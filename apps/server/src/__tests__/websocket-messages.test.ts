import { describe, it, expect, beforeEach } from "bun:test";

/**
 * WebSocket message handling unit tests.
 *
 * Extracts and exercises the core logic from websocket.ts:
 * - linkClicked handling
 * - hasAllStep3Metrics
 * - accumulateExtractedData (dedup)
 * - frame debouncing
 * - rate limiting
 */

// ── Types mirroring websocket.ts ────────────────────────────────────

interface SessionState {
  sessionId: string;
  templateId: string;
  currentStep: number;
  totalSteps: number;
  steps: Array<{
    instruction: string;
    successCriteria: string;
    hints?: string[];
  }>;
  status: "waiting" | "analyzing" | "speaking" | "completed";
  lastAnalysisTime: number;
  consecutiveSuccesses: number;
  linkClicked: Record<number, boolean>;
  allExtractedData: Array<{ label: string; value: string }>;
  lastSpokenAction: string | null;
  lastInstructionTime: number;
  awaitingAudioComplete: boolean;
}

// Constants (must match websocket.ts)
const ANALYSIS_DEBOUNCE_MS = 800;
const WS_RATE_LIMIT_WINDOW = 10000;
const WS_RATE_LIMIT_MAX = 30;

// ── Functions extracted from websocket.ts ───────────────────────────

function handleLinkClicked(state: SessionState, step: number) {
  state.linkClicked[step] = true;
  // Reset lastSpokenAction so the first analysis after clicking gets a fresh instruction
  state.lastSpokenAction = null;
}

function accumulateExtractedData(
  state: SessionState,
  items: Array<{ label: string; value: string }>
) {
  if (!items?.length) return;
  for (const item of items) {
    if (!item.label || !item.value) continue;
    const idx = state.allExtractedData.findIndex((d) => d.label === item.label);
    if (idx >= 0) {
      state.allExtractedData[idx] = item;
    } else {
      state.allExtractedData.push(item);
    }
  }
}

function hasAllStep3Metrics(state: SessionState): boolean {
  const labels = state.allExtractedData.map((d) => d.label.toLowerCase());
  const hasReach = labels.some((l) => l.includes("reach"));
  const hasNonFollowers = labels.some(
    (l) => l.includes("non-follower") || l.includes("non follower")
  );
  const hasFollowers = labels.some(
    (l) =>
      l.includes("follower") &&
      !l.includes("non-follower") &&
      !l.includes("non follower")
  );
  return hasReach && hasNonFollowers && hasFollowers;
}

function shouldAnalyzeFrame(state: SessionState, now: number): boolean {
  if (state.status === "completed" || state.status === "speaking" || state.awaitingAudioComplete) return false;
  if (now - state.lastAnalysisTime < ANALYSIS_DEBOUNCE_MS) return false;
  return true;
}

/**
 * Determines if a new TTS instruction should be sent for a suggestedAction.
 * Deduplicates: only speaks if action changed or 15s stuck timeout elapsed.
 */
function shouldSendInstruction(state: SessionState, suggestedAction: string, now: number): boolean {
  const isDifferentAction = state.lastSpokenAction === null || suggestedAction !== state.lastSpokenAction;
  const isStuckTimeout = (now - state.lastInstructionTime) >= 15000;
  return isDifferentAction || isStuckTimeout;
}

// Rate limiter
const messageRateLimit = new Map<
  string,
  { count: number; resetAt: number }
>();

function checkWsRateLimit(token: string, now?: number): boolean {
  const ts = now ?? Date.now();
  let entry = messageRateLimit.get(token);
  if (!entry || entry.resetAt < ts) {
    entry = { count: 0, resetAt: ts + WS_RATE_LIMIT_WINDOW };
    messageRateLimit.set(token, entry);
  }
  entry.count++;
  return entry.count <= WS_RATE_LIMIT_MAX;
}

// ── Helper ──────────────────────────────────────────────────────────

