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

/** Create an isolated synthetic company + insider. Always ZZ-prefixed. */
export function createSyntheticCompany(prefix = "ZZTEST"): SyntheticCompany {
  const ticker = `${prefix}${Date.now() % 100000}`;
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
  return { ticker, companyId: companyId!, insiderId: insiderId! };
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
