/**
 * Row-level security — verified against the REAL migrations.
 *
 * The previous version of this file built a two-table replica of the schema
 * by hand, enabled RLS on it, and asserted isolation. It passed for months
 * while production RLS enforced nothing at all: `FORCE ROW LEVEL SECURITY`
 * was never set and the app connected as a superuser, so the policies the
 * test "proved" were skipped entirely on the deployed system. The test was
 * not wrong about its own fixture — it was measuring the wrong object.
 *
 * So this file runs `drizzle/*.sql` end to end, then exercises the policies
 * as the `insiderflow_app` role the migration creates: NOBYPASSRLS, not the
 * table owner, exactly as the web app connects. Anything that regresses the
 * DDL — a dropped FORCE, a policy keyed on the wrong function, a role handed
 * BYPASSRLS — fails here.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

let client: PGlite;

/** The four tables whose rows belong to exactly one user. */
const USER_TABLES = ["user_watchlists", "alert_rules", "alert_channels", "alerts_log"];

/**
 * Run SQL the way the web app does: as `insiderflow_app`, inside a
 * transaction, with `app.user_id` set — or deliberately not set.
 *
 * `SET LOCAL ROLE` and `set_config(..., true)` both end with the transaction,
 * so no case can leak context into the next one.
 */
async function asApp(sql: string, settings: Record<string, string> = {}): Promise<unknown[]> {
  const config = Object.entries(settings)
    .map(([k, v]) => `SELECT set_config('${k}', '${v}', true);`)
    .join("\n");
  try {
    const result = await client.exec(`
      BEGIN;
      SET LOCAL ROLE insiderflow_app;
      ${config}
      ${sql}
      COMMIT;
    `);
    // Last statement before COMMIT carries the rows.
    return (result[result.length - 2]?.rows ?? []) as unknown[];
  } catch (error) {
    // A policy violation aborts the transaction. Without this rollback the
    // connection stays poisoned and every later case fails with "current
    // transaction is aborted" — which looks like six broken tests instead of
    // one deliberate rejection.
    await client.exec("ROLLBACK;").catch(() => {});
    throw error;
  }
}

beforeAll(async () => {
  client = new PGlite({ extensions: { pg_trgm } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });

  // Seed as the owner (which is how the scanner and the seed script write).
  await client.exec(`
    INSERT INTO alert_rules (user_id, name) VALUES
      ('${USER_A}', 'A rule one'), ('${USER_A}', 'A rule two'), ('${USER_B}', 'B secret rule');
    INSERT INTO user_watchlists (user_id, kind, ref_id, label) VALUES
      ('${USER_A}', 'company', 'ZZAAA', 'A watch'), ('${USER_B}', 'company', 'ZZBBB', 'B watch');
    INSERT INTO alert_channels (user_id, channel, destination, verified, link_token, unsubscribe_token)
      VALUES
      ('${USER_A}', 'telegram', NULL, false, 'zz-link-token-aaa', NULL),
      ('${USER_B}', 'telegram', NULL, false, 'zz-link-token-bbb', NULL),
      ('${USER_A}', 'email', 'a@example.test', true, NULL, 'zz-unsub-aaa');
  `);
}, 60_000);

afterAll(async () => {
  await client?.close();
});

