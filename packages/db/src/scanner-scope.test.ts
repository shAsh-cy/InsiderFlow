import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * THE BACKGROUND JOBS' OVER-READ, AND THE PATTERN THAT CLOSES IT.
 *
 * `rls.test.ts` proves the policies work for the WEB APP, which connects
 * as `insiderflow_app`. This file is about the other caller: the alert
 * scanner, the digest runner and the backfill all open the ADMIN
 * connection, because they own tables no user owns — the ingestion cursor,
 * the delivery lease, `alerts_log`.
 *
 * On that connection the policies did nothing. The role is the table owner
 * and, on Supabase, `postgres` is BYPASSRLS as well — so
 * `select().from(alert_rules)` returned every user's rules and, from
 * `alert_channels`, every user's Telegram chat id, email address and
 * capability tokens. The query layer scoped what happened next, so nothing
 * left the process. But "the application remembered to filter" is exactly
 * the guarantee row-level security exists to replace.
 *
 * The fix is `withUserContextAsApp`: `SET LOCAL ROLE insiderflow_app` plus
 * `set_config('app.user_id', …, true)`, both transaction-scoped so neither
 * can outlive the transaction — which is what makes it safe behind
 * Supabase's transaction pooler, where the connection goes straight to the
 * next borrower. A session-level `SET ROLE` there is a bug that only
 * appears under load.
 *
 * Everything below runs the REAL migrations. A policy dropped, a FORCE
 * removed, or the role handed BYPASSRLS fails here.
 *
 * ── WHAT THIS CANNOT PROVE ────────────────────────────────────────────
 *
 * PGlite is Postgres, and roles, policies, FORCE and GUCs all behave the
 * same. What it is not is SUPABASE: the hosted `postgres` role's exact
 * attributes and the 6543 transaction pooler are theirs, not ours. The
 * deploy-time re-verification is recorded in DEPLOYMENT_STATE.md so it
 * cannot be skipped.
 */

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

let client: PGlite;

/** Exactly what `withUserContextAsApp` emits, run against the real schema. */
async function asScannerFor(userId: string | null, sql: string): Promise<unknown[]> {
  const context = userId === null ? "" : `SELECT set_config('app.user_id', '${userId}', true);`;
  try {
    const result = await client.exec(`
      BEGIN;
      SET LOCAL ROLE insiderflow_app;
      ${context}
      ${sql}
      COMMIT;
    `);
    return (result[result.length - 2]?.rows ?? []) as unknown[];
  } catch (error) {
    await client.exec("ROLLBACK;").catch(() => {});
    throw error;
  }
}

/** The unscoped read the scanner used to do: admin connection, no context. */
async function asAdmin(sql: string): Promise<unknown[]> {
  const result = await client.exec(sql);
  return (result[result.length - 1]?.rows ?? []) as unknown[];
}

beforeAll(async () => {
  client = new PGlite({ extensions: { pg_trgm } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  await migrate(drizzle(client), { migrationsFolder });
  await client.exec(`
    INSERT INTO alert_rules (user_id, name, enabled) VALUES
      ('${USER_A}', 'A rule one', true),
      ('${USER_A}', 'A rule two', true),
      ('${USER_B}', 'B secret rule', true);
    INSERT INTO alert_channels (user_id, channel, destination, verified, timezone) VALUES
      ('${USER_A}', 'telegram', 'chat-for-a', true, 'Europe/London'),
      ('${USER_B}', 'telegram', 'chat-for-b', true, 'Asia/Kolkata');
  `);
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("the scanner's rule read", () => {
  it("returns ONLY the target user's rows", async () => {
    const rows = (await asScannerFor(
      USER_A,
      "SELECT name FROM alert_rules WHERE enabled = true;",
    )) as Array<{ name: string }>;
    expect(rows.map((r) => r.name).sort()).toEqual(["A rule one", "A rule two"]);
    expect(
      rows.map((r) => r.name),
      "user B's rule name must not be visible to a scan scoped to user A",
    ).not.toContain("B secret rule");
  });

  it("returns ZERO rows when app.user_id is unset", async () => {
    // The property the whole design rests on: forgetting the context fails
    // CLOSED. `user_id = NULL` is NULL, which matches nothing.
    const rows = await asScannerFor(null, "SELECT name FROM alert_rules WHERE enabled = true;");
    expect(rows).toEqual([]);
  });

  it("returns ZERO rows for a user id that owns nothing", async () => {
    const rows = await asScannerFor(
      "33333333-3333-4333-8333-333333333333",
      "SELECT name FROM alert_rules;",
    );
    expect(rows).toEqual([]);
  });

  it("scopes alert_channels too, which is where the destinations live", async () => {
    const rows = (await asScannerFor(
      USER_A,
      "SELECT destination, timezone FROM alert_channels;",
    )) as Array<{ destination: string; timezone: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.timezone).toBe("Europe/London");
    expect(
      rows.map((r) => r.destination),
      "a Telegram chat id is a delivery address for someone else's alerts",
    ).not.toContain("chat-for-b");
  });
});

describe("the over-read this replaced", () => {
  it("is real: the admin connection still sees every user's rows", async () => {
    // Not a regression — this is the CONTROL. It shows the policies are not
    // what stopped the scanner before, so the scoped reads above are doing
    // the work rather than passing because the data happened to be narrow.
    const rows = (await asAdmin("SELECT name FROM alert_rules;")) as Array<{ name: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.name)).toContain("B secret rule");
  });

  it("and the app role is NOBYPASSRLS, so the scoping cannot be skipped", async () => {
    const rows = (await asAdmin(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'insiderflow_app';",
    )) as Array<{ rolbypassrls: boolean; rolsuper: boolean }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
  });
});

describe("the context is transaction-scoped, which is what makes it pooler-safe", () => {
  it("does not leak app.user_id to the next transaction on the same connection", async () => {
    await asScannerFor(USER_A, "SELECT name FROM alert_rules;");
    // A new transaction on the SAME connection, with no context set. If
    // `set_config(..., true)` were `false`, or a session-level SET ROLE had
    // been used, user A's rows would still be visible here — and behind a
    // transaction pooler that connection now belongs to somebody else.
    const rows = await asScannerFor(null, "SELECT name FROM alert_rules;");
    expect(rows, "context leaked past the transaction that set it").toEqual([]);
  });

  it("does not leave the connection stuck as the app role", async () => {
    await asScannerFor(USER_A, "SELECT name FROM alert_rules;");
    const rows = (await asAdmin("SELECT current_user AS who;")) as Array<{ who: string }>;
    expect(rows[0]?.who, "SET LOCAL ROLE must end with its transaction").not.toBe(
      "insiderflow_app",
    );
  });
});
