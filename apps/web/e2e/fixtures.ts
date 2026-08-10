import { execFileSync } from "node:child_process";

/**
 * Shared E2E database fixtures.
 *
 * DATA HONESTY: every fixture uses the reserved `ZZ*` ticker namespace and
 * `e2e-*` dedup keys. Fabricated trades are never attached to a real
 * company — a synthetic row on a real ticker can end up in a screenshot
 * and read as fact. `packages/db/scripts/purge-synthetic.sql` clears them.
 */

/** Run SQL in the dev Postgres container. No shell: args are passed directly. */
export function psql(sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "insiderflow-postgres",
      "psql",
      "-U",
      "postgres",
      "-d",
      "insiderflow",
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { encoding: "utf8" },
  ).trim();
}

export interface SyntheticCompany {
  ticker: string;
  companyId: string;
  insiderId: string;
}

/** Bumped per call so two fixtures in one process can never draw the same. */
let fixtureSeq = 0;

/**
 * Create an isolated synthetic company + insider. Always ZZ-prefixed.
 *
 * The suffix used to be `Date.now() % 100000` alone. Playwright starts its
 * workers together, so two of them reaching this line inside the same
 * millisecond drew the identical ticker and the second died on
 * `companies_external_key_unique` — inside `beforeAll`, which takes the
 * whole file's tests with it and leaves the first worker's rows behind for
 * the next run to collide with again. It is rare enough to read as
 * "flaky" and structural enough to keep coming back, so the suffix now
 * mixes the clock with the process and a per-process counter, and a
 * collision retries instead of failing.
 *
 * Kept to five characters: the stock route truncates a ticker at twelve,
 * so a longer fixture name resolves to a company that does not exist and
 * the page 404s for reasons that have nothing to do with the test.
 */
export function createSyntheticCompany(prefix = "ZZTEST"): SyntheticCompany {
  const base36 = (n: number, width: number) =>
    Math.floor(n).toString(36).toUpperCase().slice(-width).padStart(width, "0");

  for (let attempt = 0; attempt < 6; attempt += 1) {
    fixtureSeq += 1;
    const ticker =
      `${prefix}` +
      base36(Date.now() % 46656, 3) +
      base36((process.pid + fixtureSeq * 37 + attempt) % 1296, 2);
    try {
      const out = psql(
        `WITH co AS (INSERT INTO companies (external_key, ticker, name, country, sector)
            VALUES ('ticker:US:${ticker}', '${ticker}', 'ZZ Synthetic Test Corp', 'US', 'Testing')
            RETURNING id),
          ins AS (INSERT INTO insiders (external_key, name, is_officer, officer_title)
            VALUES ('name:US:ZZ TESTER ${ticker}', 'ZZ TESTER ${ticker}', true, 'Chief Test Officer')
            RETURNING id)
          SELECT co.id || ' ' || ins.id FROM co, ins;`,
      );
      const [companyId, insiderId] = out.split(" ");
      if (!companyId || !insiderId) throw new Error(`unexpected psql output: ${out}`);
      return { ticker, companyId, insiderId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("duplicate key")) throw error;
    }
  }
  throw new Error("could not mint a unique synthetic ticker after 6 attempts");
}

/**
 * Insert a transaction for a synthetic company; returns its dedup key.
 *
 * `ingestedDaysAgo` backdates `created_at`. The live stream is ordered by
 * arrival, so a fixture inserted at `now()` is broadcast to every tape open
 * in every parallel worker — a spec that needs thirty rows of HISTORY will
 * otherwise flood a six-row live strip and evict the row another spec is
 * waiting on. Backdate whenever the rows are scenery rather than events.
 */
export function insertSyntheticTrade(
  target: SyntheticCompany,
  options: {
    shares?: number;
    price?: number;
    code?: string;
    tag?: string;
    ingestedDaysAgo?: number;
  } = {},
): string {
  const shares = options.shares ?? 1000;
  const price = options.price ?? 10;
  const code = options.code ?? "P";
  const dedupKey = `e2e-${options.tag ?? target.ticker}-${shares}#0`;
  const createdAt =
    options.ingestedDaysAgo === undefined
      ? "now()"
      : `now() - interval '${Number(options.ingestedDaysAgo)} days'`;
  psql(
    `INSERT INTO transactions (source, insider_id, company_id, txn_date, code, shares, price,
        value, currency, price_usd, value_usd, acquired_disposed, is_10b5_1, is_derivative,
        relevance, dedup_key, country, created_at)
      VALUES ('edgar', '${target.insiderId}', '${target.companyId}', CURRENT_DATE, '${code}',
        ${shares}, ${price}, ${shares * price}, 'USD', ${price}, ${shares * price},
        '${code === "S" ? "D" : "A"}', false, false, 'opportunistic', '${dedupKey}', 'US',
        ${createdAt})
      ON CONFLICT (dedup_key) DO NOTHING;`,
  );
  return dedupKey;
}

/**
 * A synthetic congressional disclosure.
 *
 * The filer name is OBVIOUSLY FICTIONAL. A fabricated STOCK Act filing
 * attributed to a real member of Congress would be defamatory the moment it
 * appeared in a screenshot, so the fixture never uses a real person.
 */
