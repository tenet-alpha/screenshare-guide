/**
 * AI Provider Factory
 * 
 * VISION_PROVIDER: "azure" (default) or "anthropic"
 * TTS_PROVIDER: "elevenlabs" (default) or "azure"
 */

import type { VisionProvider, TTSProvider, VisionProviderType, TTSProviderType } from "./types";
import { createAnthropicVisionProvider, createElevenLabsTTSProvider } from "./providers/anthropic";
import { createAzureVisionProvider, createAzureTTSProvider } from "./providers/azure";

export type { FrameAnalysisResult, QuickCheckResult, VoiceInfo } from "./types";

let _visionProvider: VisionProvider | null = null;
let _ttsProvider: TTSProvider | null = null;

export function getVisionProviderType(): VisionProviderType {
  return process.env.VISION_PROVIDER?.toLowerCase() === "anthropic" ? "anthropic" : "azure";
}

export function getTTSProviderType(): TTSProviderType {
  return process.env.TTS_PROVIDER?.toLowerCase() === "azure" ? "azure" : "elevenlabs";
}

export function getVisionProvider(): VisionProvider {
  if (!_visionProvider) {
    const type = getVisionProviderType();
    _visionProvider = type === "azure" ? createAzureVisionProvider() : createAnthropicVisionProvider();
  }
  return _visionProvider;
}

export function getTTSProvider(): TTSProvider {
  if (!_ttsProvider) {
    const type = getTTSProviderType();
    _ttsProvider = type === "azure" ? createAzureTTSProvider() : createElevenLabsTTSProvider();
  }
  return _ttsProvider;
}

export function resetProviders(): void {
  _visionProvider = null;
  _ttsProvider = null;
}

export async function analyzeFrame(imageBase64: string, currentInstruction: string, successCriteria: string) {
  return getVisionProvider().analyzeFrame(imageBase64, currentInstruction, successCriteria);
}

export async function quickElementCheck(imageBase64: string, elementDescription: string) {
  return getVisionProvider().quickElementCheck(imageBase64, elementDescription);
}

export async function generateSpeech(text: string, voiceId?: string) {
  return getTTSProvider().generateSpeech(text, voiceId);
}

export async function* generateSpeechStream(text: string, voiceId?: string) {
  const tts = getTTSProvider();
  if (tts.generateSpeechStream) {
    yield* tts.generateSpeechStream(text, voiceId);
  } else {
    yield Buffer.from(await tts.generateSpeech(text, voiceId), "base64");
  }
}

export async function getVoices() {
  return getTTSProvider().getVoices?.() ?? [];
}
