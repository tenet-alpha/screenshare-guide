import { router } from "./trpc";
import { sessionRouter } from "./routers/session";

// Re-export tRPC primitives
export { router, publicProcedure, authenticatedProcedure, middleware } from "./trpc";

// Main app router — session-only (Instagram audience proof)
export const appRouter = router({
  session: sessionRouter,
});

// Export type for client usage
export type AppRouter = typeof appRouter;

// Re-export context
export { createContext, type Context } from "./context";
