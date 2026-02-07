/**
 * Azure OpenAI Provider
 * 
 * Uses direct fetch calls to Azure OpenAI REST API.
 * TTS uses Azure Cognitive Services Speech or falls back to ElevenLabs.
 */

import type {
  VisionProvider,
  TTSProvider,
  FrameAnalysisResult,
  QuickCheckResult,
  VoiceInfo,
  ExtractionField,
} from "../types";

// ============================================================================
// VISION PROVIDER (Azure OpenAI GPT-4o)
// ============================================================================

class AzureOpenAIVisionProvider implements VisionProvider {
  private endpoint: string;
  private apiKey: string;
  private deploymentName: string;
  private apiVersion: string;

  constructor() {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT_VISION || "gpt-5-mini";

    if (!endpoint) {
      throw new Error("AZURE_OPENAI_ENDPOINT environment variable is required");
    }
    if (!apiKey) {
      throw new Error("AZURE_OPENAI_API_KEY environment variable is required");
    }

    this.endpoint = endpoint;
    this.apiKey = apiKey;
    this.deploymentName = deployment;
    this.apiVersion = "2024-10-21";
  }

  private get completionsUrl(): string {
    return `${this.endpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;
  }

  async analyzeFrame(
    imageBase64: string,
    currentInstruction: string,
    successCriteria: string,
    extractionSchema?: ExtractionField[]
  ): Promise<FrameAnalysisResult> {
    // Strip data URL prefix if present and prepare data URL
    let imageUrl: string;
    if (imageBase64.startsWith("data:image/")) {
      imageUrl = imageBase64;
    } else {
      imageUrl = `data:image/jpeg;base64,${imageBase64}`;
    }

    // Build extraction schema instructions for the prompt
    let schemaInstruction = "";
    let schemaFields = "";
    if (extractionSchema?.length) {
      const fieldList = extractionSchema
        .map((f) => `  "${f.field}": "${f.description}"`)
        .join(",\n");
      schemaInstruction = `\nYou MUST extract data into the exact field names defined below. Do not invent new field names.`;
      schemaFields = `\n\nEXTRACTION SCHEMA (use these exact field names in extractedData):
{
${fieldList}
}`;
    }

    const systemPrompt = `You are an AI assistant analyzing a user's screen to verify they've completed a step.
Keep responses concise. Focus on whether the success criteria is met and what action to take next.${schemaInstruction}`;

    const userPrompt = `Instruction: "${currentInstruction}"
Success criteria: "${successCriteria}"${schemaFields}

Analyze this screenshot. Respond in JSON only:
{
  "matchesSuccessCriteria": boolean,
  "confidence": number (0.0-1.0),
  "suggestedAction": "string or null (only if criteria NOT met — say what to do, not what you see)",
  "extractedData": [{"label": "<exact field name from schema>", "value": "string"}]
}`;

    try {
      const fetchResp = await fetch(this.completionsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify({
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
                    detail: "low",
                  },
                },
                {
                  type: "text",
                  text: userPrompt,
                },
              ],
            },
          ],
        }),
      });

      if (!fetchResp.ok) {
        const errBody = await fetchResp.text();
        console.error("[Azure OpenAI Vision] API error:", fetchResp.status, errBody.substring(0, 500));
        throw new Error(`Azure OpenAI API error: ${fetchResp.status}`);
      }

      const response = await fetchResp.json() as any;
      const choice = response.choices?.[0];
      const content = choice?.message?.content;
      const refusal = choice?.message?.refusal;
      const finishReason = choice?.finish_reason;

      if (refusal) {
        console.error("[Azure OpenAI Vision] Model refused:", refusal);
        throw new Error(`Model refused: ${refusal}`);
      }

      if (!content || content.trim().length === 0) {
        console.error("[Azure OpenAI Vision] No content. finish_reason:", finishReason, "full response:", JSON.stringify(response).substring(0, 500));
        throw new Error(`No response from Azure OpenAI (finish_reason: ${finishReason})`);
      }

      // Parse JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error("[Azure OpenAI Vision] Could not parse JSON from:", content.substring(0, 200));
        throw new Error("Could not parse JSON from response");
      }

      const result = JSON.parse(jsonMatch[0]) as FrameAnalysisResult;

      // Validate and sanitize result
      return {
        description: "",
        detectedElements: [],
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
      const fetchResp = await fetch(this.completionsUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": this.apiKey,
        },
        body: JSON.stringify({
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
        }),
      });

      if (!fetchResp.ok) {
        throw new Error(`Azure OpenAI API error: ${fetchResp.status}`);
      }

      const response = await fetchResp.json() as any;
      const content = response.choices?.[0]?.message?.content;
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