export function insertSyntheticPoliticianTrade(
  target: SyntheticCompany,
  options: { txnType?: string; amountRange?: string; tag?: string } = {},
): { politicianId: string; dedupKey: string; name: string } {
  const name = `ZZ Representative Fictional ${target.ticker}`;
  const externalKey = `house:zz representative fictional ${target.ticker.toLowerCase()}`;
  const dedupKey = `e2e-pol-${options.tag ?? target.ticker}#0`;
  const txnType = options.txnType ?? "purchase";
  const amountRange = options.amountRange ?? "$15,001 - $50,000";

  // psql prints the INSERT command tag on its own line alongside the RETURNING
  // row, so take the first line rather than the whole output.
  const politicianId = psql(
    `INSERT INTO politicians (external_key, name, chamber, party, state, district)
       VALUES ('${externalKey}', '${name}', 'house', 'IND', 'ZZ', 'ZZ01')
     ON CONFLICT (external_key) DO UPDATE SET name = EXCLUDED.name
     RETURNING id;`,
  )
    .split("\n")[0]!
    .trim();

  psql(
    `INSERT INTO politician_trades (politician_id, company_id, ticker, asset_description,
        asset_type, txn_type, txn_date, disclosed_at, amount_min, amount_max, amount_range,
        owner, source, source_url, dedup_key)
      VALUES ('${politicianId}', '${target.companyId}', '${target.ticker}',
        'ZZ Synthetic Test Corp', 'Stock', '${txnType}', CURRENT_DATE - 20, CURRENT_DATE,
        15001, 50000, '${amountRange}', 'self', 'e2e-fixture',
        'https://example.invalid/ptr/${target.ticker}.pdf', '${dedupKey}')
      ON CONFLICT (dedup_key) DO NOTHING;`,
  );
  return { politicianId, dedupKey, name };
}

/** A cluster flag for the synthetic company, as the analytics cron would write it. */
export function insertSyntheticClusterFlag(target: SyntheticCompany, insiderCount = 3): void {
  psql(
    `INSERT INTO cluster_flags (company_id, direction, window_start, window_end,
        insider_count, trade_count, total_usd)
      VALUES ('${target.companyId}', 'buy', CURRENT_DATE - 5, CURRENT_DATE,
        ${insiderCount}, ${insiderCount}, ${insiderCount * 500000})
      ON CONFLICT (company_id, direction, window_start)
      DO UPDATE SET insider_count = EXCLUDED.insider_count;`,
  );
}

/** Remove everything created for a synthetic company. */
export function cleanupSyntheticCompany(target: SyntheticCompany): void {
  psql(
    `DELETE FROM politician_trades WHERE company_id = '${target.companyId}';
     DELETE FROM politicians WHERE external_key = 'house:zz representative fictional ${target.ticker.toLowerCase()}';
     DELETE FROM cluster_flags WHERE company_id = '${target.companyId}';
     DELETE FROM company_anomalies WHERE company_id = '${target.companyId}';
     DELETE FROM trade_returns WHERE company_id = '${target.companyId}';
     DELETE FROM transactions WHERE company_id = '${target.companyId}';
     UPDATE filings SET superseded_by_filing_id = NULL WHERE issuer_company_id = '${target.companyId}';
     DELETE FROM filings WHERE issuer_company_id = '${target.companyId}';
     DELETE FROM companies WHERE id = '${target.companyId}';
     DELETE FROM insiders WHERE id = '${target.insiderId}';`,
  );
}

/**
 * The busiest company in the SEED, never a test fixture.
 *
 * `ORDER BY count(*) DESC LIMIT 1` over the whole companies table is a
 * race against the rest of the suite: `createSyntheticCompany` inserts a
 * company with transactions and `cleanupSyntheticCompany` deletes it again,
 * so a worker running in between can pick a ticker that stops existing
 * before it is searched for. Two specs failed that way, intermittently,
 * with an error about a missing button.
 *
 * Every transient fixture is stamped `sector = 'Testing'`, so excluding
 * that sector removes the race at the source rather than retrying past it.
 * The seeded ZZ* companies are still fair game — they are stable rows that
 * nothing deletes mid-run.
 */
export function busiestSeedTicker(): string {
  return psql(
    `SELECT c.ticker FROM companies c
       JOIN transactions t ON t.company_id = c.id
      WHERE c.ticker IS NOT NULL AND c.sector IS DISTINCT FROM 'Testing'
      GROUP BY c.ticker
      ORDER BY count(*) DESC
      LIMIT 1;`,
  );
}

/** The busiest insider in the seed, chosen the same way and for the same reason. */
export function busiestSeedInsiderId(): string {
  return psql(
    `SELECT t.insider_id FROM transactions t
       JOIN companies c ON c.id = t.company_id
      WHERE c.sector IS DISTINCT FROM 'Testing'
      GROUP BY t.insider_id
      ORDER BY count(*) DESC
      LIMIT 1;`,
  );
}
