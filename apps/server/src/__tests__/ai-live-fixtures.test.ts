/**
 * Live AI Fixture Tests
 *
 * Sends REAL screenshots from production verification sessions through the
 * actual Azure OpenAI vision API. Tests that extraction prompts work correctly
 * against real-world MBS and Insights pages.
 *
 * These tests:
 * - Call the live Azure OpenAI API (costs ~$0.01-0.03 per frame)
 * - Are non-deterministic (model may return slightly different values)
 * - Take 3-10s per test
 * - Should run on-demand or nightly, NOT on every CI push
 *
 * Skip by default — run with: LIVE_AI_TESTS=1 bun test --filter ai-live
 *
 * Fixtures extracted from actual session recording:
 *   recordings/91717955-2dfb-4cbc-9d32-fe171924f00e.webm
 */

import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { INSTAGRAM_PROOF_TEMPLATE } from "@screenshare-guide/protocol";

// Skip unless explicitly enabled
const ENABLED = process.env.LIVE_AI_TESTS === "1";

// Lazy-import to avoid constructor errors when Azure env vars aren't set
let analyzeFrame: typeof import("../ai")["analyzeFrame"];

const FIXTURES_DIR = join(import.meta.dir, "fixtures");

function loadFixtureAsBase64(filename: string): string {
  const buf = readFileSync(join(FIXTURES_DIR, filename));
  return `data:image/jpeg;base64,${buf.toString("base64")}`;
}

const step0 = INSTAGRAM_PROOF_TEMPLATE.steps[0];
const step1 = INSTAGRAM_PROOF_TEMPLATE.steps[1];

describe.skipIf(!ENABLED)("Live AI fixture tests", () => {
  beforeAll(async () => {
    // Dynamic import so it only runs when LIVE_AI_TESTS=1
    const ai = await import("../ai");
    analyzeFrame = ai.analyzeFrame;
  });

  it("extracts Handle from MBS home page screenshot", async () => {
    const image = loadFixtureAsBase64("mbs-home.jpg");
    const result = await analyzeFrame(
      image,
      step0.instruction,
      step0.successCriteria,
      step0.extractionSchema
    );

    // Should match — this IS the MBS home page
    expect(result.matchesSuccessCriteria).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);

    // Should extract the Handle
    const handle = result.extractedData?.find((d) => d.label === "Handle");
    expect(handle).toBeDefined();
    expect(handle!.value).toMatch(/@?kdus4n/i);
  }, 30_000);

  it("extracts Reach metrics from Insights page screenshot", async () => {
    const image = loadFixtureAsBase64("insights-page.jpg");
    const result = await analyzeFrame(
      image,
      step1.instruction,
      step1.successCriteria,
      step1.extractionSchema
    );

    // Should match — this IS the Insights overview page
    expect(result.matchesSuccessCriteria).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.7);

    // Should extract Reach
    const reach = result.extractedData?.find((d) => d.label === "Reach");
    expect(reach).toBeDefined();
    expect(reach!.value).toMatch(/147/);

    // Should extract Non-followers reached
    const nonFollowers = result.extractedData?.find((d) => d.label === "Non-followers reached");
    expect(nonFollowers).toBeDefined();
    expect(nonFollowers!.value).toMatch(/117/);

    // Should extract Followers reached
    const followers = result.extractedData?.find((d) => d.label === "Followers reached");
    expect(followers).toBeDefined();
    expect(followers!.value).toMatch(/30/);
  }, 30_000);

  it("does NOT match app landing page as MBS (negative case)", async () => {
    const image = loadFixtureAsBase64("app-landing.jpg");
    const result = await analyzeFrame(
      image,
      step0.instruction,
      step0.successCriteria,
      step0.extractionSchema
    );

    // Should NOT match — this is our app's landing page, not MBS
    expect(result.matchesSuccessCriteria).toBe(false);
  }, 30_000);

  it("does NOT match app landing page as Insights (negative case)", async () => {
    const image = loadFixtureAsBase64("app-landing.jpg");
    const result = await analyzeFrame(
      image,
      step1.instruction,
      step1.successCriteria,
      step1.extractionSchema
    );

    // Should NOT match — this is our app's landing page, not Insights
    expect(result.matchesSuccessCriteria).toBe(false);
  }, 30_000);

  it("does NOT match MBS home as Insights page (wrong step)", async () => {
    const image = loadFixtureAsBase64("mbs-home.jpg");
    const result = await analyzeFrame(
      image,
      step1.instruction,
      step1.successCriteria,
      step1.extractionSchema
    );

    // MBS home is NOT the Insights overview page
    expect(result.matchesSuccessCriteria).toBe(false);
  }, 30_000);
});
