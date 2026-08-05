/**
 * Backfill ownership filings from EDGAR daily form indexes.
 *
 *   pnpm backfill -- --days=30 --forms=4 --max=5000
 *   pnpm backfill -- --days=3 --reconcile        # report gaps, do not ingest
 *
 * Two jobs, and the second is the important one.
 *
 * BACKFILL loads history the live path never saw.
 *
 * RECONCILE (`--reconcile`) audits the live path. The daily full-index is a
 * COMPLETE list of what EDGAR published; the feed is a rolling window the live
 * path samples. Anything in the index that is neither ingested nor queued is a
 * filing the live path MISSED, and that is worth knowing loudly — a job that
 * silently fixes gaps hides the defect that produced them, and the next reader
 * concludes ingestion is reliable because nothing ever looked wrong. So
 * reconcile REPORTS every missing accession number (and enqueues them, which
 * is the repair, but the report is the point).
 *
 * Requires DATABASE_URL and EDGAR_USER_AGENT in the environment. Runs on
 * Node 20+ (uses global fetch); also invoked by .github/workflows/backfill.yml.
 */
import { edgarDailyFormIdxUrl, parseDailyFormIdx } from "@insiderflow/core";
import type { EdgarFilingRef } from "@insiderflow/core";
import { createDbHandle, filings, inArray, pendingFilings } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import { EdgarHttpError, fetchWithRetry, jsonLogger, RateLimiter } from "../src/http";
import type { FetchLike } from "../src/http";
import { enqueueFilingRefs, ingestFilingRefs } from "../src/pipeline";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

const days = Math.max(1, Number(argValue("days") ?? "30"));
const forms = (argValue("forms") ?? "4")
  .split(",")
  .map((f) => f.trim())
  .filter(Boolean);
const max = Math.max(1, Number(argValue("max") ?? "5000"));
const reconcile = process.argv.includes("--reconcile");

const databaseUrl = process.env.DATABASE_URL;
const userAgent = process.env.EDGAR_USER_AGENT;
if (!databaseUrl || !userAgent) {
  console.error("backfill: DATABASE_URL and EDGAR_USER_AGENT must be set");
  process.exit(1);
}

const fetchFn: FetchLike = fetch;

async function main(): Promise<void> {
  const limiter = new RateLimiter(250);
  const headers = { "User-Agent": userAgent!, "Accept-Encoding": "gzip, deflate" };

  const refs: EdgarFilingRef[] = [];
  const now = Date.now();
  for (let i = 0; i < days; i++) {
    const day = new Date(now - i * 86_400_000);
    const weekday = day.getUTCDay();
    if (weekday === 0 || weekday === 6) continue; // EDGAR publishes business days only

    const url = edgarDailyFormIdxUrl(day);
    await limiter.wait();
    try {
      const response = await fetchWithRetry(fetchFn, url, headers, { log: jsonLogger });
      const dayRefs = parseDailyFormIdx(await response.text(), forms);
      refs.push(...dayRefs);
      jsonLogger("backfill_day", { url, filings: dayRefs.length });
    } catch (error) {
      // Market holidays have no index file.
      if (error instanceof EdgarHttpError && error.status === 404) {
        jsonLogger("backfill_day_missing", { url });
        continue;
      }
      throw error;
    }
  }

  jsonLogger("backfill_discovered", {
    days,
    forms,
    discovered: refs.length,
    processing: Math.min(refs.length, max),
  });

  const handle = createDbHandle(databaseUrl!);
  try {
    if (reconcile) {
      await reportGaps(handle.db, refs);
      return;
    }
    const stats = await ingestFilingRefs(refs, {
      db: handle.db,
      userAgent: userAgent!,
      fetchFn,
      maxFilings: max,
      requestDelayMs: 200, // 5 req/s, still well under the 10 req/s cap
      log: jsonLogger,
    });
    jsonLogger("backfill_complete", { ...stats });
    if (stats.errors > 0 && stats.ingested === 0) process.exitCode = 1;
  } finally {
    await handle.end();
  }
}

/**
 * Compare the authoritative index against what we hold, and say what is
 * missing before repairing it.
 *
 * Deliberately loud and deliberately non-fatal. A gap is an ingestion defect,
 * not a broken build: exiting non-zero would train people to ignore the job,
 * and the whole value here is that someone reads the number.
 */
async function reportGaps(db: Database, refs: EdgarFilingRef[]): Promise<void> {
  const byAccession = new Map(refs.map((r) => [r.accessionNo, r]));
  const accessions = [...byAccession.keys()];

  const seen = new Set<string>();
  for (let i = 0; i < accessions.length; i += 200) {
    const chunk = accessions.slice(i, i + 200);
    const ingested = await db
      .select({ accessionNo: filings.accessionNo })
      .from(filings)
      .where(inArray(filings.accessionNo, chunk));
    for (const row of ingested) seen.add(row.accessionNo);
    const queued = await db
      .select({ accessionNo: pendingFilings.accessionNo })
      .from(pendingFilings)
      .where(inArray(pendingFilings.accessionNo, chunk));
    for (const row of queued) seen.add(row.accessionNo);
  }

  const missing = accessions.filter((a) => !seen.has(a));
  const coverage = accessions.length === 0 ? 1 : 1 - missing.length / accessions.length;

  jsonLogger("reconcile_complete", {
    indexed: accessions.length,
    held: accessions.length - missing.length,
    missing: missing.length,
    coverage: Number(coverage.toFixed(4)),
    // Bounded sample: the count is the metric, the list is for investigating.
    missingSample: missing.slice(0, 25),
  });

  if (missing.length > 0) {
    // Repair AFTER reporting, and say that the repair happened, so the gap is
    // never inferred from a silently-shrinking number.
    const { enqueued } = await enqueueFilingRefs(
      db,
      missing.map((a) => byAccession.get(a)!),
      "reconcile",
    );
    jsonLogger("reconcile_gap", {
      missing: missing.length,
      enqueued,
      detail:
        "These filings were published by EDGAR and reached neither the filings table nor " +
        "the pending queue. The live feed path missed them. They are now queued.",
    });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
