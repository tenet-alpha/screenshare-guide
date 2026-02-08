import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

/**
 * Authentication tests for the tRPC API key middleware.
 *
 * Tests the authenticatedProcedure middleware logic:
 * - Rejects requests without API key when API_KEY is configured
 * - Rejects requests with wrong API key
 * - Allows requests with valid API key
 * - Dev mode: allows all when API_KEY is not set
 * - Public routes remain accessible regardless
 *
 * Uses a standalone tRPC router that mirrors the real middleware logic
 * to avoid needing a DATABASE_URL / real DB connection.
 */

// ── Recreate the auth middleware exactly as in trpc.ts ──────────────

interface TestContext {
  apiKey: string | undefined;
}

const t = initTRPC.context<TestContext>().create({ transformer: superjson });

const publicProcedure = t.procedure;

const authenticatedProcedure = publicProcedure.use(async ({ ctx, next }) => {
  const apiKey = ctx.apiKey;
  const expectedKey = process.env.API_KEY;

  if (!expectedKey) {
    // API_KEY not configured — allow all (dev mode)
    return next();
  }

  if (!apiKey || apiKey !== expectedKey) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid API key",
    });
  }

  return next();
});

// ── Test router mimicking real routes ───────────────────────────────

const testRouter = t.router({
  session: t.router({
    // Authenticated route (like createProof)
    createProof: authenticatedProcedure.mutation(async () => {
      return { ok: true, sessionId: "test-session" };
    }),

    // Public routes (like getByToken, getUploadUrl)
    getByToken: publicProcedure
      .input((v) => v as { token: string })
      .query(async ({ input }) => {
        return { token: (input as { token: string }).token, found: false };
      }),

    getUploadUrl: publicProcedure
      .input((v) => v as { sessionId: string })
      .mutation(async () => {
        return null; // No Azure config
      }),
  }),
});

// ── Helpers ─────────────────────────────────────────────────────────

const ENDPOINT = "http://localhost:3001/trpc";

function createContextFromRequest(req: Request): TestContext {
  const authHeader = req.headers.get("authorization");
  const apiKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;
  return { apiKey };
}

async function trpcRequest(
  path: string,
  opts: {
    method?: "GET" | "POST";
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
) {
  const method = opts.method ?? "POST";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...opts.headers,
  };

  const request = new Request(`${ENDPOINT}/${path}`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(opts.body ?? {}) : undefined,
  });

  return fetchRequestHandler({
    endpoint: "/trpc",
    req: request,
    router: testRouter,
    createContext: ({ req }) => createContextFromRequest(req),
  });
}

async function parseResponse(response: Response) {
  const body = await response.json();
  return Array.isArray(body) ? body[0] : body;
}

function isUnauthorized(envelope: any): boolean {
  return (
    envelope?.error?.data?.code === "UNAUTHORIZED" ||
    envelope?.error?.json?.data?.code === "UNAUTHORIZED"
  );
}

function isSuccess(envelope: any): boolean {
  return envelope?.result?.data !== undefined;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("API key authentication", () => {
  const originalApiKey = process.env.API_KEY;

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.API_KEY = originalApiKey;
    } else {
      delete process.env.API_KEY;
    }
  });

  describe("when API_KEY env var is set", () => {
    beforeEach(() => {
      process.env.API_KEY = "test-secret-key-12345";
    });

    it("createProof succeeds with valid API key", async () => {
      const response = await trpcRequest("session.createProof", {
        headers: { Authorization: "Bearer test-secret-key-12345" },
      });
      const envelope = await parseResponse(response);

      expect(isSuccess(envelope)).toBe(true);
      expect(isUnauthorized(envelope)).toBe(false);
    });

    it("createProof returns UNAUTHORIZED without API key", async () => {
      const response = await trpcRequest("session.createProof");
      const envelope = await parseResponse(response);

      expect(isUnauthorized(envelope)).toBe(true);
    });

    it("createProof returns UNAUTHORIZED with wrong API key", async () => {
      const response = await trpcRequest("session.createProof", {
        headers: { Authorization: "Bearer wrong-key-xyz" },
      });
      const envelope = await parseResponse(response);

      expect(isUnauthorized(envelope)).toBe(true);
    });
  });

  describe("when API_KEY env var is NOT set (dev mode)", () => {
    beforeEach(() => {
      delete process.env.API_KEY;
    });

    it("createProof succeeds without API key", async () => {
      const response = await trpcRequest("session.createProof");
      const envelope = await parseResponse(response);

      expect(isSuccess(envelope)).toBe(true);
      expect(isUnauthorized(envelope)).toBe(false);
    });
  });

  describe("public routes remain accessible without auth", () => {
    beforeEach(() => {
      process.env.API_KEY = "test-secret-key-12345";
    });

    it("getByToken works without API key", async () => {
      const response = await trpcRequest(
        "session.getByToken?input=" +
          encodeURIComponent(
            superjson.stringify({ token: "nonexistent" })
          ),
        { method: "GET" }
      );
      const envelope = await parseResponse(response);

      // Should NOT be UNAUTHORIZED
      expect(isUnauthorized(envelope)).toBe(false);
    });

    it("getUploadUrl works without API key", async () => {
      const response = await trpcRequest("session.getUploadUrl", {
        body: superjson.serialize({
          sessionId: "00000000-0000-0000-0000-000000000000",
        }),
      });
      const envelope = await parseResponse(response);

      // Should NOT be UNAUTHORIZED
      expect(isUnauthorized(envelope)).toBe(false);
    });
  });
});
