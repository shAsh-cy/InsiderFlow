import { createDbHandle } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import { formatVerdict, resolveDbEnv } from "./db-env";

// One connection per serverless instance, reused across warm invocations
// (and across HMR in dev). The Supabase transaction pooler multiplexes it.
const globalStore = globalThis as unknown as {
  __insiderflowDb?: Database;
  __insiderflowDbWarned?: boolean;
};

/**
 * The web app's database connection.
 *
 * Prefers APP_DATABASE_URL — the `insiderflow_app` role, which has
 * NOBYPASSRLS, so the row-level-security policies on the user tables apply to
 * every request this process makes. DATABASE_URL is the admin connection used
 * by migrations and the ingestion jobs; on most deployments it is a superuser
 * and ignores every policy.
 *
 * ── WHY THE FALLBACK IS FATAL IN PRODUCTION AND NOT BELOW IT ──────────
 *
 * This used to warn everywhere. A warning is the right answer for a
 * self-hoster who has not created the role yet: the site works, the posture is
 * announced once, and nothing is silently degraded. It is the WRONG answer for
 * a deployment, and the reason is that the failure is invisible from outside.
 * Every query in this app also filters by user id in its WHERE clause, so with
 * RLS skipped the product behaves identically — right up until one query
 * somewhere forgets, and then it returns every user's rows with no error, no
 * log line and no test failure. A control whose absence changes nothing
 * observable has to be checked at boot or it is not checked at all.
 *
 * `resolveDbEnv` decides; see db-env.ts for what counts as production and for
 * the two ways APP_DATABASE_URL can be set and still be inert.
 */
export function getDb(): Database {
  if (!globalStore.__insiderflowDb) {
    const verdict = resolveDbEnv(process.env);

    if (verdict.level === "fatal" || !verdict.url) {
      // Thrown rather than logged: a request served from an unprotected
      // connection is the outcome this exists to prevent, so there is no
      // degraded answer to return.
      throw new Error(formatVerdict(verdict));
    }

    if (verdict.level === "warn" && !globalStore.__insiderflowDbWarned) {
      globalStore.__insiderflowDbWarned = true;
      console.warn(formatVerdict(verdict));
    }

    globalStore.__insiderflowDb = createDbHandle(verdict.url).db;
  }
  return globalStore.__insiderflowDb;
}
