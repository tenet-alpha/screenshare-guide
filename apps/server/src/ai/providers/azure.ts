/**
 * Azure OpenAI Provider
 * 
 * Uses the official `openai` package configured for Azure endpoints.
 * TTS uses Azure Cognitive Services Speech or falls back to ElevenLabs.
 */

import OpenAI from "openai";
import type {
  VisionProvider,
  TTSProvider,
  FrameAnalysisResult,
  QuickCheckResult,
  VoiceInfo,
} from "../types";

// ============================================================================
// VISION PROVIDER (Azure OpenAI GPT-4o)
// ============================================================================

class AzureOpenAIVisionProvider implements VisionProvider {
  private client: OpenAI;
  private deploymentName: string;

  constructor() {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_VISION || "gpt-5.2";

    if (!endpoint) {
      throw new Error("AZURE_OPENAI_ENDPOINT environment variable is required");
    }
    if (!apiKey) {
      throw new Error("AZURE_OPENAI_API_KEY environment variable is required");
    }

    this.client = new OpenAI({
      apiKey,
      baseURL: `${endpoint}/openai/deployments/${deployment}`,
      defaultQuery: { "api-version": "2024-10-21" },
      defaultHeaders: { "api-key": apiKey },
    });
    this.deploymentName = deployment;
  }

  async analyzeFrame(
    imageBase64: string,
    currentInstruction: string,
    successCriteria: string
  ): Promise<FrameAnalysisResult> {
    // Strip data URL prefix if present and prepare data URL
    let imageUrl: string;
    if (imageBase64.startsWith("data:image/")) {
      imageUrl = imageBase64;
    } else {
      imageUrl = `data:image/jpeg;base64,${imageBase64}`;
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

Respond in JSON format only:
{
  "description": "string",
  "detectedElements": ["string"],
  "matchesSuccessCriteria": boolean,
  "confidence": number,
  "suggestedAction": "string or null",
  "extractedData": [{"label": "string", "value": "string"}]
}`;

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        max_completion_tokens: 500,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "high",
                },
              },
              {
                type: "text",
                text: userPrompt,
              },
            ],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No response from Azure OpenAI");
      }

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
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
      console.error("[Azure OpenAI Vision] Analysis error:", error);

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
    let imageUrl: string;
    if (imageBase64.startsWith("data:image/")) {
      imageUrl = imageBase64;
    } else {
      imageUrl = `data:image/jpeg;base64,${imageBase64}`;
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.deploymentName,
        max_completion_tokens: 100,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: {
                  url: imageUrl,
                  detail: "low",
                },
              },
              {
                type: "text",
                text: `Is "${elementDescription}" visible in this screenshot? Reply with JSON only: {"found": boolean, "confidence": number}`,
              },
            ],
          },
        ],
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { found: false, confidence: 0 };
      }

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { found: false, confidence: 0 };
      }

      const result = JSON.parse(jsonMatch[0]);
      return {
        found: Boolean(result.found),
        confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
      };
    } catch (error) {
      console.error("[Azure OpenAI Vision] Quick check error:", error);
      return { found: false, confidence: 0 };
    }
  }
}

// ============================================================================
// TTS PROVIDER (Azure Cognitive Services Speech)
// ============================================================================

/**
 * Azure Speech TTS Provider
 * 
 * Uses Azure Cognitive Services Speech for TTS.
 * Falls back to ElevenLabs if Azure Speech is not configured.
 */
class AzureSpeechTTSProvider implements TTSProvider {
  private endpoint: string;
  private apiKey: string;
  private voiceName: string;

  constructor() {
    const endpoint = process.env.AZURE_SPEECH_ENDPOINT;
    const apiKey = process.env.AZURE_SPEECH_API_KEY;

    if (!endpoint || !apiKey) {
      throw new Error(
        "Azure Speech not configured. Set AZURE_SPEECH_ENDPOINT and AZURE_SPEECH_API_KEY"
      );
    }

    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.voiceName =
      process.env.AZURE_SPEECH_VOICE_NAME || "en-US-JennyNeural";
  }

  async generateSpeech(text: string, voiceId?: string): Promise<string> {
    const voice = voiceId || this.voiceName;

    // Build SSML
    const ssml = `<speak version='1.0' xml:lang='en-US'>
      <voice xml:lang='en-US' name='${voice}'>
        ${this.escapeXml(text)}
      </voice>
    </speak>`;

    const response = await fetch(
      `${this.endpoint}/cognitiveservices/v1`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": this.apiKey,
          "Content-Type": "application/ssml+xml",
          "X-Microsoft-OutputFormat": "audio-16khz-128kbitrate-mono-mp3",
        },
        body: ssml,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Azure Speech TTS] Error:", response.status, errorText);
      throw new Error(`Azure Speech API error: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return base64;
  }

  async getVoices(): Promise<VoiceInfo[]> {
    return [
      { voice_id: "en-US-JennyNeural", name: "Jenny", category: "neural" },
      { voice_id: "en-US-GuyNeural", name: "Guy", category: "neural" },
      { voice_id: "en-US-AriaNeural", name: "Aria", category: "neural" },
      { voice_id: "en-US-DavisNeural", name: "Davis", category: "neural" },
      { voice_id: "en-GB-SoniaNeural", name: "Sonia (UK)", category: "neural" },
      { voice_id: "en-AU-NatashaNeural", name: "Natasha (AU)", category: "neural" },
    ];
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}

// ============================================================================
// FALLBACK: Use ElevenLabs for TTS in Azure mode
// ============================================================================

import { createElevenLabsTTSProvider } from "./anthropic";

// ============================================================================
// EXPORTS
// ============================================================================

export function createAzureVisionProvider(): VisionProvider {
  return new AzureOpenAIVisionProvider();
}

export function createAzureTTSProvider(): TTSProvider {
  // Check if Azure Speech is configured
  const hasAzureSpeech =
    process.env.AZURE_SPEECH_ENDPOINT && process.env.AZURE_SPEECH_API_KEY;

  if (hasAzureSpeech) {
    return new AzureSpeechTTSProvider();
  }

  // Fall back to ElevenLabs if Azure Speech is not configured
  console.log(
    "[Azure TTS] Azure Speech not configured, falling back to ElevenLabs"
  );
  return createElevenLabsTTSProvider();
}
