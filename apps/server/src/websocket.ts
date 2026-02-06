import { Elysia, t } from "elysia";
import { analyzeFrame, generateSpeech } from "./ai";
import { db, sessions, templates } from "@screenshare-guide/db";
import { eq } from "drizzle-orm";
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
}

// In-memory session states (production would use Redis)
const activeSessions = new Map<string, SessionState>();

// Minimum time between frame analyses (debouncing)
const ANALYSIS_DEBOUNCE_MS = 2000;

// Consecutive successful analyses needed to advance
const SUCCESS_THRESHOLD = 2;

// Rate limiting for WebSocket messages
const messageRateLimit = new Map<string, { count: number; resetAt: number }>();
const WS_RATE_LIMIT_WINDOW = 10000; // 10 seconds
const WS_RATE_LIMIT_MAX = 20; // 20 messages per window

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
        const [session] = await db
          .select()
          .from(sessions)
          .where(eq(sessions.token, token));

        if (!session) {
          log.warn("Session not found for WebSocket", { token: token.substring(0, 4) });
          ws.send(JSON.stringify({ type: "error", message: "Session not found" }));
          ws.close();
          return;
        }

        if (session.status === "expired" || new Date() > session.expiresAt) {
          log.warn("Expired session WebSocket attempt", { sessionId: session.id });
          ws.send(JSON.stringify({ type: "error", message: "Session has expired" }));
          ws.close();
          return;
        }

        // Get template
        const [template] = await db
          .select()
          .from(templates)
          .where(eq(templates.id, session.templateId));

        if (!template) {
          log.error("Template not found for session", { sessionId: session.id, templateId: session.templateId });
          ws.send(JSON.stringify({ type: "error", message: "Template not found" }));
          ws.close();
          return;
        }

        const steps = template.steps as SessionState["steps"];

        // Initialize session state
        const state: SessionState = {
          sessionId: session.id,
          templateId: session.templateId,
          currentStep: session.currentStep,
          totalSteps: steps.length,
          steps,
          status: "waiting",
          lastAnalysisTime: 0,
          consecutiveSuccesses: 0,
        };

        activeSessions.set(token, state);

        log.info("WebSocket session initialized", {
          sessionId: session.id,
          totalSteps: steps.length,
          currentStep: session.currentStep,
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
    ws.send(JSON.stringify({ type: "completed", message: "All steps completed!" }));
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

    ws.send(
      JSON.stringify({
        type: "analysis",
        description: analysis.description,
        matchesSuccess: analysis.matchesSuccessCriteria,
        confidence: analysis.confidence,
      })
    );

    if (analysis.matchesSuccessCriteria && analysis.confidence > 0.7) {
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
          .update(sessions)
          .set({ currentStep: state.currentStep, updatedAt: new Date() })
          .where(eq(sessions.token, token));

        if (state.currentStep >= state.totalSteps) {
          // Session complete
          state.status = "completed";
          await db
            .update(sessions)
            .set({ status: "completed", updatedAt: new Date() })
            .where(eq(sessions.token, token));

          log.info("Session completed", { sessionId: state.sessionId });

          ws.send(JSON.stringify({ type: "completed", message: "All steps completed!" }));
          await sendInstruction(ws, "Great job! You've completed all the steps.", state);
        } else {
          // Send next instruction
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
    } else {
      state.consecutiveSuccesses = 0;

      // If user seems stuck, provide guidance
      if (analysis.suggestedAction) {
        await sendInstruction(ws, analysis.suggestedAction, state);
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
    .update(sessions)
    .set({ currentStep: state.currentStep, updatedAt: new Date() })
    .where(eq(sessions.token, token));

  if (state.currentStep >= state.totalSteps) {
    state.status = "completed";
    ws.send(JSON.stringify({ type: "completed", message: "All steps completed!" }));
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
