import { Elysia, t } from "elysia";
import { analyzeFrame, generateSpeech } from "./ai";
import { db } from "@screenshare-guide/db";
import { logWebSocket, logAI, log } from "./lib/logger";

// Session state machine
interface SessionState {
  sessionId: string;
  templateId: string;
  currentStep: number;
  totalSteps: number;
  steps: Array<{ instruction: string; successCriteria: string; hints?: string[] }>;
  status: "waiting" | "analyzing" | "speaking" | "completed";
  lastAnalysisTime: number;
  consecutiveSuccesses: number;
  linkClicked: Record<number, boolean>;
  allExtractedData: Array<{ label: string; value: string }>;
}

// In-memory session states (production would use Redis)
const activeSessions = new Map<string, SessionState>();

// Minimum time between frame analyses (debouncing)
const ANALYSIS_DEBOUNCE_MS = 800;

// Consecutive successful analyses needed to advance
const SUCCESS_THRESHOLD = 1;

// Rate limiting for WebSocket messages
const messageRateLimit = new Map<string, { count: number; resetAt: number }>();
const WS_RATE_LIMIT_WINDOW = 10000; // 10 seconds
const WS_RATE_LIMIT_MAX = 30; // 30 messages per window (increased for 1fps)

function checkWsRateLimit(token: string): boolean {
  const now = Date.now();
  let entry = messageRateLimit.get(token);

  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + WS_RATE_LIMIT_WINDOW };
    messageRateLimit.set(token, entry);
  }

  entry.count++;
  return entry.count <= WS_RATE_LIMIT_MAX;
}

export const websocketHandler = new Elysia()
  .ws("/ws/:token", {
    // Validate the token parameter
    params: t.Object({
      token: t.String(),
    }),

    // Handle WebSocket connection open
    async open(ws) {
      const { token } = ws.data.params;
      logWebSocket("open", token);

      try {
        // Validate session
        const session = await db
          .selectFrom("sessions")
          .selectAll()
          .where("token", "=", token)
          .executeTakeFirst();

        if (!session) {
          log.warn("Session not found for WebSocket", { token: token.substring(0, 4) });
          ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
          ws.close();
          return;
        }

        if (session.status === "expired" || new Date() > session.expires_at) {
          log.warn("Expired session WebSocket attempt", { sessionId: session.id });
          ws.send(JSON.stringify({ type: "error", message: "Session has expired" }));
          ws.close();
          return;
        }

        // Get template
        const template = await db
          .selectFrom("templates")
          .selectAll()
          .where("id", "=", session.template_id)
          .executeTakeFirst();

        if (!template) {
          log.error("Template not found for session", { sessionId: session.id, templateId: session.template_id });
          ws.send(JSON.stringify({ type: "error", message: "Template not found" }));
          ws.close();
          return;
        }

        const steps = (
          typeof template.steps === "string"
            ? JSON.parse(template.steps)
            : template.steps
        ) as SessionState["steps"];

        // Initialize session state (clamp currentStep to valid range)
        const clampedStep = Math.min(session.current_step, steps.length - 1);
        const state: SessionState = {
          sessionId: session.id,
          templateId: session.template_id,
          currentStep: Math.max(0, clampedStep),
          totalSteps: steps.length,
          steps,
          status: "waiting",
          lastAnalysisTime: 0,
          consecutiveSuccesses: 0,
          linkClicked: {},
          allExtractedData: [],
        };

        activeSessions.set(token, state);

        log.info("WebSocket session initialized", {
          sessionId: session.id,
          totalSteps: steps.length,
          currentStep: session.current_step,
        });

        // Send initial state
        ws.send(
          JSON.stringify({
            type: "connected",
            sessionId: session.id,
            currentStep: state.currentStep,
            totalSteps: state.totalSteps,
            instruction: steps[state.currentStep]?.instruction || "Session complete!",
          })
        );

        // If starting fresh, send the first instruction as audio
        if (state.currentStep === 0 && steps[0]) {
          await sendInstruction(ws, steps[0].instruction, state);
        }
      } catch (error) {
        log.error("WebSocket connection setup failed", error as Error);
        ws.send(JSON.stringify({ type: "error", message: "Internal error" }));
        ws.close();
      }
    },

    // Handle incoming messages (frame data)
    async message(ws, message) {
      const { token } = ws.data.params;
      const state = activeSessions.get(token);

      if (!state) {
        ws.send(JSON.stringify({ type: "error", message: "Session not initialized" }));
        return;
      }

      // Rate limiting
      if (!checkWsRateLimit(token)) {
        log.warn("WebSocket rate limit exceeded", { token: token.substring(0, 4) });
        ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded" }));
        return;
      }

      try {
        const data = typeof message === "string" ? JSON.parse(message) : message;

        logWebSocket("message", token, { type: data.type });

        // Handle different message types
        switch (data.type) {
          case "frame":
            await handleFrame(ws, state, data.imageData, token);
            break;

          case "linkClicked":
            handleLinkClicked(ws, state, data.step);
            break;

          case "requestHint":
            await handleHintRequest(ws, state);
            break;

          case "skipStep":
            await handleSkipStep(ws, state, token);
            break;

          case "ping":
            ws.send(JSON.stringify({ type: "pong" }));
            break;

          default:
            log.debug("Unknown WebSocket message type", { type: data.type });
        }
      } catch (error) {
        log.error("WebSocket message processing failed", error as Error);
        ws.send(JSON.stringify({ type: "error", message: "Failed to process message" }));
      }
    },

    // Handle WebSocket close
    close(ws) {
      const { token } = ws.data.params;
      logWebSocket("close", token);
      activeSessions.delete(token);
      messageRateLimit.delete(token);
    },
  });

