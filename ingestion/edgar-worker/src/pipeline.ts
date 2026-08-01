/**
 * Ingestion pipeline. Source adapters produce UnifiedTransactions;
 * persistUnified() writes them idempotently — companies/insiders resolved by
 * cross-source identity, filings by accession number, transactions by
 * dedup key. Adding a market touches none of this code.
 */
import {
  assignDedupKeys,
  edgarCurrentFeedUrl,
  edgarSubmissionTextUrl,
  parseCurrentFeed,
  parseEdgarSubmission,
  toUsd,
} from "@insiderflow/core";
import type {
  EdgarFilingRef,
  EdgarNormalizedSubmission,
  UnifiedCompany,
  UnifiedFiling,
  UnifiedInsider,
  UnifiedTransaction,
} from "@insiderflow/core";
import {
  and,
  companies,
  eq,
  filings,
  inArray,
  ingestionState,
  insiders,
  isNull,
  ne,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database, NewTransaction } from "@insiderflow/db";

import { fetchWithRetry, jsonLogger, RateLimiter } from "./http";
import type { FetchLike, Logger } from "./http";

/** Resolve the USD rate for (currency, ISO date); null = leave USD fields empty. */
export type FxRateLookup = (currency: string, dateIso: string) => Promise<number | null>;

export interface PersistOptions {
  db: Database;
  log?: Logger;
  /** Defaults to identity for USD and no conversion otherwise. */
  fxRateLookup?: FxRateLookup;
}

export interface PersistStats {
  transactionsInserted: number;
  /** Rows dropped by the dedup_key unique index (same trade from another source/run). */
  transactionsDeduped: number;
  /** The dedup keys of those dropped rows — used to re-home rows onto amendments. */
  dedupedKeys: string[];
  filingsCreated: number;
}

const toNumeric = (n: number | null): string | null => (n === null ? null : String(n));

const defaultFxLookup: FxRateLookup = (currency) =>
  Promise.resolve(currency.toUpperCase() === "USD" ? 1 : null);

async function resolveCompany(
  db: Database,
  company: UnifiedCompany,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(company.externalKey);
  if (cached) return cached;

  let id: string | undefined;
  const [byKey] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(eq(companies.externalKey, company.externalKey));
  id = byKey?.id;

  // Cross-source join: another adapter may know this company under a
  // different key (EDGAR "cik:...", Finnhub "ticker:US:...").
  if (!id && company.ticker) {
    const [byTicker] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.ticker, company.ticker), eq(companies.country, company.country)))
      .limit(1);
    id = byTicker?.id;
  }

  if (!id) {
    const [row] = await db
      .insert(companies)
      .values({
        externalKey: company.externalKey,
        cik: company.cik,
        name: company.name,
        ticker: company.ticker,
        country: company.country,
      })
      .onConflictDoUpdate({
        target: companies.externalKey,
        set: {
          name: sql`excluded.name`,
          ticker: sql`coalesce(excluded.ticker, ${companies.ticker})`,
        },
      })
      .returning({ id: companies.id });
    id = row!.id;
  }

  cache.set(company.externalKey, id);
  return id;
}

async function resolveInsider(
  db: Database,
  insider: UnifiedInsider,
  cache: Map<string, string>,
): Promise<string> {
  const cached = cache.get(insider.externalKey);
  if (cached) return cached;

  let id: string | undefined;
  const [byKey] = await db
    .select({ id: insiders.id })
    .from(insiders)
    .where(eq(insiders.externalKey, insider.externalKey));
  id = byKey?.id;

  // Cross-source join on the exact normalized name (aggregators have no CIK).
  // Tradeoff: two distinct people with identical normalized names would merge.
  if (!id) {
    const [byName] = await db
      .select({ id: insiders.id })
      .from(insiders)
      .where(eq(insiders.name, insider.name))
      .limit(1);
    id = byName?.id;
  }

  if (!id) {
    const [row] = await db
      .insert(insiders)
      .values({
        externalKey: insider.externalKey,
        cik: insider.externalKey.startsWith("cik:") ? insider.externalKey.slice(4) : null,
        name: insider.name,
        isDirector: insider.isDirector,
        isOfficer: insider.isOfficer,
        isTenPctOwner: insider.isTenPercentOwner,
        officerTitle: insider.title,
      })
      .onConflictDoUpdate({
        target: insiders.externalKey,
        set: {
          name: sql`excluded.name`,
          isDirector: sql`excluded.is_director`,
          isOfficer: sql`excluded.is_officer`,
          isTenPctOwner: sql`excluded.is_ten_pct_owner`,
          // Keep the last known title when a later filing omits it.
          officerTitle: sql`coalesce(excluded.officer_title, ${insiders.officerTitle})`,
        },
      })
      .returning({ id: insiders.id });
    id = row!.id;
  }

  cache.set(insider.externalKey, id);
  return id;
}

