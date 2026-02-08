import { Elysia, t } from "elysia";
import { analyzeFrame, generateSpeech } from "./ai";
import { db } from "@screenshare-guide/db";
import { logWebSocket, logAI, log } from "./lib/logger";
import { notifyWebhook } from "./lib/webhook";
import {
  CONSENSUS_THRESHOLD,
  ANALYSIS_DEBOUNCE_MS,
  SUCCESS_THRESHOLD,
  WS_RATE_LIMIT_WINDOW,
  WS_RATE_LIMIT_MAX,
  TTS_QUIET_PERIOD_MS,
  TTS_STUCK_TIMEOUT_MS,
  PROOF_TEMPLATES,
  CHALLENGE_TIMEOUT_MS,
  CHALLENGE_PROBABILITY,
  computeTrustScore,
} from "@screenshare-guide/protocol";
import type {
  TrustSignals,
  TemporalConsistencyResult,
  FrameSimilarityResult,
  VisualContinuityResult,
} from "@screenshare-guide/protocol";
import { nanoid } from "nanoid";
import {
  trackVisionAnalysis,
  trackTTSGeneration,
  trackSessionEvent,
  trackVerificationComplete,
} from "./lib/telemetry";
import { clientMessageSchema } from "./websocket-schemas";
import { createSessionStore } from "./lib/redis";
import type { SessionState, SessionStore } from "./lib/redis";

// Session store (Redis in production, in-memory Map in dev)
export const sessionStore: SessionStore = createSessionStore();

// Rate limiting for WebSocket messages (ephemeral, per-instance is fine)
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

// ── Anti-forgery signal computation ─────────────────────────────────

/**
 * Compute temporal consistency from recorded frame timestamps.
 * Detects bot-like uniform timing and suspiciously fast intervals.
 */
function computeTemporalConsistency(
  timestamps: number[],
  frameHashes: string[]
): TemporalConsistencyResult | null {
  if (timestamps.length < 3) return null;

  const intervals: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    intervals.push(timestamps[i] - timestamps[i - 1]);
  }

  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance =
    intervals.reduce((sum, v) => sum + (v - mean) ** 2, 0) / intervals.length;
  const stddev = Math.sqrt(variance);
  const cv = mean > 0 ? stddev / mean : 0;

  // Count suspiciously fast intervals:
  // An interval < 200ms where the frame hash also changed implies content
  // was swapped faster than a human screen recording would produce.
  let suspiciouslyFastCount = 0;
  for (let i = 0; i < intervals.length; i++) {
    if (intervals[i] < 200) {
      // Check if frame hash changed (if we have hashes)
      if (frameHashes.length > i + 1 && frameHashes[i] !== frameHashes[i + 1]) {
        suspiciouslyFastCount++;
      }
    }
  }

  return {
    meanIntervalMs: Math.round(mean),
    stddevMs: Math.round(stddev),
    coefficientOfVariation: Math.round(cv * 1000) / 1000,
    suspiciouslyFastCount,
    totalIntervals: intervals.length,
  };
}

/**
 * Compute frame similarity metrics from client-provided frame hashes.
 * Detects replay attacks (same frames submitted repeatedly) and
 * splicing (abrupt hash changes without transition).
 */
function computeFrameSimilarity(
  frameHashes: string[]
): FrameSimilarityResult | null {
  if (frameHashes.length < 3) return null;

  let duplicateHashCount = 0;
  let abruptChangeCount = 0;
  const uniqueHashes = new Set(frameHashes);

  for (let i = 1; i < frameHashes.length; i++) {
    if (frameHashes[i] === frameHashes[i - 1]) {
      duplicateHashCount++;
    }
    // "Abrupt change" = completely different hash with no intermediate transition.
    // We detect this by checking if 3+ consecutive frames all have unique hashes
    // that don't repeat nearby — a sign of spliced/stitched content.
    // Simple heuristic: if both neighboring pairs are different, it's an abrupt transition.
    if (
      i >= 2 &&
      frameHashes[i] !== frameHashes[i - 1] &&
      frameHashes[i - 1] !== frameHashes[i - 2] &&
      frameHashes[i] !== frameHashes[i - 2]
    ) {
      abruptChangeCount++;
    }
  }

  return {
    duplicateHashCount,
    abruptChangeCount,
    totalTransitions: frameHashes.length - 1,
    uniqueHashRatio:
      Math.round((uniqueHashes.size / frameHashes.length) * 100) / 100,
  };
}

