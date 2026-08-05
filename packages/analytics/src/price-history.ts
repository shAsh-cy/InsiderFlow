/**
 * Price-history gap fill.
 *
 * Scoring needs a close on the trade date AND at +30/+90/+180 days, for the
 * stock and for the benchmark. The 1-minute enrichment only caches the trade
 * date itself, so without this job almost nothing would ever score.
 *
 * RATE LIMITS: Stooq publishes no formal quota, so this job self-imposes one
 * (default 1 request/second, bounded symbols per run) and fetches a whole
 * date RANGE per symbol rather than a day at a time — one request covering
 * two years beats five hundred covering one day each.
 */
import { parseStooqCsv, stooqHistoryUrl } from "@insiderflow/core";
import type { FetchLike } from "@insiderflow/core";
import {
  and,
  companies,
  dailyPrices,
  eq,
  gte,
  inArray,
  isNotNull,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import { BENCHMARK_MARKET, BENCHMARK_SYMBOL } from "./scoring-math";

export interface PriceGapOptions {
  db: Database;
  fetchFn?: FetchLike;
  /** Symbols per run. */
  limit?: number;
  requestsPerSecond?: number;
  /** How far back to keep history. Must cover the longest scoring horizon. */
  lookbackDays?: number;
  now?: Date;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export interface PriceGapResult {
  symbolsConsidered: number;
  symbolsFetched: number;
  rowsWritten: number;
  failed: number;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));

export async function fillPriceHistoryGaps(options: PriceGapOptions): Promise<PriceGapResult> {
  const { db } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const fetchFn = (options.fetchFn ?? globalThis.fetch) as FetchLike;
  const minIntervalMs = 1000 / (options.requestsPerSecond ?? 1);
  const lookbackDays = options.lookbackDays ?? 900;
  const from = iso(new Date(now.getTime() - lookbackDays * 86_400_000));
  const to = iso(now);

  /**
   * Symbols with scorable trades, ranked by how thin their cached history is.
   * The benchmark goes first unconditionally — with no SPY series NOTHING
   * scores, so it is never allowed to lose its slot to a busy ticker.
   */
  const candidates = await db
    .select({
      symbol: sql<string>`upper(${companies.ticker})`,
      market: transactions.country,
      trades: sql<number>`count(*)`.mapWith(Number),
      cached: sql<number>`(
        select count(*) from daily_prices dp
        where dp.symbol = upper(${companies.ticker})
          and dp.market = ${transactions.country}
          and dp.price_date >= ${from}
      )`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .where(
      and(
        isNotNull(companies.ticker),
        inArray(transactions.code, ["P", "S"]),
        eq(transactions.relevance, "opportunistic"),
        gte(transactions.txnDate, from),
      ),
    )
    .groupBy(sql`upper(${companies.ticker})`, transactions.country)
    .orderBy(sql`count(*) desc`)
    .limit(options.limit ?? 50);

  const queue = [
    { symbol: BENCHMARK_SYMBOL, market: BENCHMARK_MARKET },
    ...candidates
      // Roughly 252 trading days a year; anything close to complete is skipped.
      .filter((c) => c.cached < (lookbackDays / 365) * 240)
      .map((c) => ({ symbol: c.symbol, market: c.market })),
  ];

  const result: PriceGapResult = {
    symbolsConsidered: queue.length,
    symbolsFetched: 0,
    rowsWritten: 0,
    failed: 0,
  };

  for (const entry of queue) {
    const started = Date.now();
    const url = stooqHistoryUrl(entry.symbol, entry.market, from, to);
    if (!url) continue; // market not covered by the free provider

    try {
      const response = await fetchFn(url);
      if (!response.ok) {
        result.failed++;
        continue;
      }
      const rows = parseStooqCsv(await response.text());
      if (rows.length === 0) continue;
      result.symbolsFetched++;

      for (let i = 0; i < rows.length; i += 500) {
        const written = await db
          .insert(dailyPrices)
          .values(
            rows.slice(i, i + 500).map((r) => ({
              symbol: entry.symbol,
              market: entry.market,
              priceDate: r.date,
              close: String(r.close),
              source: "stooq",
              fetchedAt: now,
            })),
          )
          .onConflictDoNothing()
          .returning({ symbol: dailyPrices.symbol });
        result.rowsWritten += written.length;
      }
    } catch (error) {
      result.failed++;
      log("price_history_failed", {
        symbol: entry.symbol,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    await sleep(minIntervalMs - (Date.now() - started));
  }

  log("price_history_complete", { ...result });
  return result;
}
