/**
 * Trust scoring system for anti-forgery.
 *
 * Platform-agnostic: works for web screenshare and future mobile app.
 * The server computes trust signals; consumers decide thresholds.
 */

export interface TrustSignals {
  /** All frames showed URLs matching the expected domain */
  urlVerified: boolean;
  /** Number of frames where URL was verified vs total analyzed */
  urlVerifiedRatio: number;
  /** Interaction challenge was passed (null if no challenge issued) */
  challengePassed: boolean | null;
  /** Response time to interaction challenge in ms (null if no challenge) */
  challengeResponseMs: number | null;
  /** Total session duration in ms */
  sessionDurationMs: number;
  /** Number of frames analyzed */
  framesAnalyzed: number;
  /** Display surface type reported by client */
  displaySurface: string | null;
  /** Client platform identifier */
  clientPlatform: "web" | "ios" | "android" | string;
}

export interface TrustResult {
  /** Composite score 0.0 - 1.0 */
  score: number;
  /** Individual signal results */
  signals: TrustSignals;
  /** Flags for specific concerns (empty = no concerns) */
  flags: string[];
}

/**
 * Compute a trust score from collected signals.
 *
 * Weights:
 * - URL verification: 30%
 * - Interaction challenge: 35%
 * - Session timing: 15%
 * - Frame coverage: 10%
 * - Display surface: 10%
 */
export function computeTrustScore(signals: TrustSignals): TrustResult {
  const flags: string[] = [];
  let score = 0;

  // URL verification (30%)
  if (signals.urlVerified) {
    score += 0.3 * signals.urlVerifiedRatio;
  } else {
    flags.push("url_not_verified");
  }

  // Interaction challenge (35%)
  if (signals.challengePassed === null) {
    // No challenge issued — give partial credit (step may not have challenges defined)
    score += 0.2;
  } else if (signals.challengePassed) {
    score += 0.35;
  } else {
    flags.push("challenge_failed");
  }

  // Session timing (15%) — too fast or too slow is suspicious
  const durationSec = signals.sessionDurationMs / 1000;
  if (durationSec >= 15 && durationSec <= 300) {
    score += 0.15; // Normal range
  } else if (durationSec < 15) {
    score += 0.05;
    flags.push("session_too_fast");
  } else {
    score += 0.08;
    flags.push("session_too_slow");
  }

  // Frame coverage (10%) — enough frames analyzed?
  if (signals.framesAnalyzed >= 4) {
    score += 0.1;
  } else if (signals.framesAnalyzed >= 2) {
    score += 0.05;
    flags.push("low_frame_count");
  } else {
    flags.push("very_low_frame_count");
  }

  // Display surface (10%)
  if (signals.displaySurface === "monitor") {
    score += 0.1;
  } else if (signals.displaySurface) {
    score += 0.03;
    flags.push("non_monitor_surface");
  } else {
    // Mobile or unknown — neutral (don't penalize mobile)
    score += 0.05;
  }

  return {
    score: Math.round(score * 100) / 100,
    signals,
    flags,
  };
}