/**
 * Build visual continuity result from tracked frame-level signals.
 */
function buildVisualContinuity(
  consistent: number,
  discontinuous: number
): VisualContinuityResult | null {
  const total = consistent + discontinuous;
  if (total < 1) return null;
  return {
    consistentFrames: consistent,
    discontinuousFrames: discontinuous,
    totalChecked: total,
  };
}

/**
 * Build complete TrustSignals from session state.
 * Centralized to avoid duplication across completion paths.
 */
function buildTrustSignals(state: SessionState): TrustSignals {
  return {
    urlVerified:
      state.trustSignals.urlVerifiedCount > 0 &&
      state.trustSignals.urlNotVerifiedCount === 0,
    urlVerifiedRatio:
      state.trustSignals.framesAnalyzed > 0
        ? state.trustSignals.urlVerifiedCount /
          state.trustSignals.framesAnalyzed
        : 0,
    challengePassed:
      state.challengeResults.length > 0
        ? state.challengeResults.every((r) => r.passed)
        : null,
    challengeResponseMs:
      state.challengeResults.length > 0
        ? state.challengeResults[state.challengeResults.length - 1]
            .responseTimeMs
        : null,
    sessionDurationMs: Date.now() - state.trustSignals.sessionStartedAt,
    framesAnalyzed: state.trustSignals.framesAnalyzed,
    displaySurface: state.trustSignals.displaySurface,
    clientPlatform: state.trustSignals.clientPlatform,
    // New signals
    temporalConsistency: computeTemporalConsistency(
      state.trustSignals.frameTimestamps,
      state.trustSignals.frameHashes
    ),
    frameSimilarity: computeFrameSimilarity(
      state.trustSignals.frameHashes
    ),
    visualContinuity: buildVisualContinuity(
      state.trustSignals.visualContinuityConsistent,
      state.trustSignals.visualContinuityDiscontinuous
    ),
  };
}

