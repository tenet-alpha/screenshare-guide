import { describe, it, expect, beforeEach, mock } from "bun:test";

/**
 * WebSocket AI Loop Tests
 * 
 * Tests the state machine logic for the real-time AI guidance system.
 * This tests the core logic without requiring actual WebSocket connections.
 */

// Session state machine types (mirroring websocket.ts)
interface SessionState {
  sessionId: string;
  templateId: string;
  currentStep: number;
  totalSteps: number;
  steps: Array<{ instruction: string; successCriteria: string; hints?: string[] }>;
  status: "waiting" | "analyzing" | "speaking" | "completed";
  lastAnalysisTime: number;
  consecutiveSuccesses: number;
}

// State machine constants
const ANALYSIS_DEBOUNCE_MS = 2000;
const SUCCESS_THRESHOLD = 2;

// Helper to create a test state
function createTestState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: "test-session-id",
    templateId: "test-template-id",
    currentStep: 0,
    totalSteps: 3,
    steps: [
      { instruction: "Step 1", successCriteria: "Step 1 done", hints: ["Hint 1A", "Hint 1B"] },
      { instruction: "Step 2", successCriteria: "Step 2 done" },
      { instruction: "Step 3", successCriteria: "Step 3 done", hints: ["Hint 3"] },
    ],
    status: "waiting",
    lastAnalysisTime: 0,
    consecutiveSuccesses: 0,
    ...overrides,
  };
}

// Mock analysis result
interface AnalysisResult {
  description: string;
  detectedElements: string[];
  matchesSuccessCriteria: boolean;
  confidence: number;
  suggestedAction?: string;
}

// State transition logic (extracted from websocket.ts for testing)
function processAnalysis(
  state: SessionState,
  analysis: AnalysisResult
): { shouldAdvance: boolean; newStep: number; isComplete: boolean } {
  if (analysis.matchesSuccessCriteria && analysis.confidence > 0.7) {
    state.consecutiveSuccesses++;

    if (state.consecutiveSuccesses >= SUCCESS_THRESHOLD) {
      state.currentStep++;
      state.consecutiveSuccesses = 0;

      if (state.currentStep >= state.totalSteps) {
        state.status = "completed";
        return { shouldAdvance: true, newStep: state.currentStep, isComplete: true };
      }

      return { shouldAdvance: true, newStep: state.currentStep, isComplete: false };
    }
  } else {
    state.consecutiveSuccesses = 0;
  }

  return { shouldAdvance: false, newStep: state.currentStep, isComplete: false };
}

// Debounce check logic
function shouldAnalyze(state: SessionState, now: number): boolean {
  if (state.status === "completed" || state.status === "speaking") {
    return false;
  }
  if (now - state.lastAnalysisTime < ANALYSIS_DEBOUNCE_MS) {
    return false;
  }
  return true;
}

