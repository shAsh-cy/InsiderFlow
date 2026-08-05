/**
 * Bootstrap a production database: run every migration, then VERIFY the
 * result instead of assuming it.
 *
 *   DATABASE_URL='postgres://...pooler...' pnpm --filter @insiderflow/db bootstrap
 *
 * Deliberately does NOT seed. Seed data belongs in local development; a
 * synthetic row in production is a fabricated filing, and this project's whole
 * premise is that the data is real. `--check` skips migrating and only
 * verifies, which is what you want against a database you did not just create.
 *
 * Migrations run through drizzle-kit (`db:migrate`); this script wraps it so
 * a fresh deploy is one command with a pass/fail answer at the end.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import postgres from "postgres";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const checkOnly = process.argv.includes("--check");
/**
 * Acknowledge that RLS enforcement is being taken on trust. There is exactly
 * one legitimate use: a database that has no separate application role yet,
 * mid-migration. It is a flag rather than a default because the failure this
 * check exists to catch — a control that looks enabled and enforces nothing —
 * is invisible without it.
 */
const skipRlsProof = process.argv.includes("--skip-rls-proof");

const log = (event, data = {}) =>
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));

/** Tables the app cannot run without. */
const REQUIRED_TABLES = [
  "companies",
  "insiders",
  "filings",
  "transactions",
  "fx_rates",
  "daily_prices",
  "api_cache",
  "ingestion_state",
  "scanner_state",
  "user_watchlists",
  "alert_rules",
  "alert_channels",
  "alerts_log",
  "cluster_flags",
  "trade_returns",
  "insider_scores",
  "company_anomalies",
  "politicians",
  "politician_trades",
];

/** User-scoped tables that MUST have row-level security on in production. */
const RLS_TABLES = ["user_watchlists", "alert_rules", "alert_channels", "alerts_log"];

