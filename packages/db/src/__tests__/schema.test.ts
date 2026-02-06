import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, lt } from "drizzle-orm";
import * as schema from "../src/schema";

/**
 * Database Integration Tests
 * 
 * These tests run against a real Postgres database to verify:
 * - Schema is valid and can be pushed
 * - CRUD operations work correctly
 * - Relations work as expected
 * - Constraints are enforced
 */

const connectionString = process.env.DATABASE_URL;
const shouldSkip = !connectionString;

// Create test-specific connection
const sql = shouldSkip ? null : postgres(connectionString!);
const db = shouldSkip ? null : drizzle(sql!, { schema });

describe.skipIf(shouldSkip)("Database Schema Integration", () => {
  beforeEach(async () => {
    // Clean up test data before each test
    await db!.delete(schema.frameSamples);
    await db!.delete(schema.recordings);
    await db!.delete(schema.sessions);
    await db!.delete(schema.templates);
  });

  afterAll(async () => {
    // Clean up and close connection
    await db!.delete(schema.frameSamples);
    await db!.delete(schema.recordings);
    await db!.delete(schema.sessions);
    await db!.delete(schema.templates);
    await sql!.end();
  });

  describe("Templates", () => {
    it("should create a template with steps", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({
          name: "Test Template",
          description: "A test template",
          steps: [
            { instruction: "Step 1", successCriteria: "Step 1 done" },
            { instruction: "Step 2", successCriteria: "Step 2 done", hints: ["Hint 1"] },
          ],
        })
        .returning();

      expect(template.id).toBeDefined();
      expect(template.name).toBe("Test Template");
      expect(template.description).toBe("A test template");
      expect(template.steps).toHaveLength(2);
      expect(template.steps[1].hints).toContain("Hint 1");
      expect(template.createdAt).toBeInstanceOf(Date);
    });

    it("should update a template", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({ name: "Original", steps: [{ instruction: "Do X", successCriteria: "X done" }] })
        .returning();

      const [updated] = await db!
        .update(schema.templates)
        .set({ name: "Updated", updatedAt: new Date() })
        .where(eq(schema.templates.id, template.id))
        .returning();

      expect(updated.name).toBe("Updated");
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(template.createdAt.getTime());
    });

    it("should delete a template", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({ name: "To Delete", steps: [] })
        .returning();

      await db!.delete(schema.templates).where(eq(schema.templates.id, template.id));

      const found = await db!
        .select()
        .from(schema.templates)
        .where(eq(schema.templates.id, template.id));

      expect(found).toHaveLength(0);
    });
  });

  describe("Sessions", () => {
    it("should create a session linked to a template", async () => {
      // Create template first
      const [template] = await db!
        .insert(schema.templates)
        .values({ name: "Session Test Template", steps: [{ instruction: "Test", successCriteria: "Done" }] })
        .returning();

      // Create session
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const [session] = await db!
        .insert(schema.sessions)
        .values({
          token: "test-token-abc",
          templateId: template.id,
          expiresAt,
        })
        .returning();

      expect(session.token).toBe("test-token-abc");
      expect(session.templateId).toBe(template.id);
      expect(session.status).toBe("pending");
      expect(session.currentStep).toBe(0);
      expect(session.usedAt).toBeNull();
    });

    it("should enforce unique token constraint", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({ name: "Unique Test", steps: [] })
        .returning();

      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      
      await db!.insert(schema.sessions).values({
        token: "unique-token",
        templateId: template.id,
        expiresAt,
      });

      // Second insert with same token should fail
      await expect(
        db!.insert(schema.sessions).values({
          token: "unique-token",
          templateId: template.id,
          expiresAt,
        })
      ).rejects.toThrow();
    });

    it("should update session status and track used_at", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({ name: "Status Test", steps: [] })
        .returning();

      const [session] = await db!
        .insert(schema.sessions)
        .values({
          token: "status-test-token",
          templateId: template.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();

      // Start session
      const usedAt = new Date();
      const [started] = await db!
        .update(schema.sessions)
        .set({ status: "active", usedAt })
        .where(eq(schema.sessions.id, session.id))
        .returning();

      expect(started.status).toBe("active");
      expect(started.usedAt).toBeInstanceOf(Date);

      // Complete session
      const [completed] = await db!
        .update(schema.sessions)
        .set({ status: "completed", currentStep: 3 })
        .where(eq(schema.sessions.id, session.id))
        .returning();

      expect(completed.status).toBe("completed");
      expect(completed.currentStep).toBe(3);
    });

    it("should find expired sessions", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({ name: "Expiry Test", steps: [] })
        .returning();

      // Create expired session
      await db!.insert(schema.sessions).values({
        token: "expired-token",
        templateId: template.id,
        expiresAt: new Date(Date.now() - 1000), // 1 second ago
      });

      // Create valid session
      await db!.insert(schema.sessions).values({
        token: "valid-token",
        templateId: template.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      // Query for expired
      const expired = await db!
        .select()
        .from(schema.sessions)
        .where(lt(schema.sessions.expiresAt, new Date()));

      expect(expired).toHaveLength(1);
      expect(expired[0].token).toBe("expired-token");
    });

    it("should store and retrieve session metadata", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({ name: "Metadata Test", steps: [] })
        .returning();

      const [session] = await db!
        .insert(schema.sessions)
        .values({
          token: "metadata-token",
          templateId: template.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          metadata: {
            userAgent: "Test Browser/1.0",
            completedSteps: [0, 1, 2],
            totalDurationMs: 30000,
          },
        })
        .returning();

      expect(session.metadata?.userAgent).toBe("Test Browser/1.0");
      expect(session.metadata?.completedSteps).toEqual([0, 1, 2]);
      expect(session.metadata?.totalDurationMs).toBe(30000);
    });
  });

  describe("Recordings", () => {
    it("should create recording chunks linked to a session", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({ name: "Recording Test", steps: [] })
        .returning();

      const [session] = await db!
        .insert(schema.sessions)
        .values({
          token: "recording-token",
          templateId: template.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();

      // Create multiple chunks
      const chunks = await db!
        .insert(schema.recordings)
        .values([
          { sessionId: session.id, storageKey: "r2://chunk-0.webm", chunkIndex: 0, durationMs: 5000, sizeBytes: 100000 },
          { sessionId: session.id, storageKey: "r2://chunk-1.webm", chunkIndex: 1, durationMs: 5000, sizeBytes: 95000 },
          { sessionId: session.id, storageKey: "r2://chunk-2.webm", chunkIndex: 2, durationMs: 5000, sizeBytes: 110000 },
        ])
        .returning();

      expect(chunks).toHaveLength(3);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[2].chunkIndex).toBe(2);
      expect(chunks[0].mimeType).toBe("video/webm");
    });
  });

  describe("Frame Samples", () => {
    it("should create frame samples with analysis results", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({ name: "Frame Test", steps: [] })
        .returning();

      const [session] = await db!
        .insert(schema.sessions)
        .values({
          token: "frame-token",
          templateId: template.id,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })
        .returning();

      const [frame] = await db!
        .insert(schema.frameSamples)
        .values({
          sessionId: session.id,
          storageKey: "r2://frame-001.jpg",
          capturedAt: new Date(),
          analysisResult: {
            description: "User is on the Instagram profile page",
            detectedElements: ["profile picture", "follower count", "bio"],
            matchesSuccessCriteria: true,
            confidence: 0.92,
            suggestedAction: "Click on Professional Dashboard",
          },
        })
        .returning();

      expect(frame.analysisResult?.description).toContain("Instagram");
      expect(frame.analysisResult?.confidence).toBe(0.92);
      expect(frame.analysisResult?.detectedElements).toContain("bio");
    });
  });

  describe("Relations", () => {
    it("should query session with template using relations", async () => {
      const [template] = await db!
        .insert(schema.templates)
        .values({
          name: "Relation Test Template",
          description: "For testing relations",
          steps: [{ instruction: "Do something", successCriteria: "Something done" }],
        })
        .returning();

      await db!.insert(schema.sessions).values({
        token: "relation-token",
        templateId: template.id,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      // Query with relations
      const result = await db!.query.sessions.findFirst({
        where: eq(schema.sessions.token, "relation-token"),
        with: {
          template: true,
        },
      });

      expect(result?.template.name).toBe("Relation Test Template");
      expect(result?.template.steps[0].instruction).toBe("Do something");
    });
  });
});
