/**
 * AI Provider Types
 */

export interface FrameAnalysisResult {
  description: string;
  detectedElements: string[];
  matchesSuccessCriteria: boolean;
  confidence: number;
  suggestedAction?: string;
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

export interface VisionProvider {
  analyzeFrame(
    imageBase64: string,
    currentInstruction: string,
    successCriteria: string
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
