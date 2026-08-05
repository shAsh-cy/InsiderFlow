import { createDbHandle } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

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
 * Falling back is allowed, because a self-hoster who has not created the role
 * yet should still get a working site — but it is announced, once, rather than
 * silently degrading the security posture. `pnpm db:bootstrap` fails outright
 * in this configuration.
 */
export function getDb(): Database {
  if (!globalStore.__insiderflowDb) {
    const appUrl = process.env.APP_DATABASE_URL;
    const url = appUrl || process.env.DATABASE_URL;
    if (!url) {
      throw new Error("Neither APP_DATABASE_URL nor DATABASE_URL is set");
    }
    if (!appUrl && !globalStore.__insiderflowDbWarned) {
      globalStore.__insiderflowDbWarned = true;
      console.warn(
        JSON.stringify({
          event: "db_admin_fallback",
          detail:
            "APP_DATABASE_URL is not set, so the web app is using the admin DATABASE_URL. " +
            "Row-level security will not be enforced on user tables. " +
            "Run `pnpm db:app-role` and set APP_DATABASE_URL. See docs/auth.md.",
        }),
      );
    }
    globalStore.__insiderflowDb = createDbHandle(url).db;
  }
  return globalStore.__insiderflowDb;
}
