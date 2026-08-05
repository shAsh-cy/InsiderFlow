import { classifyTransaction, signalWeight } from "@insiderflow/core";
import {
  and,
  apiCache,
  asc,
  buildTradeConditions,
  companies,
  cutoffIso,
  dailyPrices,
  desc,
  eq,
  excludeSynthetic,
  filings,
  gte,
  inArray,
  insiders,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database, TradeFilterInput } from "@insiderflow/db";

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

/**
 * Trade filtering is delegated to buildTradeConditions in @insiderflow/db.
 *
 * This used to be a parallel implementation, which is how a saved screen
 * could quietly alert differently from how it screened. One builder, one
 * behaviour — the parity test in packages/alerts asserts it stays that way.
 */

export async function queryTrades(
  db: Database,
  q: TradesQuery,
): Promise<{ data: TradeRow[]; meta: PageMeta }> {
  const conds = buildTradeConditions(db, q as TradeFilterInput);

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
  /** Stable identity for the cell within its grouping. */
  key: string;
  label: string;
  /** Kept for API compatibility: populated only when grouping by company. */
  ticker: string | null;
  name: string;
  market: string;
  trades: number;
  buyValueUsd: number;
  sellValueUsd: number;
  netValueUsd: number;
  /**
   * Finnhub MSPR (−100…100), where the ingestion worker has cached it.
   * Sparse by design — it is an overlay, never the size of a cell.
   */
  mspr: number | null;
}

/**
 * Net insider flow, grouped by company, sector, or country.
 *
 * Synthetic ZZ* fixtures are excluded: this is an aggregate presented as a
 * picture of the market, and a fabricated trade must never be part of one.
 */
export async function queryHeatmap(db: Database, q: HeatmapQuery): Promise<HeatmapCell[]> {
  const buyExpr = sql`coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'A'), 0)`;
  const sellExpr = sql`coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'D'), 0)`;

  const conds = [gte(transactions.txnDate, cutoffIso(q.days)), excludeSynthetic()];
  if (q.market) conds.push(eq(transactions.country, q.market));
  if (q.relevance) conds.push(eq(transactions.relevance, q.relevance));
  if (q.sector) conds.push(eq(companies.sector, q.sector));

  const base = {
    trades: sql`count(*)`.mapWith(Number),
    buyValueUsd: buyExpr.mapWith(Number),
    sellValueUsd: sellExpr.mapWith(Number),
  };
  const order = desc(sql`greatest(${buyExpr}, ${sellExpr})`);

  if (q.group_by === "sector") {
    // Unclassified companies are shown as such, never folded into a real
    // sector — the SIC backfill is incremental and honesty about coverage
    // matters more than a tidy chart.
    const label = sql<string>`coalesce(${companies.sector}, 'Unclassified')`;
    const rows = await db
      .select({ label, ...base })
      .from(transactions)
      .innerJoin(companies, eq(transactions.companyId, companies.id))
      .where(and(...conds))
      .groupBy(label)
      .orderBy(order)
      .limit(q.limit);
    return rows.map((r) => ({
      key: r.label,
      label: r.label,
      ticker: null,
      name: r.label,
      market: q.market ?? "*",
      trades: r.trades,
      buyValueUsd: r.buyValueUsd,
      sellValueUsd: r.sellValueUsd,
      netValueUsd: r.buyValueUsd - r.sellValueUsd,
      mspr: null,
    }));
  }

  if (q.group_by === "country") {
    const rows = await db
      .select({ label: transactions.country, ...base })
      .from(transactions)
      .innerJoin(companies, eq(transactions.companyId, companies.id))
      .where(and(...conds))
      .groupBy(transactions.country)
      .orderBy(order)
      .limit(q.limit);
    return rows.map((r) => ({
      key: r.label,
      label: r.label,
      ticker: null,
      name: r.label,
      market: r.label,
      trades: r.trades,
      buyValueUsd: r.buyValueUsd,
      sellValueUsd: r.sellValueUsd,
      netValueUsd: r.buyValueUsd - r.sellValueUsd,
      mspr: null,
    }));
  }

  const rows = await db
    .select({
      companyId: companies.id,
      ticker: companies.ticker,
      name: companies.name,
      market: transactions.country,
      ...base,
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .where(and(...conds))
    .groupBy(companies.id, companies.ticker, companies.name, transactions.country)
    .orderBy(order)
    .limit(q.limit);

  const mspr = await msprByTicker(
    db,
    rows.map((r) => r.ticker).filter((t): t is string => !!t),
  );

  return rows.map((r) => ({
    key: r.ticker ?? r.companyId,
    label: r.ticker ?? r.name,
    ticker: r.ticker,
    name: r.name,
    market: r.market,
    trades: r.trades,
    buyValueUsd: r.buyValueUsd,
    sellValueUsd: r.sellValueUsd,
    netValueUsd: r.buyValueUsd - r.sellValueUsd,
    mspr: r.ticker ? (mspr.get(r.ticker) ?? null) : null,
  }));
}

/** Latest cached MSPR per ticker. Absent for most tickers — that is expected. */
async function msprByTicker(db: Database, tickers: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (tickers.length === 0) return out;
  const keys = tickers.map((t) => `finnhub:sentiment:${t}`);
  const rows = await db.select().from(apiCache).where(inArray(apiCache.key, keys));
  for (const row of rows) {
    const points = row.payload.points;
    if (!Array.isArray(points) || points.length === 0) continue;
    const latest = (points as SentimentPoint[])
      .filter((p) => typeof p.mspr === "number")
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .at(-1);
    if (latest?.mspr !== null && latest?.mspr !== undefined) {
      out.set(row.key.replace("finnhub:sentiment:", ""), latest.mspr);
    }
  }
  return out;
}
