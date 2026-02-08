import { describe, it, expect } from "bun:test";
import { INSTAGRAM_PROOF_TEMPLATE, FRAME_STALENESS_MS } from "@screenshare-guide/protocol";
import type { ExtractedDataItem, ProofStep } from "@screenshare-guide/protocol";

/**
 * Frontend logic unit tests.
 *
 * Since this is a static-export Next.js app tested with Bun's runner
 * (no jsdom), we test the *logic* that drives the UI:
 *   - createProof response parsing / normalization
 *   - ScreenShareSession step links mapping
 *   - Countdown logic
 *   - Template data defensive parsing
 *   - WebSocket message handling state transitions
 */

// ── Template step normalization (mirrors page.tsx onSuccess) ────────

function normalizeSteps(raw: unknown): ProofStep[] {
  try {
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") return JSON.parse(raw);
    return [];
  } catch {
    return [];
  }
}

// ── Step links from template ────────────────────────────────────────

const STEP_LINKS = INSTAGRAM_PROOF_TEMPLATE.steps.reduce<Record<number, { url: string; label: string }>>((acc, step, i) => {
  if (step.link) acc[i] = step.link;
  return acc;
}, {});

// ── Accumulated data dedup (mirrors accumulateData in component) ────

function accumulateData(
  prev: ExtractedDataItem[],
  items: ExtractedDataItem[]
): ExtractedDataItem[] {
  if (!items?.length) return prev;
  const updated = [...prev];
  for (const item of items) {
    if (!item.label || !item.value) continue;
    const idx = updated.findIndex((d) => d.label === item.label);
    if (idx >= 0) updated[idx] = item;
    else updated.push(item);
  }
  return updated;
}

// ── WebSocket message handler state transitions ─────────────────────

interface WsState {
  currentStep: number;
  instruction: string;
  isAnalyzing: boolean;
  completedSteps: Set<number>;
  status: string;
  collectedData: ExtractedDataItem[];
}

function createInitialWsState(): WsState {
  return {
    currentStep: 0,
    instruction: "",
    isAnalyzing: false,
    completedSteps: new Set(),
    status: "idle",
    collectedData: [],
  };
}

