/**
 * AI Provider Tests
 *
 * Tests response parsing, prompt construction, error handling, and edge cases
 * for the Azure OpenAI vision provider, Azure Speech TTS provider, and the
 * provider factory — all without calling live APIs.
 */

import { describe, it, expect, afterEach, mock, beforeEach } from "bun:test";
import type { ExtractionField } from "../../src/ai/types";

// ---------------------------------------------------------------------------
// Helpers: mock global fetch
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;

function mockFetch(response: { status: number; body: any; ok?: boolean }) {
  globalThis.fetch = mock(async () => ({
    ok: response.ok ?? (response.status >= 200 && response.status < 300),
    status: response.status,
    text: async () =>
      typeof response.body === "string"
        ? response.body
        : JSON.stringify(response.body),
    json: async () => response.body,
    arrayBuffer: async () => {
      if (response.body instanceof ArrayBuffer) return response.body;
      return new TextEncoder().encode(JSON.stringify(response.body)).buffer;
    },
    headers: new Headers(),
  })) as any;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Helpers: Azure OpenAI response builders
// ---------------------------------------------------------------------------

function azureResponse(content: string, finishReason = "stop") {
  return {
    choices: [
      {
        message: { content },
        finish_reason: finishReason,
      },
    ],
  };
}

function azureRefusal(refusal: string) {
  return {
    choices: [
      {
        message: { content: null, refusal },
        finish_reason: "stop",
      },
    ],
  };
}

// Dummy 1×1 JPEG in base64 (smallest valid JPEG)
const TINY_IMAGE =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAFBABAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJn//2Q==";

// ---------------------------------------------------------------------------
// Azure Vision Provider
// ---------------------------------------------------------------------------

describe("Azure Vision Provider", () => {
  // Ensure env vars are set so the constructor doesn't throw
  beforeEach(() => {
    process.env.AZURE_OPENAI_ENDPOINT = "https://test.openai.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "test-key";
  });

  // Lazy import — we re-import each time to get a fresh provider
  async function createProvider() {
    const { createAzureVisionProvider } = await import(
      "../ai/providers/azure"
    );
    return createAzureVisionProvider();
  }

  // -----------------------------------------------------------------------
  // Response parsing
  // -----------------------------------------------------------------------

  describe("response parsing", () => {
    it("parses a valid analysis response with all fields", async () => {
      const payload = JSON.stringify({
        matchesSuccessCriteria: true,
        confidence: 0.92,
        suggestedAction: null,
        extractedData: [],
      });
      mockFetch({ status: 200, body: azureResponse(payload) });

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "Click the button",
        "Button clicked"
      );

      expect(result.matchesSuccessCriteria).toBe(true);
      expect(result.confidence).toBeCloseTo(0.92);
      expect(result.suggestedAction).toBeUndefined();
      expect(result.extractedData).toEqual([]);
    });

    it("parses response with extractedData array", async () => {
      const payload = JSON.stringify({
        matchesSuccessCriteria: true,
        confidence: 0.95,
        suggestedAction: null,
        extractedData: [
          { label: "Handle", value: "@testuser" },
          { label: "Reach", value: "12345" },
        ],
      });
      mockFetch({ status: 200, body: azureResponse(payload) });

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "Verify handle",
        "Handle visible"
      );

      expect(result.extractedData).toHaveLength(2);
      expect(result.extractedData![0]).toEqual({
        label: "Handle",
        value: "@testuser",
      });
      expect(result.extractedData![1]).toEqual({
        label: "Reach",
        value: "12345",
      });
    });

    it("handles response with JSON wrapped in markdown code fences", async () => {
      const wrapped =
        '```json\n{"matchesSuccessCriteria": false, "confidence": 0.7, "suggestedAction": "Scroll down", "extractedData": []}\n```';
      mockFetch({ status: 200, body: azureResponse(wrapped) });

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "Scroll",
        "Bottom visible"
      );

      expect(result.matchesSuccessCriteria).toBe(false);
      expect(result.confidence).toBeCloseTo(0.7);
      expect(result.suggestedAction).toBe("Scroll down");
    });

    it("clamps confidence to 0-1 range", async () => {
      // Confidence > 1
      const highPayload = JSON.stringify({
        matchesSuccessCriteria: true,
        confidence: 1.5,
        suggestedAction: null,
        extractedData: [],
      });
      mockFetch({ status: 200, body: azureResponse(highPayload) });

      const provider = await createProvider();
      const highResult = await provider.analyzeFrame(
        TINY_IMAGE,
        "test",
        "test"
      );
      expect(highResult.confidence).toBe(1);

      // Confidence < 0
      const lowPayload = JSON.stringify({
        matchesSuccessCriteria: false,
        confidence: -0.3,
        suggestedAction: null,
        extractedData: [],
      });
      mockFetch({ status: 200, body: azureResponse(lowPayload) });

      const provider2 = await createProvider();
      const lowResult = await provider2.analyzeFrame(
        TINY_IMAGE,
        "test",
        "test"
      );
      expect(lowResult.confidence).toBe(0);
    });

    it("filters extractedData items with empty label or value", async () => {
      const payload = JSON.stringify({
        matchesSuccessCriteria: true,
        confidence: 0.8,
        suggestedAction: null,
        extractedData: [
          { label: "Handle", value: "@good" },
          { label: "", value: "no-label" },
          { label: "Empty", value: "" },
          { label: "Valid", value: "ok" },
        ],
      });
      mockFetch({ status: 200, body: azureResponse(payload) });

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "test",
        "test"
      );

      expect(result.extractedData).toHaveLength(2);
      expect(result.extractedData![0].label).toBe("Handle");
      expect(result.extractedData![1].label).toBe("Valid");
    });

    it("returns empty extractedData when model returns none", async () => {
      const payload = JSON.stringify({
        matchesSuccessCriteria: true,
        confidence: 0.9,
        suggestedAction: null,
      });
      mockFetch({ status: 200, body: azureResponse(payload) });

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "test",
        "test"
      );

      // When extractedData is not an array, it should be undefined
      expect(result.extractedData).toBeUndefined();
    });

    it("handles model refusal gracefully", async () => {
      mockFetch({
        status: 200,
        body: azureRefusal("I cannot analyze this content"),
      });

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "test",
        "test"
      );

      // Should return safe default
      expect(result.matchesSuccessCriteria).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.description).toBe("Unable to analyze frame");
    });

    it("handles empty content (finish_reason: length)", async () => {
      mockFetch({
        status: 200,
        body: {
          choices: [
            {
              message: { content: "" },
              finish_reason: "length",
            },
          ],
        },
      });

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "test",
        "test"
      );

      expect(result.matchesSuccessCriteria).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.description).toBe("Unable to analyze frame");
    });

    it("returns safe default on API error (non-200 status)", async () => {
      mockFetch({
        status: 429,
        body: { error: "Rate limit exceeded" },
        ok: false,
      });

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "test",
        "test"
      );

      expect(result.matchesSuccessCriteria).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.description).toBe("Unable to analyze frame");
      expect(result.suggestedAction).toContain("try again");
    });

    it("returns safe default on network error (fetch throws)", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("ECONNREFUSED");
      }) as any;

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "test",
        "test"
      );

      expect(result.matchesSuccessCriteria).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.description).toBe("Unable to analyze frame");
    });

    it("returns safe default on malformed JSON", async () => {
      mockFetch({
        status: 200,
        body: azureResponse("This is not JSON at all, just plain text."),
      });

      const provider = await createProvider();
      const result = await provider.analyzeFrame(
        TINY_IMAGE,
        "test",
        "test"
      );

      expect(result.matchesSuccessCriteria).toBe(false);
      expect(result.confidence).toBe(0);
      expect(result.description).toBe("Unable to analyze frame");
    });
  });

  // -----------------------------------------------------------------------
  // Prompt construction
  // -----------------------------------------------------------------------

  describe("prompt construction", () => {
    it("includes extraction schema in prompt when provided", async () => {
      const payload = JSON.stringify({
        matchesSuccessCriteria: true,
        confidence: 0.9,
        suggestedAction: null,
        extractedData: [],
      });
      mockFetch({ status: 200, body: azureResponse(payload) });

      const schema: ExtractionField[] = [
        { field: "Handle", description: "Instagram handle", required: true },
        {
          field: "Reach",
          description: "Total reach number",
          required: true,
        },
      ];

      const provider = await createProvider();
      await provider.analyzeFrame(
        TINY_IMAGE,
        "Open insights",
        "Metrics visible",
        schema
      );

      // Inspect the request body passed to fetch
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
      const callArgs = fetchMock.mock.calls[0];
      const requestInit = callArgs[1] as RequestInit;
      const body = JSON.parse(requestInit.body as string);

      // The user message content should contain the field names
      const userContent = body.messages[1].content;
      const textPart = userContent.find((c: any) => c.type === "text");
      expect(textPart.text).toContain("Handle");
      expect(textPart.text).toContain("Reach");
      expect(textPart.text).toContain("EXTRACTION SCHEMA");
    });

    it('uses "auto" detail for extraction steps, "low" for non-extraction', async () => {
      const payload = JSON.stringify({
        matchesSuccessCriteria: true,
        confidence: 0.9,
        suggestedAction: null,
        extractedData: [],
      });

      // With extraction schema → "auto"
      mockFetch({ status: 200, body: azureResponse(payload) });
      const provider = await createProvider();
      await provider.analyzeFrame(TINY_IMAGE, "test", "test", [
        { field: "Handle", description: "handle", required: true },
      ]);

      let fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
      let body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      let imagePart = body.messages[1].content.find(
        (c: any) => c.type === "image_url"
      );
      expect(imagePart.image_url.detail).toBe("auto");

      // Without extraction schema → "low"
      mockFetch({ status: 200, body: azureResponse(payload) });
      const provider2 = await createProvider();
      await provider2.analyzeFrame(TINY_IMAGE, "test", "test");

      fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
      body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      imagePart = body.messages[1].content.find(
        (c: any) => c.type === "image_url"
      );
      expect(imagePart.image_url.detail).toBe("low");
    });

    it("includes success criteria in the prompt", async () => {
      const payload = JSON.stringify({
        matchesSuccessCriteria: true,
        confidence: 0.9,
        suggestedAction: null,
        extractedData: [],
      });
      mockFetch({ status: 200, body: azureResponse(payload) });

      const provider = await createProvider();
      await provider.analyzeFrame(
        TINY_IMAGE,
        "Click the big blue button",
        "The confirmation dialog is visible"
      );

      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof mock>;
      const body = JSON.parse(
        (fetchMock.mock.calls[0][1] as RequestInit).body as string
      );
      const textPart = body.messages[1].content.find(
        (c: any) => c.type === "text"
      );
      expect(textPart.text).toContain("The confirmation dialog is visible");
      expect(textPart.text).toContain("Click the big blue button");
    });
  });

  // -----------------------------------------------------------------------
  // Quick element check
  // -----------------------------------------------------------------------

  describe("quickElementCheck", () => {
    it("parses a valid quick check response", async () => {
      const payload = JSON.stringify({ found: true, confidence: 0.85 });
      mockFetch({ status: 200, body: azureResponse(payload) });

      const provider = await createProvider();
      const result = await provider.quickElementCheck(
        TINY_IMAGE,
        "Submit button"
      );

      expect(result.found).toBe(true);
      expect(result.confidence).toBeCloseTo(0.85);
    });

    it("returns {found: false, confidence: 0} on error", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("Network failure");
      }) as any;

      const provider = await createProvider();
      const result = await provider.quickElementCheck(
        TINY_IMAGE,
        "Submit button"
      );

      expect(result.found).toBe(false);
      expect(result.confidence).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Azure Speech TTS Provider
// ---------------------------------------------------------------------------

describe("Azure Speech TTS Provider", () => {
  beforeEach(() => {
    process.env.AZURE_SPEECH_ENDPOINT =
      "https://test.cognitiveservices.azure.com";
    process.env.AZURE_SPEECH_API_KEY = "test-speech-key";
    // Also set Azure OpenAI env so the module import doesn't fail elsewhere
    process.env.AZURE_OPENAI_ENDPOINT = "https://test.openai.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "test-key";
  });

  async function createTTSProvider() {
    const { createAzureTTSProvider } = await import(
      "../ai/providers/azure"
    );
    return createAzureTTSProvider();
  }

  it("returns base64 audio on success", async () => {
    // Create a small ArrayBuffer to simulate audio
    const audioBytes = new Uint8Array([0xff, 0xfb, 0x90, 0x00]); // MP3 header
    const arrayBuffer = audioBytes.buffer;

    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => arrayBuffer,
      text: async () => "audio data",
      headers: new Headers(),
    })) as any;

    const provider = await createTTSProvider();
    const base64 = await provider.generateSpeech("Hello world");

    // Verify it's valid base64
    const decoded = Buffer.from(base64, "base64");
    expect(decoded[0]).toBe(0xff);
    expect(decoded[1]).toBe(0xfb);
  });

  it("throws on API error", async () => {
    mockFetch({ status: 400, body: "Bad Request", ok: false });

    const provider = await createTTSProvider();
    await expect(provider.generateSpeech("Hello world")).rejects.toThrow(
      "Azure Speech API error: 400"
    );
  });

  it("escapes XML special characters in SSML", async () => {
    // We need to capture the request body to verify SSML escaping
    const audioBytes = new Uint8Array([0x00]);
    globalThis.fetch = mock(async (_url: any, init: any) => {
      // Store the body for inspection
      (globalThis.fetch as any).__lastBody = init?.body;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => audioBytes.buffer,
        text: async () => "",
        headers: new Headers(),
      };
    }) as any;

    const provider = await createTTSProvider();
    await provider.generateSpeech('Test & <script> "quotes" \'apos\'');

    const ssml = (globalThis.fetch as any).__lastBody as string;
    expect(ssml).toContain("&amp;");
    expect(ssml).toContain("&lt;script&gt;");
    expect(ssml).toContain("&quot;quotes&quot;");
    expect(ssml).toContain("&apos;apos&apos;");
    // Must NOT contain raw & or < in the text portion
    expect(ssml).not.toMatch(/Test & /);
  });

  it("uses configured voice name from env var", async () => {
    process.env.AZURE_SPEECH_VOICE_NAME = "en-GB-SoniaNeural";

    const audioBytes = new Uint8Array([0x00]);
    globalThis.fetch = mock(async (_url: any, init: any) => {
      (globalThis.fetch as any).__lastBody = init?.body;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => audioBytes.buffer,
        text: async () => "",
        headers: new Headers(),
      };
    }) as any;

    const provider = await createTTSProvider();
    await provider.generateSpeech("Hello");

    const ssml = (globalThis.fetch as any).__lastBody as string;
    expect(ssml).toContain("en-GB-SoniaNeural");

    // Cleanup
    delete process.env.AZURE_SPEECH_VOICE_NAME;
  });
});

