/**
 * WebSocket Integration Tests
 *
 * Opens real WebSocket connections to a test Elysia server,
 * sends messages, and drives through the full 2-step Instagram proof flow.
 * AI vision and TTS providers are mocked at the module level.
 *
 * Requires a running PostgreSQL instance.
 * Set DATABASE_URL or defaults to local dev DB.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, mock } from "bun:test";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
// Import Database type from schema subpath (avoids loading
// @screenshare-guide/db main entrypoint which throws if DATABASE_URL is not set).
import type { Database } from "@screenshare-guide/db/schema";
import type { FrameAnalysisResult } from "../ai/types";

// ── Test DB ─────────────────────────────────────────────────────────

const TEST_DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/screenshare";

const testPool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
const testDb = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: testPool }),
});

// ── Mock AI module ──────────────────────────────────────────────────
// Must be set up before importing websocketHandler

let mockAnalyzeFrameImpl: (
  imageBase64: string,
  instruction: string,
  successCriteria: string,
  schema?: any
) => Promise<FrameAnalysisResult> = async () => ({
  description: "default mock",
  detectedElements: [],
  matchesSuccessCriteria: false,
  confidence: 0.3,
  suggestedAction: undefined,
  extractedData: [],
});

let mockGenerateSpeechImpl: (text: string, voiceId?: string) => Promise<string> =
  async () => "dGVzdA==";

mock.module("../ai", () => ({
  analyzeFrame: (...args: any[]) => (mockAnalyzeFrameImpl as any)(...args),
  generateSpeech: (...args: any[]) => (mockGenerateSpeechImpl as any)(...args),
  resetProviders: () => {},
  getVisionProvider: () => ({}),
  getTTSProvider: () => ({}),
}));

// ── Mock the @screenshare-guide/db module so websocket.ts uses our testDb ──
mock.module("@screenshare-guide/db", () => ({
  db: testDb,
}));

// ── Imports (after mock) ────────────────────────────────────────────

import { Elysia } from "elysia";
import { websocketHandler } from "../websocket";
import {
  ANALYSIS_DEBOUNCE_MS,
  CONSENSUS_THRESHOLD,
  INSTAGRAM_PROOF_TEMPLATE,
} from "@screenshare-guide/protocol";

// ── WebSocket Test Client ───────────────────────────────────────────

class TestWSClient {
  private ws: WebSocket;
  private messages: any[] = [];
  private waiters: Array<{
    resolve: (msg: any) => void;
    reject: (err: Error) => void;
    filter?: (msg: any) => boolean;
    timer: ReturnType<typeof setTimeout>;
  }> = [];
  private openPromise: Promise<void>;
  private closePromise: Promise<{ code: number; reason: string }>;
  private _closed = false;

  constructor(url: string) {
    this.ws = new WebSocket(url);

    this.openPromise = new Promise<void>((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (e) => reject(new Error(`WS connect error`)));
    });

    this.closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
      this.ws.addEventListener("close", (e) => {
        this._closed = true;
        resolve({ code: (e as CloseEvent).code, reason: (e as CloseEvent).reason || "" });
        // Reject all waiters
        for (const w of this.waiters) {
          clearTimeout(w.timer);
          w.reject(new Error("WebSocket closed while waiting"));
        }
        this.waiters = [];
      });
    });

    this.ws.addEventListener("message", (event) => {
      const data = typeof event.data === "string" ? event.data : String(event.data);
      let msg: any;
      try {
        msg = JSON.parse(data);
      } catch {
        msg = { raw: data };
      }
      this.messages.push(msg);

      // Resolve matching waiters (iterate backwards for safe splice)
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (!w.filter || w.filter(msg)) {
          clearTimeout(w.timer);
          w.resolve(msg);
          this.waiters.splice(i, 1);
        }
      }
    });
  }

  async waitForOpen(): Promise<void> {
    return this.openPromise;
  }

  async waitForClose(timeoutMs = 5000): Promise<{ code: number; reason: string }> {
    if (this._closed) return this.closePromise;
    return Promise.race([
      this.closePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timeout waiting for WS close")), timeoutMs)
      ),
    ]);
  }

  /**
   * Wait for a message, optionally filtering by type.
   * Checks already-buffered messages first.
   */
  async waitForMessage(type?: string, timeoutMs = 5000): Promise<any> {
    // Check buffered messages
    const idx = this.messages.findIndex((m) => !type || m.type === type);
    if (idx >= 0) {
      const [msg] = this.messages.splice(idx, 1);
      return msg;
    }

    // Wait for new message
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          const i = this.waiters.findIndex((w) => w.timer === timer);
          if (i >= 0) this.waiters.splice(i, 1);
          reject(new Error(`Timeout waiting for message type="${type || "any"}" after ${timeoutMs}ms`));
        },
        timeoutMs
      );
      this.waiters.push({
        resolve,
        reject,
        filter: type ? (m) => m.type === type : undefined,
        timer,
      });
    });
  }

  /**
   * Collect all messages of a given type that arrive within a window.
   */
  async collectMessages(type: string, windowMs: number): Promise<any[]> {
    await new Promise((r) => setTimeout(r, windowMs));
    const collected = this.messages.filter((m) => m.type === type);
    this.messages = this.messages.filter((m) => m.type !== type);
    return collected;
  }

  /**
   * Drain all buffered messages (non-blocking).
   */
  drainMessages(): any[] {
    const msgs = [...this.messages];
    this.messages = [];
    return msgs;
  }

  send(msg: object) {
    this.ws.send(JSON.stringify(msg));
  }

  sendRaw(data: string) {
    this.ws.send(data);
  }

  close() {
    this.ws.close();
  }

  get isClosed() {
    return this._closed;
  }
}