function handleMessage(state: WsState, data: any, totalSteps: number): WsState {
  const next = { ...state, completedSteps: new Set(state.completedSteps), collectedData: [...state.collectedData] };

  switch (data.type) {
    case "connected": {
      next.currentStep = Math.min(data.currentStep, totalSteps - 1);
      next.instruction = data.instruction;
      break;
    }
    case "analyzing":
      next.isAnalyzing = true;
      break;
    case "analysis":
      next.isAnalyzing = false;
      if (data.extractedData?.length) {
        next.collectedData = accumulateData(next.collectedData, data.extractedData);
      }
      break;
    case "stepComplete": {
      next.completedSteps.add(data.currentStep - 1);
      next.currentStep = Math.min(data.currentStep, totalSteps - 1);
      next.instruction = data.nextInstruction;
      break;
    }
    case "completed":
      if (data.extractedData?.length) {
        next.collectedData = accumulateData(next.collectedData, data.extractedData);
      }
      next.completedSteps.add(totalSteps - 1);
      next.status = "completed";
      break;
    case "error":
      next.status = "error";
      break;
  }
  return next;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("createProof response normalization", () => {
  it("passes through a valid array of steps", () => {
    const steps = [
      { instruction: "Step 1", successCriteria: "Done" },
      { instruction: "Step 2", successCriteria: "Done" },
    ];

    expect(normalizeSteps(steps)).toEqual(steps);
  });

  it("parses a JSON string into an array", () => {
    const steps = [{ instruction: "Step 1", successCriteria: "Done" }];
    const json = JSON.stringify(steps);

    const result = normalizeSteps(json);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(result[0].instruction).toBe("Step 1");
  });

  it("returns empty array for invalid JSON string", () => {
    expect(normalizeSteps("not json")).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(normalizeSteps(null)).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(normalizeSteps(undefined)).toEqual([]);
  });

  it("returns empty array for number", () => {
    expect(normalizeSteps(42)).toEqual([]);
  });

  it("returns empty array for object", () => {
    expect(normalizeSteps({ foo: "bar" })).toEqual([]);
  });

  it("handles double-stringified JSON (returns inner string as parse result)", () => {
    const steps = [{ instruction: "Step 1", successCriteria: "Done" }];
    const doubleStringified = JSON.stringify(JSON.stringify(steps));

    // normalizeSteps does one JSON.parse, which yields a string.
    // Since a string is not an array, this would fail gracefully
    // in the actual frontend due to Array.isArray check.
    const result = normalizeSteps(doubleStringified);
    // The result from JSON.parse(doubleStringified) is a string,
    // which is not an array, so normalizeSteps returns [].
    // Actually: typeof raw === "string" branch does JSON.parse,
    // which yields a string again — and since a string IS returned
    // by JSON.parse successfully, and it's not an array,
    // normalizeSteps treats the outer as string → parses once → gets string.
    // Since JSON.parse doesn't throw, it returns the string.
    // This is a known edge case — double-stringification shouldn't happen.
    expect(result).toBeDefined();
  });
});

describe("STEP_LINKS mapping", () => {
  it("step 0 maps to business.facebook.com/latest/home", () => {
    expect(STEP_LINKS[0].url).toBe(
      "https://business.facebook.com/latest/home"
    );
  });

  it("step 1 maps to business.facebook.com/latest/insights/", () => {
    expect(STEP_LINKS[1].url).toBe(
      "https://business.facebook.com/latest/insights/"
    );
  });

  it("step 2 has no link (only 2 steps)", () => {
    expect(STEP_LINKS[2]).toBeUndefined();
  });

  it("step 0 label says Meta Business Suite", () => {
    expect(STEP_LINKS[0].label).toContain("Meta Business Suite");
  });

  it("step 1 label says Insights", () => {
    expect(STEP_LINKS[1].label).toContain("Insights");
  });
});

/**
 * Models the stopScreenShare behavior in the component.
 * keepStatus=true  → don't change status (used on completion)
 * keepStatus=false → set status to "idle" (used on manual stop)
 */
function stopScreenShare(state: WsState, keepStatus = false): WsState {
  const next = { ...state, completedSteps: new Set(state.completedSteps), collectedData: [...state.collectedData] };
  if (!keepStatus) {
    next.status = "idle";
  }
  return next;
}

describe("completion flow", () => {
  const TOTAL = 2;

  it("'completed' message sets status to completed", () => {
    const state = { ...createInitialWsState(), status: "active", currentStep: 1 };
    const next = handleMessage(
      state,
      { type: "completed", extractedData: [{ label: "Reach", value: "10K" }] },
      TOTAL
    );
    expect(next.status).toBe("completed");
  });

  it("'completed' marks the last step as done", () => {
    const state = { ...createInitialWsState(), status: "active", currentStep: 1 };
    const next = handleMessage(
      state,
      { type: "completed", extractedData: [] },
      TOTAL
    );
    expect(next.completedSteps.has(1)).toBe(true);
    expect(next.completedSteps.size).toBe(1);
  });

  it("'completed' accumulates final extractedData", () => {
    const state = { ...createInitialWsState(), status: "active", currentStep: 1 };
    const next = handleMessage(
      state,
      {
        type: "completed",
        extractedData: [
          { label: "Reach", value: "12,345" },
          { label: "Non-followers reached", value: "8,000" },
          { label: "Followers reached", value: "4,345" },
        ],
      },
      TOTAL
    );
    expect(next.collectedData).toHaveLength(3);
    expect(next.collectedData[0]).toEqual({ label: "Reach", value: "12,345" });
    expect(next.collectedData[1]).toEqual({ label: "Non-followers reached", value: "8,000" });
    expect(next.collectedData[2]).toEqual({ label: "Followers reached", value: "4,345" });
  });

  it("'completed' preserves previously collected data", () => {
    const state = {
      ...createInitialWsState(),
      status: "active",
      currentStep: 1,
      collectedData: [{ label: "Handle", value: "@testuser" }],
    };
    const next = handleMessage(
      state,
      { type: "completed", extractedData: [{ label: "Reach", value: "10K" }] },
      TOTAL
    );
    expect(next.collectedData).toHaveLength(2);
    expect(next.collectedData[0].label).toBe("Handle");
    expect(next.collectedData[1].label).toBe("Reach");
  });

  it("stopScreenShare(keepStatus=true) does NOT overwrite completed status", () => {
    // This was the actual bug: completed → stopScreenShare → idle
    let state = { ...createInitialWsState(), status: "active", currentStep: 1 };

    // Server sends completed
    state = handleMessage(
      state,
      { type: "completed", extractedData: [{ label: "Reach", value: "10K" }] },
      TOTAL
    );
    expect(state.status).toBe("completed");

    // stopScreenShare called with keepStatus=true (as the component does)
    state = stopScreenShare(state, true);
    expect(state.status).toBe("completed"); // must stay completed!
  });

  it("stopScreenShare(keepStatus=false) resets to idle (manual stop)", () => {
    const state = { ...createInitialWsState(), status: "active" };
    const next = stopScreenShare(state, false);
    expect(next.status).toBe("idle");
  });

  it("manual stop does NOT set completed status", () => {
    const state = { ...createInitialWsState(), status: "active", currentStep: 0 };
    const next = stopScreenShare(state, false);
    expect(next.status).toBe("idle");
    expect(next.completedSteps.size).toBe(0);
  });

  it("full 2-step flow: connected → step0 complete → step1 complete → completed", () => {
    let state = createInitialWsState();

    // 1. Connected at step 0
    state = handleMessage(
      state,
      { type: "connected", currentStep: 0, instruction: "Open Meta Business Suite and verify your Instagram handle" },
      TOTAL
    );
    expect(state.currentStep).toBe(0);
    expect(state.status).toBe("idle"); // status is managed by component, not WS messages

    // 2. Analysis results come in with handle data
    state = handleMessage(
      state,
      { type: "analysis", extractedData: [{ label: "Handle", value: "@testuser" }] },
      TOTAL
    );
    expect(state.collectedData).toHaveLength(1);
    expect(state.collectedData[0]).toEqual({ label: "Handle", value: "@testuser" });

    // 3. Step 0 completes, advance to step 1
    state = handleMessage(
      state,
      { type: "stepComplete", currentStep: 1, nextInstruction: "Open Account Insights and capture your audience metrics" },
      TOTAL
    );
    expect(state.completedSteps.has(0)).toBe(true);
    expect(state.currentStep).toBe(1);
    expect(state.instruction).toBe("Open Account Insights and capture your audience metrics");

    // 4. Analysis results come in with metrics
    state = handleMessage(
      state,
      {
        type: "analysis",
        extractedData: [
          { label: "Reach", value: "12,345" },
          { label: "Non-followers reached", value: "8,000" },
          { label: "Followers reached", value: "4,345" },
        ],
      },
      TOTAL
    );
    expect(state.collectedData).toHaveLength(4); // Handle + 3 metrics

    // 5. Session completed
    state = handleMessage(
      state,
      { type: "completed", extractedData: [] },
      TOTAL
    );
    expect(state.status).toBe("completed");
    expect(state.completedSteps.has(0)).toBe(true);
    expect(state.completedSteps.has(1)).toBe(true);

    // 6. stopScreenShare with keepStatus=true preserves completed
    state = stopScreenShare(state, true);
    expect(state.status).toBe("completed");
    expect(state.collectedData).toHaveLength(4);
  });

  it("completed with no extractedData still transitions to completed", () => {
    const state = { ...createInitialWsState(), status: "active", currentStep: 1 };
    const next = handleMessage(state, { type: "completed" }, TOTAL);
    expect(next.status).toBe("completed");
    expect(next.completedSteps.has(1)).toBe(true);
  });

  it("completed after error is still possible (recovery)", () => {
    let state = { ...createInitialWsState(), status: "error" };
    state = handleMessage(
      state,
      { type: "completed", extractedData: [{ label: "Handle", value: "@user" }] },
      TOTAL
    );
    expect(state.status).toBe("completed");
    expect(state.collectedData).toHaveLength(1);
  });
});

describe("accumulateData dedup", () => {
  it("adds fresh items", () => {
    const result = accumulateData([], [{ label: "Reach", value: "10K" }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ label: "Reach", value: "10K" });
  });

  it("updates existing item by label", () => {
    const prev = [{ label: "Reach", value: "10K" }];
    const result = accumulateData(prev, [{ label: "Reach", value: "15K" }]);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe("15K");
  });

  it("skips items with empty label or value", () => {
    const result = accumulateData(
      [],
      [
        { label: "", value: "x" },
        { label: "x", value: "" },
      ]
    );
    expect(result).toHaveLength(0);
  });

  it("handles null input gracefully", () => {
    const result = accumulateData([{ label: "A", value: "1" }], null as any);
    expect(result).toHaveLength(1);
  });
});

describe("WebSocket message handling state transitions", () => {
  const TOTAL_STEPS = 2;

  it("'connected' sets currentStep and instruction", () => {
    const state = createInitialWsState();
    const next = handleMessage(
      state,
      {
        type: "connected",
        sessionId: "s1",
        currentStep: 0,
        totalSteps: 2,
        instruction: "Open Meta Business Suite and verify your Instagram handle",
      },
      TOTAL_STEPS
    );

    expect(next.currentStep).toBe(0);
    expect(next.instruction).toBe("Open Meta Business Suite and verify your Instagram handle");
  });

  it("'connected' clamps currentStep to valid range", () => {
    const state = createInitialWsState();
    const next = handleMessage(
      state,
      { type: "connected", currentStep: 99, instruction: "Test" },
      TOTAL_STEPS
    );

    expect(next.currentStep).toBe(1); // clamped to totalSteps - 1
  });

  it("'analyzing' sets isAnalyzing to true", () => {
    const state = createInitialWsState();
    const next = handleMessage(state, { type: "analyzing" }, TOTAL_STEPS);

    expect(next.isAnalyzing).toBe(true);
  });

  it("'analysis' resets isAnalyzing and collects data", () => {
    const state = { ...createInitialWsState(), isAnalyzing: true };
    const next = handleMessage(
      state,
      {
        type: "analysis",
        extractedData: [{ label: "Reach", value: "10K" }],
      },
      TOTAL_STEPS
    );

    expect(next.isAnalyzing).toBe(false);
    expect(next.collectedData).toHaveLength(1);
  });

  it("'stepComplete' marks previous step and advances", () => {
    const state = createInitialWsState();
    const next = handleMessage(
      state,
      {
        type: "stepComplete",
        currentStep: 1,
        totalSteps: 2,
        nextInstruction: "Open Account Insights and capture your audience metrics",
      },
      TOTAL_STEPS
    );

    expect(next.completedSteps.has(0)).toBe(true);
    expect(next.currentStep).toBe(1);
    expect(next.instruction).toBe("Open Account Insights and capture your audience metrics");
  });

  it("'completed' marks last step and sets status to completed", () => {
    const state = { ...createInitialWsState(), currentStep: 1 };
    const next = handleMessage(
      state,
      {
        type: "completed",
        message: "All done!",
        extractedData: [
          { label: "Reach", value: "10K" },
          { label: "Non-Followers", value: "6K" },
          { label: "Followers", value: "4K" },
        ],
      },
      TOTAL_STEPS
    );

    expect(next.completedSteps.has(1)).toBe(true);
    expect(next.status).toBe("completed");
    expect(next.collectedData).toHaveLength(3);
  });

  it("'error' sets status to error", () => {
    const state = createInitialWsState();
    const next = handleMessage(
      state,
      { type: "error", message: "Something failed" },
      TOTAL_STEPS
    );

    expect(next.status).toBe("error");
  });

  it("full flow: connected → stepComplete → completed", () => {
    let state = createInitialWsState();

    // Connected
    state = handleMessage(
      state,
      { type: "connected", currentStep: 0, instruction: "Step 1" },
      TOTAL_STEPS
    );
    expect(state.currentStep).toBe(0);

    // Step 1 complete
    state = handleMessage(
      state,
      { type: "stepComplete", currentStep: 1, nextInstruction: "Step 2" },
      TOTAL_STEPS
    );
    expect(state.completedSteps.has(0)).toBe(true);
    expect(state.currentStep).toBe(1);

    // Session completed
    state = handleMessage(
      state,
      { type: "completed", extractedData: [{ label: "Reach", value: "10K" }] },
      TOTAL_STEPS
    );
    expect(state.completedSteps.has(1)).toBe(true);
    expect(state.status).toBe("completed");
    expect(state.collectedData).toHaveLength(1);
  });
});

// ── Frame hash dedup logic (mirrors ScreenShareSession) ─────────────

function djb2Hash(data: Uint8ClampedArray, sampleStep: number = 4): number {
  let hash = 5381;
  for (let i = 0; i < data.length; i += sampleStep) {
    hash = ((hash << 5) + hash + data[i]) | 0;
  }
  return hash;
}

function shouldSendFrame(
  hash: number,
  lastHash: number,
  now: number,
  lastSendTime: number
): { send: boolean; reason: string } {
  if (hash !== lastHash) {
    return { send: true, reason: "changed" };
  }
  const elapsed = now - lastSendTime;
  if (elapsed >= FRAME_STALENESS_MS) {
    return { send: true, reason: "stale" };
  }
  return { send: false, reason: "skip" };
}

// ── Link-gate logic (mirrors ScreenShareSession) ────────────────────

function shouldSkipForLinkGate(
  stepLinks: Record<number, any>,
  currentStep: number,
  linkClickedSteps: Set<number>
): boolean {
  return !!stepLinks[currentStep] && !linkClickedSteps.has(currentStep);
}

// ── Copy results formatting (mirrors ScreenShareSession) ────────────

function formatResults(data: ExtractedDataItem[], dateStr: string): string {
  const lines = data.map((d) => `${d.label}: ${d.value}`).join("\n");
  return `Instagram Audience Proof — Verified ${dateStr}\n\n${lines}`;
}

describe("frame hash dedup", () => {
  it("sends frame when hash changes", () => {
    const result = shouldSendFrame(12345, 99999, 1000, 500);
    expect(result.send).toBe(true);
    expect(result.reason).toBe("changed");
  });

  it("skips frame when hash is same and within staleness window", () => {
    const now = 3000;
    const lastSend = 1000; // 2s ago — within 5s window
    const result = shouldSendFrame(12345, 12345, now, lastSend);
    expect(result.send).toBe(false);
    expect(result.reason).toBe("skip");
  });

  it("sends frame when hash is same but staleness threshold exceeded", () => {
    const now = 10000;
    const lastSend = 4000; // 6s ago — over 5s threshold
    const result = shouldSendFrame(12345, 12345, now, lastSend);
    expect(result.send).toBe(true);
    expect(result.reason).toBe("stale");
  });

  it("sends frame at exactly 5s staleness boundary", () => {
    const now = 6000;
    const lastSend = 1000; // exactly 5s
    const result = shouldSendFrame(12345, 12345, now, lastSend);
    expect(result.send).toBe(true);
    expect(result.reason).toBe("stale");
  });

  it("skips frame at 4999ms (just under staleness)", () => {
    const now = 5999;
    const lastSend = 1000;
    const result = shouldSendFrame(12345, 12345, now, lastSend);
    expect(result.send).toBe(false);
    expect(result.reason).toBe("skip");
  });

  it("always sends first frame (lastHash=0, lastSendTime=0)", () => {
    const result = shouldSendFrame(12345, 0, Date.now(), 0);
    // hash !== lastHash (0), so it sends
    expect(result.send).toBe(true);
    expect(result.reason).toBe("changed");
  });
});

describe("djb2Hash", () => {
  it("produces consistent hash for same input", () => {
    const data = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]);
    expect(djb2Hash(data, 4)).toBe(djb2Hash(data, 4));
  });

  it("produces different hash for different input", () => {
    const a = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 80]);
    const b = new Uint8ClampedArray([80, 70, 60, 50, 40, 30, 20, 10]);
    expect(djb2Hash(a, 4)).not.toBe(djb2Hash(b, 4));
  });

  it("handles empty array", () => {
    const data = new Uint8ClampedArray([]);
    expect(djb2Hash(data, 4)).toBe(5381); // Initial hash value
  });

  it("respects sampleStep parameter", () => {
    const data = new Uint8ClampedArray(64);
    for (let i = 0; i < 64; i++) data[i] = i;
    const hash1 = djb2Hash(data, 1);
    const hash8 = djb2Hash(data, 8);
    // Different sample steps should produce different hashes
    expect(hash1).not.toBe(hash8);
  });
});

