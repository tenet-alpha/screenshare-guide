import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { templateRouter } from "./routers/template";
import { sessionRouter } from "./routers/session";
import { recordingRouter } from "./routers/recording";
import type { Context } from "./context";

// Initialize tRPC with context
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

// Export reusable router and procedure helpers
export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

// Main app router combining all sub-routers
export const appRouter = router({
  template: templateRouter,
  session: sessionRouter,
  recording: recordingRouter,
});

// Export type for client usage
export type AppRouter = typeof appRouter;

// Re-export context
export { createContext, type Context } from "./context";
