import { Elysia, t } from "elysia";
import { analyzeFrame, generateSpeech } from "./ai";
import { db } from "@screenshare-guide/db";
import { logWebSocket, logAI, log } from "./lib/logger";
import {
  CONSENSUS_THRESHOLD,
  ANALYSIS_DEBOUNCE_MS,
  SUCCESS_THRESHOLD,
  WS_RATE_LIMIT_WINDOW,
  WS_RATE_LIMIT_MAX,
  TTS_QUIET_PERIOD_MS,
  TTS_STUCK_TIMEOUT_MS,
} from "@screenshare-guide/protocol";
import type { ProofStep } from "@screenshare-guide/protocol";

// Session state machine
interface SessionState {
  sessionId: string;
  templateId: string;
  currentStep: number;
  totalSteps: number;
  steps: ProofStep[];
  status: "waiting" | "analyzing" | "completed";
  lastAnalysisTime: number;
  consecutiveSuccesses: number;
  linkClicked: Record<number, boolean>;
  allExtractedData: Array<{ label: string; value: string }>;
  /** Vote counter: field → { value → count }. Used for consensus before committing. */
  extractionVotes: Record<string, Record<string, number>>;
  lastSpokenAction: string | null;
  lastInstructionTime: number;
  /** Timestamp when the last link was clicked — used for quiet period */
  linkClickedTime: number;
  /** Last suggestedAction from vision — used for stability gate (must match twice before speaking) */
  pendingSuggestedAction: string | null;
}

// In-memory session states (production would use Redis)
const activeSessions = new Map<string, SessionState>();

// Rate limiting for WebSocket messages
const messageRateLimit = new Map<string, { count: number; resetAt: number }>();

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

        // Restore extracted data from existing metadata (for reconnection resilience)
        let restoredExtractedData: Array<{ label: string; value: string }> = [];
        try {
          const rawMetadata = session.metadata;
          const parsed = typeof rawMetadata === "string" ? JSON.parse(rawMetadata) : rawMetadata;
          if (parsed?.extractedData && Array.isArray(parsed.extractedData)) {
            restoredExtractedData = parsed.extractedData;
          }
        } catch {
          // Ignore parse errors — start fresh
        }

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
          allExtractedData: restoredExtractedData,
          extractionVotes: {},
          lastSpokenAction: null,
          lastInstructionTime: 0,
          linkClickedTime: 0,
          pendingSuggestedAction: null,
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

          case "audioComplete":
            // Client finished playing audio — no longer blocks analysis but kept for compatibility
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
  state.linkClickedTime = Date.now();
  // Reset TTS state — fresh start after navigation
  state.lastSpokenAction = null;
  state.pendingSuggestedAction = null;
}

/**
 * Accumulate extracted data using consensus voting.
 * Each field+value pair gets voted on. A value is only committed to
 * allExtractedData once it reaches CONSENSUS_THRESHOLD votes.
 * This filters out OCR misreads (e.g., "@dkdus4n" vs "@kdus4n").
 */
function accumulateExtractedData(
  state: SessionState,
  items: Array<{ label: string; value: string }>
) {
  if (!items?.length) return;
  for (const item of items) {
    if (!item.label || !item.value) continue;

    // Initialize vote bucket for this field if needed
    if (!state.extractionVotes[item.label]) {
      state.extractionVotes[item.label] = {};
    }
    const votes = state.extractionVotes[item.label];

    // Cast vote for this value
    const normalizedValue = item.value.trim();
    votes[normalizedValue] = (votes[normalizedValue] || 0) + 1;

    // Find the value with the most votes
    let bestValue = normalizedValue;
    let bestCount = 0;
    for (const [val, count] of Object.entries(votes)) {
      if (count > bestCount) {
        bestValue = val;
        bestCount = count;
      }
    }

    // Only commit once the best value reaches consensus threshold
    if (bestCount >= CONSENSUS_THRESHOLD) {
      const idx = state.allExtractedData.findIndex((d) => d.label === item.label);
      if (idx >= 0) {
        state.allExtractedData[idx] = { label: item.label, value: bestValue };
      } else {
        state.allExtractedData.push({ label: item.label, value: bestValue });
      }
    }
  }

  // Persist incrementally to DB (fire-and-forget)
  db.updateTable("sessions")
    .set({
      metadata: JSON.stringify({ extractedData: state.allExtractedData }),
      updated_at: new Date(),
    })
    .where("id", "=", state.sessionId)
    .execute()
    .catch((err) => {
      log.error("Failed to persist incremental extracted data", err as Error);
    });
}

