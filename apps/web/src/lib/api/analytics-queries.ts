/**
 * Queries over the Phase 8 derived tables: insider scores, company anomalies,
 * cluster flags, and congressional disclosures.
 *
 * Same shared Drizzle layer as everything else — server components call these
 * directly, never through an HTTP self-call.
 *
 * EVERY number produced here is INFORMATIONAL: backward-looking descriptive
 * statistics on public filings, computed by the formulas published at
 * /docs/methodology. None of it is a prediction, and none of it is advice.
 */
import {
  and,
  asc,
  clusterFlags,
  companies,
  companyAnomalies,
  cutoffIso,
  desc,
  eq,
  excludeSynthetic,
  gte,
  inArray,
  insiderScores,
  insiders,
  isNotNull,
  lte,
  politicians,
  politicianTrades,
  showSyntheticData,
  sql,
  tradeReturns,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";
import { disclosureLagDays, isLateDisclosure, STOCK_ACT_DEADLINE_DAYS } from "@insiderflow/core";

import type { LeaderboardQuery, PoliticiansQuery } from "./schemas";
import type { PageMeta } from "./queries";

const num = (v: string | null): number | null => (v === null ? null : Number(v));

// ── Insider scores / leaderboard ────────────────────────────────────────────

export interface LeaderboardRow {
  insiderId: string;
  name: string;
  title: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPctOwner: boolean;
  scoredTrades: number;
  wins90d: number;
  hitRate90d: number | null;
  avgExcess30d: number | null;
  avgExcess90d: number | null;
  avgExcess180d: number | null;
  medianExcess90d: number | null;
  realizedTrades: number;
  realizedReturnPct: number | null;
  score: number | null;
  lastTradeDate: string | null;
}

const METRIC_COLUMN = {
  score: insiderScores.score,
  avg_excess_90d: insiderScores.avgExcess90d,
  hit_rate_90d: insiderScores.hitRate90d,
  realized: insiderScores.realizedReturnPct,
} as const;

export async function queryLeaderboard(
  db: Database,
  q: LeaderboardQuery,
): Promise<{ data: LeaderboardRow[]; meta: PageMeta }> {
  const conds = [
    gte(insiderScores.scoredTrades, q.min_trades),
    isNotNull(METRIC_COLUMN[q.metric]),
    // Same rule as the heatmap and the anomaly rankings — this is an aggregate
    // presented as a picture of the market. The leaderboard was previously the
    // one aggregate that did NOT filter, which is an inconsistency, not a
    // feature. insider_scores has no company to join, so the fixture namespace
    // is matched on the insider's own reserved name prefix.
    showSyntheticData() ? sql`true` : sql`${insiders.name} not like 'ZZ %'`,
  ];
  if (q.role === "director") conds.push(eq(insiders.isDirector, true));
  if (q.role === "officer") conds.push(eq(insiders.isOfficer, true));
  if (q.role === "ten_pct") conds.push(eq(insiders.isTenPctOwner, true));

  const column = METRIC_COLUMN[q.metric];
  const rows = await db
    .select({
      insiderId: insiderScores.insiderId,
      name: insiders.name,
      title: insiders.officerTitle,
      isDirector: insiders.isDirector,
      isOfficer: insiders.isOfficer,
      isTenPctOwner: insiders.isTenPctOwner,
      scoredTrades: insiderScores.scoredTrades,
      wins90d: insiderScores.wins90d,
      hitRate90d: insiderScores.hitRate90d,
      avgExcess30d: insiderScores.avgExcess30d,
      avgExcess90d: insiderScores.avgExcess90d,
      avgExcess180d: insiderScores.avgExcess180d,
      medianExcess90d: insiderScores.medianExcess90d,
      realizedTrades: insiderScores.realizedTrades,
      realizedReturnPct: insiderScores.realizedReturnPct,
      score: insiderScores.score,
      lastTradeDate: insiderScores.lastTradeDate,
    })
    .from(insiderScores)
    .innerJoin(insiders, eq(insiderScores.insiderId, insiders.id))
    .where(and(...conds))
    // Ties broken by sample size: between two equal scores, prefer the one
    // supported by more evidence.
    .orderBy(
      q.order === "asc" ? asc(column) : desc(column),
      desc(insiderScores.scoredTrades),
      asc(insiders.name),
    )
    .limit(q.limit + 1)
    .offset(q.offset);

  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return {
    data: page.map((r) => ({
      ...r,
      hitRate90d: num(r.hitRate90d),
      avgExcess30d: num(r.avgExcess30d),
      avgExcess90d: num(r.avgExcess90d),
      avgExcess180d: num(r.avgExcess180d),
      medianExcess90d: num(r.medianExcess90d),
      realizedReturnPct: num(r.realizedReturnPct),
      score: num(r.score),
    })),
    meta: {
      limit: q.limit,
      offset: q.offset,
      count: page.length,
      hasMore,
      nextOffset: hasMore ? q.offset + q.limit : null,
    },
  };
}

export interface InsiderScoreDetail {
  summary: LeaderboardRow | null;
  /** The trades behind the summary — every published figure is auditable. */
  trades: Array<{
    transactionId: string;
    txnDate: string;
    direction: string;
    ticker: string | null;
    companyName: string;
    entryClose: number;
    ret90d: number | null;
    bench90d: number | null;
    excess90d: number | null;
  }>;
}

export async function queryInsiderScore(
  db: Database,
  insiderId: string,
  tradeLimit = 25,
): Promise<InsiderScoreDetail> {
  const [summary] = await db
    .select({
      insiderId: insiderScores.insiderId,
      name: insiders.name,
      title: insiders.officerTitle,
      isDirector: insiders.isDirector,
      isOfficer: insiders.isOfficer,
      isTenPctOwner: insiders.isTenPctOwner,
      scoredTrades: insiderScores.scoredTrades,
      wins90d: insiderScores.wins90d,
      hitRate90d: insiderScores.hitRate90d,
      avgExcess30d: insiderScores.avgExcess30d,
      avgExcess90d: insiderScores.avgExcess90d,
      avgExcess180d: insiderScores.avgExcess180d,
      medianExcess90d: insiderScores.medianExcess90d,
      realizedTrades: insiderScores.realizedTrades,
      realizedReturnPct: insiderScores.realizedReturnPct,
      score: insiderScores.score,
      lastTradeDate: insiderScores.lastTradeDate,
    })
    .from(insiderScores)
    .innerJoin(insiders, eq(insiderScores.insiderId, insiders.id))
    .where(eq(insiderScores.insiderId, insiderId));

  const trades = await db
    .select({
      transactionId: tradeReturns.transactionId,
      txnDate: tradeReturns.txnDate,
      direction: tradeReturns.direction,
      entryClose: tradeReturns.entryClose,
      ret90d: tradeReturns.ret90d,
      bench90d: tradeReturns.bench90d,
      excess90d: tradeReturns.excess90d,
      ticker: companies.ticker,
      companyName: companies.name,
    })
    .from(tradeReturns)
    .innerJoin(companies, eq(tradeReturns.companyId, companies.id))
    .where(eq(tradeReturns.insiderId, insiderId))
    .orderBy(desc(tradeReturns.txnDate))
    .limit(tradeLimit);

  return {
    summary: summary
      ? {
          ...summary,
          hitRate90d: num(summary.hitRate90d),
          avgExcess30d: num(summary.avgExcess30d),
          avgExcess90d: num(summary.avgExcess90d),
          avgExcess180d: num(summary.avgExcess180d),
          medianExcess90d: num(summary.medianExcess90d),
          realizedReturnPct: num(summary.realizedReturnPct),
          score: num(summary.score),
        }
      : null,
    trades: trades.map((t) => ({
      ...t,
      entryClose: Number(t.entryClose),
      ret90d: num(t.ret90d),
      bench90d: num(t.bench90d),
      excess90d: num(t.excess90d),
    })),
  };
}

// ── Anomalies ───────────────────────────────────────────────────────────────

export interface AnomalyRow {
  companyId: string;
  windowDays: number;
  netUsd: number;
  baselineMean: number | null;
  baselineStddev: number | null;
  zScore: number | null;
  sampleSize: number;
  /** False when the baseline is too thin to support a z-score. */
  published: boolean;
}

export async function queryCompanyAnomaly(
  db: Database,
  companyId: string,
): Promise<AnomalyRow | null> {
  const [row] = await db
    .select()
    .from(companyAnomalies)
    .where(eq(companyAnomalies.companyId, companyId));
  if (!row) return null;
  return {
    companyId: row.companyId,
    windowDays: row.windowDays,
    netUsd: Number(row.netUsd),
    baselineMean: num(row.baselineMean),
    baselineStddev: num(row.baselineStddev),
    zScore: num(row.zScore),
    sampleSize: row.sampleSize,
    published: row.zScore !== null,
  };
}

// ── Cluster flags ───────────────────────────────────────────────────────────

export interface ClusterFlagInfo {
  direction: "buy" | "sell";
  windowStart: string;
  windowEnd: string;
  insiderCount: number;
  tradeCount: number;
  totalUsd: number | null;
}

/**
 * Live cluster flags for one company. Reads the precomputed table; the
 * query-time fallback lives in buildTradeConditions for self-hosters without
 * the analytics cron.
 */
export async function queryClusterFlags(
  db: Database,
  companyId: string,
  windowDays = 14,
): Promise<ClusterFlagInfo[]> {
  const rows = await db
    .select()
    .from(clusterFlags)
    .where(
      and(
        eq(clusterFlags.companyId, companyId),
        gte(clusterFlags.windowStart, cutoffIso(windowDays)),
      ),
    )
    .orderBy(desc(clusterFlags.insiderCount));
  return rows.map((r) => ({
    direction: r.direction,
    windowStart: r.windowStart,
    windowEnd: r.windowEnd,
    insiderCount: r.insiderCount,
    tradeCount: r.tradeCount,
    totalUsd: num(r.totalUsd),
  }));
}

// ── Congressional disclosures ───────────────────────────────────────────────

export interface PoliticianTradeRow {
  id: string;
  politician: {
    id: string;
    name: string;
    chamber: string;
    party: string | null;
    state: string | null;
    district: string | null;
  };
  ticker: string | null;
  companyId: string | null;
  companyName: string | null;
  assetDescription: string;
  assetType: string | null;
  txnType: string;
  /** Normalized direction, for shared UI with insider trades. */
  direction: "buy" | "sell" | "neutral";
  txnDate: string;
  disclosedAt: string | null;
  /**
   * The disclosed BRACKET. Both bounds may be null and there is no point
   * value — STOCK Act filings do not contain one.
   */
  amountMin: number | null;
  amountMax: number | null;
  amountRange: string | null;
  disclosureLagDays: number | null;
  /** Filed past the 45-day STOCK Act deadline. */
  late: boolean;
  owner: string | null;
  comment: string | null;
  source: string;
  sourceUrl: string | null;
  createdAt: string;
}

const DIRECTION: Record<string, "buy" | "sell" | "neutral"> = {
  purchase: "buy",
  sale: "sell",
  sale_partial: "sell",
  sale_full: "sell",
  exchange: "neutral",
};

const politicianSelection = {
  id: politicianTrades.id,
  ticker: politicianTrades.ticker,
  companyId: politicianTrades.companyId,
  assetDescription: politicianTrades.assetDescription,
  assetType: politicianTrades.assetType,
  txnType: politicianTrades.txnType,
  txnDate: politicianTrades.txnDate,
  disclosedAt: politicianTrades.disclosedAt,
  amountMin: politicianTrades.amountMin,
  amountMax: politicianTrades.amountMax,
  amountRange: politicianTrades.amountRange,
  owner: politicianTrades.owner,
  comment: politicianTrades.comment,
  source: politicianTrades.source,
  sourceUrl: politicianTrades.sourceUrl,
  createdAt: politicianTrades.createdAt,
  politicianId: politicians.id,
  politicianName: politicians.name,
  chamber: politicians.chamber,
  party: politicians.party,
  state: politicians.state,
  district: politicians.district,
  companyName: companies.name,
};

function serializePoliticianTrade(
  r: Awaited<ReturnType<typeof rawPoliticianRows>>[number],
): PoliticianTradeRow {
  return {
    id: r.id,
    politician: {
      id: r.politicianId,
      name: r.politicianName,
      chamber: r.chamber,
      party: r.party,
      state: r.state,
      district: r.district,
    },
    ticker: r.ticker,
    companyId: r.companyId,
    companyName: r.companyName,
    assetDescription: r.assetDescription,
    assetType: r.assetType,
    txnType: r.txnType,
    direction: DIRECTION[r.txnType] ?? "neutral",
    txnDate: r.txnDate,
    disclosedAt: r.disclosedAt,
    amountMin: num(r.amountMin),
    amountMax: num(r.amountMax),
    amountRange: r.amountRange,
    disclosureLagDays: disclosureLagDays(r.txnDate, r.disclosedAt),
    late: isLateDisclosure(r.txnDate, r.disclosedAt),
    owner: r.owner,
    comment: r.comment,
    source: r.source,
    sourceUrl: r.sourceUrl,
    createdAt: r.createdAt.toISOString(),
  };
}

function rawPoliticianRows(db: Database) {
  return db
    .select(politicianSelection)
    .from(politicianTrades)
    .innerJoin(politicians, eq(politicianTrades.politicianId, politicians.id))
    .leftJoin(companies, eq(politicianTrades.companyId, companies.id));
}

export async function queryPoliticianTrades(
  db: Database,
  q: PoliticiansQuery,
): Promise<{ data: PoliticianTradeRow[]; meta: PageMeta }> {
  const conds = [];
  if (q.ticker) conds.push(eq(politicianTrades.ticker, q.ticker));
  if (q.politician_id) conds.push(eq(politicianTrades.politicianId, q.politician_id));
  if (q.chamber) conds.push(eq(politicians.chamber, q.chamber));
  if (q.party) conds.push(eq(politicians.party, q.party));
  if (q.txn_type) conds.push(eq(politicianTrades.txnType, q.txn_type));
  if (q.side === "buy") conds.push(eq(politicianTrades.txnType, "purchase"));
  if (q.side === "sell") {
    conds.push(inArray(politicianTrades.txnType, ["sale", "sale_partial", "sale_full"]));
  }
  // Matches on the upper bound: a $1,001–$15,000 bracket "clears $10,000" in
  // the only sense the filing supports.
  if (q.min_amount_usd !== undefined) {
    conds.push(gte(politicianTrades.amountMax, String(q.min_amount_usd)));
  }
  if (q.late_only) {
    conds.push(
      sql`${politicianTrades.disclosedAt} is not null
        and ${politicianTrades.disclosedAt} - ${politicianTrades.txnDate} > ${STOCK_ACT_DEADLINE_DAYS}`,
    );
  }
  if (q.from) conds.push(gte(politicianTrades.txnDate, q.from));
  if (q.to) conds.push(lte(politicianTrades.txnDate, q.to));

  const sortColumn = {
    disclosed_at: politicianTrades.disclosedAt,
    txn_date: politicianTrades.txnDate,
    amount: politicianTrades.amountMax,
  }[q.sort];

  const rows = await rawPoliticianRows(db)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(
      q.order === "asc" ? asc(sortColumn) : desc(sortColumn),
      desc(politicianTrades.createdAt),
      desc(politicianTrades.id),
    )
    .limit(q.limit + 1)
    .offset(q.offset);

  const hasMore = rows.length > q.limit;
  const page = rows.slice(0, q.limit);
  return {
    data: page.map(serializePoliticianTrade),
    meta: {
      limit: q.limit,
      offset: q.offset,
      count: page.length,
      hasMore,
      nextOffset: hasMore ? q.offset + q.limit : null,
    },
  };
}

export interface PoliticianCoverage {
  /** Rows actually ingested. Zero means the pipeline has never populated. */
  disclosures: number;
  filers: number;
  /** Most recent DISCLOSURE date on record — the honest "data through" date. */
  latestDisclosure: string | null;
  earliestDisclosure: string | null;
  /** Distinct upstream datasets the rows came from. */
  sources: string[];
  /** Days since the newest disclosure; null when there is no data at all. */
  ageDays: number | null;
}

/**
 * What congressional data we actually have.
 *
 * Surfaced on /politicians rather than kept internal, because the upstream
 * feeds are community-maintained and have gone dark before. A page that
 * silently shows nothing is indistinguishable from a page whose source died —
 * so we state the coverage window and let the reader judge.
 */
export async function queryPoliticianCoverage(db: Database): Promise<PoliticianCoverage> {
  const [row] = await db
    .select({
      disclosures: sql`count(*)`.mapWith(Number),
      filers: sql`count(distinct ${politicianTrades.politicianId})`.mapWith(Number),
      latest: sql<string | null>`max(${politicianTrades.disclosedAt})::text`,
      earliest: sql<string | null>`min(${politicianTrades.disclosedAt})::text`,
      sources: sql<string[]>`coalesce(array_agg(distinct ${politicianTrades.source}), '{}')`,
    })
    .from(politicianTrades);

  const latestDisclosure = row?.latest ?? null;
  const ageDays = latestDisclosure
    ? Math.floor((Date.now() - Date.parse(`${latestDisclosure}T00:00:00Z`)) / 86_400_000)
    : null;

  return {
    disclosures: row?.disclosures ?? 0,
    filers: row?.filers ?? 0,
    latestDisclosure,
    earliestDisclosure: row?.earliest ?? null,
    sources: (row?.sources ?? []).filter(Boolean),
    ageDays,
  };
}

export interface PoliticianSummary {
  id: string;
  name: string;
  chamber: string;
  party: string | null;
  state: string | null;
  district: string | null;
  trades: number;
  buys: number;
  sells: number;
  lastDisclosure: string | null;
  /** Disclosures filed past the 45-day deadline. */
  lateFilings: number;
}

export async function queryPoliticians(db: Database, limit = 100): Promise<PoliticianSummary[]> {
  const rows = await db
    .select({
      id: politicians.id,
      name: politicians.name,
      chamber: politicians.chamber,
      party: politicians.party,
      state: politicians.state,
      district: politicians.district,
      trades: sql`count(${politicianTrades.id})`.mapWith(Number),
      buys: sql`count(*) filter (where ${politicianTrades.txnType} = 'purchase')`.mapWith(Number),
      sells:
        sql`count(*) filter (where ${politicianTrades.txnType} in ('sale','sale_partial','sale_full'))`.mapWith(
          Number,
        ),
      lastDisclosure: sql<string | null>`max(${politicianTrades.disclosedAt})`,
      lateFilings: sql`count(*) filter (where ${politicianTrades.disclosedAt} is not null
          and ${politicianTrades.disclosedAt} - ${politicianTrades.txnDate} > ${STOCK_ACT_DEADLINE_DAYS})`.mapWith(
        Number,
      ),
    })
    .from(politicians)
    .leftJoin(politicianTrades, eq(politicianTrades.politicianId, politicians.id))
    .groupBy(politicians.id)
    .orderBy(desc(sql`count(${politicianTrades.id})`))
    .limit(limit);
  return rows;
}

export async function queryPolitician(
  db: Database,
  politicianId: string,
): Promise<PoliticianSummary | null> {
  const all = await queryPoliticians(db, 1000);
  return all.find((p) => p.id === politicianId) ?? null;
}

export interface TopTickerRow {
  ticker: string;
  companyName: string | null;
  trades: number;
  buys: number;
  sells: number;
  politicians: number;
}

/** Most-disclosed tickers across all filers, or within one filer. */
export async function queryTopPoliticianTickers(
  db: Database,
  options: { politicianId?: string; days?: number; limit?: number } = {},
): Promise<TopTickerRow[]> {
  const conds = [isNotNull(politicianTrades.ticker)];
  if (options.politicianId) conds.push(eq(politicianTrades.politicianId, options.politicianId));
  if (options.days) conds.push(gte(politicianTrades.txnDate, cutoffIso(options.days)));

  const rows = await db
    .select({
      ticker: politicianTrades.ticker,
      companyName: sql<string | null>`max(${companies.name})`,
      trades: sql`count(*)`.mapWith(Number),
      buys: sql`count(*) filter (where ${politicianTrades.txnType} = 'purchase')`.mapWith(Number),
      sells:
        sql`count(*) filter (where ${politicianTrades.txnType} in ('sale','sale_partial','sale_full'))`.mapWith(
          Number,
        ),
      politicians: sql`count(distinct ${politicianTrades.politicianId})`.mapWith(Number),
    })
    .from(politicianTrades)
    .leftJoin(companies, eq(politicianTrades.companyId, companies.id))
    .where(and(...conds))
    .groupBy(politicianTrades.ticker)
    .orderBy(desc(sql`count(*)`))
    .limit(options.limit ?? 20);

  return rows.map((r) => ({ ...r, ticker: r.ticker! }));
}

/** Recent congressional activity in one ticker — the stock-page overlay. */
export async function queryPoliticianTradesForTicker(
  db: Database,
  ticker: string,
  limit = 10,
): Promise<PoliticianTradeRow[]> {
  const rows = await rawPoliticianRows(db)
    .where(eq(politicianTrades.ticker, ticker.toUpperCase()))
    .orderBy(desc(politicianTrades.txnDate))
    .limit(limit);
  return rows.map(serializePoliticianTrade);
}

/** Companies whose current net flow is most unusual against their own history. */
export async function queryTopAnomalies(
  db: Database,
  limit = 20,
): Promise<Array<AnomalyRow & { ticker: string | null; name: string }>> {
  const rows = await db
    .select({
      companyId: companyAnomalies.companyId,
      windowDays: companyAnomalies.windowDays,
      netUsd: companyAnomalies.netUsd,
      baselineMean: companyAnomalies.baselineMean,
      baselineStddev: companyAnomalies.baselineStddev,
      zScore: companyAnomalies.zScore,
      sampleSize: companyAnomalies.sampleSize,
      ticker: companies.ticker,
      name: companies.name,
    })
    .from(companyAnomalies)
    .innerJoin(companies, eq(companyAnomalies.companyId, companies.id))
    .where(and(isNotNull(companyAnomalies.zScore), excludeSynthetic()))
    .orderBy(desc(sql`abs(${companyAnomalies.zScore})`))
    .limit(limit);

  return rows.map((r) => ({
    companyId: r.companyId,
    windowDays: r.windowDays,
    netUsd: Number(r.netUsd),
    baselineMean: num(r.baselineMean),
    baselineStddev: num(r.baselineStddev),
    zScore: num(r.zScore),
    sampleSize: r.sampleSize,
    published: r.zScore !== null,
    ticker: r.ticker,
    name: r.name,
  }));
}
