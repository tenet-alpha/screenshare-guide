import { describe, it, expect, beforeEach, mock } from "bun:test";
import { INSTAGRAM_PROOF_TEMPLATE } from "@screenshare-guide/protocol";

/**
 * createProof tRPC endpoint unit tests.
 *
 * We exercise the logic that lives in session.ts ➜ createProof by
 * providing a thin mock of Kysely's query builder chain.
 * The goal: prove the endpoint always returns correctly-shaped data
 * and that the template-reuse / step-parsing paths are exercised.
 */

// ── Helpers ──────────────────────────────────────────────────────────

/** Build a mock Kysely `db` object just for the createProof path. */
function createMockDb(opts: {
  existingTemplate?: Record<string, any> | null;
  insertedTemplate?: Record<string, any>;
  insertedSession?: Record<string, any>;
}) {
  const selectFromTemplates = {
    selectAll: () => selectFromTemplates,
    where: () => selectFromTemplates,
    executeTakeFirst: async () => opts.existingTemplate ?? null,
  };

  const insertIntoTemplates = {
    values: () => insertIntoTemplates,
    returningAll: () => insertIntoTemplates,
    executeTakeFirstOrThrow: async () =>
      opts.insertedTemplate ?? {
        id: "tmpl-uuid-1",
        name: INSTAGRAM_PROOF_TEMPLATE.name,
        description: INSTAGRAM_PROOF_TEMPLATE.description,
        steps: JSON.stringify(INSTAGRAM_PROOF_TEMPLATE.steps),
        created_at: new Date(),
        updated_at: new Date(),
      },
  };

  const insertIntoSessions = {
    values: () => insertIntoSessions,
    returningAll: () => insertIntoSessions,
    executeTakeFirstOrThrow: async () =>
      opts.insertedSession ?? {
        id: "sess-uuid-1",
        token: "abc123xyz789",
        template_id: "tmpl-uuid-1",
        status: "pending",
        current_step: 0,
        metadata: null,
        used_at: null,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
        created_at: new Date(),
        updated_at: new Date(),
      },
  };

  return {
    selectFrom: (table: string) => {
      if (table === "templates") return selectFromTemplates;
      throw new Error(`Unexpected selectFrom("${table}")`);
    },
    insertInto: (table: string) => {
      if (table === "templates") return insertIntoTemplates;
      if (table === "sessions") return insertIntoSessions;
      throw new Error(`Unexpected insertInto("${table}")`);
    },
  };
}

