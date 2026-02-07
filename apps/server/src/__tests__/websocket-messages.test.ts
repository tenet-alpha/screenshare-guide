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
  status: "waiting" | "analyzing" | "completed";
  lastAnalysisTime: number;
  consecutiveSuccesses: number;
  linkClicked: Record<number, boolean>;
  allExtractedData: Array<{ label: string; value: string }>;
  extractionVotes: Record<string, Record<string, number>>;
  lastSpokenAction: string | null;
  lastInstructionTime: number;
}

// Constants (must match websocket.ts)
const ANALYSIS_DEBOUNCE_MS = 400;
const WS_RATE_LIMIT_WINDOW = 10000;
const WS_RATE_LIMIT_MAX = 50;

// ── Functions extracted from websocket.ts ───────────────────────────

function handleLinkClicked(state: SessionState, step: number) {
  state.linkClicked[step] = true;
  // Reset lastSpokenAction so the first analysis after clicking gets a fresh instruction
  state.lastSpokenAction = null;
}

const CONSENSUS_THRESHOLD = 2;

function accumulateExtractedData(
  state: SessionState,
  items: Array<{ label: string; value: string }>
) {
  if (!items?.length) return;
  for (const item of items) {
    if (!item.label || !item.value) continue;
    if (!state.extractionVotes[item.label]) {
      state.extractionVotes[item.label] = {};
    }
    const votes = state.extractionVotes[item.label];
    const normalizedValue = item.value.trim();
    votes[normalizedValue] = (votes[normalizedValue] || 0) + 1;

    let bestValue = normalizedValue;
    let bestCount = 0;
    for (const [val, count] of Object.entries(votes)) {
      if (count > bestCount) {
        bestValue = val;
        bestCount = count;
      }
    }

    if (bestCount >= CONSENSUS_THRESHOLD) {
      const idx = state.allExtractedData.findIndex((d) => d.label === item.label);
      if (idx >= 0) {
        state.allExtractedData[idx] = { label: item.label, value: bestValue };
      } else {
        state.allExtractedData.push({ label: item.label, value: bestValue });
      }
    }
  }
}

// Extraction schemas (must match websocket.ts)
// Step 0: Open MBS + extract Handle, Step 1: Open Insights + extract metrics
const STEP_EXTRACTION_SCHEMAS: Record<number, Array<{ field: string; description: string; required: boolean }>> = {
  0: [
    { field: "Handle", description: "Instagram handle", required: true },
  ],
  1: [
    { field: "Reach", description: "Total reach", required: true },
    { field: "Non-followers reached", description: "Non-followers reached", required: true },
    { field: "Followers reached", description: "Followers reached", required: true },
  ],
};

function hasAllRequiredFields(state: SessionState): boolean {
  const schema = STEP_EXTRACTION_SCHEMAS[state.currentStep];
  if (!schema) return true;
  const labels = state.allExtractedData.map((d) => d.label);
  return schema
    .filter((f) => f.required)
    .every((f) => labels.includes(f.field));
}

function shouldAnalyzeFrame(state: SessionState, now: number): boolean {
  if (state.status === "completed") return false;
  if (now - state.lastAnalysisTime < ANALYSIS_DEBOUNCE_MS) return false;
  return true;
}

/**
 * Determines if a new TTS instruction should be sent for a suggestedAction.
 * New strategy: stability gate + quiet period.
 * - During quiet period (4s after link click): always silent
 * - Otherwise: only speak if this action matches pendingSuggestedAction (stability)
 *   AND differs from lastSpokenAction, OR if stuck for 15s+
 */