if (!checkOnly) {
  log("migrate_start");
  try {
    // Inherit stdio so drizzle-kit's own progress output is visible.
    execFileSync("pnpm", ["exec", "drizzle-kit", "migrate"], {
      cwd: pkgRoot,
      stdio: "inherit",
      env: process.env,
      shell: process.platform === "win32",
    });
    log("migrate_ok");
  } catch (error) {
    log("migrate_failed", { message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  }
}

const sql = postgres(databaseUrl, { prepare: false, max: 1 });
let failures = 0;
const fail = (what, detail) => {
  failures++;
  log("check_failed", { check: what, detail });
};

try {
  // ── Tables ───────────────────────────────────────────────────────────────
  const tables = await sql`
    select table_name from information_schema.tables where table_schema = 'public'`;
  const present = new Set(tables.map((t) => t.table_name));
  const missing = REQUIRED_TABLES.filter((t) => !present.has(t));
  if (missing.length > 0) fail("tables", `missing: ${missing.join(", ")}`);
  else log("check_ok", { check: "tables", count: REQUIRED_TABLES.length });

  // ── Migrations applied ───────────────────────────────────────────────────
  const applied = await sql`
    select count(*)::int as n from drizzle.__drizzle_migrations`.catch(() => [{ n: 0 }]);
  log("check_ok", { check: "migrations", applied: applied[0]?.n ?? 0 });

  // ── RLS ──────────────────────────────────────────────────────────────────
  // This block used to report `check_ok: rls` on the strength of
  // pg_class.relrowsecurity alone. That flag was true while RLS was doing
  // nothing at all: FORCE was off and the app connected as a superuser. A
  // check that certifies an inert control is worse than no check, because it
  // stops anyone from looking again.
  //
  // So the flags below are necessary conditions, and the probe at the end is
  // the actual verdict.
  const rls = await sql`
    select c.relname as table_name,
           c.relrowsecurity as enabled,
           c.relforcerowsecurity as forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(${RLS_TABLES})`;
  const rlsOff = RLS_TABLES.filter(
    (t) => !rls.find((r) => r.table_name === t && r.enabled === true),
  );
  if (rlsOff.length > 0) fail("rls", `row-level security is OFF for: ${rlsOff.join(", ")}`);
  else log("check_ok", { check: "rls", tables: RLS_TABLES.length });

  // Without FORCE, the table owner skips its own policies — and the owner is
  // exactly who a misconfigured deployment connects as.
  const notForced = RLS_TABLES.filter((t) => !rls.find((r) => r.table_name === t && r.forced));
  if (notForced.length > 0)
    fail("rls_forced", `FORCE ROW LEVEL SECURITY is off for: ${notForced.join(", ")}`);
  else log("check_ok", { check: "rls_forced" });

  const policies = await sql`
    select tablename, count(*)::int as n from pg_policies
    where schemaname = 'public' group by tablename`;
  const noPolicy = RLS_TABLES.filter((t) => !policies.find((p) => p.tablename === t && p.n > 0));
  if (noPolicy.length > 0)
    fail("rls_policies", `RLS on but no policies for: ${noPolicy.join(", ")}`);
  else log("check_ok", { check: "rls_policies" });

  // Warn if the admin URL bypasses RLS. It is SUPPOSED to — migrations and the
  // ingestion worker need it — but the web app must never use this URL.
  const [adminRole] = await sql`
    select current_user as name, rolsuper, rolbypassrls
    from pg_roles where rolname = current_user`;
  if (adminRole?.rolsuper || adminRole?.rolbypassrls) {
    log("note", {
      check: "admin_role",
      detail:
        `this connection ("${adminRole.name}") bypasses RLS, which is correct for ` +
        `migrations and the ingestion worker. The WEB APP must connect as the ` +
        `insiderflow_app role instead — see pnpm db:app-role.`,
    });
  }

  // ── RLS enforcement PROOF ────────────────────────────────────────────────
  // Not "is the flag set" but "can a row actually be read without context".
  // Insert a probe as admin, then read it back over APP_DATABASE_URL with no
  // app.user_id set. Anything other than zero rows means RLS is not enforcing.
  const appUrl = process.env.APP_DATABASE_URL;
  if (skipRlsProof) {
    log("warning", {
      check: "rls_enforced",
      detail: "--skip-rls-proof: enforcement was NOT verified, only the catalog flags.",
    });
  } else if (!appUrl) {
    // Loudly unproven, never silently passed.
    fail(
      "rls_not_proven",
      "APP_DATABASE_URL is not set, so RLS enforcement could not be PROVEN — only " +
        "the catalog flags were checked, and those were true while RLS was inert. " +
        "Set APP_DATABASE_URL to the insiderflow_app connection string (pnpm db:app-role) " +
        "and re-run. Pass --skip-rls-proof to acknowledge and continue.",
    );
  } else {
    const probeUser = "00000000-0000-4000-8000-0000000f1a90";
    const appSql = postgres(appUrl, { prepare: false, max: 1 });
    try {
      await sql`delete from user_watchlists where user_id = ${probeUser}`;
      await sql`
        insert into user_watchlists (user_id, kind, ref_id, label, market)
        values (${probeUser}, 'company', 'ZZRLSPROBE', 'RLS enforcement probe', 'US')`;

      const [appRole] = await appSql`
        select current_user as name, rolsuper, rolbypassrls
        from pg_roles where rolname = current_user`;
      if (appRole?.rolsuper || appRole?.rolbypassrls) {
        fail(
          "rls_not_enforced",
          `APP_DATABASE_URL connects as "${appRole.name}", which has ` +
            `${appRole.rolsuper ? "SUPERUSER" : "BYPASSRLS"} and therefore ignores every ` +
            `policy. Use the insiderflow_app role (pnpm db:app-role).`,
        );
      }

      const blind = await appSql`
        select count(*)::int as n from user_watchlists where ref_id = 'ZZRLSPROBE'`;
      if (blind[0].n !== 0) {
        fail(
          "rls_not_enforced",
          `a user row was VISIBLE to the application role with no app.user_id set ` +
            `(${blind[0].n} row(s)). RLS is not protecting anything. Do not ship this.`,
        );
      } else {
        // The mirror image: with the right context the row must appear, or the
        // policies are simply blocking everything and the app is broken.
        const scoped = await appSql.begin(async (tx) => {
          await tx`select set_config('app.user_id', ${probeUser}, true)`;
          return tx`select count(*)::int as n from user_watchlists where ref_id = 'ZZRLSPROBE'`;
        });
        const wrong = await appSql.begin(async (tx) => {
          await tx`select set_config('app.user_id', '00000000-0000-4000-8000-00000000dead', true)`;
          return tx`select count(*)::int as n from user_watchlists where ref_id = 'ZZRLSPROBE'`;
        });
        if (scoped[0].n !== 1) {
          fail(
            "rls_over_restrictive",
            "the probe row was invisible even WITH the correct app.user_id — policies are " +
              "blocking legitimate access, so the app cannot work.",
          );
        } else if (wrong[0].n !== 0) {
          fail("rls_not_enforced", "another user's context could read the probe row.");
        } else {
          log("check_ok", {
            check: "rls_enforced",
            proof: "no context → 0 rows; owner context → 1 row; other user → 0 rows",
            app_role: appRole?.name,
          });
        }
      }
    } finally {
      await appSql.end({ timeout: 5 });
      await sql`delete from user_watchlists where user_id = ${probeUser}`;
    }
  }

  // ── Extensions ───────────────────────────────────────────────────────────
  const ext = await sql`select extname from pg_extension where extname = 'pg_trgm'`;
  if (ext.length === 0) fail("extensions", "pg_trgm is missing (company/insider search needs it)");
  else log("check_ok", { check: "extensions" });

  // ── Scanner seed row ─────────────────────────────────────────────────────
  // Without it the alert scanner's compare-and-set lease matches zero rows and
  // silently never runs.
  const [{ n: scannerRows }] = await sql`
    select count(*)::int as n from scanner_state where name = 'alerts'`;
  if (scannerRows === 0) {
    await sql`insert into scanner_state (name) values ('alerts') on conflict do nothing`;
    log("seeded", { row: "scanner_state.alerts" });
  } else {
    log("check_ok", { check: "scanner_state" });
  }

  // ── Honesty check: no synthetic fixtures in production ────────────────────
  const [{ n: synthetic }] = await sql`
    select count(*)::int as n from companies where ticker like 'ZZ%'`;
  if (synthetic > 0) {
    log("warning", {
      check: "synthetic_data",
      detail: `${synthetic} ZZ* fixture compan${synthetic === 1 ? "y" : "ies"} present. Fine locally; in production run packages/db/scripts/purge-synthetic.sql.`,
    });
  } else {
    log("check_ok", { check: "synthetic_data" });
  }

  if (failures > 0) {
    log("bootstrap_failed", { failures });
    process.exitCode = 1;
  } else {
    log("bootstrap_ok");
  }
} catch (error) {
  log("bootstrap_error", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
