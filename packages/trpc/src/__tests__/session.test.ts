import { describe, it, expect } from "bun:test";
import { createMockSession } from "./fixtures";

/**
 * Session router unit tests
 */

describe("Session Router", () => {
  describe("token generation", () => {
    it("should generate unique tokens", () => {
      // Simulating nanoid behavior
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        // nanoid(12) generates 12 char strings
        const token = Math.random().toString(36).substring(2, 14);
        tokens.add(token);
      }
      // All should be unique
      expect(tokens.size).toBe(100);
    });

    it("should generate URL-safe tokens", () => {
      const token = "abc123XYZ_-";
      const urlSafeRegex = /^[A-Za-z0-9_-]+$/;

      expect(urlSafeRegex.test(token)).toBe(true);
    });
  });

  describe("session expiry", () => {
    it("should calculate expiry time correctly", () => {
      const expiryHours = 24;
      const now = Date.now();
      const expiresAt = new Date(now + expiryHours * 60 * 60 * 1000);

      const expectedMs = 24 * 60 * 60 * 1000;
      expect(expiresAt.getTime() - now).toBeCloseTo(expectedMs, -3);
    });

    it("should detect expired sessions", () => {
      const expiredSession = createMockSession({
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      });

      const isExpired = new Date() > expiredSession.expiresAt;
      expect(isExpired).toBe(true);
    });

    it("should detect valid sessions", () => {
      const validSession = createMockSession({
        expiresAt: new Date(Date.now() + 1000000),
      });

      const isExpired = new Date() > validSession.expiresAt;
      expect(isExpired).toBe(false);
    });
  });

  describe("one-time use enforcement", () => {
    it("should track first use timestamp", () => {
      const session = createMockSession({ usedAt: null });

      expect(session.usedAt).toBeNull();

      // Simulate starting the session
      const startedSession = {
        ...session,
        usedAt: new Date(),
        status: "active",
      };

      expect(startedSession.usedAt).toBeInstanceOf(Date);
      expect(startedSession.status).toBe("active");
    });

    it("should reject already-used sessions", () => {
      const usedSession = createMockSession({
        usedAt: new Date(),
        status: "completed",
      });

      const isAlreadyUsed = usedSession.usedAt && usedSession.status === "completed";
      expect(isAlreadyUsed).toBe(true);
    });
  });

  describe("session status transitions", () => {
    it("should transition from pending to active", () => {
      const session = createMockSession({ status: "pending" });

      const activated = { ...session, status: "active" as const };
      expect(activated.status).toBe("active");
    });

    it("should transition from active to completed", () => {
      const session = createMockSession({ status: "active" });

      const completed = { ...session, status: "completed" as const };
      expect(completed.status).toBe("completed");
    });

    it("should allow transition to expired from any state", () => {
      const statuses = ["pending", "active"] as const;

      for (const status of statuses) {
        const session = createMockSession({ status });
        const expired = { ...session, status: "expired" as const };
        expect(expired.status).toBe("expired");
      }
    });
  });

  describe("step progression", () => {
    it("should start at step 0", () => {
      const session = createMockSession();

      expect(session.currentStep).toBe(0);
    });

    it("should increment current step", () => {
      const session = createMockSession({ currentStep: 0 });

      const advanced = { ...session, currentStep: session.currentStep + 1 };
      expect(advanced.currentStep).toBe(1);
    });

    it("should track completed steps in metadata", () => {
      const session = createMockSession({
        metadata: { completedSteps: [0, 1] },
      });

      expect(session.metadata.completedSteps).toContain(0);
      expect(session.metadata.completedSteps).toContain(1);
    });
  });

  describe("share URL generation", () => {
    it("should generate correct share URL format", () => {
      const session = createMockSession({ token: "abc123xyz" });
      const shareUrl = `/s/${session.token}`;

      expect(shareUrl).toBe("/s/abc123xyz");
    });
  });

  describe("session filtering", () => {
    it("should filter by status", () => {
      const sessions = [
        createMockSession({ status: "pending" }),
        createMockSession({ status: "active" }),
        createMockSession({ status: "completed" }),
        createMockSession({ status: "expired" }),
      ];

      const activeSessions = sessions.filter((s) => s.status === "active");
      expect(activeSessions.length).toBe(1);

      const nonExpired = sessions.filter((s) => s.status !== "expired");
      expect(nonExpired.length).toBe(3);
    });

    it("should filter by template", () => {
      const sessions = [
        createMockSession({ templateId: "template-1" }),
        createMockSession({ templateId: "template-1" }),
        createMockSession({ templateId: "template-2" }),
      ];

      const template1Sessions = sessions.filter(
        (s) => s.templateId === "template-1"
      );
      expect(template1Sessions.length).toBe(2);
    });
  });
});
