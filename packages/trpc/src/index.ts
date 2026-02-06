import { router } from "./trpc";
import { templateRouter } from "./routers/template";
import { sessionRouter } from "./routers/session";
import { recordingRouter } from "./routers/recording";

// Re-export tRPC primitives
export { router, publicProcedure, middleware } from "./trpc";

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
