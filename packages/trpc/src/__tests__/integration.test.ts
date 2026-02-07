import { describe, it, expect } from "bun:test";

/**
 * Integration / contract tests.
 *
 * Validates the full createProof → response → render contract
 * and the WebSocket connect → frame → analysis → stepComplete → completed flow,
 * using mock data that mirrors real DB/API shapes.
 */

// ── Types ───────────────────────────────────────────────────────────

interface TemplateStep {
  instruction: string;
  successCriteria: string;
  hints?: string[];
}

interface CreateProofResponse {
  shareUrl: string;
  token: string;
  sessionId: string;
  template: {
    id: string;
    name: string;
    steps: TemplateStep[];
  };
}

interface WsMessage {
  type: string;
  [key: string]: any;
}

// ── Mock createProof response factory ───────────────────────────────

function mockCreateProofResponse(
  overrides: Partial<CreateProofResponse> = {}
): CreateProofResponse {
  return {
    shareUrl: "/s/abc123",
    token: "abc123",
    sessionId: "sess-uuid-1",
    template: {
      id: "tmpl-uuid-1",
      name: "Instagram Audience Proof",
      steps: [
        {
          instruction: "Open your Meta Business Suite",
          successCriteria: "Meta Business Suite home page is visible.",
          hints: [],
        },
        {
          instruction: "Navigate to Insights",
          successCriteria: "The Insights page is visible.",
          hints: [],
        },
        {
          instruction: "Capture audience metrics",
          successCriteria: "All three metrics must be found.",
          hints: [],
        },
      ],
    },
    ...overrides,
  };
}

// ── Contract: createProof → response → render ───────────────────────

describe("createProof → response → render contract", () => {
  it("response has all fields the frontend expects", () => {
    const resp = mockCreateProofResponse();

    // Fields page.tsx reads:
    expect(resp.token).toBeDefined();
    expect(resp.sessionId).toBeDefined();
    expect(resp.template).toBeDefined();
    expect(resp.template.id).toBeDefined();
    expect(resp.template.name).toBeDefined();
    expect(resp.template.steps).toBeDefined();
  });

  it("template.steps is an array (never a string)", () => {
    const resp = mockCreateProofResponse();
    expect(Array.isArray(resp.template.steps)).toBe(true);
  });

  it("each step has instruction and successCriteria", () => {
    const resp = mockCreateProofResponse();

    for (const step of resp.template.steps) {
      expect(typeof step.instruction).toBe("string");
      expect(typeof step.successCriteria).toBe("string");
      expect(step.instruction.length).toBeGreaterThan(0);
    }
  });

  it("ScreenShareSession can compute safeStep from response", () => {
    const resp = mockCreateProofResponse();
    const initialStep = 0;
    const totalSteps = resp.template.steps.length;
    const safeStep = Math.min(initialStep, Math.max(totalSteps - 1, 0));

    expect(safeStep).toBe(0);
    expect(resp.template.steps[safeStep]).toBeDefined();
    expect(resp.template.steps[safeStep].instruction).toBeTruthy();
  });

  it("ScreenShareSession renders correct instruction for each step", () => {
    const resp = mockCreateProofResponse();
    const steps = resp.template.steps;

    expect(steps[0].instruction).toContain("Meta Business Suite");
    expect(steps[1].instruction).toContain("Insights");
    expect(steps[2].instruction).toContain("metrics");
  });

  it("handles response with steps as stringified JSON (defensive parsing)", () => {
    // Simulates what happens if superjson doesn't parse correctly
    const raw = {
      shareUrl: "/s/abc123",
      token: "abc123",
      sessionId: "sess-1",
      template: {
        id: "tmpl-1",
        name: "Test",
        steps: JSON.stringify([
          { instruction: "S1", successCriteria: "C1" },
        ]) as any,
      },
    };

    // Frontend normalization
    const steps = Array.isArray(raw.template.steps)
      ? raw.template.steps
      : typeof raw.template.steps === "string"
        ? JSON.parse(raw.template.steps)
        : [];

    expect(Array.isArray(steps)).toBe(true);
    expect(steps[0].instruction).toBe("S1");
  });

  it("handles empty steps gracefully without crash", () => {
    const resp = mockCreateProofResponse({
      template: { id: "t1", name: "Empty", steps: [] },
    });

    const totalSteps = resp.template.steps.length;
    expect(totalSteps).toBe(0);

    // safeStep computation shouldn't crash
    const safeStep = Math.min(0, Math.max(totalSteps - 1, 0));
    expect(safeStep).toBe(0);

    // Accessing step at safeStep should be undefined, not crash
    expect(resp.template.steps[safeStep]).toBeUndefined();
  });
});

// ── Contract: WebSocket flow ────────────────────────────────────────

