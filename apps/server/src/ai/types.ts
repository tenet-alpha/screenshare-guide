/**
 * AI Provider Types
 * 
 * Common interfaces for vision analysis and text-to-speech
 * that can be implemented by different AI providers.
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

/**
 * Vision analysis provider interface
 */
export interface VisionProvider {
  /**
   * Analyze a screen frame to evaluate task progress
   */
  analyzeFrame(
    imageBase64: string,
    currentInstruction: string,
    successCriteria: string
  ): Promise<FrameAnalysisResult>;

  /**
   * Quick check if a specific element is visible
   */
  quickElementCheck(
    imageBase64: string,
    elementDescription: string
  ): Promise<QuickCheckResult>;
}

/**
 * Text-to-speech provider interface
 */
export interface TTSProvider {
  /**
   * Generate speech audio from text
   * @returns Base64 encoded audio data
   */
  generateSpeech(text: string, voiceId?: string): Promise<string>;

  /**
   * Generate speech with streaming support
   */
  generateSpeechStream?(text: string, voiceId?: string): AsyncGenerator<Uint8Array>;

  /**
   * Get available voices
   */
  getVoices?(): Promise<VoiceInfo[]>;
}

/**
 * Combined AI provider interface
 */
export interface AIProvider {
  vision: VisionProvider;
  tts: TTSProvider;
}

/**
 * Supported AI provider types
 */
export type AIProviderType = "anthropic" | "azure";
