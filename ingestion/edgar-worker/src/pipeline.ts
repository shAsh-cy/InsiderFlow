/**
 * EDGAR → Postgres ingestion pipeline. Runtime-agnostic: the Cloudflare
 * Worker cron, the backfill script, and the integration tests all run this
 * exact code with different fetch/db handles.
 */
import {
  edgarCurrentFeedUrl,
  edgarSubmissionTextUrl,
  extractAcceptanceDatetime,
  extractOwnershipXml,
  isSecTransactionCode,
  parseCurrentFeed,
  parseOwnershipDocument,
} from "@insiderflow/core";
import type { EdgarFilingRef, ParsedOwnershipDocument } from "@insiderflow/core";
import {
  companies,
  filings,
  ingestionState,
  insiders,
  transactions,
  inArray,
  sql,
} from "@insiderflow/db";
import type { Database, NewTransaction } from "@insiderflow/db";

import { fetchWithRetry, jsonLogger, RateLimiter } from "./http";
import type { FetchLike, Logger } from "./http";

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
}

export interface IngestStats {
  discovered: number;
  alreadyKnown: number;
  ingested: number;
  transactionsInserted: number;
  skippedNoXml: number;
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
 * Ingest a batch of filing refs (from the live feed or a backfill index):
 * diff against filings already in the DB, fetch + parse the new ones, and
 * upsert idempotently (accession_no is the unique key).
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
    skippedNoXml: 0,
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
      const fullText = await response.text();

      const xml = extractOwnershipXml(fullText);
      if (!xml) {
        stats.skippedNoXml++;
        log("edgar_no_ownership_xml", { accessionNo: ref.accessionNo });
        continue;
      }

      const doc = parseOwnershipDocument(xml);
      const filedAt =
        extractAcceptanceDatetime(fullText) ?? ref.filedAt ?? new Date().toISOString();
      const result = await persistFiling(db, ref, doc, filedAt, url, log);

      if (result) {
        stats.ingested++;
        stats.transactionsInserted += result.transactionCount;
        log("filing_ingested", {
          accessionNo: ref.accessionNo,
          formType: doc.formType,
          issuer: doc.issuer.ticker ?? doc.issuer.name,
          transactions: result.transactionCount,
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

async function upsertCompany(db: Database, doc: ParsedOwnershipDocument): Promise<string> {
  const [row] = await db
    .insert(companies)
    .values({ cik: doc.issuer.cik, name: doc.issuer.name, ticker: doc.issuer.ticker })
    .onConflictDoUpdate({
      target: companies.cik,
      set: {
        name: sql`excluded.name`,
        ticker: sql`coalesce(excluded.ticker, ${companies.ticker})`,
      },
    })
    .returning({ id: companies.id });
  return row!.id;
}

async function upsertInsiders(db: Database, doc: ParsedOwnershipDocument): Promise<string[]> {
  const ids: string[] = [];
  for (const owner of doc.owners) {
    const [row] = await db
      .insert(insiders)
      .values({
        cik: owner.cik,
        name: owner.name,
        isDirector: owner.isDirector,
        isOfficer: owner.isOfficer,
        isTenPctOwner: owner.isTenPercentOwner,
        officerTitle: owner.officerTitle,
      })
      .onConflictDoUpdate({
        target: insiders.cik,
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
    ids.push(row!.id);
  }
  return ids;
}

const toNumeric = (n: number | null): string | null => (n === null ? null : String(n));

async function persistFiling(
  db: Database,
  ref: EdgarFilingRef,
  doc: ParsedOwnershipDocument,
  filedAtIso: string,
  rawXmlUrl: string,
  log: Logger,
): Promise<{ transactionCount: number } | null> {
  if (doc.owners.length === 0) {
    throw new Error("ownershipDocument has no reportingOwner");
  }

  const companyId = await upsertCompany(db, doc);
  const insiderIds = await upsertInsiders(db, doc);
  // Multi-owner filings (e.g. a fund + its GP) report one shared transaction
  // set; we attach it to the first (primary) owner.
  const primaryInsiderId = insiderIds[0]!;

  const [filing] = await db
    .insert(filings)
    .values({
      accessionNo: ref.accessionNo,
      formType: ref.formType || doc.formType,
      filedAt: new Date(filedAtIso),
      sourceUrl: ref.sourceUrl ?? rawXmlUrl,
      issuerCompanyId: companyId,
      rawXmlUrl,
    })
    .onConflictDoNothing({ target: filings.accessionNo })
    .returning({ id: filings.id });

  // Lost the race / already ingested — transactions were written with the
  // filing the first time, so there is nothing left to do.
  if (!filing) return null;

  const rows: NewTransaction[] = [];
  for (const txn of doc.transactions) {
    if (!isSecTransactionCode(txn.code)) {
      log("unknown_transaction_code", { accessionNo: ref.accessionNo, code: txn.code });
      continue;
    }
    rows.push({
      filingId: filing.id,
      insiderId: primaryInsiderId,
      companyId,
      txnDate: txn.transactionDate ?? doc.periodOfReport ?? filedAtIso.slice(0, 10),
      code: txn.code,
      shares: toNumeric(txn.shares),
      price: toNumeric(txn.pricePerShare),
      value: toNumeric(txn.value),
      acquiredDisposed: txn.acquiredDisposed,
      sharesOwnedAfter: toNumeric(txn.sharesOwnedAfter),
      is10b51: txn.isTenB51,
      isDerivative: txn.isDerivative,
      footnote: txn.footnote,
      country: "US",
    });
  }
  if (rows.length > 0) {
    await db.insert(transactions).values(rows);
  }
  return { transactionCount: rows.length };
}
