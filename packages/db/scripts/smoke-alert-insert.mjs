/**
 * Insert ONE synthetic transaction to exercise the alert pipeline.
 *
 * Uses the reserved ZZ* namespace (same rule as e2e/fixtures.ts) so a
 * fabricated trade is never attributable to a real company. Idempotent
 * per ticker: re-running reuses the company/insider and inserts a new
 * transaction with a fresh dedup key.
 *
 *   pnpm smoke:alert-insert                       # ZZSMOKE, $2,500,000
 *   pnpm smoke:alert-insert -- --ticker=ZZDEMO --value=750000
 *
 * Clean up with: psql -f packages/db/scripts/purge-synthetic.sql
 */
import postgres from "postgres";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const ticker = arg("ticker", "ZZSMOKE").toUpperCase();
const value = Number(arg("value", "2500000"));
const code = arg("code", "P").toUpperCase();
const databaseUrl =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/insiderflow";

if (!ticker.startsWith("ZZ")) {
  console.error(`Refusing to insert: ticker must start with ZZ (got "${ticker}").`);
  process.exit(1);
}
if (!Number.isFinite(value) || value <= 0) {
  console.error(`Invalid --value: ${arg("value", "")}`);
  process.exit(1);
}

const sql = postgres(databaseUrl, { prepare: false, max: 1 });

try {
  const [company] = await sql`
    INSERT INTO companies (external_key, ticker, name, country, sector)
    VALUES (${`ticker:US:${ticker}`}, ${ticker}, ${"ZZ Smoke Test Corp"}, 'US', 'Testing')
    ON CONFLICT (external_key) DO UPDATE SET ticker = EXCLUDED.ticker
    RETURNING id`;

  const [insider] = await sql`
    INSERT INTO insiders (external_key, name, is_officer, officer_title)
    VALUES (${`name:US:ZZ SMOKE TESTER ${ticker}`}, ${`ZZ SMOKE TESTER`}, true, 'Chief Test Officer')
    ON CONFLICT (external_key) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`;

  const shares = 1000;
  const price = value / shares;
  const dedupKey = `e2e-smoke-${ticker}-${Date.now()}#0`;

  const [txn] = await sql`
    INSERT INTO transactions (source, insider_id, company_id, txn_date, code, shares, price,
      value, currency, price_usd, value_usd, acquired_disposed, is_10b5_1, is_derivative,
      relevance, dedup_key, country)
    VALUES ('edgar', ${insider.id}, ${company.id}, CURRENT_DATE, ${code}, ${shares}, ${price},
      ${value}, 'USD', ${price}, ${value}, ${code === "S" ? "D" : "A"}, false, false,
      'opportunistic', ${dedupKey}, 'US')
    RETURNING id, created_at`;

  console.log(
    JSON.stringify(
      {
        inserted: true,
        ticker,
        code,
        shares,
        valueUsd: value,
        transactionId: txn.id,
        dedupKey,
        createdAt: txn.created_at,
        next: "fire one scanner run, then check Telegram",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("smoke insert failed:", error.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