function createState(
  overrides: Partial<SessionState> = {}
): SessionState {
  return {
    sessionId: "test-sess",
    templateId: "test-tmpl",
    currentStep: 0,
    totalSteps: 3,
    steps: [
      {
        instruction: "Open Meta Business Suite",
        successCriteria: "MBS home page visible",
      },
      {
        instruction: "Navigate to Insights",
        successCriteria: "Insights page visible",
      },
      {
        instruction: "Capture audience metrics",
        successCriteria: "All metrics found",
      },
    ],
    status: "waiting",
    lastAnalysisTime: 0,
    consecutiveSuccesses: 0,
    linkClicked: {},
    allExtractedData: [],
    lastSpokenAction: null,
    lastInstructionTime: 0,
    awaitingAudioComplete: false,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("linkClicked handling", () => {
  it("records link click for step 1", () => {
    const state = createState();
    handleLinkClicked(state, 1);

    expect(state.linkClicked[1]).toBe(true);
  });

  it("records link click for step 2", () => {
    const state = createState();
    handleLinkClicked(state, 2);

    expect(state.linkClicked[2]).toBe(true);
  });

  it("does not affect other steps", () => {
    const state = createState();
    handleLinkClicked(state, 1);

    expect(state.linkClicked[1]).toBe(true);
    expect(state.linkClicked[2]).toBeUndefined();
  });

  it("handles multiple link clicks on same step", () => {
    const state = createState();
    handleLinkClicked(state, 1);
    handleLinkClicked(state, 1);

    expect(state.linkClicked[1]).toBe(true);
  });

  it("handles link clicks on multiple steps", () => {
    const state = createState();
    handleLinkClicked(state, 1);
    handleLinkClicked(state, 2);

    expect(state.linkClicked[1]).toBe(true);
    expect(state.linkClicked[2]).toBe(true);
  });

  it("resets lastSpokenAction on link click (fresh instruction)", () => {
    const state = createState({
      lastSpokenAction: "Click the button to navigate",
    });
    handleLinkClicked(state, 1);

    expect(state.linkClicked[1]).toBe(true);
    expect(state.lastSpokenAction).toBeNull();
  });

  it("resets lastSpokenAction even on repeated link click", () => {
    const state = createState({
      lastSpokenAction: "Some action",
    });
    handleLinkClicked(state, 1);
    state.lastSpokenAction = "New action after first click";
    handleLinkClicked(state, 1);

    expect(state.lastSpokenAction).toBeNull();
  });
});

describe("hasAllStep3Metrics", () => {
  it("returns true when all three metrics are present", () => {
    const state = createState({
      allExtractedData: [
        { label: "Reach", value: "12,345" },
        { label: "Non-Followers", value: "8,000" },
        { label: "Followers", value: "4,345" },
      ],
    });

    expect(hasAllStep3Metrics(state)).toBe(true);
  });

  it("returns false with no metrics", () => {
    const state = createState({ allExtractedData: [] });

    expect(hasAllStep3Metrics(state)).toBe(false);
  });

  it("returns false with only Reach", () => {
    const state = createState({
      allExtractedData: [{ label: "Reach", value: "10,000" }],
    });

    expect(hasAllStep3Metrics(state)).toBe(false);
  });

  it("returns false with only Reach and Non-Followers", () => {
    const state = createState({
      allExtractedData: [
        { label: "Reach", value: "10,000" },
        { label: "Non-Followers", value: "6,000" },
      ],
    });

    expect(hasAllStep3Metrics(state)).toBe(false);
  });

  it("returns false with only Reach and Followers", () => {
    const state = createState({
      allExtractedData: [
        { label: "Reach", value: "10,000" },
        { label: "Followers", value: "4,000" },
      ],
    });

    expect(hasAllStep3Metrics(state)).toBe(false);
  });

  // ── Case variation tests ──

  it("handles lowercase 'reach'", () => {
    const state = createState({
      allExtractedData: [
        { label: "reach", value: "12,345" },
        { label: "non-followers", value: "8,000" },
        { label: "followers", value: "4,345" },
      ],
    });

    expect(hasAllStep3Metrics(state)).toBe(true);
  });

  it("handles mixed case 'Accounts Reached'", () => {
    const state = createState({
      allExtractedData: [
        { label: "Accounts Reached", value: "12,345" },
        { label: "Non-Followers", value: "8,000" },
        { label: "Followers", value: "4,345" },
      ],
    });

    expect(hasAllStep3Metrics(state)).toBe(true);
  });

  it("handles 'Non Followers' (no hyphen)", () => {
    const state = createState({
      allExtractedData: [
        { label: "Reach", value: "12,345" },
        { label: "Non Followers", value: "8,000" },
        { label: "Followers", value: "4,345" },
      ],
    });

    expect(hasAllStep3Metrics(state)).toBe(true);
  });

  it("handles 'non-follower' (singular)", () => {
    const state = createState({
      allExtractedData: [
        { label: "Reach", value: "12,345" },
        { label: "non-follower count", value: "8,000" },
        { label: "Follower count", value: "4,345" },
      ],
    });

    expect(hasAllStep3Metrics(state)).toBe(true);
  });

  it("correctly distinguishes Followers from Non-Followers", () => {
    // The "Followers" check must exclude labels containing "non-follower"
    const state = createState({
      allExtractedData: [
        { label: "Reach", value: "12,345" },
        { label: "Non-Followers", value: "8,000" },
        // No plain "Followers" label
      ],
    });

    expect(hasAllStep3Metrics(state)).toBe(false);
  });

  it("handles extra data items gracefully", () => {
    const state = createState({
      allExtractedData: [
        { label: "Instagram Handle", value: "@testuser" },
        { label: "Reach", value: "12,345" },
        { label: "Non-Followers", value: "8,000" },
        { label: "Followers", value: "4,345" },
        { label: "Engagement Rate", value: "3.2%" },
      ],
    });

    expect(hasAllStep3Metrics(state)).toBe(true);
  });
});

describe("accumulateExtractedData", () => {
  it("adds new items", () => {
    const state = createState();

    accumulateExtractedData(state, [{ label: "Reach", value: "10,000" }]);

    expect(state.allExtractedData).toHaveLength(1);
    expect(state.allExtractedData[0]).toEqual({
      label: "Reach",
      value: "10,000",
    });
  });

  it("deduplicates by label (keeps latest)", () => {
    const state = createState({
      allExtractedData: [{ label: "Reach", value: "10,000" }],
    });

    accumulateExtractedData(state, [{ label: "Reach", value: "15,000" }]);

    expect(state.allExtractedData).toHaveLength(1);
    expect(state.allExtractedData[0].value).toBe("15,000");
  });

  it("adds multiple items at once", () => {
    const state = createState();

    accumulateExtractedData(state, [
      { label: "Reach", value: "10,000" },
      { label: "Followers", value: "5,000" },
    ]);

    expect(state.allExtractedData).toHaveLength(2);
  });

  it("handles mixed new and existing items", () => {
    const state = createState({
      allExtractedData: [{ label: "Reach", value: "10,000" }],
    });

    accumulateExtractedData(state, [
      { label: "Reach", value: "12,000" }, // update
      { label: "Followers", value: "5,000" }, // new
    ]);

    expect(state.allExtractedData).toHaveLength(2);
    expect(state.allExtractedData[0]).toEqual({
      label: "Reach",
      value: "12,000",
    });
    expect(state.allExtractedData[1]).toEqual({
      label: "Followers",
      value: "5,000",
    });
  });

  it("skips items with empty label", () => {
    const state = createState();

    accumulateExtractedData(state, [{ label: "", value: "123" }]);

    expect(state.allExtractedData).toHaveLength(0);
  });

  it("skips items with empty value", () => {
    const state = createState();

    accumulateExtractedData(state, [{ label: "Reach", value: "" }]);

    expect(state.allExtractedData).toHaveLength(0);
  });

  it("handles null/undefined items array gracefully", () => {
    const state = createState();

    accumulateExtractedData(state, null as any);
    accumulateExtractedData(state, undefined as any);
    accumulateExtractedData(state, []);

    expect(state.allExtractedData).toHaveLength(0);
  });

  it("preserves insertion order for new labels", () => {
    const state = createState();

    accumulateExtractedData(state, [
      { label: "A", value: "1" },
      { label: "B", value: "2" },
      { label: "C", value: "3" },
    ]);

    expect(state.allExtractedData.map((d) => d.label)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});

describe("frame debouncing", () => {
  it("allows first frame analysis", () => {
    const state = createState({ lastAnalysisTime: 0 });
    expect(shouldAnalyzeFrame(state, Date.now())).toBe(true);
  });

  it("blocks frame within 800ms of last analysis", () => {
    const now = Date.now();
    const state = createState({ lastAnalysisTime: now - 400 });

    expect(shouldAnalyzeFrame(state, now)).toBe(false);
  });

  it("blocks frame at exactly 800ms boundary", () => {
    const now = Date.now();
    const state = createState({ lastAnalysisTime: now - 799 });

    expect(shouldAnalyzeFrame(state, now)).toBe(false);
  });

  it("allows frame after 800ms debounce", () => {
    const now = Date.now();
    const state = createState({ lastAnalysisTime: now - 801 });

    expect(shouldAnalyzeFrame(state, now)).toBe(true);
  });

  it("blocks analysis when session is completed", () => {
    const state = createState({ status: "completed", lastAnalysisTime: 0 });
    expect(shouldAnalyzeFrame(state, Date.now())).toBe(false);
  });

  it("blocks analysis when speaking", () => {
    const state = createState({ status: "speaking", lastAnalysisTime: 0 });
    expect(shouldAnalyzeFrame(state, Date.now())).toBe(false);
  });

  it("blocks analysis when awaiting audio complete", () => {
    const state = createState({ awaitingAudioComplete: true, lastAnalysisTime: 0 });
    expect(shouldAnalyzeFrame(state, Date.now())).toBe(false);
  });

  it("allows analysis when waiting", () => {
    const state = createState({ status: "waiting", lastAnalysisTime: 0 });
    expect(shouldAnalyzeFrame(state, Date.now())).toBe(true);
  });

  it("allows analysis when already analyzing (re-entrant)", () => {
    const state = createState({ status: "analyzing", lastAnalysisTime: 0 });
    expect(shouldAnalyzeFrame(state, Date.now())).toBe(true);
  });

  it("simulates rapid frame burst — only first passes", () => {
    const state = createState();
    const t0 = Date.now();

    // First frame — passes
    expect(shouldAnalyzeFrame(state, t0)).toBe(true);
    state.lastAnalysisTime = t0;

    // Rapid subsequent frames — all blocked
    for (let offset = 100; offset < 800; offset += 100) {
      expect(shouldAnalyzeFrame(state, t0 + offset)).toBe(false);
    }

    // After debounce window — passes
    expect(shouldAnalyzeFrame(state, t0 + 801)).toBe(true);
  });
});

describe("rate limiting", () => {
  beforeEach(() => {
    messageRateLimit.clear();
  });

  it("allows first message", () => {
    expect(checkWsRateLimit("tok-1", 1000)).toBe(true);
  });

  it("allows up to 30 messages in a window", () => {
    const now = 1000;
    for (let i = 0; i < 30; i++) {
      expect(checkWsRateLimit("tok-rate", now)).toBe(true);
    }
  });

  it("blocks message 31", () => {
    const now = 1000;
    for (let i = 0; i < 30; i++) {
      checkWsRateLimit("tok-block", now);
    }
    expect(checkWsRateLimit("tok-block", now)).toBe(false);
  });

  it("resets after window expires", () => {
    const t0 = 1000;
    // Fill the window
    for (let i = 0; i < 30; i++) {
      checkWsRateLimit("tok-reset", t0);
    }
    expect(checkWsRateLimit("tok-reset", t0)).toBe(false);

    // After 10 second window
    expect(checkWsRateLimit("tok-reset", t0 + WS_RATE_LIMIT_WINDOW + 1)).toBe(
      true
    );
  });

  it("rate limits are per-token", () => {
    const now = 1000;
    // Fill token A
    for (let i = 0; i < 30; i++) {
      checkWsRateLimit("tok-a", now);
    }
    expect(checkWsRateLimit("tok-a", now)).toBe(false);

    // Token B should still be fine
    expect(checkWsRateLimit("tok-b", now)).toBe(true);
  });
});

describe("instruction deduplication", () => {
  it("sends instruction when lastSpokenAction is null (first instruction)", () => {
    const state = createState({ lastSpokenAction: null, lastInstructionTime: 0 });
    expect(shouldSendInstruction(state, "Click the button", Date.now())).toBe(true);
  });

  it("sends instruction when suggestedAction is different from last", () => {
    const now = Date.now();
    const state = createState({
      lastSpokenAction: "Click the button",
      lastInstructionTime: now - 1000, // 1 second ago
    });
    expect(shouldSendInstruction(state, "Scroll down to see more", now)).toBe(true);
  });

  it("blocks instruction when suggestedAction is the same and within 15s", () => {
    const now = Date.now();
    const state = createState({
      lastSpokenAction: "Click the button",
      lastInstructionTime: now - 5000, // 5 seconds ago
    });
    expect(shouldSendInstruction(state, "Click the button", now)).toBe(false);
  });

  it("re-sends instruction after 15 seconds even if same action (stuck timeout)", () => {
    const now = Date.now();
    const state = createState({
      lastSpokenAction: "Click the button",
      lastInstructionTime: now - 15000, // exactly 15 seconds ago
    });
    expect(shouldSendInstruction(state, "Click the button", now)).toBe(true);
  });

  it("re-sends instruction well after 15 seconds", () => {
    const now = Date.now();
    const state = createState({
      lastSpokenAction: "Click the button",
      lastInstructionTime: now - 30000, // 30 seconds ago
    });
    expect(shouldSendInstruction(state, "Click the button", now)).toBe(true);
  });

  it("blocks repeated identical action at 14 seconds", () => {
    const now = Date.now();
    const state = createState({
      lastSpokenAction: "Click the button",
      lastInstructionTime: now - 14000,
    });
    expect(shouldSendInstruction(state, "Click the button", now)).toBe(false);
  });

  it("sends instruction after step advancement resets lastSpokenAction", () => {
    const state = createState({
      lastSpokenAction: "Click the button",
      lastInstructionTime: Date.now(),
    });
    // Simulate step advancement
    state.lastSpokenAction = null;
    expect(shouldSendInstruction(state, "Navigate to insights", Date.now())).toBe(true);
  });
});
