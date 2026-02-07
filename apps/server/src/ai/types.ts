/**
 * AI Provider Types
 */

export interface ExtractedDataItem {
  label: string;
  value: string;
}

export interface FrameAnalysisResult {
  description: string;
  detectedElements: string[];
  matchesSuccessCriteria: boolean;
  confidence: number;
  suggestedAction?: string;
  extractedData?: ExtractedDataItem[];
}

export interface QuickCheckResult {
  found: boolean;
  confidence: number;
}

export interface VoiceInfo {
  voice_id: string;
  name: string;
  category: string;
}

/**
 * Schema for expected extracted data fields per step.
 * The vision model must return data matching these exact field names.
 */
export interface ExtractionField {
  field: string;       // exact field name the model must use
  description: string; // what the field represents (for the prompt)
  required: boolean;   // must be present for step to complete
}

export interface VisionProvider {
  analyzeFrame(
    imageBase64: string,
    currentInstruction: string,
    successCriteria: string,
    extractionSchema?: ExtractionField[]
  ): Promise<FrameAnalysisResult>;

  quickElementCheck(
    imageBase64: string,
    elementDescription: string
  ): Promise<QuickCheckResult>;
}

export interface TTSProvider {
  generateSpeech(text: string, voiceId?: string): Promise<string>;
  generateSpeechStream?(text: string, voiceId?: string): AsyncGenerator<Uint8Array>;
  getVoices?(): Promise<VoiceInfo[]>;
}

export type VisionProviderType = "azure" | "anthropic";
export type TTSProviderType = "elevenlabs" | "azure";
