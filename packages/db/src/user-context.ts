/**
 * Database-enforced user scoping.
 *
 * WHY THIS EXISTS. Row-level security was enabled on the four user tables and
 * did nothing: `FORCE ROW LEVEL SECURITY` was not set, and the application
 * connected as a superuser, which bypasses RLS entirely. A pre-release audit
 * found the bootstrap script certifying that inert control as passing — worse
 * than no check, because it stops anyone looking again.
 *
 * The fix has three parts and needs all three:
 *
 *   1. Policies keyed on `current_setting('app.user_id')` rather than on
 *      Supabase's `auth.uid()`. The server talks to Postgres directly with no
 *      end-user JWT anywhere in the connection, so a JWT-derived predicate
 *      could never match — it was guarding a path that does not exist.
 *   2. `FORCE ROW LEVEL SECURITY`, so the table owner is subject to its own
 *      policies.
 *   3. A dedicated NOBYPASSRLS application role. Without it (1) and (2) are
 *      decoration: a superuser ignores both.
 *
 * The helpers below supply the GUC. `set_config(..., true)` is transaction-
 * local, which also makes it safe behind Supabase's transaction pooler: the
 * setting cannot leak to the next borrower of the connection because the
 * transaction that set it has ended.
 *
 * The query layer still filters by `user_id` on every statement. That remains
 * the PRIMARY control and is not redundant — this is the layer that catches
 * the day someone forgets.
 */
import { sql } from "drizzle-orm";

import type { Database } from "./client";

/**
 * A transaction handle. Structurally the same query API as `Database`, which
 * is why callers can hand it to the ordinary query helpers.
 */
export type ScopedDb = Database;

/** Postgres GUC names. Namespaced so they cannot collide with a real setting. */
export const USER_ID_SETTING = "app.user_id";
export const CAPABILITY_SETTING = "app.capability";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Set a transaction-local GUC.
 *
 * The value is bound as a parameter, so it cannot be injected. A malformed
 * user id would simply fail the `::uuid` cast inside the policy function,
 * which returns NULL and therefore matches no rows — the safe direction.
 */
export async function setLocalSetting(
  tx: ScopedDb,
  name: string,
  value: string | null,
): Promise<void> {
  await tx.execute(sql`select set_config(${name}, ${value ?? ""}, true)`);
}

/**
 * Run `fn` in a transaction where RLS can see who is asking.
 *
 * Every user-table read and write goes through here. Outside it the policies
 * find no `app.user_id`, and a connection using the application role sees
 * nothing at all — which is precisely the guarantee bootstrap now proves.
 */
export async function withUserContext<T>(
  db: Database,
  userId: string,
  fn: (tx: ScopedDb) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    // Fail loudly rather than opening a transaction that can never match.
    // A non-UUID here means an id came from somewhere it should not have.
    throw new Error("withUserContext requires a UUID user id");
  }
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as ScopedDb;
    await setLocalSetting(scoped, USER_ID_SETTING, userId);
    return fn(scoped);
  });
}

/** The NOBYPASSRLS role the migration creates. Must match `0009_rls_enforced.sql`. */
export const APP_ROLE = "insiderflow_app";

/**
 * `withUserContext`, for a connection that is NOT already the app role.
 *
 * ── THE OVER-READ THIS EXISTS TO CLOSE ────────────────────────────────
 *
 * The web app connects as `insiderflow_app` and RLS applies to it. The
 * BACKGROUND JOBS do not: the scanner, the digest runner and the backfill
 * all open the admin connection, because they legitimately own tables no
 * user owns — the ingestion cursor, the delivery lease, `alerts_log`.
 *
 * That connection is the table owner and, on Supabase, `postgres` is
 * BYPASSRLS as well. So when the scanner read `alert_rules` to match new
 * trades, every policy in `0009_rls_enforced.sql` was simply skipped and
 * the read returned every user's rules and every user's channel
 * destinations. Nothing was leaked OUT of the process — the query layer
 * scoped what it did next — but the database was not the thing enforcing
 * it, and "the query layer remembered" is precisely the guarantee RLS
 * exists to replace.
 *
 * `SET LOCAL ROLE` drops the transaction to the app role, so the policies
 * apply to the very next statement. LOCAL, not SESSION: it ends with the
 * transaction, which is what makes it safe behind Supabase's transaction
 * pooler where the connection is handed to somebody else immediately
 * afterwards. A session-level `SET ROLE` there is a bug that only appears
 * under load.
 *
 * The role switch is reversible by definition — an admin connection may
 * always `SET ROLE` back — so this is not a sandbox against hostile code
 * in the same process. It is the control that makes the DATABASE the thing
 * deciding which rows a background job may see, rather than the job.
 */
export async function withUserContextAsApp<T>(
  db: Database,
  userId: string,
  fn: (tx: ScopedDb) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(userId)) {
    throw new Error("withUserContextAsApp requires a UUID user id");
  }
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as ScopedDb;
    // Order matters: assume the role FIRST, so that if anything below
    // throws, no statement has run with owner privileges and the GUC set.
    await scoped.execute(sql.raw(`SET LOCAL ROLE ${APP_ROLE}`));
    await setLocalSetting(scoped, USER_ID_SETTING, userId);
    return fn(scoped);
  });
}

/**
 * Run `fn` in a transaction authorised by a bearer capability instead of a
 * session — the Telegram `/start <token>` link and one-click email
 * unsubscribe, both of which arrive with no user id by design.
 *
 * The policy compares the token against the row's own `link_token` /
 * `unsubscribe_token`, so the DATABASE decides which single row is reachable.
 * That is a stronger statement than the query layer alone could make: even a
 * mistaken `update ... where true` inside this block can only touch the row
 * whose 192-bit token the caller already possessed.
 */
export async function withCapability<T>(
  db: Database,
  token: string,
  fn: (tx: ScopedDb) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const scoped = tx as unknown as ScopedDb;
    await setLocalSetting(scoped, CAPABILITY_SETTING, token);
    return fn(scoped);
  });
}
