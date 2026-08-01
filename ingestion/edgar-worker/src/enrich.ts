/**
 * Enrichment services: FX conversion (Frankfurter/ECB, cached in fx_rates —
 * historical rates never change) and daily price context (Stooq, cached in
 * daily_prices). Both free, no API keys.
 */
import {
  frankfurterUrl,
  parseFrankfurterRate,
  parseStooqCsv,
  stooqDailyUrl,
} from "@insiderflow/core";
import {
  and,
  companies,
  dailyPrices,
  eq,
  fxRates,
  gte,
  isNotNull,
  isNull,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import { jsonLogger } from "./http";
import type { FetchLike, Logger } from "./http";
import type { FxRateLookup } from "./pipeline";

/**
 * FX lookup backed by the fx_rates table; misses hit Frankfurter once and
 * are stored forever. Memoized per instance so a batch never queries the
 * same (currency, date) twice.
 */
export function makeFxRateLookup(
  db: Database,
  fetchFn: FetchLike,
  log: Logger = jsonLogger,
): FxRateLookup {
  const memo = new Map<string, number | null>();
  return async (currency, dateIso) => {
    const cur = currency.trim().toUpperCase();
    if (cur === "USD") return 1;
    const date = dateIso.slice(0, 10);
    const memoKey = `${cur}:${date}`;
    const memoized = memo.get(memoKey);
    if (memoized !== undefined) return memoized;

    const [row] = await db
      .select()
      .from(fxRates)
      .where(and(eq(fxRates.currency, cur), eq(fxRates.date, date)));
    if (row) {
      const rate = Number(row.rateUsd);
      memo.set(memoKey, rate);
      return rate;
    }

    try {
      const response = await fetchFn(frankfurterUrl(cur, date));
      if (!response.ok) {
        memo.set(memoKey, null);
        return null;
      }
      const rate = parseFrankfurterRate(JSON.parse(await response.text()));
      if (rate !== null) {
        await db
          .insert(fxRates)
          .values({ currency: cur, date, rateUsd: String(rate) })
          .onConflictDoNothing();
      }
      memo.set(memoKey, rate);
      return rate;
    } catch (error) {
      log("fx_lookup_failed", {
        currency: cur,
        date,
        message: error instanceof Error ? error.message : String(error),
      });
      memo.set(memoKey, null);
      return null;
    }
  };
}

/** Daily close for (symbol, market, date) — served from daily_prices, else fetched from Stooq and cached. */
export async function getDailyClose(
  db: Database,
  fetchFn: FetchLike,
  symbol: string,
  market: string,
  dateIso: string,
): Promise<number | null> {
  const sym = symbol.trim().toUpperCase();
  const date = dateIso.slice(0, 10);

  const [cached] = await db
    .select()
    .from(dailyPrices)
    .where(
      and(
        eq(dailyPrices.symbol, sym),
        eq(dailyPrices.market, market),
        eq(dailyPrices.priceDate, date),
      ),
    );
  if (cached) return Number(cached.close);

  const url = stooqDailyUrl(sym, market, date);
  if (!url) return null; // market not covered by the free provider

  const response = await fetchFn(url);
  if (!response.ok) return null;
  const rows = parseStooqCsv(await response.text());
  const hit = rows.find((r) => r.date === date) ?? rows[0];
  if (!hit) return null;

  await db
    .insert(dailyPrices)
    .values({ symbol: sym, market, priceDate: date, close: String(hit.close) })
    .onConflictDoNothing();
  return hit.close;
}

/**
 * Attach price context to recent opportunistic trades: make sure the
 * (symbol, txn date) daily close is cached so the UI can show the trade
 * price against the market close. Capped per run to stay polite.
 */
export async function enrichRecentPrices(
  db: Database,
  fetchFn: FetchLike,
  { limit = 10, log = jsonLogger }: { limit?: number; log?: Logger } = {},
): Promise<number> {
  const candidates = await db
    .select({
      ticker: companies.ticker,
      market: transactions.country,
      date: transactions.txnDate,
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .leftJoin(
      dailyPrices,
      and(
        eq(dailyPrices.symbol, companies.ticker),
        eq(dailyPrices.market, transactions.country),
        eq(dailyPrices.priceDate, transactions.txnDate),
      ),
    )
    .where(
      and(
        eq(transactions.relevance, "opportunistic"),
        isNotNull(companies.ticker),
        isNull(dailyPrices.symbol),
        gte(transactions.createdAt, new Date(Date.now() - 24 * 3600 * 1000)),
      ),
    )
    .groupBy(companies.ticker, transactions.country, transactions.txnDate)
    .limit(limit);

  let fetched = 0;
  for (const row of candidates) {
    const close = await getDailyClose(db, fetchFn, row.ticker!, row.market, row.date);
    if (close !== null) fetched++;
  }
  if (candidates.length > 0) {
    log("price_enrichment", { candidates: candidates.length, fetched });
  }
  return fetched;
}