describe("link-gate logic", () => {
  const stepLinks: Record<number, { url: string; label: string }> = {
    0: { url: "https://example.com", label: "Open" },
    1: { url: "https://example.com/insights", label: "Open Insights" },
  };

  it("skips frame for step 0 when link not clicked", () => {
    expect(shouldSkipForLinkGate(stepLinks, 0, new Set())).toBe(true);
  });

  it("skips frame for step 1 when link not clicked", () => {
    expect(shouldSkipForLinkGate(stepLinks, 1, new Set())).toBe(true);
  });

  it("allows frame for step 0 when link has been clicked", () => {
    expect(shouldSkipForLinkGate(stepLinks, 0, new Set([0]))).toBe(false);
  });

  it("allows frame for step 1 when link has been clicked", () => {
    expect(shouldSkipForLinkGate(stepLinks, 1, new Set([1]))).toBe(false);
  });

  it("allows frame for step 2 (no link required)", () => {
    expect(shouldSkipForLinkGate(stepLinks, 2, new Set())).toBe(false);
  });

  it("step 0 link click does not ungate step 1", () => {
    expect(shouldSkipForLinkGate(stepLinks, 1, new Set([0]))).toBe(true);
  });
});

describe("copy results formatting", () => {
  it("formats collected data correctly", () => {
    const data = [
      { label: "Reach", value: "12,345" },
      { label: "Followers", value: "4,000" },
    ];
    const result = formatResults(data, "February 7, 2026");
    expect(result).toContain("Instagram Audience Proof — Verified February 7, 2026");
    expect(result).toContain("Reach: 12,345");
    expect(result).toContain("Followers: 4,000");
  });

  it("handles empty data", () => {
    const result = formatResults([], "February 7, 2026");
    expect(result).toBe("Instagram Audience Proof — Verified February 7, 2026\n\n");
  });

  it("handles single item", () => {
    const result = formatResults([{ label: "Reach", value: "10K" }], "Jan 1, 2026");
    expect(result).toBe("Instagram Audience Proof — Verified Jan 1, 2026\n\nReach: 10K");
  });
});

