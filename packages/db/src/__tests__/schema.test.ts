import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "../schema";

/**
 * Database Integration Tests
 *
 * These tests run against a real Postgres database to verify:
 * - Schema is valid and can be queried
 * - CRUD operations work correctly
 * - Constraints are enforced
 */

const connectionString = process.env.DATABASE_URL;
const shouldSkip = !connectionString;

let db: Kysely<Database>;
let pool: pg.Pool;

if (!shouldSkip) {
  pool = new pg.Pool({ connectionString });
  db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}

describe.skipIf(shouldSkip)("Database Schema Integration", () => {
  beforeEach(async () => {
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

  describe("Templates", () => {
    it("should create a template with steps", async () => {
      const template = await db
        .insertInto("templates")
        .values({
          name: "Test Template",
          description: "A test template",
          steps: JSON.stringify([
            { instruction: "Step 1", successCriteria: "Step 1 done" },
            { instruction: "Step 2", successCriteria: "Step 2 done", hints: ["Hint 1"] },
          ]),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(template.id).toBeDefined();
      expect(template.name).toBe("Test Template");
      expect(template.description).toBe("A test template");
      expect(template.steps).toHaveLength(2);
      expect(template.steps[1].hints).toContain("Hint 1");
      expect(template.created_at).toBeInstanceOf(Date);
    });

    it("should update a template", async () => {
      const template = await db
        .insertInto("templates")
        .values({
          name: "Original",
          steps: JSON.stringify([{ instruction: "Do X", successCriteria: "X done" }]),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const updated = await db
        .updateTable("templates")
        .set({ name: "Updated", updated_at: new Date() })
        .where("id", "=", template.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(updated.name).toBe("Updated");
      expect(updated.updated_at.getTime()).toBeGreaterThanOrEqual(template.created_at.getTime());
    });

    it("should delete a template", async () => {
      const template = await db
        .insertInto("templates")
        .values({ name: "To Delete", steps: JSON.stringify([]) })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db.deleteFrom("templates").where("id", "=", template.id).execute();

      const found = await db
        .selectFrom("templates")
        .selectAll()
        .where("id", "=", template.id)
        .execute();

      expect(found).toHaveLength(0);
    });
  });

  describe("Sessions", () => {
    it("should create a session linked to a template", async () => {
      const template = await db
        .insertInto("templates")
        .values({
          name: "Session Test Template",
          steps: JSON.stringify([{ instruction: "Test", successCriteria: "Done" }]),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const session = await db
        .insertInto("sessions")
        .values({
          token: "test-token-abc",
          template_id: template.id,
          expires_at: expiresAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(session.token).toBe("test-token-abc");
      expect(session.template_id).toBe(template.id);
      expect(session.status).toBe("pending");
      expect(session.current_step).toBe(0);
      expect(session.used_at).toBeNull();
    });

    it("should enforce unique token constraint", async () => {
      const template = await db
        .insertInto("templates")
        .values({ name: "Unique Test", steps: JSON.stringify([]) })
        .returningAll()
        .executeTakeFirstOrThrow();

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.insertInto("sessions").values({
        token: "unique-token",
        template_id: template.id,
        expires_at: expiresAt,
      }).execute();

      // Second insert with same token should fail
      await expect(
        db.insertInto("sessions").values({
          token: "unique-token",
          template_id: template.id,
          expires_at: expiresAt,
        }).execute()
      ).rejects.toThrow();
    });

    it("should update session status and track used_at", async () => {
      const template = await db
        .insertInto("templates")
        .values({ name: "Status Test", steps: JSON.stringify([]) })
        .returningAll()
        .executeTakeFirstOrThrow();

      const session = await db
        .insertInto("sessions")
        .values({
          token: "status-test-token",
          template_id: template.id,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Start session
      const usedAt = new Date();
      const started = await db
        .updateTable("sessions")
        .set({ status: "active", used_at: usedAt })
        .where("id", "=", session.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(started.status).toBe("active");
      expect(started.used_at).toBeInstanceOf(Date);

      // Complete session
      const completed = await db
        .updateTable("sessions")
        .set({ status: "completed", current_step: 3 })
        .where("id", "=", session.id)
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(completed.status).toBe("completed");
      expect(completed.current_step).toBe(3);
    });

    it("should find expired sessions", async () => {
      const template = await db
        .insertInto("templates")
        .values({ name: "Expiry Test", steps: JSON.stringify([]) })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create expired session
      await db.insertInto("sessions").values({
        token: "expired-token",
        template_id: template.id,
        expires_at: new Date(Date.now() - 1000),
      }).execute();

      // Create valid session
      await db.insertInto("sessions").values({
        token: "valid-token",
        template_id: template.id,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }).execute();

      // Query for expired
      const expired = await db
        .selectFrom("sessions")
        .selectAll()
        .where("expires_at", "<", new Date())
        .execute();

      expect(expired).toHaveLength(1);
      expect(expired[0].token).toBe("expired-token");
    });

    it("should store and retrieve session metadata", async () => {
      const template = await db
        .insertInto("templates")
        .values({ name: "Metadata Test", steps: JSON.stringify([]) })
        .returningAll()
        .executeTakeFirstOrThrow();

      const session = await db
        .insertInto("sessions")
        .values({
          token: "metadata-token",
          template_id: template.id,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          metadata: JSON.stringify({
            userAgent: "Test Browser/1.0",
            completedSteps: [0, 1, 2],
            totalDurationMs: 30000,
          }),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(session.metadata?.userAgent).toBe("Test Browser/1.0");
      expect(session.metadata?.completedSteps).toEqual([0, 1, 2]);
      expect(session.metadata?.totalDurationMs).toBe(30000);
    });
  });

  describe("Recordings", () => {
    it("should create recording chunks linked to a session", async () => {
      const template = await db
        .insertInto("templates")
        .values({ name: "Recording Test", steps: JSON.stringify([]) })
        .returningAll()
        .executeTakeFirstOrThrow();

      const session = await db
        .insertInto("sessions")
        .values({
          token: "recording-token",
          template_id: template.id,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Create multiple chunks
      const chunks = await db
        .insertInto("recordings")
        .values([
          { session_id: session.id, storage_key: "r2://chunk-0.webm", chunk_index: 0, duration_ms: 5000, size_bytes: 100000 },
          { session_id: session.id, storage_key: "r2://chunk-1.webm", chunk_index: 1, duration_ms: 5000, size_bytes: 95000 },
          { session_id: session.id, storage_key: "r2://chunk-2.webm", chunk_index: 2, duration_ms: 5000, size_bytes: 110000 },
        ])
        .returningAll()
        .execute();

      expect(chunks).toHaveLength(3);
      expect(chunks[0].chunk_index).toBe(0);
      expect(chunks[2].chunk_index).toBe(2);
      expect(chunks[0].mime_type).toBe("video/webm");
    });
  });

  describe("Frame Samples", () => {
    it("should create frame samples with analysis results", async () => {
      const template = await db
        .insertInto("templates")
        .values({ name: "Frame Test", steps: JSON.stringify([]) })
        .returningAll()
        .executeTakeFirstOrThrow();

      const session = await db
        .insertInto("sessions")
        .values({
          token: "frame-token",
          template_id: template.id,
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const frame = await db
        .insertInto("frame_samples")
        .values({
          session_id: session.id,
          storage_key: "r2://frame-001.jpg",
          captured_at: new Date(),
          analysis_result: JSON.stringify({
            description: "User is on the Instagram profile page",
            detectedElements: ["profile picture", "follower count", "bio"],
            matchesSuccessCriteria: true,
            confidence: 0.92,
            suggestedAction: "Click on Professional Dashboard",
          }),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(frame.analysis_result?.description).toContain("Instagram");
      expect(frame.analysis_result?.confidence).toBe(0.92);
      expect(frame.analysis_result?.detectedElements).toContain("bio");
    });
  });

  describe("Joins", () => {
    it("should query session with template using join", async () => {
      const template = await db
        .insertInto("templates")
        .values({
          name: "Relation Test Template",
          description: "For testing relations",
          steps: JSON.stringify([{ instruction: "Do something", successCriteria: "Something done" }]),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await db.insertInto("sessions").values({
        token: "relation-token",
        template_id: template.id,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }).execute();

      // Query with join
      const result = await db
        .selectFrom("sessions")
        .innerJoin("templates", "templates.id", "sessions.template_id")
        .select([
          "sessions.token",
          "templates.name as template_name",
          "templates.steps as template_steps",
        ])
        .where("sessions.token", "=", "relation-token")
        .executeTakeFirst();

      expect(result?.template_name).toBe("Relation Test Template");
      expect((result?.template_steps as any)[0].instruction).toBe("Do something");
    });
  });
});
