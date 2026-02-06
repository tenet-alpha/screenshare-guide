import { db, type DB } from "@screenshare-guide/db";

export interface Context {
  db: DB;
}

/**
 * Creates context for each tRPC request.
 * Called for each incoming request.
 */
export function createContext(): Context {
  return {
    db,
  };
}