function shouldSendInstruction(
  state: SessionState,
  suggestedAction: string,
  now: number
): { speak: boolean; reason: string } {
  const quietPeriodMs = 4000;
  const stuckTimeoutMs = 15000;

  // Quiet period after link click
  if (now - state.linkClickedTime < quietPeriodMs) {
    return { speak: false, reason: "quiet-period" };
  }

  // Stability gate: action must match pending (seen twice consecutively)
  const isStable = suggestedAction === state.pendingSuggestedAction;
  const isNewAction = suggestedAction !== state.lastSpokenAction;
  const isStuckTimeout = (now - state.lastInstructionTime) >= stuckTimeoutMs;

  if (isStable && isNewAction) {
    return { speak: true, reason: "stable-new-action" };
  }
  if (isStuckTimeout && state.lastSpokenAction) {
    return { speak: true, reason: "stuck-timeout" };
  }
  return { speak: false, reason: "not-stable" };
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
    totalSteps: 2,
    steps: [
      {
        instruction: "Open Meta Business Suite and verify your Instagram handle",
        successCriteria: "MBS home page visible with handle",
      },
      {
        instruction: "Open Account Insights and capture your audience metrics",
        successCriteria: "All metrics found",
      },
    ],
    status: "waiting",
    lastAnalysisTime: 0,
    consecutiveSuccesses: 0,
    linkClicked: {},
    allExtractedData: [],
    extractionVotes: {},
    lastSpokenAction: null,
    lastInstructionTime: 0,
    linkClickedTime: 0,
    pendingSuggestedAction: null,
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

describe("hasAllRequiredFields (schema-based validation)", () => {
  it("returns true when all step 1 (metrics) fields are present", () => {
    const state = createState({
      currentStep: 1,
      allExtractedData: [
        { label: "Reach", value: "12,345" },
        { label: "Non-followers reached", value: "8,000" },
        { label: "Followers reached", value: "4,345" },
      ],
    });
    expect(hasAllRequiredFields(state)).toBe(true);
  });

  it("returns false with no data for step 1", () => {
    const state = createState({ currentStep: 1, allExtractedData: [] });
    expect(hasAllRequiredFields(state)).toBe(false);
  });

  it("returns false with partial step 1 data", () => {
    const state = createState({
      currentStep: 1,
      allExtractedData: [{ label: "Reach", value: "10,000" }],
    });
    expect(hasAllRequiredFields(state)).toBe(false);
  });

  it("returns true for step 0 when Handle is present", () => {
    const state = createState({
      currentStep: 0,
      allExtractedData: [{ label: "Handle", value: "@testuser" }],
    });
    expect(hasAllRequiredFields(state)).toBe(true);
  });

  it("returns false for step 0 when Handle is missing", () => {
    const state = createState({ currentStep: 0, allExtractedData: [] });
    expect(hasAllRequiredFields(state)).toBe(false);
  });

  it("returns true with extra data items beyond schema", () => {
    const state = createState({
      currentStep: 1,
      allExtractedData: [
        { label: "Handle", value: "@testuser" },
        { label: "Reach", value: "12,345" },
        { label: "Non-followers reached", value: "8,000" },
        { label: "Followers reached", value: "4,345" },
      ],
    });
    expect(hasAllRequiredFields(state)).toBe(true);
  });
});

describe("accumulateExtractedData (consensus voting)", () => {
  it("does not commit on first observation (below threshold)", () => {
    const state = createState();
    accumulateExtractedData(state, [{ label: "Handle", value: "@kdus4n" }]);
    expect(state.allExtractedData).toHaveLength(0);
    expect(state.extractionVotes["Handle"]["@kdus4n"]).toBe(1);
  });

  it("commits value after reaching consensus threshold (2)", () => {
    const state = createState();
    accumulateExtractedData(state, [{ label: "Handle", value: "@kdus4n" }]);
    accumulateExtractedData(state, [{ label: "Handle", value: "@kdus4n" }]);
    expect(state.allExtractedData).toHaveLength(1);
    expect(state.allExtractedData[0]).toEqual({ label: "Handle", value: "@kdus4n" });
  });

  it("picks the value with the most votes (filters misreads)", () => {
    const state = createState();
    // 2x correct, 1x misread
    accumulateExtractedData(state, [{ label: "Handle", value: "@kdus4n" }]);
    accumulateExtractedData(state, [{ label: "Handle", value: "@dkdus4n" }]);
    accumulateExtractedData(state, [{ label: "Handle", value: "@kdus4n" }]);
    expect(state.allExtractedData).toHaveLength(1);
    expect(state.allExtractedData[0].value).toBe("@kdus4n");
  });

  it("updates committed value if a new value reaches higher votes", () => {
    const state = createState();
    accumulateExtractedData(state, [{ label: "Reach", value: "100" }]);
    accumulateExtractedData(state, [{ label: "Reach", value: "100" }]); // committed
    expect(state.allExtractedData[0].value).toBe("100");
    accumulateExtractedData(state, [{ label: "Reach", value: "147" }]);
    accumulateExtractedData(state, [{ label: "Reach", value: "147" }]);
    accumulateExtractedData(state, [{ label: "Reach", value: "147" }]); // 3 vs 2
    expect(state.allExtractedData[0].value).toBe("147");
  });

  it("tracks multiple fields independently", () => {
    const state = createState();
    accumulateExtractedData(state, [{ label: "Handle", value: "@a" }, { label: "Reach", value: "10" }]);
    accumulateExtractedData(state, [{ label: "Handle", value: "@a" }, { label: "Reach", value: "10" }]);
    expect(state.allExtractedData).toHaveLength(2);
  });

  it("skips items with empty label or value", () => {
    const state = createState();
    accumulateExtractedData(state, [{ label: "", value: "123" }]);
    accumulateExtractedData(state, [{ label: "Reach", value: "" }]);
    expect(state.allExtractedData).toHaveLength(0);
    expect(Object.keys(state.extractionVotes)).toHaveLength(0);
  });

  it("handles null/undefined items array gracefully", () => {
    const state = createState();
    accumulateExtractedData(state, null as any);
    accumulateExtractedData(state, undefined as any);
    accumulateExtractedData(state, []);
    expect(state.allExtractedData).toHaveLength(0);
  });
});

describe("frame debouncing", () => {
  it("allows first frame analysis", () => {
    const state = createState({ lastAnalysisTime: 0 });
    expect(shouldAnalyzeFrame(state, Date.now())).toBe(true);
  });

  it("blocks frame within 400ms of last analysis", () => {
    const now = Date.now();
    const state = createState({ lastAnalysisTime: now - 200 });

    expect(shouldAnalyzeFrame(state, now)).toBe(false);
  });

  it("blocks frame at exactly 400ms boundary", () => {
    const now = Date.now();
    const state = createState({ lastAnalysisTime: now - 399 });

    expect(shouldAnalyzeFrame(state, now)).toBe(false);
  });

  it("allows frame after 400ms debounce", () => {
    const now = Date.now();
    const state = createState({ lastAnalysisTime: now - 401 });

    expect(shouldAnalyzeFrame(state, now)).toBe(true);
  });

  it("blocks analysis when session is completed", () => {
    const state = createState({ status: "completed", lastAnalysisTime: 0 });
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
    for (let offset = 50; offset < 400; offset += 50) {
      expect(shouldAnalyzeFrame(state, t0 + offset)).toBe(false);
    }

    // After debounce window — passes
    expect(shouldAnalyzeFrame(state, t0 + 401)).toBe(true);
  });
});

describe("rate limiting", () => {
  beforeEach(() => {
    messageRateLimit.clear();
  });

  it("allows first message", () => {
    expect(checkWsRateLimit("tok-1", 1000)).toBe(true);
  });

  it("allows up to 50 messages in a window", () => {
    const now = 1000;
    for (let i = 0; i < 50; i++) {
      expect(checkWsRateLimit("tok-rate", now)).toBe(true);
    }
  });

  it("blocks message 51", () => {
    const now = 1000;
    for (let i = 0; i < 50; i++) {
      checkWsRateLimit("tok-block", now);
    }
    expect(checkWsRateLimit("tok-block", now)).toBe(false);
  });

  it("resets after window expires", () => {
    const t0 = 1000;
    // Fill the window
    for (let i = 0; i < 50; i++) {
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
    for (let i = 0; i < 50; i++) {
      checkWsRateLimit("tok-a", now);
    }
    expect(checkWsRateLimit("tok-a", now)).toBe(false);

    // Token B should still be fine
    expect(checkWsRateLimit("tok-b", now)).toBe(true);
  });
});

describe("TTS strategy: quiet period + stability gate", () => {
  it("suppresses TTS during 4s quiet period after link click", () => {
    const now = Date.now();
    const state = createState({
      linkClickedTime: now - 2000, // 2s ago — within quiet period
      lastSpokenAction: null,
      pendingSuggestedAction: null,
    });
    const result = shouldSendInstruction(state, "Click the button", now);
    expect(result.speak).toBe(false);
    expect(result.reason).toBe("quiet-period");
  });

  it("allows TTS after quiet period expires", () => {
    const now = Date.now();
    const state = createState({
      linkClickedTime: now - 5000, // 5s ago — past quiet period
      lastSpokenAction: null,
      pendingSuggestedAction: "Click the button", // matches = stable
    });
    const result = shouldSendInstruction(state, "Click the button", now);
    expect(result.speak).toBe(true);
    expect(result.reason).toBe("stable-new-action");
  });

  it("blocks TTS when action not yet stable (first occurrence)", () => {
    const now = Date.now();
    const state = createState({
      linkClickedTime: 0,
      lastSpokenAction: null,
      pendingSuggestedAction: null, // no previous pending — not stable
    });
    const result = shouldSendInstruction(state, "Click the button", now);
    expect(result.speak).toBe(false);
    expect(result.reason).toBe("not-stable");
  });

  it("speaks when action seen twice consecutively (stability gate passes)", () => {
    const now = Date.now();
    const state = createState({
      linkClickedTime: 0,
      lastSpokenAction: null,
      pendingSuggestedAction: "Scroll down", // matches incoming = stable
    });
    const result = shouldSendInstruction(state, "Scroll down", now);
    expect(result.speak).toBe(true);
    expect(result.reason).toBe("stable-new-action");
  });

  it("blocks stable action that was already spoken", () => {
    const now = Date.now();
    const state = createState({
      linkClickedTime: 0,
      lastSpokenAction: "Scroll down",
      lastInstructionTime: now - 5000, // 5s ago
      pendingSuggestedAction: "Scroll down",
    });
    const result = shouldSendInstruction(state, "Scroll down", now);
    expect(result.speak).toBe(false);
    expect(result.reason).toBe("not-stable"); // not new, not stuck yet
  });

  it("re-speaks after 15s stuck timeout even if same action", () => {
    const now = Date.now();
    const state = createState({
      linkClickedTime: 0,
      lastSpokenAction: "Click the button",
      lastInstructionTime: now - 16000, // 16s ago — past stuck timeout
      pendingSuggestedAction: "Click the button",
    });
    const result = shouldSendInstruction(state, "Click the button", now);
    expect(result.speak).toBe(true);
    expect(result.reason).toBe("stuck-timeout");
  });

  it("does not stuck-timeout if no previous spoken action", () => {
    const now = Date.now();
    const state = createState({
      linkClickedTime: 0,
      lastSpokenAction: null,
      lastInstructionTime: 0,
      pendingSuggestedAction: null,
    });
    const result = shouldSendInstruction(state, "Something new", now);
    expect(result.speak).toBe(false);
    expect(result.reason).toBe("not-stable");
  });

  it("quiet period blocks even a stable repeated action", () => {
    const now = Date.now();
    const state = createState({
      linkClickedTime: now - 1000, // 1s ago — within quiet period
      lastSpokenAction: null,
      pendingSuggestedAction: "Click the button", // would be stable
    });
    const result = shouldSendInstruction(state, "Click the button", now);
    expect(result.speak).toBe(false);
    expect(result.reason).toBe("quiet-period");
  });

  it("different action after quiet period needs two occurrences to stabilize", () => {
    const now = Date.now();
    const state = createState({
      linkClickedTime: now - 5000, // past quiet period
      lastSpokenAction: "Old action",
      lastInstructionTime: now - 5000,
      pendingSuggestedAction: "Old action", // pending doesn't match new action
    });
    // First time seeing "New action" — not stable yet
    const result = shouldSendInstruction(state, "New action", now);
    expect(result.speak).toBe(false);
    expect(result.reason).toBe("not-stable");
  });
});
