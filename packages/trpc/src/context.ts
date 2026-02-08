import { db, type DB } from "@screenshare-guide/db";

export interface Context {
  db: DB;
  apiKey: string | undefined;
}

/**
 * Creates context for each tRPC request.
 * Called for each incoming request by the fetch adapter.
 *
 * The fetch adapter passes `{ req, resHeaders, info }`.
 * We extract the API key from the Authorization header.
 */
export function createContext(
  opts?: { req?: Request } | undefined
): Context {
  // Extract API key from: Authorization: Bearer <key>
  const authHeader = opts?.req?.headers?.get?.("authorization");
  const apiKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;

  return {
    db,
    apiKey,
  };
}
