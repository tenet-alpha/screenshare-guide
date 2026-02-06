/**
 * Anthropic AI Provider
 * 
 * Uses Claude for vision analysis and ElevenLabs for TTS.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  VisionProvider,
  TTSProvider,
  FrameAnalysisResult,
  QuickCheckResult,
  VoiceInfo,
} from "../types";

// ============================================================================
// VISION PROVIDER (Claude)
// ============================================================================

class AnthropicVisionProvider implements VisionProvider {
  private client: Anthropic;

  constructor() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required");
    }
    this.client = new Anthropic({ apiKey });
  }

  async analyzeFrame(
    imageBase64: string,
    currentInstruction: string,
    successCriteria: string
  ): Promise<FrameAnalysisResult> {
    // Strip data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    // Detect media type from prefix or default to jpeg
    let mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" = "image/jpeg";
    if (imageBase64.startsWith("data:image/png")) {
      mediaType = "image/png";
    } else if (imageBase64.startsWith("data:image/webp")) {
      mediaType = "image/webp";
    }

    const systemPrompt = `You are an AI assistant helping a user complete a task by analyzing their screen.
Your job is to:
1. Describe what you see on screen
2. Identify UI elements relevant to the current instruction
3. Determine if the success criteria has been met
4. Extract any specific data mentioned in the success criteria (handles, numbers, metrics, etc.)
5. If the user seems stuck, provide helpful guidance

Be concise and helpful. Focus on actionable observations.
CRITICAL: When the success criteria asks you to extract or verify specific data (usernames, handles, numbers, metrics), you MUST include them in the extractedData array.`;

    const userPrompt = `Current instruction for the user: "${currentInstruction}"

Success criteria (what indicates this step is complete): "${successCriteria}"

Please analyze this screenshot and provide:
1. A brief description of what's visible on screen
2. Key UI elements you can identify
3. Whether the success criteria appears to be met (true/false)
4. Your confidence level (0.0 to 1.0)
5. If the criteria is NOT met, a suggested action for the user
6. Any data extracted from the screen (handles, numbers, metrics, etc.) as label/value pairs

Respond in JSON format:
{
  "description": "string",
  "detectedElements": ["string"],
  "matchesSuccessCriteria": boolean,
  "confidence": number,
  "suggestedAction": "string or null",
  "extractedData": [{"label": "string", "value": "string"}]
}`;

    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: userPrompt,
              },
            ],
          },
        ],
        system: systemPrompt,
      });

      // Extract text content from response
      const textContent = response.content.find((c) => c.type === "text");
      if (!textContent || textContent.type !== "text") {
        throw new Error("No text response from Claude");
      }

      // Parse JSON from response
      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("Could not parse JSON from response");
      }

      const result = JSON.parse(jsonMatch[0]) as FrameAnalysisResult;

      // Validate and sanitize result
      return {
        description: result.description || "Unable to describe screen",
        detectedElements: Array.isArray(result.detectedElements)
          ? result.detectedElements
          : [],
        matchesSuccessCriteria: Boolean(result.matchesSuccessCriteria),
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
        suggestedAction: result.suggestedAction || undefined,
        extractedData: Array.isArray(result.extractedData)
          ? result.extractedData.filter((d: any) => d.label && d.value)
          : undefined,
      };
    } catch (error) {
      console.error("[Anthropic Vision] Analysis error:", error);

      // Return safe default on error
      return {
        description: "Unable to analyze frame",
        detectedElements: [],
        matchesSuccessCriteria: false,
        confidence: 0,
        suggestedAction:
          "Please try again or contact support if the issue persists.",
      };
    }
  }

  async quickElementCheck(
    imageBase64: string,
    elementDescription: string
  ): Promise<QuickCheckResult> {
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

    try {
      const response = await this.client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 100,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/jpeg",
                  data: base64Data,
                },
              },
              {
                type: "text",
                text: `Is "${elementDescription}" visible in this screenshot? Reply with JSON: {"found": boolean, "confidence": number}`,
              },
            ],
          },
        ],
      });

      const textContent = response.content.find((c) => c.type === "text");
      if (!textContent || textContent.type !== "text") {
        throw new Error("No text response");
      }

      const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { found: false, confidence: 0 };
      }

      const result = JSON.parse(jsonMatch[0]);
      return {
        found: Boolean(result.found),
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
      };
    } catch (error) {
      console.error("[Anthropic Vision] Quick check error:", error);
      return { found: false, confidence: 0 };
    }
  }
}

// ============================================================================
// TTS PROVIDER (ElevenLabs)
// ============================================================================

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

class ElevenLabsTTSProvider implements TTSProvider {
  private apiKey: string;
  private defaultVoiceId: string;
  private modelId: string;

  constructor() {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY environment variable is required");
    }
    this.apiKey = apiKey;
    this.defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel
    this.modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_turbo_v2_5";
  }

  async generateSpeech(text: string, voiceId?: string): Promise<string> {
    const voice = voiceId || this.defaultVoiceId;

    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voice}`,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: DEFAULT_VOICE_SETTINGS,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[ElevenLabs TTS] Error:", response.status, errorText);
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    // Convert response to base64
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return base64;
  }

  async *generateSpeechStream(
    text: string,
    voiceId?: string
  ): AsyncGenerator<Uint8Array> {
    const voice = voiceId || this.defaultVoiceId;

    const response = await fetch(
      `${ELEVENLABS_API_URL}/text-to-speech/${voice}/stream`,
      {
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify({
          text,
          model_id: this.modelId,
          voice_settings: DEFAULT_VOICE_SETTINGS,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  async getVoices(): Promise<VoiceInfo[]> {
    const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
      headers: {
        "xi-api-key": this.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs API error: ${response.status}`);
    }

    const data = await response.json();
    return data.voices.map((v: any) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category,
    }));
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export function createAnthropicVisionProvider(): VisionProvider {
  return new AnthropicVisionProvider();
}

export function createElevenLabsTTSProvider(): TTSProvider {
  return new ElevenLabsTTSProvider();
}
