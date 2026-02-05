import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, createContext } from "@screenshare-guide/trpc";
import type { Context } from "elysia";

/**
 * Elysia handler that bridges to tRPC's fetch adapter.
 * Handles all /trpc/* routes.
 */
export async function trpcHandler(ctx: Context) {
  const response = await fetchRequestHandler({
    endpoint: "/trpc",
    req: ctx.request,
    router: appRouter,
    createContext,
  });

  return response;
}
