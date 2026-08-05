/**
 * Insider performance scoring — the nightly job that fills trade_returns and
 * insider_scores.
 *
 * ELIGIBILITY (a trade only scores if ALL of these hold):
 *   - code P or S (an open-market purchase or sale)
 *   - relevance = opportunistic (routine comp plumbing is not a decision)
 *   - the filing is not superseded by an amendment
 *   - the company has a ticker and a market the price provider covers
 *   - a close exists within PRICE_TOLERANCE_DAYS of the trade date, and of
 *     the horizon date, for BOTH the stock and the benchmark
 *
 * A horizon whose price is missing yields null for that horizon rather than a
 * substituted value — a gap in the data is not a zero return.
 *
 * INFORMATIONAL ONLY, not investment advice. Formulas: /docs/methodology.
 */
import {
  and,
  companies,
  dailyPrices,
  desc,
  eq,
  filings,
  gte,
  inArray,
  insiderScores,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  tradeReturns,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import {
  BENCHMARK_MARKET,
  BENCHMARK_SYMBOL,
  compositeScore,
  HORIZONS,
  hitRate,
  mean,
  median,
  periodReturn,
  realizedRoundTrips,
  signedExcess,
} from "./scoring-math";
import type { Horizon, RoundTripLot } from "./scoring-math";

/** How far past a target date we will look for the next available close. */
export const PRICE_TOLERANCE_DAYS = 7;

export interface ScoringOptions {
  db: Database;
  /** Scored trades must be at least this old, so the 30-day horizon can exist. */
  minAgeDays?: number;
  /** How far back to (re)score. */
  lookbackDays?: number;
  limit?: number;
  now?: Date;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export interface ScoringResult {
  tradesConsidered: number;
  tradesScored: number;
  insidersUpdated: number;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export const addDays = (dateIso: string, days: number): string =>
  iso(new Date(new Date(`${dateIso}T00:00:00Z`).getTime() + days * 86_400_000));

/** symbol|market → sorted [date, close] pairs. */
type PriceSeries = Map<string, Array<[string, number]>>;

async function loadPriceSeries(
  db: Database,
  symbols: Array<{ symbol: string; market: string }>,
  from: string,
): Promise<PriceSeries> {
  const series: PriceSeries = new Map();
  if (symbols.length === 0) return series;

  const rows = await db
    .select({
      symbol: dailyPrices.symbol,
      market: dailyPrices.market,
      priceDate: dailyPrices.priceDate,
      close: dailyPrices.close,
    })
    .from(dailyPrices)
    .where(
      and(
        gte(dailyPrices.priceDate, from),
        inArray(dailyPrices.symbol, [...new Set(symbols.map((s) => s.symbol))]),
      ),
    )
    .orderBy(dailyPrices.symbol, dailyPrices.market, dailyPrices.priceDate);

  for (const row of rows) {
    const key = `${row.symbol}|${row.market}`;
    const list = series.get(key) ?? [];
    list.push([row.priceDate, Number(row.close)]);
    series.set(key, list);
  }
  return series;
}

/**
 * First close on or after `target`, within the tolerance window. Markets
 * close on weekends and holidays, so an exact-date lookup would silently
 * drop a fifth of all trades.
 */
export function closeOnOrAfter(
  series: Array<[string, number]> | undefined,
  target: string,
  toleranceDays = PRICE_TOLERANCE_DAYS,
): number | null {
  if (!series || series.length === 0) return null;
  const limit = addDays(target, toleranceDays);
  for (const [date, close] of series) {
    if (date < target) continue;
    if (date > limit) return null;
    return close;
  }
  return null;
}

export async function scoreTrades(options: ScoringOptions): Promise<ScoringResult> {
  const { db } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const minAgeDays = options.minAgeDays ?? 30;
  const lookbackDays = options.lookbackDays ?? 730;

  const newestScorable = iso(new Date(now.getTime() - minAgeDays * 86_400_000));
  const oldest = iso(new Date(now.getTime() - lookbackDays * 86_400_000));

  const candidates = await db
    .select({
      id: transactions.id,
      insiderId: transactions.insiderId,
      companyId: transactions.companyId,
      txnDate: transactions.txnDate,
      code: transactions.code,
      shares: transactions.shares,
      price: transactions.price,
      ticker: companies.ticker,
      market: transactions.country,
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .leftJoin(filings, eq(transactions.filingId, filings.id))
    .where(
      and(
        inArray(transactions.code, ["P", "S"]),
        eq(transactions.relevance, "opportunistic"),
        isNotNull(companies.ticker),
        gte(transactions.txnDate, oldest),
        lte(transactions.txnDate, newestScorable),
        // Superseded rows were replaced by an amendment — not a real decision.
        or(isNull(transactions.filingId), isNull(filings.supersededByFilingId)),
      ),
    )
    .orderBy(desc(transactions.txnDate))
    .limit(options.limit ?? 5000);

  const result: ScoringResult = {
    tradesConsidered: candidates.length,
    tradesScored: 0,
    insidersUpdated: 0,
  };
  if (candidates.length === 0) return result;

  const symbols = candidates
    .filter((c) => c.ticker)
    .map((c) => ({ symbol: c.ticker!.toUpperCase(), market: c.market }));
  symbols.push({ symbol: BENCHMARK_SYMBOL, market: BENCHMARK_MARKET });

  const earliest = candidates.reduce((min, c) => (c.txnDate < min ? c.txnDate : min), iso(now));
  const series = await loadPriceSeries(db, symbols, earliest);
  const benchmark = series.get(`${BENCHMARK_SYMBOL}|${BENCHMARK_MARKET}`);

  const rows: Array<typeof tradeReturns.$inferInsert> = [];

  for (const candidate of candidates) {
    const direction = candidate.code === "P" ? "buy" : "sell";
    const key = `${candidate.ticker!.toUpperCase()}|${candidate.market}`;
    const stock = series.get(key);

    const entry = closeOnOrAfter(stock, candidate.txnDate);
    const benchEntry = closeOnOrAfter(benchmark, candidate.txnDate);
    if (entry === null || benchEntry === null) continue;

    const perHorizon: Record<
      string,
      { ret: number | null; bench: number | null; excess: number | null }
    > = {};
    for (const h of HORIZONS) {
      const target = addDays(candidate.txnDate, h);
      const exit = closeOnOrAfter(stock, target);
      const benchExit = closeOnOrAfter(benchmark, target);
      const ret = exit === null ? null : periodReturn(entry, exit);
      const bench = benchExit === null ? null : periodReturn(benchEntry, benchExit);
      perHorizon[h] = { ret, bench, excess: signedExcess(ret, bench, direction) };
    }

    // Nothing computable at any horizon — do not write an all-null row.
    if (HORIZONS.every((h) => perHorizon[h]!.ret === null)) continue;

    const s = (v: number | null): string | null => (v === null ? null : v.toFixed(6));
    rows.push({
      transactionId: candidate.id,
      insiderId: candidate.insiderId,
      companyId: candidate.companyId,
      direction,
      txnDate: candidate.txnDate,
      entryClose: entry.toFixed(4),
      ret30d: s(perHorizon[30]!.ret),
      ret90d: s(perHorizon[90]!.ret),
      ret180d: s(perHorizon[180]!.ret),
      bench30d: s(perHorizon[30]!.bench),
      bench90d: s(perHorizon[90]!.bench),
      bench180d: s(perHorizon[180]!.bench),
      excess30d: s(perHorizon[30]!.excess),
      excess90d: s(perHorizon[90]!.excess),
      excess180d: s(perHorizon[180]!.excess),
      computedAt: now,
    });
  }

  // Chunked so a large rescore never builds one oversized statement.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    await db
      .insert(tradeReturns)
      .values(chunk)
      .onConflictDoUpdate({
        target: tradeReturns.transactionId,
        set: {
          entryClose: sql`excluded.entry_close`,
          ret30d: sql`excluded.ret_30d`,
          ret90d: sql`excluded.ret_90d`,
          ret180d: sql`excluded.ret_180d`,
          bench30d: sql`excluded.bench_30d`,
          bench90d: sql`excluded.bench_90d`,
          bench180d: sql`excluded.bench_180d`,
          excess30d: sql`excluded.excess_30d`,
          excess90d: sql`excluded.excess_90d`,
          excess180d: sql`excluded.excess_180d`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
  result.tradesScored = rows.length;

  result.insidersUpdated = await rollUpInsiderScores(db, now);
  log("scoring_complete", { ...result });
  return result;
}

/**
 * Roll trade_returns into per-insider aggregates. A separate statement from
 * the writes above (see the CTE warning in the ingestion worker) — a
 * data-modifying CTE could not see the rows it had just inserted.
 */
export async function rollUpInsiderScores(db: Database, now = new Date()): Promise<number> {
  const rows = await db
    .select({
      insiderId: tradeReturns.insiderId,
      txnDate: tradeReturns.txnDate,
      excess30d: tradeReturns.excess30d,
      excess90d: tradeReturns.excess90d,
      excess180d: tradeReturns.excess180d,
    })
    .from(tradeReturns);
  if (rows.length === 0) return 0;

  const byInsider = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byInsider.get(row.insiderId) ?? [];
    list.push(row);
    byInsider.set(row.insiderId, list);
  }

  const realized = await realizedByInsider(db, [...byInsider.keys()]);

  const values: Array<typeof insiderScores.$inferInsert> = [];
  for (const [insiderId, trades] of byInsider) {
    const nums = (key: "excess30d" | "excess90d" | "excess180d") =>
      trades
        .map((t) => t[key])
        .filter((v): v is string => v !== null)
        .map(Number);

    const e30 = nums("excess30d");
    const e90 = nums("excess90d");
    const e180 = nums("excess180d");
    const rt = realized.get(insiderId);
    const s = (v: number | null): string | null => (v === null ? null : v.toFixed(6));

    values.push({
      insiderId,
      scoredTrades: trades.length,
      wins90d: e90.filter((v) => v > 0).length,
      hitRate90d: s(hitRate(e90)),
      avgExcess30d: s(mean(e30)),
      avgExcess90d: s(mean(e90)),
      avgExcess180d: s(mean(e180)),
      medianExcess90d: s(median(e90)),
      realizedTrades: rt?.trades ?? 0,
      realizedReturnPct: s(rt?.returnPct ?? null),
      score: s(compositeScore(e90)),
      lastTradeDate: trades.reduce((max, t) => (t.txnDate > max ? t.txnDate : max), "0000-01-01"),
      computedAt: now,
    });
  }

  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(insiderScores)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: insiderScores.insiderId,
        set: {
          scoredTrades: sql`excluded.scored_trades`,
          wins90d: sql`excluded.wins_90d`,
          hitRate90d: sql`excluded.hit_rate_90d`,
          avgExcess30d: sql`excluded.avg_excess_30d`,
          avgExcess90d: sql`excluded.avg_excess_90d`,
          avgExcess180d: sql`excluded.avg_excess_180d`,
          medianExcess90d: sql`excluded.median_excess_90d`,
          realizedTrades: sql`excluded.realized_trades`,
          realizedReturnPct: sql`excluded.realized_return_pct`,
          score: sql`excluded.score`,
          lastTradeDate: sql`excluded.last_trade_date`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }
  return values.length;
}

/** FIFO round-trip P&L per insider, matched within each company separately. */
async function realizedByInsider(
  db: Database,
  insiderIds: string[],
): Promise<Map<string, { trades: number; returnPct: number | null }>> {
  const out = new Map<string, { trades: number; returnPct: number | null }>();
  if (insiderIds.length === 0) return out;

  const rows = await db
    .select({
      insiderId: transactions.insiderId,
      companyId: transactions.companyId,
      txnDate: transactions.txnDate,
      code: transactions.code,
      shares: transactions.shares,
      price: transactions.price,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.insiderId, insiderIds),
        inArray(transactions.code, ["P", "S"]),
        eq(transactions.relevance, "opportunistic"),
        isNotNull(transactions.shares),
        isNotNull(transactions.price),
      ),
    );

  // Positions are per (insider, company): a sale of A never closes a buy of B.
  const byPair = new Map<string, RoundTripLot[]>();
  for (const row of rows) {
    const key = `${row.insiderId}|${row.companyId}`;
    const shares = Number(row.shares);
    const price = Number(row.price);
    if (!Number.isFinite(shares) || !Number.isFinite(price) || shares <= 0 || price <= 0) continue;
    const list = byPair.get(key) ?? [];
    list.push({
      shares: row.code === "P" ? shares : -shares,
      price,
      date: row.txnDate,
    });
    byPair.set(key, list);
  }

  const perInsider = new Map<string, { weighted: number; shares: number; trades: number }>();
  for (const [key, lots] of byPair) {
    const insiderId = key.split("|")[0]!;
    const rt = realizedRoundTrips(lots);
    if (rt.trades === 0 || rt.returnPct === null) continue;
    const acc = perInsider.get(insiderId) ?? { weighted: 0, shares: 0, trades: 0 };
    acc.weighted += rt.returnPct * rt.trades;
    acc.shares += rt.trades;
    acc.trades += rt.trades;
    perInsider.set(insiderId, acc);
  }

  for (const [insiderId, acc] of perInsider) {
    out.set(insiderId, {
      trades: acc.trades,
      returnPct: acc.shares > 0 ? acc.weighted / acc.shares : null,
    });
  }
  return out;
}

export type { Horizon };
