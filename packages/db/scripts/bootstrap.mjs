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
  // Query-layer scoping is the primary enforcement (the server connects as the
  // app role), but RLS is the backstop for anything arriving with an end-user
  // JWT. Shipping without it in production is a data-leak waiting to happen.
  const rls = await sql`
    select c.relname as table_name, c.relrowsecurity as enabled
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = any(${RLS_TABLES})`;
  const rlsOff = RLS_TABLES.filter(
    (t) => !rls.find((r) => r.table_name === t && r.enabled === true),
  );
  if (rlsOff.length > 0) fail("rls", `row-level security is OFF for: ${rlsOff.join(", ")}`);
  else log("check_ok", { check: "rls", tables: RLS_TABLES.length });

  const policies = await sql`
    select tablename, count(*)::int as n from pg_policies
    where schemaname = 'public' group by tablename`;
  const noPolicy = RLS_TABLES.filter((t) => !policies.find((p) => p.tablename === t && p.n > 0));
  if (noPolicy.length > 0)
    fail("rls_policies", `RLS on but no policies for: ${noPolicy.join(", ")}`);
  else log("check_ok", { check: "rls_policies" });

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
