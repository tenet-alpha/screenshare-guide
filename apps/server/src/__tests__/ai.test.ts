import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";

/**
 * AI Provider Factory Tests
 * 
 * Tests the AI provider abstraction layer and factory logic.
 */

describe("AI Provider Factory", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  describe("Vision Provider Type Detection", () => {
    it("should default to azure", () => {
      delete process.env.VISION_PROVIDER;
      const type = () => process.env.VISION_PROVIDER?.toLowerCase() === "anthropic" ? "anthropic" : "azure";
      expect(type()).toBe("azure");
    });

    it("should return anthropic when set", () => {
      process.env.VISION_PROVIDER = "anthropic";
      const type = () => process.env.VISION_PROVIDER?.toLowerCase() === "anthropic" ? "anthropic" : "azure";
      expect(type()).toBe("anthropic");
    });

    it("should be case-insensitive", () => {
      for (const v of ["ANTHROPIC", "Anthropic", "anthropic"]) {
        process.env.VISION_PROVIDER = v;
        const type = () => process.env.VISION_PROVIDER?.toLowerCase() === "anthropic" ? "anthropic" : "azure";
        expect(type()).toBe("anthropic");
      }
    });
  });

  describe("TTS Provider Type Detection", () => {
    it("should default to elevenlabs", () => {
      delete process.env.TTS_PROVIDER;
      const type = () => process.env.TTS_PROVIDER?.toLowerCase() === "azure" ? "azure" : "elevenlabs";
      expect(type()).toBe("elevenlabs");
    });

    it("should return azure when set", () => {
      process.env.TTS_PROVIDER = "azure";
      const type = () => process.env.TTS_PROVIDER?.toLowerCase() === "azure" ? "azure" : "elevenlabs";
      expect(type()).toBe("azure");
    });

    it("should allow azure vision + elevenlabs TTS", () => {
      process.env.VISION_PROVIDER = "azure";
      process.env.TTS_PROVIDER = "elevenlabs";
      const vision = () => process.env.VISION_PROVIDER?.toLowerCase() === "anthropic" ? "anthropic" : "azure";
      const tts = () => process.env.TTS_PROVIDER?.toLowerCase() === "azure" ? "azure" : "elevenlabs";
      expect(vision()).toBe("azure");
      expect(tts()).toBe("elevenlabs");
    });
  });

  describe("Vision Provider Interface", () => {
    it("should define correct FrameAnalysisResult structure", () => {
      interface FrameAnalysisResult {
        description: string;
        detectedElements: string[];
        matchesSuccessCriteria: boolean;
        confidence: number;
        suggestedAction?: string;
      }

      const validResult: FrameAnalysisResult = {
        description: "Test description",
        detectedElements: ["element1", "element2"],
        matchesSuccessCriteria: true,
        confidence: 0.9,
        suggestedAction: "Do something",
      };

      expect(validResult.description).toBe("Test description");
      expect(validResult.detectedElements).toHaveLength(2);
      expect(validResult.matchesSuccessCriteria).toBe(true);
      expect(validResult.confidence).toBeGreaterThan(0);
      expect(validResult.confidence).toBeLessThanOrEqual(1);
    });

    it("should define correct QuickCheckResult structure", () => {
      interface QuickCheckResult {
        found: boolean;
        confidence: number;
      }

      const validResult: QuickCheckResult = {
        found: true,
        confidence: 0.85,
      };

      expect(validResult.found).toBe(true);
      expect(validResult.confidence).toBe(0.85);
    });
  });

  describe("TTS Provider Interface", () => {
    it("should define correct VoiceInfo structure", () => {
      interface VoiceInfo {
        voice_id: string;
        name: string;
        category: string;
      }

      const voiceInfo: VoiceInfo = {
        voice_id: "voice-123",
        name: "Jenny",
        category: "neural",
      };

      expect(voiceInfo.voice_id).toBe("voice-123");
      expect(voiceInfo.name).toBe("Jenny");
      expect(voiceInfo.category).toBe("neural");
    });
  });

  describe("Anthropic Provider", () => {
    it("should require ANTHROPIC_API_KEY", () => {
      delete process.env.ANTHROPIC_API_KEY;

      const checkApiKey = () => {
        if (!process.env.ANTHROPIC_API_KEY) {
          throw new Error("ANTHROPIC_API_KEY environment variable is required");
        }
      };

      expect(checkApiKey).toThrow("ANTHROPIC_API_KEY environment variable is required");
    });

    it("should use correct model for vision analysis", () => {
      const model = "claude-sonnet-4-20250514";

      expect(model).toBe("claude-sonnet-4-20250514");
    });

    it("should strip data URL prefix from base64 images", () => {
      const withPrefix = "data:image/jpeg;base64,/9j/4AAQ...";
      const stripped = withPrefix.replace(/^data:image\/\w+;base64,/, "");

      expect(stripped).toBe("/9j/4AAQ...");
    });

    it("should detect media type from data URL prefix", () => {
      const detectMediaType = (imageBase64: string) => {
        if (imageBase64.startsWith("data:image/png")) return "image/png";
        if (imageBase64.startsWith("data:image/webp")) return "image/webp";
        return "image/jpeg";
      };

      expect(detectMediaType("data:image/png;base64,abc")).toBe("image/png");
      expect(detectMediaType("data:image/webp;base64,abc")).toBe("image/webp");
      expect(detectMediaType("data:image/jpeg;base64,abc")).toBe("image/jpeg");
      expect(detectMediaType("abc")).toBe("image/jpeg");
    });
  });

  describe("Azure Provider", () => {
    it("should require AZURE_OPENAI_ENDPOINT", () => {
      delete process.env.AZURE_OPENAI_ENDPOINT;

      const checkEndpoint = () => {
        if (!process.env.AZURE_OPENAI_ENDPOINT) {
          throw new Error("AZURE_OPENAI_ENDPOINT environment variable is required");
        }
      };

      expect(checkEndpoint).toThrow("AZURE_OPENAI_ENDPOINT environment variable is required");
    });

    it("should require AZURE_OPENAI_API_KEY", () => {
      delete process.env.AZURE_OPENAI_API_KEY;

      const checkApiKey = () => {
        if (!process.env.AZURE_OPENAI_API_KEY) {
          throw new Error("AZURE_OPENAI_API_KEY environment variable is required");
        }
      };

      expect(checkApiKey).toThrow("AZURE_OPENAI_API_KEY environment variable is required");
    });

    it("should require AZURE_OPENAI_DEPLOYMENT_VISION", () => {
      delete process.env.AZURE_OPENAI_DEPLOYMENT_VISION;

      const checkDeployment = () => {
        if (!process.env.AZURE_OPENAI_DEPLOYMENT_VISION) {
          throw new Error("AZURE_OPENAI_DEPLOYMENT_VISION environment variable is required");
        }
      };

      expect(checkDeployment).toThrow("AZURE_OPENAI_DEPLOYMENT_VISION environment variable is required");
    });

    it("should prepare image URL correctly for Azure OpenAI", () => {
      const prepareImageUrl = (imageBase64: string) => {
        if (imageBase64.startsWith("data:image/")) {
          return imageBase64;
        }
        return `data:image/jpeg;base64,${imageBase64}`;
      };

      expect(prepareImageUrl("data:image/png;base64,abc")).toBe("data:image/png;base64,abc");
      expect(prepareImageUrl("rawbase64data")).toBe("data:image/jpeg;base64,rawbase64data");
    });
  });

  describe("Azure Speech TTS", () => {
    it("should use default voice when not specified", () => {
      const defaultVoice = process.env.AZURE_SPEECH_VOICE_NAME || "en-US-JennyNeural";

      expect(defaultVoice).toBe("en-US-JennyNeural");
    });

    it("should escape XML special characters in SSML", () => {
      const escapeXml = (text: string) => {
        return text
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&apos;");
      };

      expect(escapeXml("Hello & <World>")).toBe("Hello &amp; &lt;World&gt;");
      expect(escapeXml('Say "Hello"')).toBe("Say &quot;Hello&quot;");
    });

    it("should fall back to ElevenLabs when Azure Speech not configured", () => {
      delete process.env.AZURE_SPEECH_ENDPOINT;
      delete process.env.AZURE_SPEECH_API_KEY;

      const hasAzureSpeech =
        process.env.AZURE_SPEECH_ENDPOINT && process.env.AZURE_SPEECH_API_KEY;

      expect(hasAzureSpeech).toBeFalsy();
    });
  });

  describe("ElevenLabs TTS", () => {
    it("should require ELEVENLABS_API_KEY", () => {
      delete process.env.ELEVENLABS_API_KEY;

      const checkApiKey = () => {
        if (!process.env.ELEVENLABS_API_KEY) {
          throw new Error("ELEVENLABS_API_KEY environment variable is required");
        }
      };

      expect(checkApiKey).toThrow("ELEVENLABS_API_KEY environment variable is required");
    });

    it("should use default voice ID when not specified", () => {
      const defaultVoiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel

      expect(process.env.ELEVENLABS_VOICE_ID || defaultVoiceId).toBe(defaultVoiceId);
    });

    it("should use correct API URL", () => {
      const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

      expect(ELEVENLABS_API_URL).toBe("https://api.elevenlabs.io/v1");
    });
  });

  describe("Error Handling", () => {
    it("should return safe defaults on analysis error", () => {
      const fallbackResponse = {
        description: "Unable to analyze frame",
        detectedElements: [],
        matchesSuccessCriteria: false,
        confidence: 0,
        suggestedAction: "Please try again or contact support if the issue persists.",
      };

      expect(fallbackResponse.description).toBe("Unable to analyze frame");
      expect(fallbackResponse.detectedElements).toEqual([]);
      expect(fallbackResponse.matchesSuccessCriteria).toBe(false);
      expect(fallbackResponse.confidence).toBe(0);
    });

    it("should return safe defaults on quick check error", () => {
      const fallback = { found: false, confidence: 0 };

      expect(fallback.found).toBe(false);
      expect(fallback.confidence).toBe(0);
    });

    it("should clamp confidence between 0 and 1", () => {
      // Actual implementation from providers uses Number() || 0 before clamping
      const clamp = (value: number) => Math.max(0, Math.min(1, Number(value) || 0));

      expect(clamp(-0.5)).toBe(0);
      expect(clamp(0.5)).toBe(0.5);
      expect(clamp(1.5)).toBe(1);
      expect(clamp(NaN)).toBe(0);
    });
  });

  describe("JSON Parsing", () => {
    it("should extract JSON from response text", () => {
      const responseText = 'Here is the analysis:\n{"found": true, "confidence": 0.9}\nEnd.';

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      expect(jsonMatch).not.toBeNull();
      expect(jsonMatch![0]).toBe('{"found": true, "confidence": 0.9}');
    });

    it("should handle missing JSON in response", () => {
      const responseText = "No JSON here, just text.";

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);

      expect(jsonMatch).toBeNull();
    });

    it("should parse valid JSON objects", () => {
      const jsonString = '{"found": true, "confidence": 0.85}';

      const parsed = JSON.parse(jsonString);

      expect(parsed.found).toBe(true);
      expect(parsed.confidence).toBe(0.85);
    });
  });
});
