/**
 * Touch the database so Supabase does not pause the project.
 *
 * Free Supabase projects pause after 7 consecutive idle days and then answer
 * with HTTP 540 until restored by hand. Any real query resets the timer.
 *
 * Deliberately a real read against a real table rather than `SELECT 1`: it
 * proves the schema is reachable, not just that a connection opened, and it
 * gives the workflow log a row count worth glancing at.
 *
 *   DATABASE_URL=... node packages/db/scripts/keepalive.mjs
 */
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// prepare:false + max:1 — required for Supabase's transaction-mode pooler.
const sql = postgres(databaseUrl, { prepare: false, max: 1 });

try {
  const [row] = await sql`
    select
      (select count(*) from transactions) as transactions,
      (select count(*) from companies)    as companies,
      (select max(created_at) from transactions) as latest_transaction,
      now() as server_time`;

  console.log(
    JSON.stringify({
      event: "keepalive_ok",
      at: new Date().toISOString(),
      transactions: Number(row.transactions),
      companies: Number(row.companies),
      latestTransaction: row.latest_transaction,
      serverTime: row.server_time,
    }),
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "keepalive_failed",
      at: new Date().toISOString(),
      message: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
