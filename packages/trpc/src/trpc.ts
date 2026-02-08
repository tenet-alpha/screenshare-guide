import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { Context } from "./context";

// Initialize tRPC with context
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

// Export reusable router and procedure helpers
export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

/**
 * Authenticated procedure — requires a valid API key via Authorization header.
 *
 * Behavior:
 * - If `API_KEY` env var is NOT set → dev mode, all requests allowed (backwards compatible)
 * - If `API_KEY` env var IS set → requires `Authorization: Bearer <key>` header
 */
export const authenticatedProcedure = publicProcedure.use(
  async ({ ctx, next }) => {
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
  }
);
