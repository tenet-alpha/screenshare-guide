/**
 * Shared constants for the screenshare-guide protocol.
 *
 * Timing thresholds, rate limits, and consensus parameters
 * used by both server and client.
 */

// ── Server-side analysis constants ──────────────────────────────────

/** Minimum time between frame analyses (debouncing) in ms */
export const ANALYSIS_DEBOUNCE_MS = 400;

/** Consecutive successful analyses needed to advance a step */
export const SUCCESS_THRESHOLD = 1;

/** How many times a value must be seen to be accepted (consensus voting) */
export const CONSENSUS_THRESHOLD = 2;

// ── WebSocket rate limiting ─────────────────────────────────────────

/** Rate limit window in ms (10 seconds) */
export const WS_RATE_LIMIT_WINDOW = 10000;

/** Max messages per rate limit window (2fps + pings + events) */
export const WS_RATE_LIMIT_MAX = 50;

// ── TTS timing constants ────────────────────────────────────────────

/** Quiet period after link click (page loading) in ms */
export const TTS_QUIET_PERIOD_MS = 4000;

/** Time before repeating guidance when user appears stuck, in ms */
export const TTS_STUCK_TIMEOUT_MS = 15000;

// ── Anti-forgery constants ───────────────────────────────────────────

/** Default timeout for interaction challenges in ms */
export const CHALLENGE_TIMEOUT_MS = 15000;

/** Probability of issuing a challenge per step (0.0 - 1.0) */
export const CHALLENGE_PROBABILITY = 0.4;

// ── Client-side constants ───────────────────────────────────────────

/** Frame hash staleness threshold (ms) — resend even if unchanged after this */
export const FRAME_STALENESS_MS = 5000;
