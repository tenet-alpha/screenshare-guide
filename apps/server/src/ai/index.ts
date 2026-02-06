/**
 * AI Provider Factory
 * 
 * Vision and TTS providers are configured independently:
 * 
 * VISION_PROVIDER:
 *   - "anthropic" (default): Claude for vision analysis
 *   - "azure": Azure OpenAI (GPT-4o) for vision analysis
 * 
 * TTS_PROVIDER:
 *   - "elevenlabs" (default): ElevenLabs for text-to-speech
 *   - "azure": Azure Cognitive Services Speech for TTS
 * 
 * Legacy: AI_PROVIDER still works as a fallback to set both at once.
 */

import type { VisionProvider, TTSProvider, VisionProviderType, TTSProviderType } from "./types";
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
 * Get the configured vision provider type
 * 
 * Priority: VISION_PROVIDER > AI_PROVIDER > "anthropic"
 */
export function getVisionProviderType(): VisionProviderType {
  const explicit = process.env.VISION_PROVIDER?.toLowerCase();
  if (explicit === "azure") return "azure";
  if (explicit === "anthropic") return "anthropic";

  // Fallback to legacy AI_PROVIDER
  const legacy = process.env.AI_PROVIDER?.toLowerCase();
  if (legacy === "azure") return "azure";

  return "anthropic"; // default
}

/**
 * Get the configured TTS provider type
 * 
 * Priority: TTS_PROVIDER > AI_PROVIDER > "elevenlabs"
 */
export function getTTSProviderType(): TTSProviderType {
  const explicit = process.env.TTS_PROVIDER?.toLowerCase();
  if (explicit === "azure") return "azure";
  if (explicit === "elevenlabs") return "elevenlabs";

  // Fallback to legacy AI_PROVIDER
  const legacy = process.env.AI_PROVIDER?.toLowerCase();
  if (legacy === "azure") return "azure";

  return "elevenlabs"; // default
}

/**
 * Get the vision provider (lazy initialization)
 */
export function getVisionProvider(): VisionProvider {
  if (_visionProvider) return _visionProvider;

  const providerType = getVisionProviderType();
  console.log(`[AI] Initializing vision provider: ${providerType}`);

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

  const providerType = getTTSProviderType();
  console.log(`[AI] Initializing TTS provider: ${providerType}`);

  switch (providerType) {
    case "azure":
      _ttsProvider = createAzureTTSProvider();
      break;
    case "elevenlabs":
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
// Convenience functions
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
