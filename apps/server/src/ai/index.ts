/**
 * AI Provider Factory
 * 
 * Creates vision and TTS providers based on the AI_PROVIDER environment variable.
 * 
 * Supported providers:
 * - "anthropic" (default): Claude for vision, ElevenLabs for TTS
 * - "azure": Azure OpenAI for vision, Azure Speech (or ElevenLabs) for TTS
 */

import type { VisionProvider, TTSProvider, AIProviderType } from "./types";
import {
  createAnthropicVisionProvider,
  createElevenLabsTTSProvider,
} from "./providers/anthropic";
import { createAzureVisionProvider, createAzureTTSProvider } from "./providers/azure";

// Re-export types
export type { FrameAnalysisResult, QuickCheckResult, VoiceInfo } from "./types";

// Lazy-loaded provider instances
let _visionProvider: VisionProvider | null = null;
let _ttsProvider: TTSProvider | null = null;

/**
 * Get the configured AI provider type
 */
export function getProviderType(): AIProviderType {
  const provider = process.env.AI_PROVIDER?.toLowerCase();
  if (provider === "azure") {
    return "azure";
  }
  return "anthropic"; // default
}

/**
 * Get the vision provider (lazy initialization)
 */
export function getVisionProvider(): VisionProvider {
  if (_visionProvider) return _visionProvider;

  const providerType = getProviderType();
  console.log(`[AI] Initializing ${providerType} vision provider`);

  switch (providerType) {
    case "azure":
      _visionProvider = createAzureVisionProvider();
      break;
    case "anthropic":
    default:
      _visionProvider = createAnthropicVisionProvider();
      break;
  }

  return _visionProvider;
}

/**
 * Get the TTS provider (lazy initialization)
 */
export function getTTSProvider(): TTSProvider {
  if (_ttsProvider) return _ttsProvider;

  const providerType = getProviderType();
  console.log(`[AI] Initializing ${providerType} TTS provider`);

  switch (providerType) {
    case "azure":
      _ttsProvider = createAzureTTSProvider();
      break;
    case "anthropic":
    default:
      _ttsProvider = createElevenLabsTTSProvider();
      break;
  }

  return _ttsProvider;
}

/**
 * Reset providers (useful for testing)
 */
export function resetProviders(): void {
  _visionProvider = null;
  _ttsProvider = null;
}

// ============================================================================
// Convenience functions (backwards compatibility with old API)
// ============================================================================

/**
 * Analyze a screen frame using the configured vision provider
 */
export async function analyzeFrame(
  imageBase64: string,
  currentInstruction: string,
  successCriteria: string
) {
  return getVisionProvider().analyzeFrame(
    imageBase64,
    currentInstruction,
    successCriteria
  );
}

/**
 * Quick check if an element is visible using the configured vision provider
 */
export async function quickElementCheck(
  imageBase64: string,
  elementDescription: string
) {
  return getVisionProvider().quickElementCheck(imageBase64, elementDescription);
}

/**
 * Generate speech using the configured TTS provider
 */
export async function generateSpeech(text: string, voiceId?: string) {
  return getTTSProvider().generateSpeech(text, voiceId);
}

/**
 * Generate speech with streaming support
 */
export async function* generateSpeechStream(text: string, voiceId?: string) {
  const tts = getTTSProvider();
  if (tts.generateSpeechStream) {
    yield* tts.generateSpeechStream(text, voiceId);
  } else {
    // Fallback: yield the entire audio as a single chunk
    const audio = await tts.generateSpeech(text, voiceId);
    yield Buffer.from(audio, "base64");
  }
}

/**
 * Get available voices from the configured TTS provider
 */
export async function getVoices() {
  const tts = getTTSProvider();
  if (tts.getVoices) {
    return tts.getVoices();
  }
  return [];
}
