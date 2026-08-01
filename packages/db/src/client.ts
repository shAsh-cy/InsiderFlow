import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseHandle {
  db: Database;
  /** Close the underlying connection. Always call when done (worker invocation end, script exit). */
  end: () => Promise<void>;
}

/**
 * Create a short-lived Drizzle client. Call per request / per worker
 * invocation and `end()` it afterwards — never keep a persistent connection.
 *
 * postgres.js runs on Node and Cloudflare Workers (via cloudflare:sockets).
 * `prepare: false` is required for Supabase's transaction-mode pooler;
 * `max: 1` because callers are short-lived and sequential.
 */
export function createDbHandle(connectionString: string): DatabaseHandle {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const client = postgres(connectionString, { prepare: false, max: 1 });
  return {
    db: drizzle(client, { schema }),
    end: () => client.end({ timeout: 5 }),
  };
}

/** Convenience for contexts that never explicitly close (e.g. serverless with pooler). */
export function createDb(connectionString: string): Database {
  return createDbHandle(connectionString).db;
}
