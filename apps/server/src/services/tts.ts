/**
 * Text-to-Speech service using ElevenLabs API
 */

const ELEVENLABS_API_URL = "https://api.elevenlabs.io/v1";

// Default voice settings
const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

/**
 * Generate speech audio from text using ElevenLabs.
 *
 * @param text - The text to convert to speech
 * @param voiceId - Optional voice ID (defaults to env var)
 * @returns Base64 encoded audio data (MP3)
 */
export async function generateSpeech(
  text: string,
  voiceId?: string
): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is required");
  }

  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel default

  const response = await fetch(
    `${ELEVENLABS_API_URL}/text-to-speech/${voice}`,
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
        voice_settings: DEFAULT_VOICE_SETTINGS,
      }),
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[TTS] ElevenLabs error:", response.status, errorText);
    throw new Error(`ElevenLabs API error: ${response.status}`);
  }

  // Convert response to base64
  const arrayBuffer = await response.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");

  return base64;
}

/**
 * Generate speech with streaming support.
 * Returns an async generator that yields audio chunks.
 */
export async function* generateSpeechStream(
  text: string,
  voiceId?: string
): AsyncGenerator<Uint8Array> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is required");
  }

  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

  const response = await fetch(
    `${ELEVENLABS_API_URL}/text-to-speech/${voice}/stream`,
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_monolingual_v1",
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

/**
 * Get available voices from ElevenLabs.
 */
export async function getVoices(): Promise<
  Array<{ voice_id: string; name: string; category: string }>
> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY environment variable is required");
  }

  const response = await fetch(`${ELEVENLABS_API_URL}/voices`, {
    headers: {
      "xi-api-key": apiKey,
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
