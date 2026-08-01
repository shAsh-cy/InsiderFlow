import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/**
 * Create a Drizzle client. Call lazily (per request / per worker invocation),
 * never at module top level, so builds work without a database.
 *
 * `prepare: false` is required for Supabase's transaction-mode pooler.
 */
export function createDb(connectionString: string): ReturnType<typeof buildDb> {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return buildDb(connectionString);
}

function buildDb(connectionString: string) {
  const client = postgres(connectionString, { prepare: false });
  return drizzle(client, { schema });
}