/**
 * Handle linkClicked message from client
 */
function handleLinkClicked(ws: any, state: SessionState, step: number) {
  log.info("Link clicked by user", {
    sessionId: state.sessionId,
    step,
  });
  state.linkClicked[step] = true;
}

/**
 * Accumulate extracted data (dedup by label, keep latest)
 */
function accumulateExtractedData(
  state: SessionState,
  items: Array<{ label: string; value: string }>
) {
  if (!items?.length) return;
  for (const item of items) {
    if (!item.label || !item.value) continue;
    const idx = state.allExtractedData.findIndex((d) => d.label === item.label);
    if (idx >= 0) {
      state.allExtractedData[idx] = item;
    } else {
      state.allExtractedData.push(item);
    }
  }
}

/**
 * For Step 3 (index 2): check if all required metrics are present
 */
function hasAllStep3Metrics(state: SessionState): boolean {
  const labels = state.allExtractedData.map((d) => d.label.toLowerCase());
  const hasReach = labels.some((l) => l.includes("reach"));
  const hasNonFollowers = labels.some((l) => l.includes("non-follower") || l.includes("non follower"));
  const hasFollowers = labels.some(
    (l) => l.includes("follower") && !l.includes("non-follower") && !l.includes("non follower")
  );
  return hasReach && hasNonFollowers && hasFollowers;
}

/**
 * Handle incoming frame for analysis
 */
