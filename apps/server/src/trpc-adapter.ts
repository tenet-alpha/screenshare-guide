import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "@screenshare-guide/trpc";
import type { Context } from "elysia";

/**
 * Elysia handler that bridges to tRPC's fetch adapter.
 * Handles all /trpc/* routes.
 *
 * IMPORTANT: We must copy the Response properties into Elysia's `set`
 * and return the raw body. Returning the Response object directly from
 * an Elysia handler causes the onAfterHandle lifecycle hooks to
 * re-process / double-wrap the body in Elysia ≥1.4, which corrupts
 * the tRPC envelope and makes the client receive malformed data
 * (e.g. `template` becomes `undefined`).
 */
export async function trpcHandler(ctx: Context) {
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: ctx.request,
    router: appRouter,
    createContext,
  });

  // Copy status
  ctx.set.status = response.status;

  // Copy all response headers into Elysia's set.headers
  response.headers.forEach((value, key) => {
    ctx.set.headers[key] = value;
  });

  // Return the raw body text so Elysia passes it through as-is
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
