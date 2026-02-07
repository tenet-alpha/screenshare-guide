import { describe, it, expect } from "bun:test";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { initTRPC } from "@trpc/server";
import superjson from "superjson";

/**
 * Tests the EXACT tRPC serialization round-trip to prove whether
 * template is present in the response. This reproduces the production
 * environment: superjson transformer, fetchRequestHandler, httpBatchLink format.
 */

const t = initTRPC.create({ transformer: superjson });

const testRouter = t.router({
  session: t.router({
    createProof: t.procedure.mutation(async () => {
      return {
        shareUrl: "/s/abc123",
        token: "abc123",
        sessionId: "some-uuid",
        template: {
          id: "tmpl-uuid",
          name: "Instagram Audience Proof",
          steps: [
            { instruction: "Open Meta Business Suite", successCriteria: "Visible", hints: [] },
            { instruction: "Navigate to Insights", successCriteria: "Done", hints: [] },
            { instruction: "Capture metrics", successCriteria: "Found", hints: [] },
          ],
        },
      };
    }),
  }),
});

describe("tRPC + superjson round-trip", () => {
  it("template field survives fetchRequestHandler serialization", async () => {
    const request = new Request(
      "http://localhost:3001/trpc/session.createProof",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );

    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: request,
      router: testRouter,
      createContext: () => ({}),
    });

    expect(response.status).toBe(200);

    const body = await response.json();
    // tRPC batch format: response is an array
    const resultEnvelope = Array.isArray(body) ? body[0] : body;

    expect(resultEnvelope.result).toBeDefined();
    expect(resultEnvelope.result.data).toBeDefined();

    // The data field is a superjson envelope: { json: ..., meta?: ... }
    const superjsonEnvelope = resultEnvelope.result.data;
    expect(superjsonEnvelope.json).toBeDefined();

    // Check that template is present in the raw JSON
    expect(superjsonEnvelope.json.template).toBeDefined();
    expect(superjsonEnvelope.json.template.id).toBe("tmpl-uuid");
    expect(superjsonEnvelope.json.template.name).toBe("Instagram Audience Proof");
    expect(superjsonEnvelope.json.template.steps).toHaveLength(3);

    // Now deserialize exactly as the client would
    const deserialized = superjson.deserialize(superjsonEnvelope) as any;
    expect(deserialized.template).toBeDefined();
    expect(deserialized.template.id).toBe("tmpl-uuid");
    expect(deserialized.template.steps).toHaveLength(3);
    expect(deserialized.template.steps[0].instruction).toBe("Open Meta Business Suite");
  });

  it("template.steps is an array after deserialization, not a string", async () => {
    const request = new Request(
      "http://localhost:3001/trpc/session.createProof",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );

    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: request,
      router: testRouter,
      createContext: () => ({}),
    });

    const body = await response.json();
    const envelope = (Array.isArray(body) ? body[0] : body).result.data;
    const data = superjson.deserialize(envelope) as any;

    expect(Array.isArray(data.template.steps)).toBe(true);
    expect(typeof data.template.steps).not.toBe("string");
  });

  it("template with JSON.parse-d steps survives round-trip", async () => {
    // Test what happens when steps come from JSON.parse (Kysely JSONB string)
    const routerWithParsedSteps = t.router({
      session: t.router({
        createProof: t.procedure.mutation(async () => {
          const stepsFromDb = JSON.stringify([
            { instruction: "Step 1", successCriteria: "Done" },
          ]);
          return {
            shareUrl: "/s/tok",
            token: "tok",
            sessionId: "sid",
            template: {
              id: "tid",
              name: "Test",
              steps:
                typeof stepsFromDb === "string"
                  ? JSON.parse(stepsFromDb)
                  : stepsFromDb,
            },
          };
        }),
      }),
    });

    const request = new Request(
      "http://localhost:3001/trpc/session.createProof",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }
    );

    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: request,
      router: routerWithParsedSteps,
      createContext: () => ({}),
    });

    const body = await response.json();
    const envelope = (Array.isArray(body) ? body[0] : body).result.data;
    const data = superjson.deserialize(envelope) as any;

    expect(data.template).toBeDefined();
    expect(Array.isArray(data.template.steps)).toBe(true);
    expect(data.template.steps[0].instruction).toBe("Step 1");
  });
});