async function handleFrame(
  ws: any,
  state: SessionState,
  imageData: string,
  token: string
) {
  // Debounce analysis
  const now = Date.now();
  if (now - state.lastAnalysisTime < ANALYSIS_DEBOUNCE_MS) {
    return;
  }

  // Skip if session is completed or currently speaking
  if (state.status === "completed" || state.status === "speaking") {
    return;
  }

  state.status = "analyzing";
  state.lastAnalysisTime = now;

  const currentStepData = state.steps[state.currentStep];
  if (!currentStepData) {
    state.status = "completed";
    ws.send(JSON.stringify({ type: "completed", message: "All steps completed!", extractedData: state.allExtractedData }));
    return;
  }

  ws.send(JSON.stringify({ type: "analyzing" }));

  const startTime = Date.now();
  try {
    // Analyze the frame with AI provider
    const analysis = await analyzeFrame(
      imageData,
      currentStepData.instruction,
      currentStepData.successCriteria
    );

    logAI("vision", "analyzeFrame", Date.now() - startTime);

    // Accumulate any extracted data
    if (analysis.extractedData?.length) {
      accumulateExtractedData(state, analysis.extractedData);
    }

    ws.send(
      JSON.stringify({
        type: "analysis",
        description: analysis.description,
        matchesSuccess: analysis.matchesSuccessCriteria,
        confidence: analysis.confidence,
        extractedData: analysis.extractedData || [],
      })
    );

    if (analysis.matchesSuccessCriteria && analysis.confidence > 0.7) {
      // For step 3 (index 2), require all three metrics before advancing
      if (state.currentStep === 2 && !hasAllStep3Metrics(state)) {
        log.info("Step 3: not all metrics found yet", {
          sessionId: state.sessionId,
          extractedData: state.allExtractedData,
        });
        state.status = "waiting";
        return;
      }

      state.consecutiveSuccesses++;

      if (state.consecutiveSuccesses >= SUCCESS_THRESHOLD) {
        // Advance to next step
        state.currentStep++;
        state.consecutiveSuccesses = 0;

        log.info("Session step advanced", {
          sessionId: state.sessionId,
          newStep: state.currentStep,
          totalSteps: state.totalSteps,
        });

        // Update database
        await db
          .updateTable("sessions")
          .set({ current_step: state.currentStep, updated_at: new Date() })
          .where("token", "=", token)
          .execute();

        // Build acknowledgment from extracted data
        const extractedSummary = (analysis.extractedData || [])
          .map((d: { label: string; value: string }) => `${d.label}: ${d.value}`)
          .join(", ");

        if (state.currentStep >= state.totalSteps) {
          // Session complete — store extracted data in session metadata
          state.status = "completed";

          const metadataJson = JSON.stringify({
            extractedData: state.allExtractedData,
            completedAt: new Date().toISOString(),
          });

          await db
            .updateTable("sessions")
            .set({
              status: "completed",
              metadata: metadataJson,
              updated_at: new Date(),
            })
            .where("token", "=", token)
            .execute();

          log.info("Session completed", {
            sessionId: state.sessionId,
            extractedData: state.allExtractedData,
          });

          ws.send(JSON.stringify({
            type: "completed",
            message: "All steps completed!",
            extractedData: state.allExtractedData,
          }));
          const completionMsg = extractedSummary
            ? `I've captured everything. ${extractedSummary}. Great job — all steps are complete!`
            : "Great job! You've completed all the steps.";
          await sendInstruction(ws, completionMsg, state);
        } else {
          // Send next instruction with acknowledgment of what was found
          const nextStep = state.steps[state.currentStep];
          ws.send(
            JSON.stringify({
              type: "stepComplete",
              currentStep: state.currentStep,
              totalSteps: state.totalSteps,
              nextInstruction: nextStep.instruction,
            })
          );

          const ackPrefix = extractedSummary
            ? `I can see ${extractedSummary}. Step complete! Now, `
            : `Step complete! Now, `;
          await sendInstruction(ws, `${ackPrefix}${nextStep.instruction}`, state);
        }
      }
    } else {
      state.consecutiveSuccesses = 0;

      // Provide contextual guidance based on what vision sees
      if (analysis.suggestedAction) {
        const seenContext = analysis.description !== "Unable to analyze frame"
          ? `I can see ${analysis.description.toLowerCase()}. `
          : "";
        await sendInstruction(ws, `${seenContext}${analysis.suggestedAction}`, state);
      }
    }

    state.status = "waiting";
  } catch (error) {
    logAI("vision", "analyzeFrame", Date.now() - startTime, error as Error);
    state.status = "waiting";
    ws.send(JSON.stringify({ type: "error", message: "Analysis failed" }));
  }
}

/**
 * Handle request for a hint
 */
async function handleHintRequest(ws: any, state: SessionState) {
  const currentStep = state.steps[state.currentStep];
  if (!currentStep) return;

  const hints = currentStep.hints || [];
  if (hints.length > 0) {
    const hint = hints[Math.floor(Math.random() * hints.length)];
    await sendInstruction(ws, `Here's a hint: ${hint}`, state);
  } else {
    await sendInstruction(ws, `Try this: ${currentStep.instruction}`, state);
  }
}

/**
 * Handle manual step skip
 */
async function handleSkipStep(ws: any, state: SessionState, token: string) {
  log.info("Step skipped by user", {
    sessionId: state.sessionId,
    skippedStep: state.currentStep,
  });

  state.currentStep++;
  state.consecutiveSuccesses = 0;

  await db
    .updateTable("sessions")
    .set({ current_step: state.currentStep, updated_at: new Date() })
    .where("token", "=", token)
    .execute();

  if (state.currentStep >= state.totalSteps) {
    state.status = "completed";
    ws.send(JSON.stringify({ type: "completed", message: "All steps completed!", extractedData: state.allExtractedData }));
  } else {
    const nextStep = state.steps[state.currentStep];
    ws.send(
      JSON.stringify({
        type: "stepComplete",
        currentStep: state.currentStep,
        totalSteps: state.totalSteps,
        nextInstruction: nextStep.instruction,
      })
    );
    await sendInstruction(ws, nextStep.instruction, state);
  }
}

/**
 * Generate TTS and send audio to client
 */
async function sendInstruction(ws: any, text: string, state: SessionState) {
  state.status = "speaking";

  const startTime = Date.now();
  try {
    const audioBase64 = await generateSpeech(text);

    logAI("tts", "generateSpeech", Date.now() - startTime);

    ws.send(
      JSON.stringify({
        type: "audio",
        text,
        audioData: audioBase64,
      })
    );
  } catch (error) {
    logAI("tts", "generateSpeech", Date.now() - startTime, error as Error);
    // Fall back to text only
    ws.send(
      JSON.stringify({
        type: "instruction",
        text,
      })
    );
  }

  state.status = "waiting";
}
