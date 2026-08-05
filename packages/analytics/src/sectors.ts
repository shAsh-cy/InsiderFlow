/**
 * Sector enrichment from EDGAR SIC codes.
 *
 * RATE LIMITS: the SEC fair-access policy caps automated traffic at 10
 * requests/second and requires a descriptive User-Agent with a contact
 * address. This job is deliberately slower than the cap (default 5 rps) and
 * bounded per run, because it is a nightly backfill with no deadline — being
 * a good citizen costs us nothing here.
 *
 * WORK QUEUE: companies with a CIK and `sic_fetched_at IS NULL` are enriched
 * first; after that, the oldest lookups are refreshed. Recording the attempt
 * timestamp even on a miss is what stops a company with no SIC from being
 * retried forever on every run.
 */
import { parseEdgarSubmissionProfile, edgarSubmissionsUrl } from "@insiderflow/core";
import type { FetchLike } from "@insiderflow/core";
import { and, asc, companies, eq, isNotNull, isNull, or, lt, sql } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

export interface SectorBackfillOptions {
  db: Database;
  fetchFn?: FetchLike;
  /** Required by SEC fair access, e.g. "InsiderFlow/0.1 (you@example.com)". */
  userAgent: string;
  /** Companies per run. Keeps a nightly job to a predictable wall-clock cost. */
  limit?: number;
  /** Requests per second. Stays under the SEC's 10/s ceiling. */
  requestsPerSecond?: number;
  /** Re-check a company this many days after its last lookup. */
  refreshAfterDays?: number;
  log?: (event: string, data?: Record<string, unknown>) => void;
  now?: Date;
}

export interface SectorBackfillResult {
  considered: number;
  updated: number;
  /** Looked up successfully but EDGAR had no SIC for them. */
  unclassified: number;
  failed: number;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

export async function backfillSectors(
  options: SectorBackfillOptions,
): Promise<SectorBackfillResult> {
  const { db } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const fetchFn = (options.fetchFn ?? globalThis.fetch) as FetchLike;
  const limit = options.limit ?? 200;
  const minIntervalMs = 1000 / (options.requestsPerSecond ?? 5);
  const refreshCutoff = new Date(now.getTime() - (options.refreshAfterDays ?? 90) * 86_400_000);

  const queue = await db
    .select({ id: companies.id, cik: companies.cik, ticker: companies.ticker })
    .from(companies)
    .where(
      and(
        isNotNull(companies.cik),
        or(isNull(companies.sicFetchedAt), lt(companies.sicFetchedAt, refreshCutoff)),
      ),
    )
    // Never-enriched first (NULLS FIRST), then the stalest.
    .orderBy(asc(sql`${companies.sicFetchedAt} nulls first`))
    .limit(limit);

  const result: SectorBackfillResult = {
    considered: queue.length,
    updated: 0,
    unclassified: 0,
    failed: 0,
  };

  for (const company of queue) {
    const started = Date.now();
    try {
      const response = await fetchFn(edgarSubmissionsUrl(company.cik!), {
        headers: { "User-Agent": options.userAgent, Accept: "application/json" },
      });
      if (!response.ok) {
        result.failed++;
        log("sector_backfill_http_error", { cik: company.cik, status: response.status });
        continue;
      }
      const profile = parseEdgarSubmissionProfile(JSON.parse(await response.text()));
      if (!profile) {
        result.failed++;
        continue;
      }

      await db
        .update(companies)
        .set({
          sicCode: profile.sicCode,
          industry: profile.industry,
          // Only overwrite sector when we actually derived one — a company
          // classified by another source must not be blanked by a SIC miss.
          ...(profile.sector ? { sector: profile.sector } : {}),
          ...(profile.exchange ? { exchange: profile.exchange } : {}),
          // Stamped even on a miss, so an unclassifiable company leaves the queue.
          sicFetchedAt: now,
        })
        .where(eq(companies.id, company.id));

      if (profile.sector) result.updated++;
      else result.unclassified++;
    } catch (error) {
      result.failed++;
      log("sector_backfill_failed", {
        cik: company.cik,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await sleep(minIntervalMs - (Date.now() - started));
  }

  log("sector_backfill_complete", { ...result });
  return result;
}
