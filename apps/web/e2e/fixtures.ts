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

/** Insert a transaction for a synthetic company; returns its dedup key. */
export function insertSyntheticTrade(
  target: SyntheticCompany,
  options: { shares?: number; price?: number; code?: string; tag?: string } = {},
): string {
  const shares = options.shares ?? 1000;
  const price = options.price ?? 10;
  const code = options.code ?? "P";
  const dedupKey = `e2e-${options.tag ?? target.ticker}-${shares}#0`;
  psql(
    `INSERT INTO transactions (source, insider_id, company_id, txn_date, code, shares, price,
        value, currency, price_usd, value_usd, acquired_disposed, is_10b5_1, is_derivative,
        relevance, dedup_key, country)
      VALUES ('edgar', '${target.insiderId}', '${target.companyId}', CURRENT_DATE, '${code}',
        ${shares}, ${price}, ${shares * price}, 'USD', ${price}, ${shares * price},
        '${code === "S" ? "D" : "A"}', false, false, 'opportunistic', '${dedupKey}', 'US')
      ON CONFLICT (dedup_key) DO NOTHING;`,
  );
  return dedupKey;
}

/** Remove everything created for a synthetic company. */
export function cleanupSyntheticCompany(target: SyntheticCompany): void {
  psql(
    `DELETE FROM transactions WHERE company_id = '${target.companyId}';
     UPDATE filings SET superseded_by_filing_id = NULL WHERE issuer_company_id = '${target.companyId}';
     DELETE FROM filings WHERE issuer_company_id = '${target.companyId}';
     DELETE FROM companies WHERE id = '${target.companyId}';
     DELETE FROM insiders WHERE id = '${target.insiderId}';`,
  );
}