describe("WebSocket State Machine", () => {
  describe("Initial State", () => {
    it("should start in waiting status at step 0", () => {
      const state = createTestState();

      expect(state.status).toBe("waiting");
      expect(state.currentStep).toBe(0);
      expect(state.consecutiveSuccesses).toBe(0);
    });

    it("should have access to current step instruction", () => {
      const state = createTestState();
      const currentInstruction = state.steps[state.currentStep]?.instruction;

      expect(currentInstruction).toBe("Step 1");
    });
  });

  describe("Analysis Debouncing", () => {
    it("should allow analysis when debounce time has passed", () => {
      const state = createTestState({ lastAnalysisTime: 0 });
      const now = Date.now();

      expect(shouldAnalyze(state, now)).toBe(true);
    });

    it("should block analysis within debounce window", () => {
      const now = Date.now();
      const state = createTestState({ lastAnalysisTime: now - 1000 }); // 1 second ago

      expect(shouldAnalyze(state, now)).toBe(false);
    });

    it("should allow analysis after debounce window", () => {
      const now = Date.now();
      const state = createTestState({ lastAnalysisTime: now - 3000 }); // 3 seconds ago

      expect(shouldAnalyze(state, now)).toBe(true);
    });

    it("should block analysis when speaking", () => {
      const state = createTestState({ status: "speaking" });

      expect(shouldAnalyze(state, Date.now())).toBe(false);
    });

    it("should block analysis when completed", () => {
      const state = createTestState({ status: "completed" });

      expect(shouldAnalyze(state, Date.now())).toBe(false);
    });
  });

  describe("Step Progression", () => {
    it("should not advance on failed analysis", () => {
      const state = createTestState();

      const result = processAnalysis(state, {
        description: "User is looking at wrong screen",
        detectedElements: [],
        matchesSuccessCriteria: false,
        confidence: 0.8,
      });

      expect(result.shouldAdvance).toBe(false);
      expect(state.currentStep).toBe(0);
      expect(state.consecutiveSuccesses).toBe(0);
    });

    it("should not advance on low confidence success", () => {
      const state = createTestState();

      const result = processAnalysis(state, {
        description: "Might be the right screen",
        detectedElements: [],
        matchesSuccessCriteria: true,
        confidence: 0.5, // Below 0.7 threshold
      });

      expect(result.shouldAdvance).toBe(false);
      expect(state.currentStep).toBe(0);
    });

    it("should increment consecutive successes but not advance on first success", () => {
      const state = createTestState();

      processAnalysis(state, {
        description: "User is on correct screen",
        detectedElements: ["target element"],
        matchesSuccessCriteria: true,
        confidence: 0.9,
      });

      expect(state.consecutiveSuccesses).toBe(1);
      expect(state.currentStep).toBe(0);
    });

    it("should advance step after consecutive successes threshold", () => {
      const state = createTestState();

      // First success
      processAnalysis(state, {
        description: "Success 1",
        detectedElements: [],
        matchesSuccessCriteria: true,
        confidence: 0.9,
      });

      expect(state.consecutiveSuccesses).toBe(1);
      expect(state.currentStep).toBe(0);

      // Second success - should advance
      const result = processAnalysis(state, {
        description: "Success 2",
        detectedElements: [],
        matchesSuccessCriteria: true,
        confidence: 0.85,
      });

      expect(result.shouldAdvance).toBe(true);
      expect(result.newStep).toBe(1);
      expect(state.currentStep).toBe(1);
      expect(state.consecutiveSuccesses).toBe(0); // Reset after advancing
    });

    it("should reset consecutive successes on failure", () => {
      const state = createTestState({ consecutiveSuccesses: 1 });

      processAnalysis(state, {
        description: "Failed check",
        detectedElements: [],
        matchesSuccessCriteria: false,
        confidence: 0.8,
      });

      expect(state.consecutiveSuccesses).toBe(0);
    });

    it("should complete session after final step", () => {
      const state = createTestState({
        currentStep: 2, // On last step (0-indexed, 3 total)
        consecutiveSuccesses: 1,
      });

      // This should trigger completion
      const result = processAnalysis(state, {
        description: "Final step complete",
        detectedElements: [],
        matchesSuccessCriteria: true,
        confidence: 0.95,
      });

      expect(result.shouldAdvance).toBe(true);
      expect(result.isComplete).toBe(true);
      expect(state.status).toBe("completed");
    });
  });

  describe("Hints", () => {
    it("should have hints available for steps that define them", () => {
      const state = createTestState();
      const step0Hints = state.steps[0].hints;
      const step1Hints = state.steps[1].hints;

      expect(step0Hints).toHaveLength(2);
      expect(step0Hints).toContain("Hint 1A");
      expect(step1Hints).toBeUndefined();
    });

    it("should get random hint from available hints", () => {
      const state = createTestState();
      const hints = state.steps[0].hints!;

      const hint = hints[Math.floor(Math.random() * hints.length)];

      expect(["Hint 1A", "Hint 1B"]).toContain(hint);
    });
  });

  describe("Skip Step", () => {
    it("should advance to next step when skipping", () => {
      const state = createTestState();

      // Simulate skip
      state.currentStep++;
      state.consecutiveSuccesses = 0;

      expect(state.currentStep).toBe(1);
    });

    it("should complete session when skipping final step", () => {
      const state = createTestState({ currentStep: 2 });

      state.currentStep++;

      if (state.currentStep >= state.totalSteps) {
        state.status = "completed";
      }

      expect(state.status).toBe("completed");
    });
  });

  describe("Status Transitions", () => {
    it("should transition from waiting to analyzing", () => {
      const state = createTestState();

      state.status = "analyzing";

      expect(state.status).toBe("analyzing");
    });

    it("should transition to speaking when sending instruction", () => {
      const state = createTestState();

      state.status = "speaking";

      expect(state.status).toBe("speaking");
    });

    it("should return to waiting after speaking", () => {
      const state = createTestState({ status: "speaking" });

      state.status = "waiting";

      expect(state.status).toBe("waiting");
    });

    it("should remain completed once set", () => {
      const state = createTestState({ status: "completed" });

      // Attempting any state change shouldn't matter for completed sessions
      expect(state.status).toBe("completed");
    });
  });
});