describe("RLS is actually enforced", () => {
  it("has FORCE ROW LEVEL SECURITY on every user table", async () => {
    // Without FORCE, the table owner skips its own policies — and the owner is
    // who a misconfigured deployment connects as. This flag being off, while
    // relrowsecurity was on, is what made the whole layer decorative.
    const result = await client.query<{ relname: string; enabled: boolean; forced: boolean }>(
      `
      SELECT c.relname, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
      [USER_TABLES],
    );
    expect(result.rows).toHaveLength(USER_TABLES.length);
    for (const row of result.rows) {
      expect({ table: row.relname, enabled: row.enabled, forced: row.forced }).toEqual({
        table: row.relname,
        enabled: true,
        forced: true,
      });
    }
  });

  it("gives the application role no way to bypass policies", async () => {
    // A role with BYPASSRLS makes every policy above cosmetic. This is the
    // single property the audit found missing in production.
    const { rows } = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'insiderflow_app'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
});

describe("user isolation under the app role", () => {
  it("returns only the caller's rows for an UNSCOPED query", async () => {
    // No WHERE clause at all. This is the case the query layer cannot help
    // with, and the reason RLS is worth having: a forgotten predicate now
    // returns the caller's own rows instead of everybody's.
    const rows = (await asApp("SELECT name FROM alert_rules ORDER BY name;", {
      "app.user_id": USER_A,
    })) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(["A rule one", "A rule two"]);
  });

  it("returns nothing when no user context is set", async () => {
    const rows = await asApp("SELECT name FROM alert_rules;");
    expect(rows).toHaveLength(0);
  });

  it("returns nothing for another user's context", async () => {
    const rows = await asApp(`SELECT name FROM alert_rules WHERE user_id = '${USER_B}';`, {
      "app.user_id": USER_A,
    });
    expect(rows).toHaveLength(0);
  });

  it("ignores a malformed user id rather than erroring open", async () => {
    // app_user_id() catches the failed cast and returns NULL, which matches no
    // rows. Failing closed matters more than a clear error message here.
    const rows = await asApp("SELECT name FROM alert_rules;", { "app.user_id": "not-a-uuid" });
    expect(rows).toHaveLength(0);
  });

  it("blocks writing a row owned by someone else", async () => {
    await expect(
      asApp(`INSERT INTO alert_rules (user_id, name) VALUES ('${USER_B}', 'forged');`, {
        "app.user_id": USER_A,
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it("leaves another user's rows untouched by UPDATE and DELETE", async () => {
    await asApp(`UPDATE alert_rules SET name = 'hijacked' WHERE user_id = '${USER_B}';`, {
      "app.user_id": USER_A,
    });
    await asApp(`DELETE FROM alert_rules WHERE user_id = '${USER_B}';`, {
      "app.user_id": USER_A,
    });
    const rows = (await asApp("SELECT name FROM alert_rules;", {
      "app.user_id": USER_B,
    })) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(["B secret rule"]);
  });

  it("isolates watchlists the same way", async () => {
    const a = (await asApp("SELECT ref_id FROM user_watchlists;", {
      "app.user_id": USER_A,
    })) as Array<{ ref_id: string }>;
    expect(a.map((r) => r.ref_id)).toEqual(["ZZAAA"]);
    const b = (await asApp("SELECT ref_id FROM user_watchlists;", {
      "app.user_id": USER_B,
    })) as Array<{ ref_id: string }>;
    expect(b.map((r) => r.ref_id)).toEqual(["ZZBBB"]);
  });

  it("still honours a Supabase JWT claim, for a future direct-from-browser path", async () => {
    const rows = (await asApp("SELECT ref_id FROM user_watchlists;", {
      "request.jwt.claims": `{"sub":"${USER_A}"}`,
    })) as Array<{ ref_id: string }>;
    expect(rows.map((r) => r.ref_id)).toEqual(["ZZAAA"]);
  });
});

describe("capability tokens", () => {
  it("reaches exactly the row holding the token, even with no WHERE clause", async () => {
    // The Telegram webhook has no session. Under app.capability the DATABASE
    // decides which single row is reachable, so this deliberately reckless
    // statement still cannot touch anyone else's channel.
    await asApp(`UPDATE alert_channels SET destination = '999', verified = true;`, {
      "app.capability": "zz-link-token-aaa",
    });
    const { rows } = await client.query<{ user_id: string; destination: string | null }>(
      `SELECT user_id, destination FROM alert_channels WHERE destination = '999'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(USER_A);
  });

  it("reaches nothing when the token is wrong", async () => {
    const before = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alert_channels WHERE destination = '888'`,
    );
    expect(before.rows[0]!.n).toBe(0);
    await asApp(`UPDATE alert_channels SET destination = '888';`, {
      "app.capability": "zz-not-a-real-token",
    });
    const after = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM alert_channels WHERE destination = '888'`,
    );
    expect(after.rows[0]!.n).toBe(0);
  });

  it("does not let a capability read other tables", async () => {
    // The capability policy is scoped to alert_channels UPDATE only. Holding a
    // link token must not turn into a read of that user's rules.
    const rows = await asApp("SELECT name FROM alert_rules;", {
      "app.capability": "zz-link-token-aaa",
    });
    expect(rows).toHaveLength(0);
  });
});
