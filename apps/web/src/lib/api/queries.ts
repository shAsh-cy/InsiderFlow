import { classifyTransaction, signalWeight } from "@insiderflow/core";
import {
  and,
  apiCache,
  asc,
  companies,
  dailyPrices,
  desc,
  eq,
  filings,
  gte,
  insiders,
  isNull,
  inArray,
  lte,
  or,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import type { HeatmapQuery, TradesQuery } from "./schemas";

const num = (v: string | null): number | null => (v === null ? null : Number(v));

export interface TradeRow {
  id: string;
  source: string;
  market: string;
  txnDate: string;
  code: string;
  rawCode: string | null;
  direction: "buy" | "sell" | "neutral";
  relevance: string;
  signalWeight: number;
  shares: number | null;
  price: number | null;
  value: number | null;
  currency: string;
  priceUsd: number | null;
  valueUsd: number | null;
  acquiredDisposed: string | null;
  sharesOwnedAfter: number | null;
  is10b51: boolean;
  isDerivative: boolean;
  footnote: string | null;
  createdAt: string;
  company: { id: string; ticker: string | null; name: string };
  insider: {
    id: string;
    name: string;
    title: string | null;
    isDirector: boolean;
    isOfficer: boolean;
    isTenPctOwner: boolean;
  };
  filing: {
    accessionNo: string;
    formType: string;
    filedAt: string;
    sourceUrl: string | null;
    superseded: boolean;
  } | null;
}

export interface PageMeta {
  limit: number;
  offset: number;
  count: number;
  hasMore: boolean;
  nextOffset: number | null;
}

const tradeSelection = {
  id: transactions.id,
  source: transactions.source,
  country: transactions.country,
  txnDate: transactions.txnDate,
  code: transactions.code,
  rawCode: transactions.rawCode,
  relevance: transactions.relevance,
  shares: transactions.shares,
  price: transactions.price,
  value: transactions.value,
  currency: transactions.currency,
  priceUsd: transactions.priceUsd,
  valueUsd: transactions.valueUsd,
  acquiredDisposed: transactions.acquiredDisposed,
  sharesOwnedAfter: transactions.sharesOwnedAfter,
  is10b51: transactions.is10b51,
  isDerivative: transactions.isDerivative,
  footnote: transactions.footnote,
  createdAt: transactions.createdAt,
  companyId: companies.id,
  companyTicker: companies.ticker,
  companyName: companies.name,
  insiderId: insiders.id,
  insiderName: insiders.name,
  insiderTitle: insiders.officerTitle,
  insiderIsDirector: insiders.isDirector,
  insiderIsOfficer: insiders.isOfficer,
  insiderIsTenPct: insiders.isTenPctOwner,
  filingAccessionNo: filings.accessionNo,
  filingFormType: filings.formType,
  filingFiledAt: filings.filedAt,
  filingSourceUrl: filings.sourceUrl,
  filingSupersededBy: filings.supersededByFilingId,
};

type TradeSelectionRow = {
  [K in keyof typeof tradeSelection]: (typeof tradeSelection)[K] extends { _: { data: infer D } }
    ? D | null
    : unknown;
};

export function serializeTrade(row: Record<string, unknown>): TradeRow {
  const r = row as TradeSelectionRow;
  return {
    id: String(r.id),
    source: String(r.source),
    market: String(r.country),
    txnDate: String(r.txnDate),
    code: String(r.code),
    rawCode: (r.rawCode as string | null) ?? null,
    direction: classifyTransaction(String(r.code)),
    relevance: String(r.relevance),
    signalWeight: signalWeight(String(r.code)),
    shares: num(r.shares as string | null),
    price: num(r.price as string | null),
    value: num(r.value as string | null),
    currency: String(r.currency),
    priceUsd: num(r.priceUsd as string | null),
    valueUsd: num(r.valueUsd as string | null),
    acquiredDisposed: (r.acquiredDisposed as string | null) ?? null,
    sharesOwnedAfter: num(r.sharesOwnedAfter as string | null),
    is10b51: Boolean(r.is10b51),
    isDerivative: Boolean(r.isDerivative),
    footnote: (r.footnote as string | null) ?? null,
    createdAt: (r.createdAt as Date).toISOString(),
    company: {
      id: String(r.companyId),
      ticker: (r.companyTicker as string | null) ?? null,
      name: String(r.companyName),
    },
    insider: {
      id: String(r.insiderId),
      name: String(r.insiderName),
      title: (r.insiderTitle as string | null) ?? null,
      isDirector: Boolean(r.insiderIsDirector),
      isOfficer: Boolean(r.insiderIsOfficer),
      isTenPctOwner: Boolean(r.insiderIsTenPct),
    },
    filing: r.filingAccessionNo
      ? {
          accessionNo: String(r.filingAccessionNo),
          formType: String(r.filingFormType),
          filedAt: (r.filingFiledAt as Date).toISOString(),
          sourceUrl: (r.filingSourceUrl as string | null) ?? null,
          superseded: r.filingSupersededBy !== null,
        }
      : null,
  };
}

function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/*
 * ── Phase 8 swap points ────────────────────────────────────────────────────
 * Cluster / dip / near-low are computed at query time today. Phase 8 will
 * precompute them as flags during ingestion; only these three functions
 * change — pages and routes stay untouched.
 */

/** Companies where ≥2 distinct insiders bought (code P) within a rolling 14-day window. */
export function clusterCompaniesSubquery(db: Database, windowDays = 14) {
  return db
    .select({ companyId: transactions.companyId })
    .from(transactions)
    .where(and(eq(transactions.code, "P"), gte(transactions.txnDate, cutoffIso(windowDays))))
    .groupBy(transactions.companyId)
    .having(sql`count(distinct ${transactions.insiderId}) >= 2`);
}

/** Buys with a 5%+ drawdown vs that day's close (needs cached price context). */
function dipCondition() {
  return sql`exists (select 1 from daily_prices dp
    where dp.symbol = ${companies.ticker}
      and dp.market = ${transactions.country}
      and dp.price_date = ${transactions.txnDate}
      and ${transactions.price} <= dp.close * 0.95)`;
}

/** Trade-day close within 5% of the 52-week low of cached prices (≥5 points required). */
function nearLowCondition() {
  return sql`exists (select 1 from daily_prices dp
    where dp.symbol = ${companies.ticker}
      and dp.market = ${transactions.country}
      and dp.price_date = ${transactions.txnDate}
      and (select count(*) from daily_prices h
             where h.symbol = dp.symbol and h.market = dp.market
               and h.price_date >= current_date - 365) >= 5
      and dp.close <= (select min(h.close) * 1.05 from daily_prices h
             where h.symbol = dp.symbol and h.market = dp.market
               and h.price_date >= current_date - 365))`;
}

function tradeConditions(q: TradesQuery) {
  const conds = [];
  if (q.market) conds.push(eq(transactions.country, q.market));
  if (q.ticker) conds.push(eq(companies.ticker, q.ticker));
  if (q.side) conds.push(eq(transactions.acquiredDisposed, q.side === "buy" ? "A" : "D"));
  if (q.sector) conds.push(eq(companies.sector, q.sector));
  if (q.near_low) conds.push(nearLowCondition());
  if (q.code) conds.push(eq(transactions.code, q.code as typeof transactions.code._.data));
  if (q.relevance) conds.push(eq(transactions.relevance, q.relevance));
  if (q.source) conds.push(eq(transactions.source, q.source));
  if (q.insider_id) conds.push(eq(transactions.insiderId, q.insider_id));
  if (q.min_value !== undefined) conds.push(gte(transactions.value, String(q.min_value)));
  if (q.min_value_usd !== undefined)
    conds.push(gte(transactions.valueUsd, String(q.min_value_usd)));
  if (q.from) conds.push(gte(transactions.txnDate, q.from));
  if (q.to) conds.push(lte(transactions.txnDate, q.to));
  if (q.role === "director") conds.push(eq(insiders.isDirector, true));
  if (q.role === "officer" || q.exec_only) conds.push(eq(insiders.isOfficer, true));
  if (q.role === "ten_pct") conds.push(eq(insiders.isTenPctOwner, true));
  // Amendments replace originals: hide superseded filings unless asked.
  if (!q.include_superseded) {
    conds.push(or(isNull(transactions.filingId), isNull(filings.supersededByFilingId)));
  }
  if (q.dip) conds.push(dipCondition());
  return conds;
}

export async function queryTrades(
  db: Database,
  q: TradesQuery,
): Promise<{ data: TradeRow[]; meta: PageMeta }> {
  const conds = tradeConditions(q);

  if (q.cluster) {
    conds.push(inArray(transactions.companyId, clusterCompaniesSubquery(db)));
  }

  const sortColumn = {
    txn_date: transactions.txnDate,
    value: transactions.value,
    value_usd: transactions.valueUsd,
    created_at: transactions.createdAt,
  }[q.sort];

  const rows = await db
    .select(tradeSelection)
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .innerJoin(insiders, eq(transactions.insiderId, insiders.id))
    .leftJoin(filings, eq(transactions.filingId, filings.id))
    .where(and(...conds))
    .orderBy(
      q.order === "asc" ? asc(sortColumn) : desc(sortColumn),
      desc(transactions.createdAt),
      desc(transactions.id),
    )
    .limit(q.limit + 1)
    .offset(q.offset);

  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return {
    data: page.map((r) => serializeTrade(r)),
    meta: {
      limit: q.limit,
      offset: q.offset,
      count: page.length,
      hasMore,
      nextOffset: hasMore ? q.offset + q.limit : null,
    },
  };
}

export interface CompanyStats {
  trades: number;
  buyValueUsd: number;
  sellValueUsd: number;
  netValueUsd: number;
  opportunisticTrades: number;
}

export async function queryCompanyStats(
  db: Database,
  companyId: string,
  days = 90,
): Promise<CompanyStats> {
  const [row] = await db
    .select({
      trades: sql`count(*)`.mapWith(Number),
      buyValueUsd:
        sql`coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'A'), 0)`.mapWith(
          Number,
        ),
      sellValueUsd:
        sql`coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'D'), 0)`.mapWith(
          Number,
        ),
      opportunisticTrades:
        sql`count(*) filter (where ${transactions.relevance} = 'opportunistic')`.mapWith(Number),
    })
    .from(transactions)
    .where(and(eq(transactions.companyId, companyId), gte(transactions.txnDate, cutoffIso(days))));
  const stats = row ?? { trades: 0, buyValueUsd: 0, sellValueUsd: 0, opportunisticTrades: 0 };
  return { ...stats, netValueUsd: stats.buyValueUsd - stats.sellValueUsd };
}

export interface PriceContextPoint {
  txnDate: string;
  tradePrice: number;
  close: number;
  /** Trade price vs that day's close, percent. Negative = bought below close. */
  diffPct: number;
}

export async function queryPriceContext(
  db: Database,
  companyId: string,
  limit = 20,
): Promise<PriceContextPoint[]> {
  const rows = await db
    .select({
      txnDate: transactions.txnDate,
      price: transactions.price,
      close: dailyPrices.close,
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .innerJoin(
      dailyPrices,
      and(
        eq(dailyPrices.symbol, companies.ticker),
        eq(dailyPrices.market, transactions.country),
        eq(dailyPrices.priceDate, transactions.txnDate),
      ),
    )
    .where(and(eq(transactions.companyId, companyId), sql`${transactions.price} is not null`))
    .orderBy(desc(transactions.txnDate))
    .limit(limit);

  return rows.map((r) => {
    const tradePrice = Number(r.price);
    const close = Number(r.close);
    return {
      txnDate: r.txnDate,
      tradePrice,
      close,
      diffPct: close > 0 ? Math.round(((tradePrice - close) / close) * 10_000) / 100 : 0,
    };
  });
}

export interface SentimentPoint {
  symbol: string;
  year: number;
  month: number;
  change: number | null;
  mspr: number | null;
}

/** MSPR series cached by the ingestion worker (Finnhub insider-sentiment). */
export async function querySentiment(db: Database, ticker: string): Promise<SentimentPoint[]> {
  const [row] = await db
    .select()
    .from(apiCache)
    .where(eq(apiCache.key, `finnhub:sentiment:${ticker}`));
  const points = row?.payload.points;
  return Array.isArray(points) ? (points as SentimentPoint[]) : [];
}

export interface HeatmapCell {
  ticker: string | null;
  name: string;
  market: string;
  trades: number;
  buyValueUsd: number;
  sellValueUsd: number;
  netValueUsd: number;
}

export async function queryHeatmap(db: Database, q: HeatmapQuery): Promise<HeatmapCell[]> {
  const buyExpr = sql`coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'A'), 0)`;
  const sellExpr = sql`coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'D'), 0)`;

  const conds = [gte(transactions.txnDate, cutoffIso(q.days))];
  if (q.market) conds.push(eq(transactions.country, q.market));
  if (q.relevance) conds.push(eq(transactions.relevance, q.relevance));

  const rows = await db
    .select({
      ticker: companies.ticker,
      name: companies.name,
      market: transactions.country,
      trades: sql`count(*)`.mapWith(Number),
      buyValueUsd: buyExpr.mapWith(Number),
      sellValueUsd: sellExpr.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .where(and(...conds))
    .groupBy(companies.id, companies.ticker, companies.name, transactions.country)
    .orderBy(desc(sql`greatest(${buyExpr}, ${sellExpr})`))
    .limit(q.limit);

  return rows.map((r) => ({
    ...r,
    netValueUsd: r.buyValueUsd - r.sellValueUsd,
  }));
}
