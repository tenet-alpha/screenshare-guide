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

  // ── Temporal consistency signals ────────────────────────────────
  /** Frame timing analysis result */
  temporalConsistency: TemporalConsistencyResult | null;

  // ── Frame similarity signals ────────────────────────────────────
  /** Frame hash analysis result */
  frameSimilarity: FrameSimilarityResult | null;

  // ── Visual continuity signals ───────────────────────────────────
  /** AI-assessed visual continuity between consecutive frames */
  visualContinuity: VisualContinuityResult | null;
}

/**
 * Temporal consistency analysis — detects bot-like or pre-recorded frame timing.
 *
 * Suspicious patterns:
 * - Unnaturally uniform intervals (stddev near 0)
 * - Intervals too fast for real screen recording (< 200ms with content changes)
 * - Perfect periodicity (coefficient of variation < 5%)
 */
export interface TemporalConsistencyResult {
  /** Mean inter-frame interval in ms */
  meanIntervalMs: number;
  /** Standard deviation of inter-frame intervals in ms */
  stddevMs: number;
  /** Coefficient of variation (stddev / mean) — low = suspiciously uniform */
  coefficientOfVariation: number;
  /** Number of intervals that were suspiciously fast (< 200ms with hash change) */
  suspiciouslyFastCount: number;
  /** Total number of frame intervals measured */
  totalIntervals: number;
}

/**
 * Frame similarity analysis — detects replayed or spliced frames.
 *
 * Suspicious patterns:
 * - Identical frame hashes submitted as separate "new" frames
 * - Sudden complete hash changes without visual transition
 */
export interface FrameSimilarityResult {
  /** Number of frame pairs with identical hashes (potential replay) */
  duplicateHashCount: number;
  /** Number of frame transitions with drastic hash change (potential splice) */
  abruptChangeCount: number;
  /** Total frame transitions analyzed */
  totalTransitions: number;
  /** Ratio of unique hashes to total frames (low = suspicious looping) */
  uniqueHashRatio: number;
}

/**
 * Visual continuity analysis — AI-assessed consistency across frames.
 *
 * Checked per frame analysis:
 * - Consistent UI chrome (taskbar, dock, notification bar)
 * - Natural screen transitions vs. jump cuts
 * - Consistent display resolution / scaling
 */
export interface VisualContinuityResult {
  /** Number of frames where UI chrome was consistent with previous */
  consistentFrames: number;
  /** Number of frames flagged as discontinuous (jump cuts, splices) */
  discontinuousFrames: number;
  /** Total frames checked for continuity (first frame is baseline, so N-1) */
  totalChecked: number;
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
 * Weights (rebalanced for new signals):
 * - URL verification:      20%
 * - Interaction challenge:  25%
 * - Session timing:         10%
 * - Frame coverage:          5%
 * - Display surface:         5%
 * - Temporal consistency:   15%  (NEW)
 * - Frame similarity:       10%  (NEW)
 * - Visual continuity:      10%  (NEW)
 */
export function computeTrustScore(signals: TrustSignals): TrustResult {
  const flags: string[] = [];
  let score = 0;

  // URL verification (20%)
  if (signals.urlVerified) {
    score += 0.2 * signals.urlVerifiedRatio;
  } else {
    flags.push("url_not_verified");
  }

  // Interaction challenge (25%)
  if (signals.challengePassed === null) {
    // No challenge issued — give partial credit
    score += 0.15;
  } else if (signals.challengePassed) {
    score += 0.25;
  } else {
    flags.push("challenge_failed");
  }

  // Session timing (10%) — too fast or too slow is suspicious
  const durationSec = signals.sessionDurationMs / 1000;
  if (durationSec >= 15 && durationSec <= 300) {
    score += 0.1;
  } else if (durationSec < 15) {
    score += 0.03;
    flags.push("session_too_fast");
  } else {
    score += 0.05;
    flags.push("session_too_slow");
  }

  // Frame coverage (5%) — enough frames analyzed?
  if (signals.framesAnalyzed >= 4) {
    score += 0.05;
  } else if (signals.framesAnalyzed >= 2) {
    score += 0.025;
    flags.push("low_frame_count");
  } else {
    flags.push("very_low_frame_count");
  }

  // Display surface (5%)
  if (signals.displaySurface === "monitor") {
    score += 0.05;
  } else if (signals.displaySurface) {
    score += 0.015;
    flags.push("non_monitor_surface");
  } else {
    // Mobile or unknown — neutral (don't penalize mobile)
    score += 0.025;
  }

  // ── Temporal consistency (15%) ──────────────────────────────────
  score += scoreTemporalConsistency(signals.temporalConsistency, flags);

  // ── Frame similarity (10%) ──────────────────────────────────────
  score += scoreFrameSimilarity(signals.frameSimilarity, flags);

  // ── Visual continuity (10%) ─────────────────────────────────────
  score += scoreVisualContinuity(signals.visualContinuity, flags);

  return {
    score: Math.round(score * 100) / 100,
    signals,
    flags,
  };
}

// ── Scoring helpers ─────────────────────────────────────────────────

function scoreTemporalConsistency(
  tc: TemporalConsistencyResult | null,
  flags: string[]
): number {
  if (!tc || tc.totalIntervals < 2) {
    // Not enough data — partial credit
    return 0.08;
  }

  let s = 0.15; // Start with full credit, deduct for anomalies

  // Suspiciously uniform timing (CV < 5% with enough samples)
  if (tc.totalIntervals >= 4 && tc.coefficientOfVariation < 0.05) {
    s -= 0.08;
    flags.push("timing_too_uniform");
  }

  // Too many suspiciously fast intervals (> 30% of total)
  if (tc.suspiciouslyFastCount / tc.totalIntervals > 0.3) {
    s -= 0.07;
    flags.push("timing_suspiciously_fast");
  }

  return Math.max(0, s);
}

function scoreFrameSimilarity(
  fs: FrameSimilarityResult | null,
  flags: string[]
): number {
  if (!fs || fs.totalTransitions < 2) {
    return 0.05;
  }

  let s = 0.1;

  // High duplicate ratio (> 40% of transitions are identical hashes)
  const dupRatio = fs.duplicateHashCount / fs.totalTransitions;
  if (dupRatio > 0.4) {
    s -= 0.05;
    flags.push("frame_replay_suspected");
  }

  // Very low unique hash ratio (looping content)
  if (fs.uniqueHashRatio < 0.3) {
    s -= 0.04;
    flags.push("frame_looping_suspected");
  }

  // Too many abrupt changes (> 50% of transitions)
  const abruptRatio = fs.abruptChangeCount / fs.totalTransitions;
  if (abruptRatio > 0.5) {
    s -= 0.03;
    flags.push("frame_splicing_suspected");
  }

  return Math.max(0, s);
}

function scoreVisualContinuity(
  vc: VisualContinuityResult | null,
  flags: string[]
): number {
  if (!vc || vc.totalChecked < 1) {
    return 0.05;
  }

  const continuityRatio = vc.consistentFrames / vc.totalChecked;

  if (continuityRatio >= 0.8) {
    return 0.1; // Good continuity
  } else if (continuityRatio >= 0.5) {
    flags.push("visual_continuity_partial");
    return 0.05;
  } else {
    flags.push("visual_continuity_poor");
    return 0.02;
  }
}
