/**
 * @screenshare-guide/protocol
 *
 * Shared types, step configuration, and constants for the
 * screenshare-guide WebSocket protocol.
 */

export {
  type ExtractedDataItem,
  type ExtractionField,
  type ClientMessage,
  type ServerMessage,
} from "./messages";

export {
  type InteractionChallenge,
  type ProofStep,
  type ProofTemplate,
  INSTAGRAM_PROOF_TEMPLATE,
  PROOF_TEMPLATES,
  getAllExtractionFields,
} from "./steps";

export {
  ANALYSIS_DEBOUNCE_MS,
  SUCCESS_THRESHOLD,
  CONSENSUS_THRESHOLD,
  WS_RATE_LIMIT_WINDOW,
  WS_RATE_LIMIT_MAX,
  TTS_QUIET_PERIOD_MS,
  TTS_STUCK_TIMEOUT_MS,
  FRAME_STALENESS_MS,
  CHALLENGE_TIMEOUT_MS,
  CHALLENGE_PROBABILITY,
} from "./constants";

export {
  type TrustSignals,
  type TrustResult,
  type TemporalConsistencyResult,
  type FrameSimilarityResult,
  type VisualContinuityResult,
  computeTrustScore,
} from "./trust";