// ── Test Fixtures ───────────────────────────────────────────────────

let server: ReturnType<typeof Elysia.prototype.listen>;
let baseUrl: string;
let wsBaseUrl: string;
let port: number;

// Per-test state
let templateId: string;
let sessionToken: string;
let sessionId: string;

// Small base64 frame (tiny 1x1 transparent PNG as data)
const TINY_FRAME = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// ── Setup / Teardown ────────────────────────────────────────────────

beforeAll(async () => {
  // Start minimal Elysia server with websocketHandler on random port
  const app = new Elysia().use(websocketHandler);
  server = app.listen(0); // random available port
  port = (server as any).port || server.server?.port;
  baseUrl = `http://localhost:${port}`;
  wsBaseUrl = `ws://localhost:${port}`;
});

afterAll(async () => {
  server?.stop?.();
  await testPool.end();
});

beforeEach(async () => {
  // Reset mock implementations to defaults
  mockAnalyzeFrameImpl = async () => ({
    description: "default mock",
    detectedElements: [],
    matchesSuccessCriteria: false,
    confidence: 0.3,
    suggestedAction: undefined,
    extractedData: [],
  });
  mockGenerateSpeechImpl = async () => "dGVzdA==";

  // Create fresh template + session for each test
  const template = await testDb
    .insertInto("templates")
    .values({
      name: `Test Template ${Date.now()}`,
      description: "Integration test template",
      steps: JSON.stringify(INSTAGRAM_PROOF_TEMPLATE.steps),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  templateId = template.id;

  const token = `test-token-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const session = await testDb
    .insertInto("sessions")
    .values({
      token,
      template_id: templateId,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  sessionToken = token;
  sessionId = session.id;
});

afterEach(async () => {
  // Clean up test data
  await testDb.deleteFrom("recordings").where("session_id", "=", sessionId).execute();
  await testDb.deleteFrom("sessions").where("id", "=", sessionId).execute();
  await testDb.deleteFrom("templates").where("id", "=", templateId).execute();
});

// ── Helper: create connected client ─────────────────────────────────

async function connectClient(token?: string): Promise<TestWSClient> {
  const client = new TestWSClient(`${wsBaseUrl}/ws/${token ?? sessionToken}`);
  await client.waitForOpen();
  return client;
}

/** Small delay to respect debounce */
function debounceDelay(extra = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ANALYSIS_DEBOUNCE_MS + extra));
}

/**
 * After sending a frame that should trigger step advancement, the server
 * may issue an interaction challenge (random, ~40% probability) before
 * advancing. This helper handles both paths:
 *   - If no challenge → returns the stepComplete/completed message directly
 *   - If challenge → sends another frame to satisfy it, then returns stepComplete/completed
 */
async function waitForStepAdvance(
  client: TestWSClient,
  expectedType: "stepComplete" | "completed" = "stepComplete",
  timeoutMs = 5000,
): Promise<any> {
  // Wait for either stepComplete/completed OR a challenge message
  const msg = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for ${expectedType} or challenge after ${timeoutMs}ms`)),
      timeoutMs
    );
    // Try to get the expected message first (might already be buffered)
    const tryExpected = async () => {
      try {
        const result = await client.waitForMessage(expectedType, 200);
        clearTimeout(timer);
        resolve(result);
      } catch {
        // Not buffered yet — try challenge
        try {
          const challengeMsg = await client.waitForMessage("challenge", 200);
          clearTimeout(timer);
          resolve(challengeMsg);
        } catch {
          // Neither buffered — wait for whichever arrives first
          const raceTimeout = timeoutMs - 500;
          Promise.race([
            client.waitForMessage(expectedType, raceTimeout),
            client.waitForMessage("challenge", raceTimeout),
          ]).then((result) => {
            clearTimeout(timer);
            resolve(result);
          }).catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
        }
      }
    };
    tryExpected();
  });

  if (msg.type === "challenge") {
    // Drain the challenge TTS audio
    await new Promise((r) => setTimeout(r, 300));
    client.drainMessages();

    // Send a frame to satisfy the challenge — the mock analyzeFrame already
    // returns matchesSuccessCriteria: true, which the server uses for both
    // step analysis and challenge verification
    await debounceDelay();
    client.send({ type: "frame", imageData: TINY_FRAME });
    await client.waitForMessage("analyzing", 3000);
    await client.waitForMessage("analysis", 3000);

    // Now the step should advance
    return client.waitForMessage(expectedType, 5000);
  }

  return msg;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("WebSocket Integration Tests", () => {

  // ── Connection tests ────────────────────────────────────────────

  describe("Connection", () => {
    it("connects and receives 'connected' message with session info", async () => {
      const client = await connectClient();
      try {
        const msg = await client.waitForMessage("connected");
        expect(msg.type).toBe("connected");
        expect(msg.sessionId).toBe(sessionId);
        expect(msg.currentStep).toBe(0);
        expect(msg.totalSteps).toBe(2);
        expect(typeof msg.instruction).toBe("string");
        expect(msg.instruction.length).toBeGreaterThan(0);
      } finally {
        client.close();
      }
    });

    it("rejects connection with invalid token", async () => {
      const client = await connectClient("invalid-token-that-does-not-exist");
      try {
        const msg = await client.waitForMessage("error");
        expect(msg.type).toBe("error");
        expect(msg.message).toContain("Session not found");
        // Server should close the connection
        await client.waitForClose(3000);
      } finally {
        client.close();
      }
    });

    it("rejects connection with expired session", async () => {
      // Create an expired session
      const expiredToken = `expired-token-${Date.now()}`;
      const expiredSession = await testDb
        .insertInto("sessions")
        .values({
          token: expiredToken,
          template_id: templateId,
          expires_at: new Date(Date.now() - 1000), // already expired
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const client = await connectClient(expiredToken);
      try {
        const msg = await client.waitForMessage("error");
        expect(msg.type).toBe("error");
        expect(msg.message).toContain("expired");
        await client.waitForClose(3000);
      } finally {
        client.close();
        // Clean up the expired session
        await testDb.deleteFrom("sessions").where("id", "=", expiredSession.id).execute();
      }
    });

    it("sends initial audio instruction on connect for step 0", async () => {
      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        // Should receive an audio message for the first instruction
        const audioMsg = await client.waitForMessage("audio", 3000);
        expect(audioMsg.type).toBe("audio");
        expect(typeof audioMsg.text).toBe("string");
        expect(typeof audioMsg.audioData).toBe("string");
      } finally {
        client.close();
      }
    });
  });

  // ── Link-gate tests ─────────────────────────────────────────────

  describe("Link Gate", () => {
    it("ignores frames before link is clicked", async () => {
      let analyzeCallCount = 0;
      mockAnalyzeFrameImpl = async () => {
        analyzeCallCount++;
        return {
          description: "should not be called",
          detectedElements: [],
          matchesSuccessCriteria: false,
          confidence: 0.5,
          extractedData: [],
        };
      };

      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        // Drain initial audio
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        // Send frame WITHOUT clicking link first
        client.send({ type: "frame", imageData: TINY_FRAME });
        await debounceDelay();

        // Should NOT have called analyzeFrame
        expect(analyzeCallCount).toBe(0);

        // Should NOT receive "analyzing" message
        const msgs = client.drainMessages();
        const analyzingMsgs = msgs.filter((m) => m.type === "analyzing");
        expect(analyzingMsgs).toHaveLength(0);
      } finally {
        client.close();
      }
    });

    it("processes frames after linkClicked message", async () => {
      let analyzeCallCount = 0;
      mockAnalyzeFrameImpl = async () => {
        analyzeCallCount++;
        return {
          description: "MBS page visible",
          detectedElements: ["sidebar"],
          matchesSuccessCriteria: false,
          confidence: 0.5,
          extractedData: [],
        };
      };

      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        // Click link for step 0
        client.send({ type: "linkClicked", step: 0 });
        await debounceDelay();

        // Send frame after link click
        client.send({ type: "frame", imageData: TINY_FRAME });

        // Should receive "analyzing"
        const analyzing = await client.waitForMessage("analyzing", 3000);
        expect(analyzing.type).toBe("analyzing");

        // And then "analysis"
        const analysis = await client.waitForMessage("analysis", 3000);
        expect(analysis.type).toBe("analysis");
        expect(analyzeCallCount).toBe(1);
      } finally {
        client.close();
      }
    });
  });

  // ── Step 0 flow ─────────────────────────────────────────────────

  describe("Step 0 Flow", () => {
    it("sends 'analyzing' when processing a frame", async () => {
      mockAnalyzeFrameImpl = async () => ({
        description: "analyzing test",
        detectedElements: [],
        matchesSuccessCriteria: false,
        confidence: 0.3,
        extractedData: [],
      });

      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        client.send({ type: "linkClicked", step: 0 });
        await debounceDelay();

        client.send({ type: "frame", imageData: TINY_FRAME });
        const msg = await client.waitForMessage("analyzing", 3000);
        expect(msg.type).toBe("analyzing");
      } finally {
        client.close();
      }
    });

    it("sends analysis result with extracted data", async () => {
      mockAnalyzeFrameImpl = async () => ({
        description: "Handle found",
        detectedElements: ["sidebar", "handle"],
        matchesSuccessCriteria: false,
        confidence: 0.5,
        extractedData: [{ label: "Handle", value: "@testuser" }],
      });

      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        client.send({ type: "linkClicked", step: 0 });
        await debounceDelay();

        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        const analysis = await client.waitForMessage("analysis", 3000);
        expect(analysis.type).toBe("analysis");
        expect(analysis.matchesSuccess).toBe(false);
        expect(analysis.confidence).toBe(0.5);
        expect(analysis.extractedData).toEqual([{ label: "Handle", value: "@testuser" }]);
      } finally {
        client.close();
      }
    });

    it("requires consensus (2 votes) before committing extracted data", async () => {
      // Frame 1: First vote for Handle
      let callCount = 0;
      mockAnalyzeFrameImpl = async () => {
        callCount++;
        return {
          description: "Handle visible",
          detectedElements: [],
          matchesSuccessCriteria: false,
          confidence: 0.5,
          extractedData: [{ label: "Handle", value: "@testuser" }],
        };
      };

      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        client.send({ type: "linkClicked", step: 0 });
        await debounceDelay();

        // Frame 1 — first vote, not yet committed
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);

        // Check DB: no extracted data committed yet after 1 vote
        const session1 = await testDb
          .selectFrom("sessions")
          .selectAll()
          .where("id", "=", sessionId)
          .executeTakeFirstOrThrow();

        const meta1 = typeof session1.metadata === "string"
          ? JSON.parse(session1.metadata)
          : session1.metadata;
        const data1 = meta1?.extractedData || [];
        // After 1 vote, should be empty (not committed)
        expect(data1).toHaveLength(0);

        await debounceDelay();

        // Frame 2 — second vote, should reach consensus
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);

        // Wait for the async DB write
        await new Promise((r) => setTimeout(r, 300));

        // Check DB: extracted data should now be committed
        const session2 = await testDb
          .selectFrom("sessions")
          .selectAll()
          .where("id", "=", sessionId)
          .executeTakeFirstOrThrow();

        const meta2 = typeof session2.metadata === "string"
          ? JSON.parse(session2.metadata)
          : session2.metadata;
        const data2 = meta2?.extractedData || [];
        expect(data2).toHaveLength(1);
        expect(data2[0]).toEqual({ label: "Handle", value: "@testuser" });
      } finally {
        client.close();
      }
    });

    it("advances to step 1 after success criteria met with all required fields", async () => {
      // Need: matchesSuccessCriteria=true, confidence>0.7, Handle extracted (with consensus)
      // Since CONSENSUS_THRESHOLD=2, we need 2 successful frames with Handle
      // Since SUCCESS_THRESHOLD=1, we only need 1 consecutive success after fields are ready
      let callCount = 0;
      mockAnalyzeFrameImpl = async () => {
        callCount++;
        return {
          description: "MBS visible with handle",
          detectedElements: ["sidebar", "handle"],
          matchesSuccessCriteria: true,
          confidence: 0.9,
          extractedData: [{ label: "Handle", value: "@testuser" }],
        };
      };

      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        client.send({ type: "linkClicked", step: 0 });
        await debounceDelay();

        // Frame 1: success + Handle vote 1 (not yet consensus)
        // Because Handle not at consensus yet, won't advance
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);
        await debounceDelay();

        // Frame 2: success + Handle vote 2 (consensus reached!)
        // Now hasAllRequiredFields should be true, and this is a success → advance
        // Server may issue an interaction challenge before advancing (random ~40%)
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);

        // Handle possible challenge, then get stepComplete
        const stepComplete = await waitForStepAdvance(client, "stepComplete");
        expect(stepComplete.type).toBe("stepComplete");
        expect(stepComplete.currentStep).toBe(1);
        expect(stepComplete.totalSteps).toBe(2);
        expect(typeof stepComplete.nextInstruction).toBe("string");
      } finally {
        client.close();
      }
    });

    it("sends audio (TTS) on step transitions", async () => {
      let callCount = 0;
      mockAnalyzeFrameImpl = async () => {
        callCount++;
        return {
          description: "MBS with handle",
          detectedElements: [],
          matchesSuccessCriteria: true,
          confidence: 0.9,
          extractedData: [{ label: "Handle", value: "@testuser" }],
        };
      };

      let ttsTexts: string[] = [];
      mockGenerateSpeechImpl = async (text: string) => {
        ttsTexts.push(text);
        return "dGVzdA==";
      };

      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        // Initial instruction audio
        await client.waitForMessage("audio", 3000);
        ttsTexts = []; // Reset after initial audio
        client.drainMessages();

        client.send({ type: "linkClicked", step: 0 });
        await debounceDelay();

        // Frame 1: consensus vote 1
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);
        await debounceDelay();

        // Frame 2: consensus reached → advance → TTS
        // Server may issue a challenge before advancing
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);

        const stepComplete = await waitForStepAdvance(client, "stepComplete");
        expect(stepComplete.type).toBe("stepComplete");

        // Should receive audio for step transition
        const audio = await client.waitForMessage("audio", 3000);
        expect(audio.type).toBe("audio");
        expect(audio.audioData).toBe("dGVzdA==");
        // TTS text should mention step completion
        expect(audio.text).toContain("Step complete");
      } finally {
        client.close();
      }
    });
  });

  // ── Step 1 → completion flow ────────────────────────────────────

  describe("Step 1 → Completion", () => {
    /**
     * Helper: advance to step 1 by completing step 0.
     * Returns the client positioned at step 1.
     */
    async function advanceToStep1(client: TestWSClient): Promise<void> {
      let step0CallCount = 0;
      mockAnalyzeFrameImpl = async () => {
        step0CallCount++;
        return {
          description: "MBS with handle",
          detectedElements: [],
          matchesSuccessCriteria: true,
          confidence: 0.9,
          extractedData: [{ label: "Handle", value: "@testuser" }],
        };
      };

      await client.waitForMessage("connected");
      await new Promise((r) => setTimeout(r, 500));
      client.drainMessages();

      client.send({ type: "linkClicked", step: 0 });
      await debounceDelay();

      // Two frames for consensus
      client.send({ type: "frame", imageData: TINY_FRAME });
      await client.waitForMessage("analyzing", 3000);
      await client.waitForMessage("analysis", 3000);
      await debounceDelay();

      client.send({ type: "frame", imageData: TINY_FRAME });
      await client.waitForMessage("analyzing", 3000);
      await client.waitForMessage("analysis", 3000);

      // Server may issue an interaction challenge before advancing
      await waitForStepAdvance(client, "stepComplete");

      // Drain audio message from transition
      await new Promise((r) => setTimeout(r, 500));
      client.drainMessages();
    }

    it("completes session after all steps pass with all required fields", async () => {
      const client = await connectClient();
      try {
        await advanceToStep1(client);

        // Now set up step 1 mock: needs Reach, Non-followers reached, Followers reached
        let step1CallCount = 0;
        mockAnalyzeFrameImpl = async () => {
          step1CallCount++;
          return {
            description: "Insights page with all metrics",
            detectedElements: [],
            matchesSuccessCriteria: true,
            confidence: 0.9,
            extractedData: [
              { label: "Reach", value: "1,234" },
              { label: "Non-followers reached", value: "987" },
              { label: "Followers reached", value: "247" },
            ],
          };
        };

        // Click link for step 1
        client.send({ type: "linkClicked", step: 1 });
        await debounceDelay();

        // Frame 1: first vote (not consensus yet)
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);
        await debounceDelay();

        // Frame 2: consensus reached → complete (may get challenge first)
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);

        const completed = await waitForStepAdvance(client, "completed");
        expect(completed.type).toBe("completed");
        expect(completed.message).toContain("All steps completed");
      } finally {
        client.close();
      }
    });

    it("sends 'completed' message with all extracted data", async () => {
      const client = await connectClient();
      try {
        await advanceToStep1(client);

        mockAnalyzeFrameImpl = async () => ({
          description: "All metrics",
          detectedElements: [],
          matchesSuccessCriteria: true,
          confidence: 0.9,
          extractedData: [
            { label: "Reach", value: "1,234" },
            { label: "Non-followers reached", value: "987" },
            { label: "Followers reached", value: "247" },
          ],
        });

        client.send({ type: "linkClicked", step: 1 });
        await debounceDelay();

        // Two frames for consensus
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);
        await debounceDelay();

        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);

        const completed = await waitForStepAdvance(client, "completed");
        expect(completed.extractedData).toBeDefined();
        expect(Array.isArray(completed.extractedData)).toBe(true);

        const labels = completed.extractedData.map((d: any) => d.label);
        expect(labels).toContain("Handle");
        expect(labels).toContain("Reach");
        expect(labels).toContain("Non-followers reached");
        expect(labels).toContain("Followers reached");
      } finally {
        client.close();
      }
    });

    it("persists extracted data to database on completion", async () => {
      const client = await connectClient();
      try {
        await advanceToStep1(client);

        mockAnalyzeFrameImpl = async () => ({
          description: "All metrics",
          detectedElements: [],
          matchesSuccessCriteria: true,
          confidence: 0.9,
          extractedData: [
            { label: "Reach", value: "1,234" },
            { label: "Non-followers reached", value: "987" },
            { label: "Followers reached", value: "247" },
          ],
        });

        client.send({ type: "linkClicked", step: 1 });
        await debounceDelay();

        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);
        await debounceDelay();

        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);

        await waitForStepAdvance(client, "completed");

        // Wait for async DB writes to complete
        await new Promise((r) => setTimeout(r, 500));

        // Verify database state
        const session = await testDb
          .selectFrom("sessions")
          .selectAll()
          .where("id", "=", sessionId)
          .executeTakeFirstOrThrow();

        expect(session.status).toBe("completed");
        expect(session.current_step).toBe(2); // past last step

        const metadata = typeof session.metadata === "string"
          ? JSON.parse(session.metadata)
          : session.metadata;
        expect(metadata).toBeDefined();
        expect(metadata.extractedData).toBeDefined();
        expect(metadata.completedAt).toBeDefined();

        const labels = metadata.extractedData.map((d: any) => d.label);
        expect(labels).toContain("Handle");
        expect(labels).toContain("Reach");
        expect(labels).toContain("Non-followers reached");
        expect(labels).toContain("Followers reached");
      } finally {
        client.close();
      }
    });
  });

  // ── Full E2E flow ───────────────────────────────────────────────

  describe("Full E2E", () => {
    it("full 2-step flow: connect → link → frames → step advance → link → frames → complete", async () => {
      let frameCount = 0;
      mockAnalyzeFrameImpl = async () => {
        frameCount++;
        // Step 0 frames (1-2): Handle extraction
        if (frameCount <= 2) {
          return {
            description: "MBS page with handle",
            detectedElements: ["sidebar"],
            matchesSuccessCriteria: true,
            confidence: 0.9,
            extractedData: [{ label: "Handle", value: "@integrationuser" }],
          };
        }
        // Step 1 frame 3: partial data
        if (frameCount === 3) {
          return {
            description: "Insights with partial metrics",
            detectedElements: [],
            matchesSuccessCriteria: true,
            confidence: 0.85,
            extractedData: [
              { label: "Reach", value: "5,678" },
              { label: "Non-followers reached", value: "3,456" },
            ],
          };
        }
        // Step 1 frames 4+: all data
        return {
          description: "Insights with all metrics",
          detectedElements: [],
          matchesSuccessCriteria: true,
          confidence: 0.9,
          extractedData: [
            { label: "Reach", value: "5,678" },
            { label: "Non-followers reached", value: "3,456" },
            { label: "Followers reached", value: "2,222" },
          ],
        };
      };

      const client = await connectClient();
      try {
        // 1. Connect
        const connected = await client.waitForMessage("connected");
        expect(connected.sessionId).toBe(sessionId);
        expect(connected.currentStep).toBe(0);
        expect(connected.totalSteps).toBe(2);

        // Wait for initial audio and drain
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        // 2. Click link for step 0
        client.send({ type: "linkClicked", step: 0 });
        await debounceDelay();

        // 3. Frame 1: Handle vote 1
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        const analysis1 = await client.waitForMessage("analysis", 3000);
        expect(analysis1.matchesSuccess).toBe(true);
        await debounceDelay();

        // 4. Frame 2: Handle vote 2 → consensus → advance to step 1
        //    Server may issue an interaction challenge before advancing
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);

        const stepComplete1 = await waitForStepAdvance(client, "stepComplete");
        expect(stepComplete1.currentStep).toBe(1);
        expect(stepComplete1.totalSteps).toBe(2);

        // Drain audio + other messages from transition
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        // 5. Click link for step 1
        client.send({ type: "linkClicked", step: 1 });
        await debounceDelay();

        // 6. Frame 3: partial metrics (Reach + Non-followers — missing Followers reached)
        // success=true but not all required fields → won't advance yet
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        const analysis3 = await client.waitForMessage("analysis", 3000);
        expect(analysis3.matchesSuccess).toBe(true);
        await debounceDelay();

        // 7. Frame 4: all metrics vote 1 (partial data from frame 3 had Reach + Non-followers at count 1)
        // frame 4 has all 3 fields. Reach→2, Non-followers→2 (consensus), Followers→1 (not yet)
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);
        await debounceDelay();

        // 8. Frame 5: all metrics vote - Reach→3, Non-followers→3, Followers→2 (consensus for all!)
        //    Server may issue a challenge before completing
        client.send({ type: "frame", imageData: TINY_FRAME });
        await client.waitForMessage("analyzing", 3000);
        await client.waitForMessage("analysis", 3000);

        // 9. Session complete (may go through challenge first)
        const completed = await waitForStepAdvance(client, "completed");
        expect(completed.type).toBe("completed");
        expect(completed.message).toContain("All steps completed");

        const labels = completed.extractedData.map((d: any) => d.label);
        expect(labels).toContain("Handle");
        expect(labels).toContain("Reach");
        expect(labels).toContain("Non-followers reached");
        expect(labels).toContain("Followers reached");

        // Verify DB
        await new Promise((r) => setTimeout(r, 500));
        const session = await testDb
          .selectFrom("sessions")
          .selectAll()
          .where("id", "=", sessionId)
          .executeTakeFirstOrThrow();
        expect(session.status).toBe("completed");
      } finally {
        client.close();
      }
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("rate limits excessive messages", async () => {
      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        // Send more than 50 messages rapidly (WS_RATE_LIMIT_MAX=50)
        for (let i = 0; i < 55; i++) {
          client.send({ type: "ping" });
        }

        // Wait for responses
        await new Promise((r) => setTimeout(r, 1000));
        const msgs = client.drainMessages();

        // Should have some pong responses but also an error about rate limiting
        const errors = msgs.filter((m) => m.type === "error" && m.message.includes("Rate limit"));
        expect(errors.length).toBeGreaterThan(0);
      } finally {
        client.close();
      }
    });

    it("rejects oversized frame payloads", async () => {
      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        client.send({ type: "linkClicked", step: 0 });

        // Send a frame that exceeds the 2MB zod limit on imageData
        const oversizedData = "A".repeat(2 * 1024 * 1024 + 100);
        client.send({ type: "frame", imageData: oversizedData });

        // Should receive an error about invalid format (zod max check)
        const error = await client.waitForMessage("error", 3000);
        expect(error.type).toBe("error");
        // The error is either "Message too large" (raw size check) or "Invalid message format" (zod)
        expect(
          error.message.includes("too large") || error.message.includes("Invalid")
        ).toBe(true);
      } finally {
        client.close();
      }
    });

    it("responds to ping with pong", async () => {
      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        await new Promise((r) => setTimeout(r, 500));
        client.drainMessages();

        client.send({ type: "ping" });
        const pong = await client.waitForMessage("pong", 3000);
        expect(pong.type).toBe("pong");
      } finally {
        client.close();
      }
    });

    it("handles TTS failure gracefully (falls back to instruction)", async () => {
      // Make TTS fail
      mockGenerateSpeechImpl = async () => {
        throw new Error("TTS service unavailable");
      };

      const client = await connectClient();
      try {
        await client.waitForMessage("connected");
        // When TTS fails, the server falls back to an "instruction" text-only message
        const msg = await client.waitForMessage("instruction", 3000);
        expect(msg.type).toBe("instruction");
        expect(typeof msg.text).toBe("string");
      } finally {
        client.close();
      }
    });
  });
});
