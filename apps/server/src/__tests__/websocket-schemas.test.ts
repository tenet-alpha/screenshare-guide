import { describe, it, expect } from "bun:test";
import { clientMessageSchema } from "../websocket-schemas";

describe("clientMessageSchema", () => {
  // ── Valid messages ──────────────────────────────────────────────

  describe("valid messages", () => {
    it("parses a valid frame message", () => {
      const msg = { type: "frame", imageData: "data:image/png;base64,abc123" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("frame");
        if (result.data.type === "frame") {
          expect(result.data.imageData).toBe("data:image/png;base64,abc123");
        }
      }
    });

    it("parses a valid linkClicked message", () => {
      const msg = { type: "linkClicked", step: 0 };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("linkClicked");
        if (result.data.type === "linkClicked") {
          expect(result.data.step).toBe(0);
        }
      }
    });

    it("parses linkClicked with max step value", () => {
      const msg = { type: "linkClicked", step: 20 };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("parses a valid audioComplete message", () => {
      const msg = { type: "audioComplete" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("audioComplete");
      }
    });

    it("parses a valid ping message", () => {
      const msg = { type: "ping" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("ping");
      }
    });

    it("parses a valid requestHint message", () => {
      const msg = { type: "requestHint" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("requestHint");
      }
    });

    it("parses a valid skipStep message", () => {
      const msg = { type: "skipStep" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.type).toBe("skipStep");
      }
    });
  });

  // ── Rejection: oversized frame ──────────────────────────────────

  describe("oversized frame", () => {
    it("rejects frame with imageData exceeding 2MB", () => {
      const oversized = "x".repeat(2 * 1024 * 1024 + 1);
      const msg = { type: "frame", imageData: oversized };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("Frame too large");
      }
    });

    it("accepts frame at exactly 2MB", () => {
      const exact = "x".repeat(2 * 1024 * 1024);
      const msg = { type: "frame", imageData: exact };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });

  // ── Rejection: unknown message type ─────────────────────────────

  describe("unknown message type", () => {
    it("rejects unknown type", () => {
      const msg = { type: "unknownType" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects empty object", () => {
      const msg = {};
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects null", () => {
      const result = clientMessageSchema.safeParse(null);
      expect(result.success).toBe(false);
    });

    it("rejects string", () => {
      const result = clientMessageSchema.safeParse("ping");
      expect(result.success).toBe(false);
    });

    it("rejects number", () => {
      const result = clientMessageSchema.safeParse(42);
      expect(result.success).toBe(false);
    });
  });

  // ── Rejection: missing required fields ──────────────────────────

  describe("missing required fields", () => {
    it("rejects frame without imageData", () => {
      const msg = { type: "frame" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects linkClicked without step", () => {
      const msg = { type: "linkClicked" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects message without type", () => {
      const msg = { imageData: "abc123" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  // ── Rejection: invalid step values ──────────────────────────────

  describe("invalid step values", () => {
    it("rejects negative step number", () => {
      const msg = { type: "linkClicked", step: -1 };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects non-integer step number", () => {
      const msg = { type: "linkClicked", step: 1.5 };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects step above max (20)", () => {
      const msg = { type: "linkClicked", step: 21 };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });

    it("rejects step as string", () => {
      const msg = { type: "linkClicked", step: "3" };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
    });
  });

  // ── Extra fields behavior ───────────────────────────────────────

  describe("extra fields", () => {
    it("allows extra fields (passthrough by default)", () => {
      const msg = { type: "ping", extra: "field", nested: { a: 1 } };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });

    it("allows extra fields on frame message", () => {
      const msg = { type: "frame", imageData: "abc", timestamp: 12345 };
      const result = clientMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
    });
  });
});
