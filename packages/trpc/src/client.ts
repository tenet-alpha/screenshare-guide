import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "./index";

/**
 * Create a tRPC client for use in browser or server environments.
 * @param baseUrl - The base URL of the API server
 */
export function createClient(baseUrl: string) {
  return createTRPCProxyClient<AppRouter>({
    transformer: superjson,
    links: [
      httpBatchLink({
        url: `${baseUrl}/trpc`,
      }),
    ],
  });
}

// Re-export the router type for client usage
export type { AppRouter };