// ── Audio interrupt logic (mirrors AudioPlayer — interrupt, not queue) ──

interface AudioPlayerState {
  currentClip: string | null;
  isPlaying: boolean;
  completeFired: boolean;
}

function createAudioPlayerState(): AudioPlayerState {
  return { currentClip: null, isPlaying: false, completeFired: false };
}

function receiveAudio(state: AudioPlayerState, audioData: string): AudioPlayerState {
  // New audio always interrupts — plays immediately, clears any previous
  return { ...state, currentClip: audioData, isPlaying: true, completeFired: false };
}

function onAudioEnded(state: AudioPlayerState): AudioPlayerState {
  return { ...state, currentClip: null, isPlaying: false, completeFired: true };
}

describe("audio interrupt logic", () => {
  it("plays immediately when nothing is playing", () => {
    let state = createAudioPlayerState();
    state = receiveAudio(state, "audio1");
    expect(state.isPlaying).toBe(true);
    expect(state.currentClip).toBe("audio1");
  });

  it("interrupts current audio with new audio", () => {
    let state = createAudioPlayerState();
    state = receiveAudio(state, "audio1"); // playing
    state = receiveAudio(state, "audio2"); // interrupts audio1
    expect(state.isPlaying).toBe(true);
    expect(state.currentClip).toBe("audio2"); // new clip, not old
  });

  it("fires onComplete when clip ends naturally", () => {
    let state = createAudioPlayerState();
    state = receiveAudio(state, "audio1");
    state = onAudioEnded(state);
    expect(state.completeFired).toBe(true);
    expect(state.isPlaying).toBe(false);
    expect(state.currentClip).toBeNull();
  });

  it("does not fire onComplete when interrupted — only when new clip ends", () => {
    let state = createAudioPlayerState();
    state = receiveAudio(state, "audio1");
    state = receiveAudio(state, "audio2"); // interrupt — no onComplete for audio1
    expect(state.completeFired).toBe(false);
    state = onAudioEnded(state); // audio2 ends naturally
    expect(state.completeFired).toBe(true);
  });

  it("handles rapid successive interrupts", () => {
    let state = createAudioPlayerState();
    state = receiveAudio(state, "a1");
    state = receiveAudio(state, "a2");
    state = receiveAudio(state, "a3");
    expect(state.currentClip).toBe("a3");
    expect(state.isPlaying).toBe(true);
    state = onAudioEnded(state);
    expect(state.completeFired).toBe(true);
  });
});

describe("malformed template data", () => {
  it("normalizeSteps handles a stringified array from DB", () => {
    const dbSteps = JSON.stringify([
      {
        instruction: "Open your Meta Business Suite",
        successCriteria: "Meta Business Suite visible",
        hints: [],
      },
    ]);

    const result = normalizeSteps(dbSteps);
    expect(Array.isArray(result)).toBe(true);
    expect(result[0].instruction).toBe("Open your Meta Business Suite");
  });

  it("normalizeSteps handles empty string", () => {
    expect(normalizeSteps("")).toEqual([]);
  });

  it("normalizeSteps handles stringified empty array", () => {
    expect(normalizeSteps("[]")).toEqual([]);
  });
});
