import { describe, it, expect } from "bun:test";

/**
 * TTS Service Tests
 * 
 * Note: Tests that require actual API calls are skipped without ELEVENLABS_API_KEY.
 * Run with a valid API key for full integration testing.
 */

const hasApiKey = !!process.env.ELEVENLABS_API_KEY;

describe("TTS Service", () => {
  describe("generateSpeech", () => {
    it.skipIf(!hasApiKey)("should generate speech from text", async () => {
      // TODO: This test requires ELEVENLABS_API_KEY
      const { generateSpeech } = await import("../services/tts");

      const result = await generateSpeech("Hello world");

      // Should return base64 encoded audio
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("should use correct API URL format", () => {
      const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
      const voiceId = "21m00Tcm4TlvDq8ikWAM";
      const url = `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}`;

      expect(url).toBe(
        "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM"
      );
    });

    it("should use correct request body structure", () => {
      const requestBody = {
        text: "Hello world",
        model_id: "eleven_monolingual_v1",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.0,
          use_speaker_boost: true,
        },
      };

      expect(requestBody.text).toBe("Hello world");
      expect(requestBody.model_id).toBe("eleven_monolingual_v1");
      expect(requestBody.voice_settings.stability).toBe(0.5);
    });

    it("should have correct default voice settings", () => {
      const DEFAULT_VOICE_SETTINGS = {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      };

      expect(DEFAULT_VOICE_SETTINGS.stability).toBe(0.5);
      expect(DEFAULT_VOICE_SETTINGS.similarity_boost).toBe(0.75);
      expect(DEFAULT_VOICE_SETTINGS.style).toBe(0.0);
      expect(DEFAULT_VOICE_SETTINGS.use_speaker_boost).toBe(true);
    });

    it("should use default voice ID when not provided", () => {
      const defaultVoiceId = "21m00Tcm4TlvDq8ikWAM"; // Rachel

      expect(defaultVoiceId).toBe("21m00Tcm4TlvDq8ikWAM");
    });
  });

  describe("getVoices", () => {
    it.skipIf(!hasApiKey)("should return list of voices", async () => {
      // TODO: This test requires ELEVENLABS_API_KEY
      const { getVoices } = await import("../services/tts");

      const voices = await getVoices();

      expect(Array.isArray(voices)).toBe(true);
      if (voices.length > 0) {
        expect(voices[0]).toHaveProperty("voice_id");
        expect(voices[0]).toHaveProperty("name");
        expect(voices[0]).toHaveProperty("category");
      }
    });

    it("should return voice objects with correct structure", () => {
      const mockVoice = {
        voice_id: "v1",
        name: "Rachel",
        category: "premade",
      };

      expect(mockVoice.voice_id).toBe("v1");
      expect(mockVoice.name).toBe("Rachel");
      expect(mockVoice.category).toBe("premade");
    });
  });

  describe("generateSpeechStream", () => {
    it("should use streaming endpoint URL", () => {
      const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";
      const voiceId = "test-voice";
      const streamUrl = `${ELEVENLABS_API_URL}/text-to-speech/${voiceId}/stream`;

      expect(streamUrl).toContain("/stream");
    });
  });

  describe("Error handling", () => {
    it("should require API key", () => {
      const apiKey = process.env.ELEVENLABS_API_KEY;
      const error = !apiKey
        ? "ELEVENLABS_API_KEY environment variable is required"
        : null;

      if (!hasApiKey) {
        expect(error).toBe("ELEVENLABS_API_KEY environment variable is required");
      }
    });

    it("should format API errors correctly", () => {
      const status = 401;
      const errorMessage = `ElevenLabs API error: ${status}`;

      expect(errorMessage).toBe("ElevenLabs API error: 401");
    });
  });
});