/**
 * For Step 3 (index 2): check if all required metrics are present
 */
/**
 * Check if all required fields from the current step's extraction schema are present.
 */
function hasAllRequiredFields(state: SessionState): boolean {
  const schema = state.steps[state.currentStep]?.extractionSchema;
  if (!schema) return true; // no schema = no extraction required
  const labels = state.allExtractedData.map((d) => d.label);
  return schema
    .filter((f) => f.required)
    .every((f) => labels.includes(f.field));
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

  // Skip if session is completed
  if (state.status === "completed") {
    return;
  }

  const currentStepData = state.steps[state.currentStep];

  // Skip analysis if this step requires a link click and we haven't received one
  if (currentStepData?.requiresLinkClick && !state.linkClicked[state.currentStep]) {
    return;
  }

  state.status = "analyzing";
  state.lastAnalysisTime = now;
  if (!currentStepData) {
    state.status = "completed";
    ws.send(JSON.stringify({ type: "completed", message: "All steps completed!", extractedData: state.allExtractedData }));
    return;
  }

  ws.send(JSON.stringify({ type: "analyzing" }));

  const startTime = Date.now();
  try {
    // Analyze the frame with AI provider, passing extraction schema if defined
    const schema = currentStepData.extractionSchema;
    const analysis = await analyzeFrame(
      imageData,
      currentStepData.instruction,
      currentStepData.successCriteria,
      schema
    );

    logAI("vision", "analyzeFrame", Date.now() - startTime);

    // Filter extracted data to only include fields from known schemas
    const allKnownFields = new Set(
      state.steps.flatMap((s) => (s.extractionSchema || []).map((f) => f.field))
    );
    const validData = (analysis.extractedData || []).filter(
      (d) => d.label && d.value && allKnownFields.has(d.label)
    );

    // Accumulate only valid schema fields
    if (validData.length) {
      accumulateExtractedData(state, validData);
    }

    ws.send(
      JSON.stringify({
        type: "analysis",
        matchesSuccess: analysis.matchesSuccessCriteria,
        confidence: analysis.confidence,
        extractedData: validData,
      })
    );

    if (analysis.matchesSuccessCriteria && analysis.confidence > 0.7) {
      // Check if all required fields from the extraction schema are present
      if (!hasAllRequiredFields(state)) {
        log.info("Not all required fields found yet", {
          sessionId: state.sessionId,
          step: state.currentStep,
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
        state.lastSpokenAction = null; // Reset so next step's first instruction fires

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
          await sendInstruction(ws, "All steps complete. Verification finished.", state);
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

          await sendInstruction(ws, `Step complete. ${nextStep.instruction}`, state);
        }
      }
    } else {
      state.consecutiveSuccesses = 0;

      // TTS strategy: don't narrate every frame change.
      // Only speak when the user appears stuck (same suggestedAction seen twice + 15s timeout).
      // Stay silent during page loads (quiet period after link click).
      if (analysis.suggestedAction) {
        const now = Date.now();

        // Suppress TTS during page load quiet period
        if (now - state.linkClickedTime < TTS_QUIET_PERIOD_MS) {
          // Page is likely still loading — stay silent, just track the action
          state.pendingSuggestedAction = analysis.suggestedAction;
        } else {
          // Stability gate: only speak if this action matches the previous pending action
          // (two consecutive analyses agree = screen has stabilized)
          const isStable = analysis.suggestedAction === state.pendingSuggestedAction;
          const isStuckTimeout = (now - state.lastInstructionTime) >= TTS_STUCK_TIMEOUT_MS;
          const isNewAction = analysis.suggestedAction !== state.lastSpokenAction;

          if (isStable && isNewAction) {
            // Screen stabilized with a new action — speak it
            state.lastSpokenAction = analysis.suggestedAction;
            state.lastInstructionTime = now;
            state.pendingSuggestedAction = null;
            await sendInstruction(ws, analysis.suggestedAction, state);
          } else if (isStuckTimeout && state.lastSpokenAction) {
            // User stuck for 15s — repeat the last guidance
            state.lastInstructionTime = now;
            await sendInstruction(ws, state.lastSpokenAction, state);
          } else {
            // Track this action for stability comparison on next frame
            state.pendingSuggestedAction = analysis.suggestedAction;
          }
        }
      }
    }

    if (state.status === "analyzing") {
      state.status = "waiting";
    }
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
}
