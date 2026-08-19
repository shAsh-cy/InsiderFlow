/**
 * The India local-scrape ingest run. OFF BY DEFAULT — see README for the
 * ToS/licensing posture. Structured rows come from NSE's corporate APIs;
 * BSE provides an independent announcements cross-check. PIT disclosures
 * flow through the exact same feed contract + adapter + persistUnified
 * path as a licensed INDIA_FEED_URL feed; SAST / bulk-block / pledge rows
 * land in their own tables with INR native + USD converted values.
 */
import {
  NSE_PIT_REFERER,
  NSE_PRIME_URL,
  assignOccurrenceKeys,
  filterBseInsiderAnnouncements,
  indiaAdapter,
  mapPitXbrlToDisclosures,
  normalizeBulkBlockRows,
  normalizePledgeRows,
  normalizeSastRows,
  nseBulkBlockUrl,
  nsePitIndexUrl,
  nsePledgeUrl,
  nseSastUrl,
  parsePitXbrl,
  toUsd,
} from "@insiderflow/core";
import type {
  BulkBlockRecord,
  FetchLike,
  IndiaDisclosureRecord,
  NseBulkBlockRawRow,
  NsePitIndexRow,
  NsePledgeRawRow,
  NseSastRawRow,
  PledgeRecord,
  SastRecord,
} from "@insiderflow/core";
import {
  bulkBlockDeals,
  ingestionState,
  pledgeDisclosures,
  sastDisclosures,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";
import { jsonLogger, RateLimiter } from "@insiderflow/edgar-worker/http";
import type { Logger } from "@insiderflow/edgar-worker/http";
import { persistUnified } from "@insiderflow/edgar-worker/pipeline";
import type { FxRateLookup } from "@insiderflow/edgar-worker/pipeline";

import { fetchBseAnnouncements } from "./bse";

export class IndiaIngestDisabledError extends Error {
  constructor() {
    super(
      "India local scraping is OFF by default. It fetches NSE/BSE data whose website terms " +
        "restrict automated access — enable it only if you accept that risk or hold a license " +
        "(see ingestion/india-local/README.md). Set ENABLE_INDIA_INGEST=true to proceed. " +
        "The licensed-feed alternative (INDIA_FEED_URL on the worker) involves no scraping.",
    );
    this.name = "IndiaIngestDisabledError";
  }
}

/** Hard gate: everything in this module refuses to run unless explicitly enabled. */
export function assertIndiaIngestEnabled(env: Record<string, string | undefined>): void {
  if (env.ENABLE_INDIA_INGEST !== "true") {
    throw new IndiaIngestDisabledError();
  }
}

export interface NseJsonSession {
  getJson<T>(url: string, referer: string): Promise<T>;
  /** PIT documents are XBRL, not JSON — same session, same rate limiter. */
  getText(url: string, referer: string): Promise<string>;
}

export interface IndiaIngestOptions {
  db: Database;
  session: NseJsonSession;
  fxRateLookup: FxRateLookup;
  /** Optional BSE transport; omit to skip the cross-check. */
  bseFetch?: FetchLike;
  /** Lookback window in days (default 7). */
  days?: number;
  log?: Logger;
  now?: Date;
}

export interface IndiaIngestStats {
  window: { from: string; to: string };
  /**
   * `filings` is index rows seen; `raw` is TRANSACTIONS extracted from the
   * documents fetched. Since PIT V2.0 those are different numbers — one
   * filing routinely carries several trades — and conflating them is how a
   * halved tape would look healthy.
   */
  pit: {
    filings: number;
    documentsFetched: number;
    documentsFailed: number;
    raw: number;
    normalized: number;
    inserted: number;
    deduped: number;
  };
  sast: { raw: number; inserted: number };
  bulkBlock: { raw: number; inserted: number };
  pledge: { raw: number; inserted: number };
  bseInsiderAnnouncements: number | null;
}

interface NseApiResponse<T> {
  data?: T[];
}

const toNumeric = (n: number | null): string | null => (n === null ? null : String(n));

async function usdFor(
  fx: FxRateLookup,
  value: number | null,
  dateIso: string,
): Promise<string | null> {
  if (value === null) return null;
  return toNumeric(toUsd(value, await fx("INR", dateIso)));
}

export async function runIndiaIngest(options: IndiaIngestOptions): Promise<IndiaIngestStats> {
  const { db, session, fxRateLookup } = options;
  const log = options.log ?? jsonLogger;
  const now = options.now ?? new Date();
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (options.days ?? 7) * 86_400_000)
    .toISOString()
    .slice(0, 10);

  // ── 1. PIT: filing index → XBRL document → the licensed-feed contract ──
  //
  // Two steps, not one, since NSE's PIT V2.0 (30-04-2026). The index row is
  // a SUBMISSION and carries no numbers; the trades are in the XBRL it
  // links. Structurally identical to EDGAR — index, then parse — which is
  // why `persistUnified` below is unchanged.
  //
  // The old one-call path is gone because it returns nothing. It was not
  // removed for tidiness: `corporates-pit` answers HTTP 200 with an empty
  // envelope, which this repository read as an IP block for three rounds.
  const pitIndex =
    (
      await session.getJson<NseApiResponse<NsePitIndexRow>>(
        nsePitIndexUrl(from, to),
        NSE_PIT_REFERER,
      )
    ).data ?? [];

  const records: IndiaDisclosureRecord[] = [];
  let pitDocumentsFetched = 0;
  let pitDocumentsFailed = 0;

  for (const row of pitIndex) {
    if (!row.xmlFileName) continue;
    try {
      // Through the session so the shared limiter applies: an index of 169
      // filings is 169 more requests, and the whole point of one limiter is
      // that adding a step cannot quietly double the request rate.
      const xml = await session.getText(row.xmlFileName, NSE_PIT_REFERER);
      records.push(...mapPitXbrlToDisclosures(parsePitXbrl(xml), row));
      pitDocumentsFetched += 1;
    } catch (error) {
      // One unreadable document must not cost the other 168.
      pitDocumentsFailed += 1;
      log("india_pit_document_failed", {
        symbol: row.symbol,
        url: row.xmlFileName,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const unified = indiaAdapter.normalize({ records });
  const pitStats = await persistUnified(unified, { db, log, fxRateLookup });
  log("india_pit_ingested", {
    filings: pitIndex.length,
    documentsFetched: pitDocumentsFetched,
    documentsFailed: pitDocumentsFailed,
    raw: records.length,
    normalized: unified.length,
    inserted: pitStats.transactionsInserted,
    deduped: pitStats.transactionsDeduped,
  });

  // ── 2. BSE cross-check (announcement metadata; independent of NSE) ──────
  let bseInsiderAnnouncements: number | null = null;
  if (options.bseFetch) {
    try {
      const announcements = await fetchBseAnnouncements(options.bseFetch, new RateLimiter(500));
      bseInsiderAnnouncements = filterBseInsiderAnnouncements(announcements).length;
      log("india_bse_cross_check", {
        bseInsiderAnnouncements,
        nsePitTransactions: records.length,
      });
    } catch (error) {
      log("india_bse_cross_check_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // ── 3. SAST (Reg. 29/31) ────────────────────────────────────────────────
  const sastResponse = await session.getJson<NseApiResponse<NseSastRawRow>>(
    nseSastUrl(from, to),
    NSE_PRIME_URL,
  );
  const sastRecords = normalizeSastRows(sastResponse.data ?? []);
  const sastInserted = await insertSast(db, sastRecords, fxRateLookup, to);

  // ── 4. Bulk + block deals ───────────────────────────────────────────────
  const deals: BulkBlockRecord[] = [];
  for (const kind of ["bulk_deals", "block_deals"] as const) {
    const response = await session.getJson<NseApiResponse<NseBulkBlockRawRow>>(
      nseBulkBlockUrl(kind, from, to),
      NSE_PRIME_URL,
    );
    deals.push(
      ...normalizeBulkBlockRows(response.data ?? [], kind === "bulk_deals" ? "bulk" : "block"),
    );
  }
  const dealsInserted = await insertBulkBlock(db, deals, fxRateLookup);

  // ── 5. Promoter pledges ─────────────────────────────────────────────────
  const pledgeResponse = await session.getJson<NseApiResponse<NsePledgeRawRow>>(
    nsePledgeUrl(from, to),
    NSE_PRIME_URL,
  );
  const pledgeRecords = normalizePledgeRows(pledgeResponse.data ?? []);
  const pledgeInserted = await insertPledges(db, pledgeRecords, fxRateLookup, to);

  const stats: IndiaIngestStats = {
    window: { from, to },
    pit: {
      filings: pitIndex.length,
      documentsFetched: pitDocumentsFetched,
      documentsFailed: pitDocumentsFailed,
      raw: records.length,
      normalized: unified.length,
      inserted: pitStats.transactionsInserted,
      deduped: pitStats.transactionsDeduped,
    },
    sast: { raw: sastRecords.length, inserted: sastInserted },
    bulkBlock: { raw: deals.length, inserted: dealsInserted },
    pledge: { raw: pledgeRecords.length, inserted: pledgeInserted },
    bseInsiderAnnouncements,
  };

  await db
    .insert(ingestionState)
    .values({ key: "india-local:last_run", value: { at: now.toISOString(), ...stats } })
    .onConflictDoUpdate({
      target: ingestionState.key,
      set: { value: { at: now.toISOString(), ...stats }, updatedAt: now },
    });

  log("india_ingest_complete", { ...stats });
  return stats;
}

async function insertSast(
  db: Database,
  records: SastRecord[],
  fx: FxRateLookup,
  fallbackDate: string,
): Promise<number> {
  if (records.length === 0) return 0;
  const keys = assignOccurrenceKeys(records.map((r) => r.identity));
  const rows = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    rows.push({
      symbol: r.symbol,
      companyName: r.companyName,
      acquirerName: r.acquirerName,
      regulation: r.regulation,
      category: r.category,
      acquisitionMode: r.acquisitionMode,
      side: r.side,
      shares: toNumeric(r.shares),
      sharesPctBefore: toNumeric(r.sharesPctBefore),
      sharesPctAfter: toNumeric(r.sharesPctAfter),
      value: toNumeric(r.value),
      valueUsd: await usdFor(fx, r.value, r.txnDate ?? fallbackDate),
      txnDate: r.txnDate,
      intimatedAt: r.intimatedAt,
      sourceUrl: r.sourceUrl,
      dedupKey: keys[i]!,
    });
  }
  const inserted = await db
    .insert(sastDisclosures)
    .values(rows)
    .onConflictDoNothing({ target: sastDisclosures.dedupKey })
    .returning({ id: sastDisclosures.id });
  return inserted.length;
}

async function insertBulkBlock(
  db: Database,
  records: BulkBlockRecord[],
  fx: FxRateLookup,
): Promise<number> {
  if (records.length === 0) return 0;
  const keys = assignOccurrenceKeys(records.map((r) => r.identity));
  const rows = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    rows.push({
      dealType: r.dealType,
      dealDate: r.dealDate,
      symbol: r.symbol,
      companyName: r.companyName,
      clientName: r.clientName,
      side: r.side,
      quantity: String(r.quantity),
      wap: toNumeric(r.wap),
      value: toNumeric(r.value),
      valueUsd: await usdFor(fx, r.value, r.dealDate),
      remarks: r.remarks,
      dedupKey: keys[i]!,
    });
  }
  const inserted = await db
    .insert(bulkBlockDeals)
    .values(rows)
    .onConflictDoNothing({ target: bulkBlockDeals.dedupKey })
    .returning({ id: bulkBlockDeals.id });
  return inserted.length;
}

async function insertPledges(
  db: Database,
  records: PledgeRecord[],
  fx: FxRateLookup,
  fallbackDate: string,
): Promise<number> {
  if (records.length === 0) return 0;
  const keys = assignOccurrenceKeys(records.map((r) => r.identity));
  const rows = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i]!;
    rows.push({
      symbol: r.symbol,
      companyName: r.companyName,
      promoterName: r.promoterName,
      eventType: r.eventType,
      shares: toNumeric(r.shares),
      sharesPct: toNumeric(r.sharesPct),
      value: null,
      valueUsd: await usdFor(fx, null, r.eventDate ?? fallbackDate),
      eventDate: r.eventDate,
      intimatedAt: r.intimatedAt,
      sourceUrl: r.sourceUrl,
      dedupKey: keys[i]!,
    });
  }
  const inserted = await db
    .insert(pledgeDisclosures)
    .values(rows)
    .onConflictDoNothing({ target: pledgeDisclosures.dedupKey })
    .returning({ id: pledgeDisclosures.id });
  return inserted.length;
}