async function resolveFiling(
  db: Database,
  filing: UnifiedFiling,
  companyId: string,
  fallbackRawXmlUrl: string | null,
): Promise<{ id: string; created: boolean }> {
  const [inserted] = await db
    .insert(filings)
    .values({
      accessionNo: filing.accessionNo,
      formType: filing.formType,
      filedAt: filing.filedAt ? new Date(filing.filedAt) : new Date(),
      sourceUrl: filing.sourceUrl,
      issuerCompanyId: companyId,
      rawXmlUrl: filing.rawXmlUrl ?? fallbackRawXmlUrl,
    })
    .onConflictDoNothing({ target: filings.accessionNo })
    .returning({ id: filings.id });
  if (inserted) return { id: inserted.id, created: true };

  const [existing] = await db
    .select({ id: filings.id })
    .from(filings)
    .where(eq(filings.accessionNo, filing.accessionNo));
  return { id: existing!.id, created: false };
}

/**
 * Persist a batch of UnifiedTransactions from any source adapter.
 * Idempotent at every level; the same trade arriving from a second source
 * is dropped by the dedup_key unique index.
 */
export async function persistUnified(
  txns: UnifiedTransaction[],
  { db, log = jsonLogger, fxRateLookup = defaultFxLookup }: PersistOptions,
  context: { rawXmlUrl?: string } = {},
): Promise<PersistStats> {
  const stats: PersistStats = {
    transactionsInserted: 0,
    transactionsDeduped: 0,
    dedupedKeys: [],
    filingsCreated: 0,
  };
  if (txns.length === 0) return stats;

  const companyCache = new Map<string, string>();
  const insiderCache = new Map<string, string>();
  const filingCache = new Map<string, string>();
  const dedupKeys = assignDedupKeys(txns);

  const rows: NewTransaction[] = [];
  for (let i = 0; i < txns.length; i++) {
    const txn = txns[i]!;
    const companyId = await resolveCompany(db, txn.company, companyCache);
    const insiderId = await resolveInsider(db, txn.insider, insiderCache);

    let filingId: string | null = null;
    if (txn.filing) {
      const cachedFiling = filingCache.get(txn.filing.accessionNo);
      if (cachedFiling) {
        filingId = cachedFiling;
      } else {
        const resolved = await resolveFiling(db, txn.filing, companyId, context.rawXmlUrl ?? null);
        if (resolved.created) stats.filingsCreated++;
        filingCache.set(txn.filing.accessionNo, resolved.id);
        filingId = resolved.id;
      }
    }

    const rate = await fxRateLookup(txn.currency, txn.txnDate);
    rows.push({
      source: txn.source,
      filingId,
      insiderId,
      companyId,
      txnDate: txn.txnDate,
      code: txn.code,
      rawCode: txn.rawCode,
      shares: toNumeric(txn.shares),
      price: toNumeric(txn.price),
      value: toNumeric(txn.value),
      currency: txn.currency,
      priceUsd: toNumeric(toUsd(txn.price, rate)),
      valueUsd: toNumeric(toUsd(txn.value, rate)),
      acquiredDisposed: txn.acquiredDisposed,
      sharesOwnedAfter: toNumeric(txn.sharesOwnedAfter),
      is10b51: txn.is10b51,
      isDerivative: txn.isDerivative,
      relevance: txn.relevance,
      dedupKey: dedupKeys[i]!,
      footnote: txn.footnote,
      country: txn.country,
    });
  }

  const inserted = await db
    .insert(transactions)
    .values(rows)
    .onConflictDoNothing({ target: transactions.dedupKey })
    .returning({ id: transactions.id, dedupKey: transactions.dedupKey });
  stats.transactionsInserted = inserted.length;
  stats.transactionsDeduped = rows.length - inserted.length;
  const insertedKeys = new Set(inserted.map((r) => r.dedupKey));
  stats.dedupedKeys = rows.map((r) => r.dedupKey).filter((key) => !insertedKeys.has(key));

  if (stats.transactionsDeduped > 0) {
    log("cross_source_dedup", {
      source: txns[0]!.source,
      deduped: stats.transactionsDeduped,
      inserted: stats.transactionsInserted,
    });
  }
  return stats;
}

/**
 * Record a holdings-only filing (most Form 3s report positions, not trades).
 * Without this the filing never enters the DB diff and gets re-fetched on
 * every run, permanently clogging the per-run batch.
 */