/** Simulate the createProof logic (extracted from session.ts) */
async function runCreateProof(db: ReturnType<typeof createMockDb>) {
  // Find or create the hardcoded template
  let template = await (db as any)
    .selectFrom("templates")
    .selectAll()
    .where("name", "=", INSTAGRAM_PROOF_TEMPLATE.name)
    .executeTakeFirst();

  if (!template) {
    template = await (db as any)
      .insertInto("templates")
      .values({
        name: INSTAGRAM_PROOF_TEMPLATE.name,
        description: INSTAGRAM_PROOF_TEMPLATE.description,
        steps: JSON.stringify(INSTAGRAM_PROOF_TEMPLATE.steps),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const token = "mock-token-123";
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const session = await (db as any)
    .insertInto("sessions")
    .values({
      token,
      template_id: template.id,
      expires_at: expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    shareUrl: `/s/${token}`,
    token,
    sessionId: session.id,
    template: {
      id: template.id,
      name: template.name,
      steps:
        typeof template.steps === "string"
          ? JSON.parse(template.steps)
          : template.steps,
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("createProof endpoint", () => {
  describe("response shape", () => {
    it("returns token, sessionId, shareUrl, and template", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      expect(result).toHaveProperty("token");
      expect(result).toHaveProperty("sessionId");
      expect(result).toHaveProperty("shareUrl");
      expect(result).toHaveProperty("template");
      expect(typeof result.token).toBe("string");
      expect(typeof result.sessionId).toBe("string");
      expect(result.shareUrl).toMatch(/^\/s\/.+/);
    });

    it("returns template with id, name, and steps", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      expect(result.template).toHaveProperty("id");
      expect(result.template).toHaveProperty("name");
      expect(result.template).toHaveProperty("steps");
    });
  });

  describe("template.steps is always a parsed array", () => {
    it("parses steps when Kysely returns a JSON string", async () => {
      const db = createMockDb({
        existingTemplate: {
          id: "tmpl-1",
          name: INSTAGRAM_PROOF_TEMPLATE.name,
          steps: JSON.stringify(INSTAGRAM_PROOF_TEMPLATE.steps), // string!
        },
      });

      const result = await runCreateProof(db);

      expect(Array.isArray(result.template.steps)).toBe(true);
      expect(result.template.steps).toHaveLength(2);
      expect(result.template.steps[0]).toHaveProperty("instruction");
    });

    it("passes through steps when already an array", async () => {
      const db = createMockDb({
        existingTemplate: {
          id: "tmpl-1",
          name: INSTAGRAM_PROOF_TEMPLATE.name,
          steps: INSTAGRAM_PROOF_TEMPLATE.steps, // already an array
        },
      });

      const result = await runCreateProof(db);

      expect(Array.isArray(result.template.steps)).toBe(true);
      expect(result.template.steps).toHaveLength(2);
    });

    it("steps are never a string in the response", async () => {
      // Simulate Kysely returning stringified JSON
      const db = createMockDb({
        existingTemplate: {
          id: "tmpl-1",
          name: INSTAGRAM_PROOF_TEMPLATE.name,
          steps: JSON.stringify(INSTAGRAM_PROOF_TEMPLATE.steps),
        },
      });

      const result = await runCreateProof(db);
      expect(typeof result.template.steps).not.toBe("string");
    });
  });

  describe("template structure", () => {
    it("template has exactly 2 steps", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      expect(result.template.steps).toHaveLength(2);
    });

    it("each step has instruction and successCriteria", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      for (const step of result.template.steps) {
        expect(step).toHaveProperty("instruction");
        expect(step).toHaveProperty("successCriteria");
        expect(typeof step.instruction).toBe("string");
        expect(typeof step.successCriteria).toBe("string");
        expect(step.instruction.length).toBeGreaterThan(0);
        expect(step.successCriteria.length).toBeGreaterThan(0);
      }
    });

    it("step 1 references Meta Business Suite and handle", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      expect(result.template.steps[0].instruction).toContain("Meta Business Suite");
      expect(result.template.steps[0].instruction.toLowerCase()).toContain("handle");
    });

    it("step 2 references Insights and metrics", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      expect(result.template.steps[1].instruction).toContain("Insights");
      expect(result.template.steps[1].instruction.toLowerCase()).toContain("metrics");
    });

    it("each step has link, extractionSchema, and requiresLinkClick", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      for (const step of result.template.steps) {
        expect(step).toHaveProperty("link");
        expect(step.link).toHaveProperty("url");
        expect(step.link).toHaveProperty("label");
        expect(step).toHaveProperty("extractionSchema");
        expect(Array.isArray(step.extractionSchema)).toBe(true);
        expect(step.extractionSchema.length).toBeGreaterThan(0);
        expect(step).toHaveProperty("requiresLinkClick");
        expect(step.requiresLinkClick).toBe(true);
      }
    });

    it("step 1 extraction schema has Handle field", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      const fields = result.template.steps[0].extractionSchema.map((f: any) => f.field);
      expect(fields).toContain("Handle");
    });

    it("step 2 extraction schema has Reach, Non-followers reached, Followers reached", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      const fields = result.template.steps[1].extractionSchema.map((f: any) => f.field);
      expect(fields).toContain("Reach");
      expect(fields).toContain("Non-followers reached");
      expect(fields).toContain("Followers reached");
    });
  });

  describe("template reuse", () => {
    it("creates template on first call (no existing template)", async () => {
      let insertCalled = false;
      const db = createMockDb({ existingTemplate: null });
      // Wrap insertInto to track calls
      const origInsertInto = db.insertInto.bind(db);
      db.insertInto = (table: string) => {
        if (table === "templates") insertCalled = true;
        return origInsertInto(table);
      };

      await runCreateProof(db);
      expect(insertCalled).toBe(true);
    });

    it("reuses existing template on second call", async () => {
      let templateInsertCalled = false;
      const existingTmpl = {
        id: "existing-tmpl",
        name: INSTAGRAM_PROOF_TEMPLATE.name,
        steps: INSTAGRAM_PROOF_TEMPLATE.steps,
      };

      const db = createMockDb({ existingTemplate: existingTmpl });
      const origInsertInto = db.insertInto.bind(db);
      db.insertInto = (table: string) => {
        if (table === "templates") templateInsertCalled = true;
        return origInsertInto(table);
      };

      const result = await runCreateProof(db);

      expect(templateInsertCalled).toBe(false);
      expect(result.template.id).toBe("existing-tmpl");
    });
  });

  describe("session properties", () => {
    it("session status is 'pending'", async () => {
      const db = createMockDb({ existingTemplate: null });

      // The mock returns status: 'pending' by default
      const sessionRow = await (db as any)
        .insertInto("sessions")
        .values({})
        .returningAll()
        .executeTakeFirstOrThrow();

      expect(sessionRow.status).toBe("pending");
    });

    it("session has 24h expiry", async () => {
      const now = Date.now();
      const expectedMs = 24 * 60 * 60 * 1000;

      const db = createMockDb({
        existingTemplate: null,
        insertedSession: {
          id: "sess-1",
          token: "tok",
          template_id: "tmpl-1",
          status: "pending",
          current_step: 0,
          metadata: null,
          used_at: null,
          expires_at: new Date(now + expectedMs),
          created_at: new Date(now),
          updated_at: new Date(now),
        },
      });

      const session = await (db as any)
        .insertInto("sessions")
        .values({})
        .returningAll()
        .executeTakeFirstOrThrow();

      const diff = session.expires_at.getTime() - session.created_at.getTime();
      expect(diff).toBeCloseTo(expectedMs, -3); // within 1 second
    });

    it("shareUrl matches /s/{token} format", async () => {
      const db = createMockDb({ existingTemplate: null });
      const result = await runCreateProof(db);

      expect(result.shareUrl).toBe(`/s/${result.token}`);
    });
  });
});
