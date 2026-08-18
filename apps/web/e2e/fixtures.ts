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

/** A string literal, with embedded quotes doubled the way SQL wants them. */
const quote = (s: string): string => `'${s.replaceAll("'", "''")}'`;

/**
 * A nullable numeric as a SQL literal.
 *
 * The whole point of the adversarial fixtures is that NULL and 0 are
 * different facts, so this never coalesces one into the other: `null` is
 * written as NULL, `0` is written as 0, and only `undefined` falls back.
 */
const numLit = (v: number | null | undefined, fallback: number | null = null): string => {
  const value = v === undefined ? fallback : v;
  return value === null ? "NULL" : String(value);
};

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
export function createSyntheticCompany(
  prefix = "ZZTEST",
  options: { country?: string } = {},
): SyntheticCompany {
  // The stock page branches on country for the whole India disclosure block,
  // so a fixture that needs those panels has to be an Indian company rather
  // than a US one with Indian-looking rows attached.
  const country = options.country ?? "US";
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
            VALUES ('ticker:${country}:${ticker}', '${ticker}', 'ZZ Synthetic Test Corp', '${country}', 'Testing')
            RETURNING id),
          ins AS (INSERT INTO insiders (external_key, name, is_officer, officer_title)
            VALUES ('name:${country}:ZZ TESTER ${ticker}', 'ZZ TESTER ${ticker}', true, 'Chief Test Officer')
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
    /** Attach the row to a filing, so `superseded_by_filing_id` can reach it. */
    filingId?: string;
  } = {},
): string {
  const shares = options.shares ?? 1000;
  const price = options.price ?? 10;
  const code = options.code ?? "P";
  // The ticker is in the key unconditionally, NOT as a fallback for `tag`.
  // As a fallback it dropped out the moment a caller passed one, so all four
  // Playwright workers running `{ tag: "layout" }` drew `e2e-layout-1000#0`,
  // and three of the four inserts were silently swallowed by ON CONFLICT DO
  // NOTHING — a fixture that reports success and creates no row. The ticker
  // is the only per-worker unique thing here, so it always leads.
  const dedupKey = `e2e-${target.ticker}-${options.tag ?? "trade"}-${shares}#0`;
  const createdAt =
    options.ingestedDaysAgo === undefined
      ? "now()"
      : `now() - interval '${Number(options.ingestedDaysAgo)} days'`;
  psql(
    `INSERT INTO transactions (source, filing_id, insider_id, company_id, txn_date, code, shares,
        price, value, currency, price_usd, value_usd, acquired_disposed, is_10b5_1, is_derivative,
        relevance, dedup_key, country, created_at)
      VALUES ('edgar', ${options.filingId ? `'${options.filingId}'` : "NULL"},
        '${target.insiderId}', '${target.companyId}', CURRENT_DATE, '${code}',
        ${shares}, ${price}, ${shares * price}, 'USD', ${price}, ${shares * price},
        '${code === "S" ? "D" : "A"}', false, false, 'opportunistic', '${dedupKey}', 'US',
        ${createdAt})
      ON CONFLICT (dedup_key) DO NOTHING;`,
  );
  return dedupKey;
}

/**
 * A filing for the synthetic company; returns its id.
 *
 * `accession_no` is the idempotency key in this schema, so it carries the
 * fixture namespace too — a re-run reuses the row rather than colliding.
 */
export function insertSyntheticFiling(
  target: SyntheticCompany,
  options: { formType?: string; tag?: string; filedDaysAgo?: number } = {},
): string {
  const formType = options.formType ?? "4";
  const accessionNo = `e2e-${target.ticker}-${options.tag ?? formType}`;
  return psql(
    `INSERT INTO filings (accession_no, form_type, filed_at, issuer_company_id, source_url)
       VALUES (${quote(accessionNo)}, ${quote(formType)},
         now() - interval '${Number(options.filedDaysAgo ?? 1)} days', '${target.companyId}',
         'https://example.invalid/filing/${target.ticker}.html')
     ON CONFLICT (accession_no) DO UPDATE SET form_type = EXCLUDED.form_type
     RETURNING id;`,
  )
    .split("\n")[0]!
    .trim();
}

/**
 * Point an original filing at the amendment that replaced it.
 *
 * This is the one column that decides whether a row is published, so the
 * fixture writes it exactly as the ingestion worker does rather than
 * approximating the state with a delete.
 */
export function supersedeFiling(originalFilingId: string, amendmentFilingId: string): void {
  psql(
    `UPDATE filings SET superseded_by_filing_id = '${amendmentFilingId}'
      WHERE id = '${originalFilingId}';`,
  );
}

/**
 * An NSE SAST disclosure for the synthetic company.
 *
 * Every figure is explicitly nullable, because this is the fixture that has
 * to be able to say "the filing disclosed zero" and "the filing disclosed
 * nothing" as two different rows. Pass `0` for the first and `null` for the
 * second; neither is a default.
 */
export function insertSyntheticSastDisclosure(
  target: SyntheticCompany,
  options: {
    acquirerName: string;
    tag: string;
    shares?: number | null;
    sharesPctAfter?: number | null;
    value?: number | null;
    valueUsd?: number | null;
    daysAgo?: number;
  },
): string {
  const dedupKey = `e2e-sast-${target.ticker}-${options.tag}#0`;
  psql(
    `INSERT INTO sast_disclosures (country, exchange, symbol, company_name, acquirer_name,
        regulation, category, acquisition_mode, side, shares, shares_pct_after, value,
        currency, value_usd, txn_date, intimated_at, source_url, dedup_key)
      VALUES ('IN', 'NSE', '${target.ticker}', 'ZZ Synthetic Test Corp',
        ${quote(options.acquirerName)}, '29(2)', 'Promoter Group', 'Inter-se transfer',
        'acquisition', ${numLit(options.shares)}, ${numLit(options.sharesPctAfter)},
        ${numLit(options.value)}, 'INR', ${numLit(options.valueUsd)},
        CURRENT_DATE - ${Number(options.daysAgo ?? 3)}, CURRENT_DATE,
        'https://example.invalid/sast/${target.ticker}.pdf', '${dedupKey}')
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
  options: {
    txnType?: string;
    /**
     * The verbatim bracket as filed. Pass `null` to leave it off, which
     * forces the UI to rebuild the bracket from the bounds — the only path
     * where equal bounds could be collapsed into a point value.
     */
    amountRange?: string | null;
    amountMin?: number | null;
    amountMax?: number | null;
    tag?: string;
  } = {},
): { politicianId: string; dedupKey: string; name: string } {
  const name = `ZZ Representative Fictional ${target.ticker}`;
  const externalKey = `house:zz representative fictional ${target.ticker.toLowerCase()}`;
  const dedupKey = `e2e-pol-${options.tag ?? target.ticker}#0`;
  const txnType = options.txnType ?? "purchase";
  // `??` would turn an explicit null back into the default, which is exactly
  // the state this fixture exists to be able to create.
  const amountRange = options.amountRange === undefined ? "$15,001 - $50,000" : options.amountRange;

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
        ${numLit(options.amountMin, 15001)}, ${numLit(options.amountMax, 50000)},
        ${amountRange === null ? "NULL" : quote(amountRange)}, 'self', 'e2e-fixture',
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
     DELETE FROM sast_disclosures WHERE symbol = '${target.ticker}';
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