export async function persistFilingOnly(
  db: Database,
  parsed: Pick<EdgarNormalizedSubmission, "company" | "filing">,
  rawXmlUrl: string | null,
): Promise<PersistStats> {
  const companyId = await resolveCompany(db, parsed.company, new Map());
  const { created } = await resolveFiling(db, parsed.filing, companyId, rawXmlUrl);
  return {
    transactionsInserted: 0,
    transactionsDeduped: 0,
    dedupedKeys: [],
    filingsCreated: created ? 1 : 0,
  };
}

/**
 * Link an amendment (4/A, 3/A, 5/A) to the filing(s) it replaces: mark the
 * originals superseded, and re-home rows the amendment re-reported
 * unchanged (they deduped against the original) so they stay visible when
 * APIs hide superseded filings by default.
 */
export async function linkAmendment(
  db: Database,
  accessionNo: string,
  originalFiledDate: string,
  insiderExternalKey: string,
  dedupedKeys: string[],
  log: Logger = jsonLogger,
): Promise<number> {
  const [amendment] = await db
    .select({
      id: filings.id,
      issuerCompanyId: filings.issuerCompanyId,
      formType: filings.formType,
    })
    .from(filings)
    .where(eq(filings.accessionNo, accessionNo));
  if (!amendment) return 0;

  const baseFormType = amendment.formType.replace("/A", "");
  const candidateConditions = and(
    eq(filings.issuerCompanyId, amendment.issuerCompanyId),
    eq(filings.formType, baseFormType),
    // EDGAR filing dates are US Eastern.
    sql`date(${filings.filedAt} AT TIME ZONE 'America/New_York') = ${originalFiledDate}`,
    isNull(filings.supersededByFilingId),
    ne(filings.id, amendment.id),
  );

  // Several insiders can file against the same issuer on the same day, so
  // the original must share the amendment's reporting owner (via its rows).
  let originals = await db
    .select({ id: filings.id })
    .from(filings)
    .where(
      and(
        candidateConditions,
        sql`exists (select 1 from transactions t join insiders i on i.id = t.insider_id
             where t.filing_id = ${filings.id} and i.external_key = ${insiderExternalKey})`,
      ),
    );
  if (originals.length === 0) {
    // Holdings-only originals (e.g. Form 3) have no rows to match on —
    // safe only when the candidate is unambiguous.
    const candidates = await db.select({ id: filings.id }).from(filings).where(candidateConditions);
    if (candidates.length !== 1) return 0;
    originals = candidates;
  }

  const originalIds = originals.map((o) => o.id);
  await db
    .update(filings)
    .set({ supersededByFilingId: amendment.id })
    .where(inArray(filings.id, originalIds));
  if (dedupedKeys.length > 0) {
    await db
      .update(transactions)
      .set({ filingId: amendment.id })
      .where(
        and(
          inArray(transactions.dedupKey, dedupedKeys),
          inArray(transactions.filingId, originalIds),
        ),
      );
  }
  log("amendment_linked", { amendment: accessionNo, superseded: originalIds.length });
  return originalIds.length;
}

// ── EDGAR primary flow ──────────────────────────────────────────────────────

export interface PipelineOptions {
  db: Database;
  /** SEC fair-access UA, e.g. "InsiderFlow/0.1 (you@example.com)". */
  userAgent: string;
  fetchFn?: FetchLike;
  /**
   * Minimum ms between EDGAR requests. Default 250ms ≈ 4 req/s — well under
   * the 10 req/s fair-access cap.
   */
  requestDelayMs?: number;
  /** Cap on filings fetched per run (Workers free tier allows 50 subrequests/invocation). */
  maxFilings?: number;
  /** Which ownership form feeds to poll. */
  forms?: readonly string[];
  log?: Logger;
  fxRateLookup?: FxRateLookup;
}

export interface IngestStats {
  discovered: number;
  alreadyKnown: number;
  ingested: number;
  transactionsInserted: number;
  transactionsDeduped: number;
  skippedEmpty: number;
  errors: number;
}

const DEFAULT_FORMS = ["4", "3", "5"] as const;
const CURSOR_KEY = "edgar:cursor";

function resolveOptions(opts: PipelineOptions) {
  return {
    fetchFn: opts.fetchFn ?? (fetch as FetchLike),
    requestDelayMs: opts.requestDelayMs ?? 250,
    maxFilings: opts.maxFilings ?? 25,
    forms: opts.forms ?? DEFAULT_FORMS,
    log: opts.log ?? jsonLogger,
    headers: {
      "User-Agent": opts.userAgent,
      "Accept-Encoding": "gzip, deflate",
    },
  };
}

