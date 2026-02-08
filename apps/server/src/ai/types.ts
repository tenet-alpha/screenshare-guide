/**
 * AI Provider Types
 */

// Re-export shared types from protocol
export type { ExtractedDataItem, ExtractionField } from "@screenshare-guide/protocol";
import type { ExtractedDataItem, ExtractionField } from "@screenshare-guide/protocol";

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
