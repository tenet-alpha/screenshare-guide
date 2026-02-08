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
  STEP_LINKS,
  STEPS_REQUIRING_LINK_CLICK,
  STEP_EXTRACTION_SCHEMAS,
  INSTAGRAM_PROOF_TEMPLATE,
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
} from "./constants";