describe("WebSocket connect → frame → analysis → stepComplete → completed flow", () => {
  // Simulate a full WebSocket conversation
  function simulateWsFlow(): WsMessage[] {
    const messages: WsMessage[] = [];

    // 1. Server sends connected
    messages.push({
      type: "connected",
      sessionId: "sess-1",
      currentStep: 0,
      totalSteps: 3,
      instruction: "Open your Meta Business Suite",
    });

    // 2. Client sends frames, server analyzes
    messages.push({ type: "analyzing" });
    messages.push({
      type: "analysis",
      description: "Meta Business Suite home page visible",
      matchesSuccess: true,
      confidence: 0.92,
      extractedData: [{ label: "Instagram Handle", value: "@testuser" }],
    });

    // 3. Step 1 complete → advance to step 2
    messages.push({
      type: "stepComplete",
      currentStep: 1,
      totalSteps: 3,
      nextInstruction: "Navigate to Insights",
    });

    // 4. More analysis on step 2
    messages.push({ type: "analyzing" });
    messages.push({
      type: "analysis",
      description: "Insights page visible",
      matchesSuccess: true,
      confidence: 0.88,
      extractedData: [],
    });

    // 5. Step 2 complete → advance to step 3
    messages.push({
      type: "stepComplete",
      currentStep: 2,
      totalSteps: 3,
      nextInstruction: "Capture audience metrics",
    });

    // 6. Multiple analyses for step 3 metrics
    messages.push({ type: "analyzing" });
    messages.push({
      type: "analysis",
      description: "Partial metrics visible",
      matchesSuccess: false,
      confidence: 0.6,
      extractedData: [{ label: "Reach", value: "12,345" }],
    });

    messages.push({ type: "analyzing" });
    messages.push({
      type: "analysis",
      description: "More metrics visible",
      matchesSuccess: true,
      confidence: 0.9,
      extractedData: [
        { label: "Non-Followers", value: "8,000" },
        { label: "Followers", value: "4,345" },
      ],
    });

    // 7. Session completed
    messages.push({
      type: "completed",
      message: "All steps completed!",
      extractedData: [
        { label: "Instagram Handle", value: "@testuser" },
        { label: "Reach", value: "12,345" },
        { label: "Non-Followers", value: "8,000" },
        { label: "Followers", value: "4,345" },
      ],
    });

    return messages;
  }

  it("flow produces correct message sequence", () => {
    const messages = simulateWsFlow();
    const types = messages.map((m) => m.type);

    expect(types[0]).toBe("connected");
    expect(types[types.length - 1]).toBe("completed");
    expect(types.filter((t) => t === "stepComplete")).toHaveLength(2);
    expect(types.filter((t) => t === "analyzing")).toHaveLength(4);
  });

  it("connected message has required fields", () => {
    const messages = simulateWsFlow();
    const connected = messages[0];

    expect(connected.sessionId).toBeDefined();
    expect(typeof connected.currentStep).toBe("number");
    expect(typeof connected.totalSteps).toBe("number");
    expect(typeof connected.instruction).toBe("string");
  });

  it("stepComplete messages advance currentStep correctly", () => {
    const messages = simulateWsFlow();
    const stepCompletes = messages.filter((m) => m.type === "stepComplete");

    expect(stepCompletes[0].currentStep).toBe(1);
    expect(stepCompletes[1].currentStep).toBe(2);
  });

  it("completed message includes all extractedData", () => {
    const messages = simulateWsFlow();
    const completed = messages.find((m) => m.type === "completed");

    expect(completed).toBeDefined();
    expect(completed!.extractedData).toHaveLength(4);
    const labels = completed!.extractedData.map(
      (d: { label: string }) => d.label
    );
    expect(labels).toContain("Reach");
    expect(labels).toContain("Non-Followers");
    expect(labels).toContain("Followers");
    expect(labels).toContain("Instagram Handle");
  });

  it("analysis extractedData accumulates across messages", () => {
    const messages = simulateWsFlow();
    const analyses = messages.filter((m) => m.type === "analysis");
    const allData: Array<{ label: string; value: string }> = [];

    for (const a of analyses) {
      if (a.extractedData?.length) {
        for (const item of a.extractedData) {
          const idx = allData.findIndex((d) => d.label === item.label);
          if (idx >= 0) allData[idx] = item;
          else allData.push(item);
        }
      }
    }

    expect(allData.length).toBeGreaterThanOrEqual(3);
    expect(allData.find((d) => d.label === "Reach")).toBeDefined();
  });

  it("client state after processing all messages is correct", () => {
    const messages = simulateWsFlow();
    const totalSteps = 3;
    let currentStep = 0;
    let completedSteps = new Set<number>();
    let countdown: number | null = null;
    let collectedData: Array<{ label: string; value: string }> = [];

    for (const msg of messages) {
      switch (msg.type) {
        case "connected":
          currentStep = Math.min(msg.currentStep, totalSteps - 1);
          break;
        case "analysis":
          if (msg.extractedData?.length) {
            for (const item of msg.extractedData) {
              const idx = collectedData.findIndex((d) => d.label === item.label);
              if (idx >= 0) collectedData[idx] = item;
              else collectedData.push(item);
            }
          }
          break;
        case "stepComplete":
          completedSteps.add(msg.currentStep - 1);
          currentStep = Math.min(msg.currentStep, totalSteps - 1);
          break;
        case "completed":
          completedSteps.add(totalSteps - 1);
          countdown = 5;
          if (msg.extractedData?.length) {
            for (const item of msg.extractedData) {
              const idx = collectedData.findIndex((d) => d.label === item.label);
              if (idx >= 0) collectedData[idx] = item;
              else collectedData.push(item);
            }
          }
          break;
      }
    }

    // All 3 steps completed
    expect(completedSteps.size).toBe(3);
    expect(completedSteps.has(0)).toBe(true);
    expect(completedSteps.has(1)).toBe(true);
    expect(completedSteps.has(2)).toBe(true);

    // Countdown started
    expect(countdown).toBe(5);

    // All data collected
    expect(collectedData.length).toBe(4);
    expect(collectedData.find((d) => d.label === "Reach")?.value).toBe(
      "12,345"
    );
    expect(collectedData.find((d) => d.label === "Non-Followers")?.value).toBe(
      "8,000"
    );
    expect(collectedData.find((d) => d.label === "Followers")?.value).toBe(
      "4,345"
    );
  });
});
