import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { Database } from "./schema";

// Re-export schema types
export * from "./schema";

// Database connection
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

const dialect = new PostgresDialect({
  pool: new pg.Pool({
    connectionString,
  }),
});

export const db = new Kysely<Database>({ dialect });

// Export the typed database type for use in context
export type DB = Kysely<Database>;
