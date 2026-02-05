import Anthropic from "@anthropic-ai/sdk";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export interface FrameAnalysisResult {
  description: string;
  detectedElements: string[];
  matchesSuccessCriteria: boolean;
  confidence: number;
  suggestedAction?: string;
}

/**
 * Analyze a screen frame using Claude's vision capabilities.
 *
 * @param imageBase64 - Base64 encoded image data (with or without data URL prefix)
 * @param currentInstruction - What the user is supposed to do
 * @param successCriteria - What indicates the step is complete
 * @returns Analysis result with success evaluation
 */
export async function analyzeFrame(
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
4. If the user seems stuck, provide helpful guidance

Be concise and helpful. Focus on actionable observations.`;

  const userPrompt = `Current instruction for the user: "${currentInstruction}"

Success criteria (what indicates this step is complete): "${successCriteria}"

Please analyze this screenshot and provide:
1. A brief description of what's visible on screen
2. Key UI elements you can identify
3. Whether the success criteria appears to be met (true/false)
4. Your confidence level (0.0 to 1.0)
5. If the criteria is NOT met, a suggested action for the user

Respond in JSON format:
{
  "description": "string",
  "detectedElements": ["string"],
  "matchesSuccessCriteria": boolean,
  "confidence": number,
  "suggestedAction": "string or null"
}`;

  try {
    const response = await anthropic.messages.create({
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
      detectedElements: Array.isArray(result.detectedElements) ? result.detectedElements : [],
      matchesSuccessCriteria: Boolean(result.matchesSuccessCriteria),
      confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
      suggestedAction: result.suggestedAction || undefined,
    };
  } catch (error) {
    console.error("[Vision] Analysis error:", error);

    // Return safe default on error
    return {
      description: "Unable to analyze frame",
      detectedElements: [],
      matchesSuccessCriteria: false,
      confidence: 0,
      suggestedAction: "Please try again or contact support if the issue persists.",
    };
  }
}

/**
 * Quick check if an image appears to show a specific element.
 * Useful for simple presence checks without full analysis.
 */
export async function quickElementCheck(
  imageBase64: string,
  elementDescription: string
): Promise<{ found: boolean; confidence: number }> {
  const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

  try {
    const response = await anthropic.messages.create({
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
    console.error("[Vision] Quick check error:", error);
    return { found: false, confidence: 0 };
  }
}
