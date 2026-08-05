/**
 * Give the RLS-bound application role a login.
 *
 *   DATABASE_URL='postgres://<admin>@host/db' APP_DB_PASSWORD='...' \
 *     pnpm --filter @insiderflow/db app-role
 *
 * Migration 0009 creates `insiderflow_app` NOLOGIN and without a password,
 * because a credential committed to a migration is a credential committed to
 * the repository. This script attaches one from the environment, and re-runs
 * idempotently so rotating the password is the same command.
 *
 * The web app connects with this role; the ingestion worker and the analytics
 * jobs keep using the admin URL, because they legitimately read every user's
 * rules to decide what to deliver.
 *
 * Prints the connection string to use, with the password redacted.
 */
import postgres from "postgres";

const adminUrl = process.env.DATABASE_URL;
const password = process.env.APP_DB_PASSWORD;
const roleName = process.env.APP_DB_ROLE ?? "insiderflow_app";

const log = (event, data = {}) =>
  console.log(JSON.stringify({ event, at: new Date().toISOString(), ...data }));

if (!adminUrl) {
  console.error("DATABASE_URL (an admin connection) is required");
  process.exit(1);
}
if (!password) {
  console.error(
    "APP_DB_PASSWORD is required. Generate one with:\n" +
      "  node -e \"console.log(require('crypto').randomBytes(24).toString('base64url'))\"",
  );
  process.exit(1);
}
if (!/^[a-z_][a-z0-9_]*$/.test(roleName)) {
  console.error(`APP_DB_ROLE must be a bare identifier, got: ${roleName}`);
  process.exit(1);
}

const sql = postgres(adminUrl, { prepare: false, max: 1 });

try {
  const existing = await sql`select 1 from pg_roles where rolname = ${roleName}`;
  if (existing.length === 0) {
    // Not expected — 0009 creates it — but a self-hoster may have restored a
    // database from before that migration.
    await sql.unsafe(
      `create role ${roleName} login nosuperuser nobypassrls nocreatedb nocreaterole password ${literal(password)}`,
    );
    log("role_created", { role: roleName });
  } else {
    await sql.unsafe(`alter role ${roleName} login nosuperuser nobypassrls`);
    await sql.unsafe(`alter role ${roleName} password ${literal(password)}`);
    log("role_updated", { role: roleName });
  }

  // Grants are in the migration, but re-applying is harmless and covers a
  // database whose tables were created after 0009 ran.
  const [{ current_database: dbName }] = await sql`select current_database()`;
  await sql.unsafe(`grant connect on database ${quoteIdent(dbName)} to ${roleName}`);
  await sql.unsafe(`grant usage on schema public to ${roleName}`);
  await sql.unsafe(
    `grant select, insert, update, delete on all tables in schema public to ${roleName}`,
  );
  await sql.unsafe(`grant usage, select on all sequences in schema public to ${roleName}`);

  const [check] = await sql`
    select rolsuper, rolbypassrls from pg_roles where rolname = ${roleName}`;
  if (check.rolsuper || check.rolbypassrls) {
    // The entire point of the role is that it cannot ignore RLS.
    log("role_unsafe", { role: roleName, ...check });
    process.exit(1);
  }

  const url = new URL(adminUrl);
  url.username = roleName;
  url.password = "********";
  log("app_role_ok", { role: roleName, connect_as: url.toString() });
} catch (error) {
  log("app_role_failed", { message: error instanceof Error ? error.message : String(error) });
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}

/** Single-quoted SQL string literal. Used only for values Postgres cannot bind. */
function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** Double-quoted SQL identifier. */
function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}