export const websocketHandler = new Elysia()
  // Derive origin header so it's available in ws.data for origin validation
  .derive(({ request }) => {
    const origin = request.headers.get("origin") ?? undefined;
    return { origin };
  })
  .ws("/ws/:token", {
    // Validate the token parameter
    params: t.Object({
      token: t.String(),
    }),

    // Handle WebSocket connection open
    async open(ws) {
      const { token } = ws.data.params;
      logWebSocket("open", token);

      // --- WebSocket origin validation ---
      const origin = ws.data.origin;
      const allowedOrigins =
        process.env.CORS_ORIGIN?.split(",").map((o) => o.trim()) || [
          "http://localhost:3000",
        ];

      // In production, reject connections from disallowed origins
      if (
        process.env.NODE_ENV === "production" &&
        origin &&
        !allowedOrigins.includes(origin)
      ) {
        log.warn("WebSocket rejected: invalid origin", { origin });
        ws.send(
          JSON.stringify({ type: "error", message: "Invalid origin" })
        );
        ws.close();
        return;
      }

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

        // Derive platform from template name by reverse-looking up in PROOF_TEMPLATES
        const platform = Object.entries(PROOF_TEMPLATES).find(
          ([, t]) => t.name === template.name
        )?.[0] ?? "unknown";

        // Initialize session state (clamp currentStep to valid range)
        const clampedStep = Math.min(session.current_step, steps.length - 1);
        const state: SessionState = {
          sessionId: session.id,
          templateId: session.template_id,
          platform,
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
          activeChallenge: null,
          challengeResults: [],
          challengeIssued: false,
          trustSignals: {
            urlVerifiedCount: 0,
            urlNotVerifiedCount: 0,
            framesAnalyzed: 0,
            sessionStartedAt: Date.now(),
            displaySurface: null,
            clientPlatform: "web",
            frameTimestamps: [],
            frameHashes: [],
            visualContinuityConsistent: 0,
            visualContinuityDiscontinuous: 0,
            previousFrameDescription: null,
          },
        };

        await sessionStore.set(token, state);

        log.info("WebSocket session initialized", {
          sessionId: session.id,
          totalSteps: steps.length,
          currentStep: session.current_step,
        });

        trackSessionEvent("connected", session.id, {
          totalSteps: String(steps.length),
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
      const state = await sessionStore.get(token);

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
        // Max message size check BEFORE JSON.parse to prevent OOM
        if (typeof message === "string" && message.length > 3 * 1024 * 1024) {
          log.warn("WebSocket message too large, rejecting", { token: token.substring(0, 4), size: message.length });
          ws.send(JSON.stringify({ type: "error", message: "Message too large" }));
          return;
        }

        const raw = typeof message === "string" ? JSON.parse(message) : message;

        // Validate message shape with zod
        const parsed = clientMessageSchema.safeParse(raw);
        if (!parsed.success) {
          log.warn("Invalid WebSocket message format", { token: token.substring(0, 4), errors: parsed.error.issues });
          ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
          return;
        }

        const data = parsed.data;

        logWebSocket("message", token, { type: data.type });

        // Handle different message types
        switch (data.type) {
          case "frame":
            await handleFrame(ws, state, data.imageData, token, data.frameHash);
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

          case "challengeAck":
            log.info("Challenge acknowledged by client", {
              sessionId: state.sessionId,
              challengeId: data.challengeId,
            });
            break;

          case "clientInfo":
            log.info("Client info received", {
              sessionId: state.sessionId,
              platform: data.platform,
              displaySurface: data.displaySurface,
            });
            state.trustSignals.clientPlatform = data.platform;
            if (data.displaySurface) {
              state.trustSignals.displaySurface = data.displaySurface;
            }
            break;
        }

        // Persist mutated state back to store
        await sessionStore.set(token, state);
      } catch (error) {
        log.error("WebSocket message processing failed", error as Error);
        ws.send(JSON.stringify({ type: "error", message: "Failed to process message" }));
      }
    },

    // Handle WebSocket close
    async close(ws) {
      const { token } = ws.data.params;
      const state = await sessionStore.get(token);
      logWebSocket("close", token);
      if (state) {
        trackSessionEvent("disconnected", state.sessionId);
      }
      await sessionStore.delete(token);
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
  token: string,
  frameHash?: string
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

  // ── Track temporal consistency (frame timing) ─────────────────
  state.trustSignals.frameTimestamps.push(now);
  // Cap array to last 100 entries to bound memory
  if (state.trustSignals.frameTimestamps.length > 100) {
    state.trustSignals.frameTimestamps = state.trustSignals.frameTimestamps.slice(-100);
  }

  // ── Track frame similarity (client-provided hashes) ───────────
  if (frameHash) {
    state.trustSignals.frameHashes.push(frameHash);
    if (state.trustSignals.frameHashes.length > 100) {
      state.trustSignals.frameHashes = state.trustSignals.frameHashes.slice(-100);
    }
  }

  const startTime = Date.now();
  try {
    // If a challenge is active, analyze against the challenge criteria instead
    const isChallenge = state.activeChallenge !== null;
    const analyzeInstruction = isChallenge
      ? state.activeChallenge!.instruction
      : currentStepData.instruction;
    const analyzeCriteria = isChallenge
      ? state.activeChallenge!.successCriteria
      : currentStepData.successCriteria;

    // Analyze the frame with AI provider, passing extraction schema if defined
    const schema = isChallenge ? undefined : currentStepData.extractionSchema;
    const analysis = await analyzeFrame(
      imageData,
      analyzeInstruction,
      analyzeCriteria,
      schema,
      currentStepData.expectedDomain,
      // Pass previous frame description for visual continuity checking (skip on first frame)
      state.trustSignals.previousFrameDescription ?? undefined
    );

    const analysisDuration = Date.now() - startTime;
    logAI("vision", "analyzeFrame", analysisDuration);
    trackVisionAnalysis(
      analysisDuration,
      analysis.matchesSuccessCriteria,
      state.currentStep,
      analysis.confidence
    );

    // Track trust signals
    state.trustSignals.framesAnalyzed++;
    if (analysis.urlVerified === true) {
      state.trustSignals.urlVerifiedCount++;
    } else if (currentStepData.expectedDomain) {
      state.trustSignals.urlNotVerifiedCount++;
    }

    // Track visual continuity
    if (analysis.visualContinuity === true) {
      state.trustSignals.visualContinuityConsistent++;
    } else if (analysis.visualContinuity === false) {
      state.trustSignals.visualContinuityDiscontinuous++;
    }
    // Store frame description as baseline for next frame's continuity check
    if (analysis.description) {
      state.trustSignals.previousFrameDescription = analysis.description;
    }

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
        ...(analysis.urlVerified !== undefined && { urlVerified: analysis.urlVerified }),
      })
    );

    if (analysis.matchesSuccessCriteria && analysis.confidence > 0.7) {
      // If a challenge is active, handle challenge verification
      if (state.activeChallenge) {
        const responseTimeMs = Date.now() - state.activeChallenge.issuedAt;

        // Check for timeout
        if (responseTimeMs > state.activeChallenge.timeoutMs) {
          log.info("Challenge timed out", {
            sessionId: state.sessionId,
            challengeId: state.activeChallenge.id,
            responseTimeMs,
          });
          state.challengeResults.push({
            challengeId: state.activeChallenge.id,
            step: state.currentStep,
            passed: false,
            responseTimeMs,
          });
          state.activeChallenge = null;
          // Still advance the step (silent flagging — don't block the user)
        } else {
          // Challenge succeeded
          log.info("Challenge passed", {
            sessionId: state.sessionId,
            challengeId: state.activeChallenge.id,
            responseTimeMs,
          });
          state.challengeResults.push({
            challengeId: state.activeChallenge.id,
            step: state.currentStep,
            passed: true,
            responseTimeMs,
          });
          state.activeChallenge = null;
        }
        // Fall through to advance the step below
        state.consecutiveSuccesses = SUCCESS_THRESHOLD; // Ensure we advance
      }

      // Check if all required fields from the extraction schema are present
      if (!state.activeChallenge && !hasAllRequiredFields(state)) {
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
        // Issue interaction challenge before advancing (if applicable)
        if (
          !state.challengeIssued &&
          !state.activeChallenge &&
          currentStepData.interactionChallenges?.length &&
          Math.random() < CHALLENGE_PROBABILITY
        ) {
          const challenges = currentStepData.interactionChallenges;
          const challenge = challenges[Math.floor(Math.random() * challenges.length)];
          const challengeId = nanoid();
          const timeoutMs = challenge.timeoutMs ?? CHALLENGE_TIMEOUT_MS;

          state.activeChallenge = {
            id: challengeId,
            instruction: challenge.instruction,
            successCriteria: challenge.successCriteria,
            issuedAt: Date.now(),
            timeoutMs,
          };
          state.challengeIssued = true;

          log.info("Challenge issued", {
            sessionId: state.sessionId,
            challengeId,
            instruction: challenge.instruction,
          });

          ws.send(JSON.stringify({
            type: "challenge",
            challengeId,
            instruction: challenge.instruction,
            timeoutMs,
          }));

          await sendInstruction(ws, challenge.instruction, state);

          // Do NOT advance the step — return early
          state.status = "waiting";
          return;
        }

        // Advance to next step
        state.currentStep++;
        state.consecutiveSuccesses = 0;
        state.lastSpokenAction = null; // Reset so next step's first instruction fires
        state.challengeIssued = false; // Reset for next step

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
          // Session complete — compute trust score and store extracted data in session metadata
          state.status = "completed";

          const trustSignals = buildTrustSignals(state);
          const trustResult = computeTrustScore(trustSignals);

          const metadataJson = JSON.stringify({
            extractedData: state.allExtractedData,
            completedAt: new Date().toISOString(),
            trust: trustResult,
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
            trustScore: trustResult.score,
            trustFlags: trustResult.flags,
          });

          // Fire-and-forget webhook notification
          notifyWebhook({
            event: "session.completed",
            sessionId: state.sessionId,
            platform: state.platform,
            extractedData: state.allExtractedData,
            completedAt: new Date().toISOString(),
            trust: trustResult,
          }).catch(() => {});

          trackSessionEvent("completed", state.sessionId, {
            fieldsExtracted: String(state.allExtractedData.length),
          });
          trackVerificationComplete(
            state.sessionId,
            state.platform,
            state.allExtractedData.length
          );

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
      // Check for challenge timeout even on non-matching frames
      if (state.activeChallenge) {
        const responseTimeMs = Date.now() - state.activeChallenge.issuedAt;
        if (responseTimeMs > state.activeChallenge.timeoutMs) {
          log.info("Challenge timed out (non-match)", {
            sessionId: state.sessionId,
            challengeId: state.activeChallenge.id,
            responseTimeMs,
          });
          state.challengeResults.push({
            challengeId: state.activeChallenge.id,
            step: state.currentStep,
            passed: false,
            responseTimeMs,
          });
          state.activeChallenge = null;
          // Advance the step (silent flagging)
          state.currentStep++;
          state.consecutiveSuccesses = 0;
          state.lastSpokenAction = null;
          state.challengeIssued = false;

          await db
            .updateTable("sessions")
            .set({ current_step: state.currentStep, updated_at: new Date() })
            .where("token", "=", token)
            .execute();

          if (state.currentStep >= state.totalSteps) {
            state.status = "completed";
            // Build trust score
            const trustSignals = buildTrustSignals(state);
            const trustResult = computeTrustScore(trustSignals);

            const metadataJson = JSON.stringify({
              extractedData: state.allExtractedData,
              completedAt: new Date().toISOString(),
              trust: trustResult,
            });

            await db
              .updateTable("sessions")
              .set({ status: "completed", metadata: metadataJson, updated_at: new Date() })
              .where("token", "=", token)
              .execute();

            notifyWebhook({
              event: "session.completed",
              sessionId: state.sessionId,
              platform: state.platform,
              extractedData: state.allExtractedData,
              completedAt: new Date().toISOString(),
              trust: trustResult,
            }).catch(() => {});

            ws.send(JSON.stringify({ type: "completed", message: "All steps completed!", extractedData: state.allExtractedData }));
            await sendInstruction(ws, "All steps complete. Verification finished.", state);
          } else {
            const nextStep = state.steps[state.currentStep];
            ws.send(JSON.stringify({
              type: "stepComplete",
              currentStep: state.currentStep,
              totalSteps: state.totalSteps,
              nextInstruction: nextStep.instruction,
            }));
            await sendInstruction(ws, `Step complete. ${nextStep.instruction}`, state);
          }
          return;
        }
      }

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
    const errorDuration = Date.now() - startTime;
    logAI("vision", "analyzeFrame", errorDuration, error as Error);
    trackVisionAnalysis(errorDuration, false, state.currentStep);
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

    const ttsDuration = Date.now() - startTime;
    logAI("tts", "generateSpeech", ttsDuration);
    trackTTSGeneration(ttsDuration, true);

    ws.send(
      JSON.stringify({
        type: "audio",
        text,
        audioData: audioBase64,
      })
    );
  } catch (error) {
    const ttsErrorDuration = Date.now() - startTime;
    logAI("tts", "generateSpeech", ttsErrorDuration, error as Error);
    trackTTSGeneration(ttsErrorDuration, false);
    // Fall back to text only
    ws.send(
      JSON.stringify({
        type: "instruction",
        text,
      })
    );
  }
}
