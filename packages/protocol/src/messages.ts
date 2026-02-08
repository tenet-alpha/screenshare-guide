/**
 * WebSocket message types for the screenshare-guide protocol.
 *
 * Discriminated unions for type-safe message handling on both
 * client and server.
 */

export interface ExtractedDataItem {
  label: string;
  value: string;
}

export interface ExtractionField {
  field: string;       // exact field name the model must use
  description: string; // what the field represents (for the prompt)
  required: boolean;   // must be present for step to complete
}

// Client → Server messages
export type ClientMessage =
  | { type: "frame"; imageData: string; frameHash?: string }
  | { type: "linkClicked"; step: number }
  | { type: "audioComplete" }
  | { type: "ping" }
  | { type: "requestHint" }
  | { type: "skipStep" }
  | { type: "challengeAck"; challengeId: string }
  | { type: "clientInfo"; platform: "web" | "ios" | "android"; displaySurface?: string; screenResolution?: string; devicePixelRatio?: number; timezone?: string };

// Server → Client messages
export type ServerMessage =
  | { type: "connected"; sessionId: string; currentStep: number; totalSteps: number; instruction: string }
  | { type: "analyzing" }
  | { type: "analysis"; matchesSuccess: boolean; confidence: number; extractedData: ExtractedDataItem[]; urlVerified?: boolean }
  | { type: "stepComplete"; currentStep: number; totalSteps: number; nextInstruction: string }
  | { type: "completed"; message?: string; extractedData: ExtractedDataItem[] }
  | { type: "audio"; text: string; audioData: string }
  | { type: "instruction"; text: string }
  | { type: "error"; message: string }
  | { type: "pong" }
  | { type: "challenge"; challengeId: string; instruction: string; timeoutMs: number };
