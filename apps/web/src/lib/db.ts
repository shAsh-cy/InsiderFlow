import { createDbHandle } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

// One connection per serverless instance, reused across warm invocations
// (and across HMR in dev). The Supabase transaction pooler multiplexes it.
const globalStore = globalThis as unknown as { __insiderflowDb?: Database };

export function getDb(): Database {
  if (!globalStore.__insiderflowDb) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    globalStore.__insiderflowDb = createDbHandle(url).db;
  }
  return globalStore.__insiderflowDb;
}