// ---------------------------------------------------------------------------
// Provider Factory
// ---------------------------------------------------------------------------

describe("Provider factory", () => {
  beforeEach(() => {
    // Set all env vars so any provider can be constructed
    process.env.AZURE_OPENAI_ENDPOINT = "https://test.openai.azure.com";
    process.env.AZURE_OPENAI_API_KEY = "test-key";
    process.env.AZURE_SPEECH_ENDPOINT =
      "https://test.cognitiveservices.azure.com";
    process.env.AZURE_SPEECH_API_KEY = "test-speech-key";
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  });

  it("creates Azure vision provider when VISION_PROVIDER=azure", async () => {
    process.env.VISION_PROVIDER = "azure";
    const { resetProviders, getVisionProviderType } =
      await import("../ai/index");
    resetProviders();

    expect(getVisionProviderType()).toBe("azure");

    resetProviders();
  });

  it("creates Anthropic vision provider when VISION_PROVIDER=anthropic", async () => {
    process.env.VISION_PROVIDER = "anthropic";
    const { resetProviders, getVisionProviderType } = await import(
      "../ai/index"
    );
    resetProviders();

    expect(getVisionProviderType()).toBe("anthropic");

    resetProviders();
    delete process.env.VISION_PROVIDER;
  });

  it("defaults to Azure vision when VISION_PROVIDER not set", async () => {
    delete process.env.VISION_PROVIDER;
    const { resetProviders, getVisionProviderType } = await import(
      "../ai/index"
    );
    resetProviders();

    expect(getVisionProviderType()).toBe("azure");

    resetProviders();
  });

  it("resetProviders clears cached instances", async () => {
    process.env.VISION_PROVIDER = "azure";
    const { resetProviders, getVisionProviderType } = await import(
      "../ai/index"
    );
    resetProviders();

    // Verify type is azure
    expect(getVisionProviderType()).toBe("azure");

    // After reset + changing env, type should update
    process.env.VISION_PROVIDER = "anthropic";
    resetProviders();
    expect(getVisionProviderType()).toBe("anthropic");

    // Clean up
    process.env.VISION_PROVIDER = "azure";
    resetProviders();
  });
});
