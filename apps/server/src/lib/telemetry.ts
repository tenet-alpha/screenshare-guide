/**
 * Azure Application Insights Telemetry
 *
 * Auto-collects HTTP requests, exceptions, and console logs.
 * Custom metrics for AI operations, WS sessions, and verification completions.
 *
 * Enabled when APPLICATIONINSIGHTS_CONNECTION_STRING is set.
 * No-ops gracefully when not configured (dev/test).
 */

import type { TelemetryClient } from "applicationinsights";

let client: TelemetryClient | null = null;

/**
 * Initialize Application Insights. Call once at server startup.
 * Must be called BEFORE other imports to enable auto-instrumentation.
 */
export function initTelemetry(): void {
  const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;
  if (!connectionString) {
    return;
  }

  try {
    // Dynamic import to avoid loading the SDK when not configured
    const appInsights = require("applicationinsights");
    appInsights
      .setup(connectionString)
      .setAutoCollectConsole(true, true) // stdout + stderr
      .setAutoCollectExceptions(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectRequests(true)
      .setAutoCollectDependencies(true)
      .setSendLiveMetrics(true) // Live Metrics Stream
      .start();

    client = appInsights.defaultClient;

    // Set cloud role for identification in App Insights
    if (client) {
      client.context.tags[client.context.keys.cloudRole] = "screenshare-server";
    }

    console.log("[Telemetry] Application Insights initialized");
  } catch (error) {
    console.warn("[Telemetry] Failed to initialize Application Insights:", error);
  }
}

// ─── Custom Metrics ─────────────────────────────────────────────────

/**
 * Track AI vision analysis latency and result.
 */
export function trackVisionAnalysis(
  durationMs: number,
  success: boolean,
  stepIndex: number,
  confidence?: number
): void {
  if (!client) return;
  client.trackMetric({
    name: "vision.analysis.duration",
    value: durationMs,
    properties: {
      step: String(stepIndex),
      success: String(success),
      confidence: confidence !== undefined ? String(confidence) : undefined,
    },
  });
}

/**
 * Track TTS generation latency.
 */
export function trackTTSGeneration(durationMs: number, success: boolean): void {
  if (!client) return;
  client.trackMetric({
    name: "tts.generation.duration",
    value: durationMs,
    properties: { success: String(success) },
  });
}

/**
 * Track WebSocket session lifecycle.
 */
export function trackSessionEvent(
  event: "connected" | "completed" | "disconnected" | "error",
  sessionId: string,
  properties?: Record<string, string>
): void {
  if (!client) return;
  client.trackEvent({
    name: `session.${event}`,
    properties: {
      sessionId,
      ...properties,
    },
  });
}

/**
 * Track verification completion with extracted data summary.
 */
export function trackVerificationComplete(
  sessionId: string,
  platform: string,
  fieldsExtracted: number,
  totalDurationMs?: number
): void {
  if (!client) return;
  client.trackEvent({
    name: "verification.complete",
    properties: {
      sessionId,
      platform,
      fieldsExtracted: String(fieldsExtracted),
    },
    measurements: {
      durationMs: totalDurationMs ?? 0,
    },
  });
}

/**
 * Track frame throughput (batched — call periodically, not per frame).
 */
export function trackFrameMetrics(
  framesReceived: number,
  framesAnalyzed: number,
  framesSkipped: number
): void {
  if (!client) return;
  client.trackMetric({ name: "frames.received", value: framesReceived });
  client.trackMetric({ name: "frames.analyzed", value: framesAnalyzed });
  client.trackMetric({ name: "frames.skipped", value: framesSkipped });
}

/**
 * Flush all pending telemetry (call on shutdown).
 */
export async function flushTelemetry(): Promise<void> {
  if (!client) return;
  try {
    await client.flush();
  } catch {
    // Best-effort flush on shutdown
  }
}