/** Poll the EDGAR "current events" feeds and ingest anything new. */
export async function ingestFromFeed(opts: PipelineOptions): Promise<IngestStats> {
  const { fetchFn, requestDelayMs, forms, log, headers } = resolveOptions(opts);
  const limiter = new RateLimiter(requestDelayMs);

  const refs: EdgarFilingRef[] = [];
  for (const form of forms) {
    await limiter.wait();
    const response = await fetchWithRetry(fetchFn, edgarCurrentFeedUrl(form), headers, { log });
    refs.push(...parseCurrentFeed(await response.text()));
  }
  return ingestFilingRefs(refs, opts, limiter);
}

/**
 * Ingest a batch of EDGAR filing refs (live feed or backfill index):
 * diff against filings already in the DB, fetch + normalize the new ones,
 * and persist idempotently.
 */
export async function ingestFilingRefs(
  allRefs: EdgarFilingRef[],
  opts: PipelineOptions,
  limiter?: RateLimiter,
): Promise<IngestStats> {
  const { db } = opts;
  const { fetchFn, requestDelayMs, maxFilings, log, headers } = resolveOptions(opts);
  const rate = limiter ?? new RateLimiter(requestDelayMs);

  // Dedupe refs (feeds list a filing once per associated company/owner).
  const byAccession = new Map<string, EdgarFilingRef>();
  for (const ref of allRefs) {
    if (!byAccession.has(ref.accessionNo)) byAccession.set(ref.accessionNo, ref);
  }
  const refs = [...byAccession.values()];

  const stats: IngestStats = {
    discovered: refs.length,
    alreadyKnown: 0,
    ingested: 0,
    transactionsInserted: 0,
    transactionsDeduped: 0,
    skippedEmpty: 0,
    errors: 0,
  };

  // Diff against the DB — the accession_no unique index is the source of truth.
  const known = new Set<string>();
  const accessions = refs.map((r) => r.accessionNo);
  for (let i = 0; i < accessions.length; i += 200) {
    const chunk = accessions.slice(i, i + 200);
    const rows = await db
      .select({ accessionNo: filings.accessionNo })
      .from(filings)
      .where(inArray(filings.accessionNo, chunk));
    for (const row of rows) known.add(row.accessionNo);
  }

  const fresh = refs.filter((r) => !known.has(r.accessionNo));
  stats.alreadyKnown = refs.length - fresh.length;
  const batch = fresh.slice(0, maxFilings);
  if (fresh.length > batch.length) {
    log("edgar_batch_capped", { pending: fresh.length - batch.length, cap: maxFilings });
  }

  for (const ref of batch) {
    try {
      await rate.wait();
      const url = edgarSubmissionTextUrl(ref.cik, ref.accessionNo);
      const response = await fetchWithRetry(fetchFn, url, headers, { log });
      const parsed = parseEdgarSubmission(ref, await response.text());

      if (!parsed) {
        stats.skippedEmpty++;
        log("edgar_no_ownership_xml", { accessionNo: ref.accessionNo });
        continue;
      }

      // Holdings-only filings (most Form 3s) still get a filing row so the
      // DB diff marks them known; trade-bearing ones go through the full path.
      const result =
        parsed.transactions.length > 0
          ? await persistUnified(
              parsed.transactions,
              { db, log, fxRateLookup: opts.fxRateLookup },
              { rawXmlUrl: url },
            )
          : await persistFilingOnly(db, parsed, url);
      stats.transactionsInserted += result.transactionsInserted;
      stats.transactionsDeduped += result.transactionsDeduped;

      if (parsed.filing.formType.includes("/A") && parsed.filing.originalFiledDate) {
        await linkAmendment(
          db,
          parsed.filing.accessionNo,
          parsed.filing.originalFiledDate,
          parsed.insider.externalKey,
          result.dedupedKeys,
          log,
        );
      }

      if (result.filingsCreated > 0 || result.transactionsInserted > 0) {
        stats.ingested++;
        log("filing_ingested", {
          accessionNo: ref.accessionNo,
          formType: ref.formType,
          issuer: parsed.company.ticker ?? parsed.company.name,
          transactions: result.transactionsInserted,
        });
      } else {
        stats.alreadyKnown++;
      }
    } catch (error) {
      stats.errors++;
      log("filing_error", {
        accessionNo: ref.accessionNo,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await db
    .insert(ingestionState)
    .values({ key: CURSOR_KEY, value: { lastRunAt: new Date().toISOString(), ...stats } })
    .onConflictDoUpdate({
      target: ingestionState.key,
      set: {
        value: { lastRunAt: new Date().toISOString(), ...stats },
        updatedAt: new Date(),
      },
    });

  return stats;
}