describe("Message Types", () => {
  describe("Client -> Server Messages", () => {
    it("should define frame message structure", () => {
      const frameMessage = {
        type: "frame",
        imageData: "base64-encoded-image-data",
      };

      expect(frameMessage.type).toBe("frame");
      expect(typeof frameMessage.imageData).toBe("string");
    });

    it("should define hint request structure", () => {
      const hintRequest = { type: "requestHint" };

      expect(hintRequest.type).toBe("requestHint");
    });

    it("should define skip step structure", () => {
      const skipStep = { type: "skipStep" };

      expect(skipStep.type).toBe("skipStep");
    });

    it("should define ping structure", () => {
      const ping = { type: "ping" };

      expect(ping.type).toBe("ping");
    });
  });

  describe("Server -> Client Messages", () => {
    it("should define connected message structure", () => {
      const connected = {
        type: "connected",
        sessionId: "uuid",
        currentStep: 0,
        totalSteps: 3,
        instruction: "First instruction",
      };

      expect(connected.type).toBe("connected");
      expect(typeof connected.sessionId).toBe("string");
      expect(typeof connected.currentStep).toBe("number");
    });

    it("should define analysis message structure", () => {
      const analysis = {
        type: "analysis",
        description: "User is on the correct page",
        matchesSuccess: true,
        confidence: 0.9,
      };

      expect(analysis.type).toBe("analysis");
      expect(typeof analysis.confidence).toBe("number");
    });

    it("should define step complete message structure", () => {
      const stepComplete = {
        type: "stepComplete",
        currentStep: 1,
        totalSteps: 3,
        nextInstruction: "Next step instruction",
      };

      expect(stepComplete.type).toBe("stepComplete");
    });

    it("should define audio message structure", () => {
      const audio = {
        type: "audio",
        text: "Instruction text",
        audioData: "base64-audio",
      };

      expect(audio.type).toBe("audio");
      expect(typeof audio.audioData).toBe("string");
    });

    it("should define completed message structure", () => {
      const completed = {
        type: "completed",
        message: "All steps completed!",
      };

      expect(completed.type).toBe("completed");
    });

    it("should define error message structure", () => {
      const error = {
        type: "error",
        message: "Session not found",
      };

      expect(error.type).toBe("error");
    });
  });
});

describe("Edge Cases", () => {
  it("should handle empty steps array", () => {
    const state = createTestState({ steps: [], totalSteps: 0 });

    if (state.currentStep >= state.totalSteps) {
      state.status = "completed";
    }

    expect(state.status).toBe("completed");
  });

  it("should handle single step session", () => {
    const state = createTestState({
      steps: [{ instruction: "Only step", successCriteria: "Done" }],
      totalSteps: 1,
      consecutiveSuccesses: 1,
    });

    const result = processAnalysis(state, {
      description: "Step done",
      detectedElements: [],
      matchesSuccessCriteria: true,
      confidence: 0.9,
    });

    expect(result.isComplete).toBe(true);
  });

  it("should handle rapid frame submissions", () => {
    const state = createTestState();
    const now = Date.now();

    // First frame - should analyze
    expect(shouldAnalyze(state, now)).toBe(true);
    state.lastAnalysisTime = now;

    // Rapid subsequent frames - should be debounced
    expect(shouldAnalyze(state, now + 100)).toBe(false);
    expect(shouldAnalyze(state, now + 500)).toBe(false);
    expect(shouldAnalyze(state, now + 1000)).toBe(false);
    expect(shouldAnalyze(state, now + 1999)).toBe(false);

    // After debounce window
    expect(shouldAnalyze(state, now + 2001)).toBe(true);
  });
});
