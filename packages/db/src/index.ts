import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Re-export schema types
export * from "./schema";

// Database connection
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is required");
}

// For migrations and queries
const queryClient = postgres(connectionString);
export const db = drizzle(queryClient, { schema });

// Export types for use in other packages
export type Database = typeof db;
