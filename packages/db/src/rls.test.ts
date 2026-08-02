/**
 * RLS verification.
 *
 * Enforcement is layered: the shared query layer scopes every read/write by
 * user_id (primary, since the server connects directly as the app role),
 * and RLS blocks anything that reaches Postgres carrying an end-user JWT —
 * Supabase's anon key, PostgREST, or a future direct-from-browser path.
 *
 * These run on PGlite (real Postgres in WASM) using the same policies and
 * the same auth.uid() shim the migration installs, so behavior matches a
 * Supabase deployment.
 */
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

let client: PGlite;

/** Run as the unprivileged end-user role with a JWT claim set, as Supabase does. */
async function asUser(userId: string, sql: string): Promise<unknown[]> {
  const result = await client.exec(`
    SET LOCAL ROLE app_user;
    SELECT set_config('request.jwt.claims', '{"sub":"${userId}"}', true);
    ${sql}
  `);
  return (result[result.length - 1]?.rows ?? []) as unknown[];
}

beforeAll(async () => {
  client = new PGlite();

  // Mirror the migration: auth schema + auth.uid() shim.
  await client.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $body$
      SELECT nullif(
        coalesce(
          current_setting('request.jwt.claim.sub', true),
          (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
        ), ''
      )::uuid
    $body$;

    CREATE TABLE alert_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      name text NOT NULL,
      enabled boolean NOT NULL DEFAULT true
    );
    CREATE TABLE user_watchlists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      kind text NOT NULL,
      ref_id text NOT NULL
    );

    ALTER TABLE alert_rules ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_watchlists ENABLE ROW LEVEL SECURITY;
    CREATE POLICY alert_rules_owner ON alert_rules
      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
    CREATE POLICY user_watchlists_owner ON user_watchlists
      FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public, auth TO app_user;
    GRANT EXECUTE ON FUNCTION auth.uid() TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON alert_rules, user_watchlists TO app_user;

    INSERT INTO alert_rules (user_id, name) VALUES
      ('${USER_A}', 'A rule one'), ('${USER_A}', 'A rule two'), ('${USER_B}', 'B secret rule');
    INSERT INTO user_watchlists (user_id, kind, ref_id) VALUES
      ('${USER_A}', 'company', 'ZZAAA'), ('${USER_B}', 'company', 'ZZBBB');
  `);
});

describe("RLS on user tables", () => {
  it("user A sees only their own alert rules", async () => {
    const rows = (await asUser(USER_A, "SELECT name FROM alert_rules ORDER BY name;")) as Array<{
      name: string;
    }>;
    expect(rows.map((r) => r.name)).toEqual(["A rule one", "A rule two"]);
  });

  it("user A cannot read user B's rules — the core isolation guarantee", async () => {
    const rows = await asUser(USER_A, `SELECT name FROM alert_rules WHERE user_id = '${USER_B}';`);
    expect(rows).toHaveLength(0);
  });

  it("user B sees only their own row", async () => {
    const rows = (await asUser(USER_B, "SELECT name FROM alert_rules;")) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(["B secret rule"]);
  });

  it("a session with no JWT claim sees nothing", async () => {
    const result = await client.exec(`
      SET LOCAL ROLE app_user;
      SELECT set_config('request.jwt.claims', '', true);
      SELECT name FROM alert_rules;
    `);
    expect(result[result.length - 1]?.rows ?? []).toHaveLength(0);
  });

  it("WITH CHECK blocks writing rows owned by someone else", async () => {
    await expect(
      asUser(USER_A, `INSERT INTO alert_rules (user_id, name) VALUES ('${USER_B}', 'forged');`),
    ).rejects.toThrow(/row-level security/i);
  });

  it("user A cannot update or delete user B's rules", async () => {
    await asUser(USER_A, `UPDATE alert_rules SET name = 'hijacked' WHERE user_id = '${USER_B}';`);
    await asUser(USER_A, `DELETE FROM alert_rules WHERE user_id = '${USER_B}';`);
    // B's row is untouched.
    const rows = (await asUser(USER_B, "SELECT name FROM alert_rules;")) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(["B secret rule"]);
  });

  it("watchlists are isolated the same way", async () => {
    const a = (await asUser(USER_A, "SELECT ref_id FROM user_watchlists;")) as Array<{
      ref_id: string;
    }>;
    expect(a.map((r) => r.ref_id)).toEqual(["ZZAAA"]);
    const b = (await asUser(USER_B, "SELECT ref_id FROM user_watchlists;")) as Array<{
      ref_id: string;
    }>;
    expect(b.map((r) => r.ref_id)).toEqual(["ZZBBB"]);
  });
});
