import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";

/**
 * tRPC Integration Tests
 *
 * These tests create actual tRPC callers with a real database connection.
 * They verify the full request lifecycle from input validation to database operations.
 *
 * Requires DATABASE_URL environment variable to be set.
 */

const connectionString = process.env.DATABASE_URL;
const shouldSkip = !connectionString;

// Dynamic imports to avoid loading db module when DATABASE_URL is not set
async function setupTest() {
  const { Kysely, PostgresDialect } = await import("kysely");
  const pg = (await import("pg")).default;
  const { appRouter } = await import("../index");

  const pool = new pg.Pool({ connectionString });
  const db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });

  const createTestCaller = () => {
    return appRouter.createCaller({ db });
  };

  return { db, pool, createTestCaller };
}

describe.skipIf(shouldSkip)("tRPC Integration", () => {
  let caller: any;
  let db: any;
  let pool: any;

  beforeAll(async () => {
    const setup = await setupTest();
    db = setup.db;
    pool = setup.pool;
    caller = setup.createTestCaller();
  });

  beforeEach(async () => {
    // Clean up test data
    await db.deleteFrom("frame_samples").execute();
    await db.deleteFrom("recordings").execute();
    await db.deleteFrom("sessions").execute();
    await db.deleteFrom("templates").execute();
  });

  afterAll(async () => {
    await db.deleteFrom("frame_samples").execute();
    await db.deleteFrom("recordings").execute();
    await db.deleteFrom("sessions").execute();
    await db.deleteFrom("templates").execute();
    await db.destroy();
  });

  describe("Template Router", () => {
    it("should create and retrieve a template", async () => {
      const created = await caller.template.create({
        name: "Instagram Demographics",
        description: "Guide to view demographics",
        steps: [
          { instruction: "Open Instagram", successCriteria: "App is open" },
          { instruction: "Go to profile", successCriteria: "Profile visible", hints: ["Bottom right icon"] },
        ],
      });

      expect(created.id).toBeDefined();
      expect(created.name).toBe("Instagram Demographics");
      expect(created.steps).toHaveLength(2);

      // Retrieve by ID
      const fetched = await caller.template.get({ id: created.id });
      expect(fetched.name).toBe("Instagram Demographics");
      expect(fetched.steps[1].hints).toContain("Bottom right icon");
    });

    it("should list all templates ordered by creation", async () => {
      await caller.template.create({
        name: "Template A",
        steps: [{ instruction: "A", successCriteria: "A done" }],
      });
      await caller.template.create({
        name: "Template B",
        steps: [{ instruction: "B", successCriteria: "B done" }],
      });

      const list = await caller.template.list();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe("Template A");
      expect(list[1].name).toBe("Template B");
    });

    it("should update a template", async () => {
      const created = await caller.template.create({
        name: "Original Name",
        steps: [{ instruction: "Step", successCriteria: "Done" }],
      });

      const updated = await caller.template.update({
        id: created.id,
        name: "New Name",
        description: "Added description",
      });

      expect(updated.name).toBe("New Name");
      expect(updated.description).toBe("Added description");
      expect(updated.steps).toHaveLength(1); // Steps unchanged
    });

    it("should delete a template", async () => {
      const created = await caller.template.create({
        name: "To Delete",
        steps: [{ instruction: "X", successCriteria: "Y" }],
      });

      const result = await caller.template.delete({ id: created.id });
      expect(result.success).toBe(true);

      // Verify deleted
      await expect(caller.template.get({ id: created.id })).rejects.toThrow("Template not found");
    });

    it("should reject invalid input", async () => {
      // Empty name
      await expect(
        caller.template.create({
          name: "",
          steps: [{ instruction: "X", successCriteria: "Y" }],
        })
      ).rejects.toThrow();

      // Empty steps
      await expect(
        caller.template.create({
          name: "Valid Name",
          steps: [],
        })
      ).rejects.toThrow();
    });
  });

  describe("Session Router", () => {
    let templateId: string;

    beforeEach(async () => {
      // Clean and create fresh template for session tests
      await db.deleteFrom("frame_samples").execute();
      await db.deleteFrom("recordings").execute();
      await db.deleteFrom("sessions").execute();
      await db.deleteFrom("templates").execute();

      const template = await caller.template.create({
        name: "Session Test Template",
        steps: [
          { instruction: "Step 1", successCriteria: "Step 1 done" },
          { instruction: "Step 2", successCriteria: "Step 2 done" },
        ],
      });
      templateId = template.id;
    });

    it("should create a session with unique token", async () => {
      const session = await caller.session.create({ templateId });

      expect(session.token).toHaveLength(12);
      expect(session.status).toBe("pending");
      expect(session.current_step).toBe(0);
      expect(session.shareUrl).toBe(`/s/${session.token}`);
      expect(session.expires_at.getTime()).toBeGreaterThan(Date.now());
    });

    it("should create session with custom expiry", async () => {
      const session = await caller.session.create({
        templateId,
        expiryHours: 48,
      });

      const expectedExpiry = Date.now() + 48 * 60 * 60 * 1000;
      expect(session.expires_at.getTime()).toBeCloseTo(expectedExpiry, -4); // Within 10 seconds
    });

    it("should get session by token with template data", async () => {
      const created = await caller.session.create({ templateId });

      const fetched = await caller.session.getByToken({ token: created.token });

      expect(fetched.id).toBe(created.id);
      expect(fetched.template).toBeDefined();
      expect(fetched.template!.name).toBe("Session Test Template");
      expect(fetched.template!.steps).toHaveLength(2);
    });

    it("should start a session (mark as active)", async () => {
      const created = await caller.session.create({ templateId });

      expect(created.status).toBe("pending");
      expect(created.used_at).toBeNull();

      const started = await caller.session.start({ token: created.token });

      expect(started.status).toBe("active");
      expect(started.used_at).toBeInstanceOf(Date);
    });

    it("should prevent starting a session twice", async () => {
      const created = await caller.session.create({ templateId });
      await caller.session.start({ token: created.token });

      await expect(
        caller.session.start({ token: created.token })
      ).rejects.toThrow("Session has already been started");
    });

    it("should update session progress", async () => {
      const created = await caller.session.create({ templateId });

      const updated = await caller.session.update({
        id: created.id,
        currentStep: 1,
        metadata: { completedSteps: [0] },
      });

      expect(updated.current_step).toBe(1);
      expect(updated.metadata?.completedSteps).toContain(0);
    });

    it("should complete a session", async () => {
      const created = await caller.session.create({ templateId });
      await caller.session.start({ token: created.token });

      const completed = await caller.session.complete({
        id: created.id,
        totalDurationMs: 45000,
      });

      expect(completed.status).toBe("completed");
      expect(completed.metadata?.totalDurationMs).toBe(45000);
    });

    it("should reject expired sessions", async () => {
      // Create a session with normal expiry
      const session = await caller.session.create({
        templateId,
      });

      // Manually set expiresAt to the past to simulate expiry
      await db
        .updateTable("sessions")
        .set({ expires_at: new Date(Date.now() - 1000) })
        .where("token", "=", session.token)
        .execute();

      await expect(
        caller.session.getByToken({ token: session.token })
      ).rejects.toThrow();
    });

    it("should list sessions with filtering", async () => {
      // Create multiple sessions
      await caller.session.create({ templateId });
      const session2 = await caller.session.create({ templateId });
      await caller.session.start({ token: session2.token });

      // Filter by status
      const activeSessions = await caller.session.list({ status: "active" });
      expect(activeSessions).toHaveLength(1);

      const pendingSessions = await caller.session.list({ status: "pending" });
      expect(pendingSessions).toHaveLength(1);

      // All sessions
      const allSessions = await caller.session.list({});
      expect(allSessions).toHaveLength(2);
    });

    it("should reject non-existent template", async () => {
      await expect(
        caller.session.create({ templateId: "00000000-0000-0000-0000-000000000000" })
      ).rejects.toThrow("Template not found");
    });
  });

  describe("Full Session Lifecycle", () => {
    it("should complete an entire session workflow", async () => {
      // 1. Create template
      const template = await caller.template.create({
        name: "Complete Workflow Test",
        description: "Testing full lifecycle",
        steps: [
          { instruction: "Open app", successCriteria: "App open" },
          { instruction: "Navigate", successCriteria: "At destination" },
          { instruction: "Complete action", successCriteria: "Action done" },
        ],
      });

      // 2. Create session
      const session = await caller.session.create({
        templateId: template.id,
        metadata: { userAgent: "Test/1.0" },
      });

      expect(session.status).toBe("pending");

      // 3. Fetch session (as if user opened share link)
      const fetchedSession = await caller.session.getByToken({ token: session.token });
      expect(fetchedSession.template!.name).toBe("Complete Workflow Test");

      // 4. Start session
      const startedSession = await caller.session.start({ token: session.token });
      expect(startedSession.status).toBe("active");

      // 5. Progress through steps
      await caller.session.update({
        id: session.id,
        currentStep: 1,
        metadata: { completedSteps: [0] },
      });

      await caller.session.update({
        id: session.id,
        currentStep: 2,
        metadata: { completedSteps: [0, 1] },
      });

      // 6. Complete session
      const completedSession = await caller.session.complete({
        id: session.id,
        totalDurationMs: 120000,
      });

      expect(completedSession.status).toBe("completed");
      expect(completedSession.current_step).toBe(2);
      expect(completedSession.metadata?.completedSteps).toEqual([0, 1]);
      expect(completedSession.metadata?.totalDurationMs).toBe(120000);

      // 7. Verify session cannot be reused
      await expect(
        caller.session.getByToken({ token: session.token })
      ).rejects.toThrow("Session has already been used");
    });
  });
});
