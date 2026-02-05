import { db, type Database } from "@screenshare-guide/db";

export interface Context {
  db: Database;
  // Add more context properties as needed (e.g., user, session)
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
