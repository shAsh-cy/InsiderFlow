/**
 * Page-level queries for the product pages. Same shared Drizzle layer the
 * API routes use — server components call these directly (never HTTP
 * self-calls). Everything returns plain serializable objects.
 */
import {
  and,
  bulkBlockDeals,
  clusterFlags,
  companies,
  cutoffIso,
  dailyPrices,
  desc,
  eq,
  gte,
  ilike,
  insiders,
  isNotNull,
  or,
  pledgeDisclosures,
  resolveClusterSource,
  sastDisclosures,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Company, Database, Insider } from "@insiderflow/db";

const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

// ── Company directory / header ──────────────────────────────────────────────

export interface CompanySearchHit {
  id: string;
  ticker: string | null;
  name: string;
  country: string;
  sector: string | null;
  trades: number;
}

/** pg_trgm-backed name/ticker search; without a query, most-active companies. */
export async function searchCompanies(
  db: Database,
  query: string | undefined,
  limit = 30,
): Promise<CompanySearchHit[]> {
  const trades = sql`count(${transactions.id})`.mapWith(Number);
  const base = db
    .select({
      id: companies.id,
      ticker: companies.ticker,
      name: companies.name,
      country: companies.country,
      sector: companies.sector,
      trades,
    })
    .from(companies)
    .leftJoin(transactions, eq(transactions.companyId, companies.id))
    .groupBy(companies.id);

  if (query && query.trim().length > 0) {
    const q = query.trim();
    return base
      .where(or(ilike(companies.name, `%${q}%`), ilike(companies.ticker, `%${q}%`)))
      .orderBy(
        desc(
          sql`greatest(similarity(${companies.name}, ${q}), similarity(coalesce(${companies.ticker}, ''), ${q}))`,
        ),
      )
      .limit(limit);
  }
  return base.orderBy(desc(trades)).limit(limit);
}

export interface CompanyHeader {
  company: Company;
  /** Latest cached close, if price context exists. */
  lastClose: { close: number; date: string } | null;
}

export async function queryCompanyByTicker(
  db: Database,
  ticker: string,
): Promise<CompanyHeader | null> {
  const [company] = await db.select().from(companies).where(eq(companies.ticker, ticker));
  if (!company) return null;
  let lastClose: CompanyHeader["lastClose"] = null;
  if (company.ticker) {
    const [row] = await db
      .select({ close: dailyPrices.close, date: dailyPrices.priceDate })
      .from(dailyPrices)
      .where(and(eq(dailyPrices.symbol, company.ticker), eq(dailyPrices.market, company.country)))
      .orderBy(desc(dailyPrices.priceDate))
      .limit(1);
    if (row) lastClose = { close: Number(row.close), date: row.date };
  }
  return { company, lastClose };
}

// ── Stock page panels ───────────────────────────────────────────────────────

export interface NetFlowPoint {
  month: string; // YYYY-MM
  buyUsd: number;
  sellUsd: number;
}

/** Monthly insider buy vs sell notional (USD) for the bipolar chart. */
export async function queryNetFlow(
  db: Database,
  companyId: string,
  months = 12,
): Promise<NetFlowPoint[]> {
  const month = sql<string>`to_char(date_trunc('month', ${transactions.txnDate}::date), 'YYYY-MM')`;
  const rows = await db
    .select({
      month,
      buyUsd:
        sql`coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'A'), 0)`.mapWith(
          Number,
        ),
      sellUsd:
        sql`coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'D'), 0)`.mapWith(
          Number,
        ),
    })
    .from(transactions)
    .where(
      and(eq(transactions.companyId, companyId), gte(transactions.txnDate, cutoffIso(months * 31))),
    )
    .groupBy(month)
    .orderBy(month);
  return rows;
}

export interface ClusterInfo {
  distinctBuyers: number;
  windowDays: number;
  /** Present when a precomputed flag exists — the anchored cluster window. */
  windowStart: string | null;
  windowEnd: string | null;
  tradeCount: number;
  totalUsd: number | null;
  /** "flags" when read from cluster_flags, "sql" when computed at query time. */
  source: "flags" | "sql";
}

/**
 * Cluster indicator: distinct open-market buyers inside the rolling window.
 *
 * Reads the precomputed cluster_flags maintained by the ingest cron. Falls
 * back to the query-time GROUP BY when INSIDERFLOW_CLUSTER_SOURCE=sql, or
 * when no flag row exists yet — a self-hoster without the analytics cron
 * still sees a correct indicator, just computed on demand.
 */
export async function queryClusterInfo(
  db: Database,
  companyId: string,
  windowDays = 14,
): Promise<ClusterInfo> {
  if (resolveClusterSource() === "flags") {
    const [flag] = await db
      .select()
      .from(clusterFlags)
      .where(
        and(
          eq(clusterFlags.companyId, companyId),
          eq(clusterFlags.direction, "buy"),
          gte(clusterFlags.windowStart, cutoffIso(windowDays)),
        ),
      )
      .orderBy(desc(clusterFlags.insiderCount))
      .limit(1);

    if (flag) {
      return {
        distinctBuyers: flag.insiderCount,
        windowDays,
        windowStart: flag.windowStart,
        windowEnd: flag.windowEnd,
        tradeCount: flag.tradeCount,
        totalUsd: num(flag.totalUsd),
        source: "flags",
      };
    }
    // No flag means "fewer than two buyers" — flags are only written at the
    // threshold. Fall through to the exact count so the panel can still say
    // "1 buyer" rather than "0".
  }

  const [row] = await db
    .select({
      buyers: sql`count(distinct ${transactions.insiderId})`.mapWith(Number),
      trades: sql`count(*)`.mapWith(Number),
      totalUsd: sql<string | null>`sum(${transactions.valueUsd})`,
      first: sql<string | null>`min(${transactions.txnDate})`,
      last: sql<string | null>`max(${transactions.txnDate})`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.companyId, companyId),
        eq(transactions.code, "P"),
        gte(transactions.txnDate, cutoffIso(windowDays)),
      ),
    );
  return {
    distinctBuyers: row?.buyers ?? 0,
    windowDays,
    windowStart: row?.first ?? null,
    windowEnd: row?.last ?? null,
    tradeCount: row?.trades ?? 0,
    totalUsd: num(row?.totalUsd ?? null),
    source: "sql",
  };
}

export interface OwnershipEntry {
  insiderId: string;
  insiderName: string;
  firstDate: string;
  lastDate: string;
  firstShares: number | null;
  lastShares: number | null;
}

/**
 * Ownership timeline: first vs latest reported post-transaction holdings per
 * insider. No interpolation between filings — only what was disclosed.
 */
export async function queryOwnershipTimeline(
  db: Database,
  companyId: string,
  limit = 8,
): Promise<OwnershipEntry[]> {
  const rows = await db
    .select({
      insiderId: insiders.id,
      insiderName: insiders.name,
      firstDate: sql<string>`min(${transactions.txnDate})`,
      lastDate: sql<string>`max(${transactions.txnDate})`,
      firstShares: sql<
        string | null
      >`(array_agg(${transactions.sharesOwnedAfter} order by ${transactions.txnDate} asc))[1]`,
      lastShares: sql<
        string | null
      >`(array_agg(${transactions.sharesOwnedAfter} order by ${transactions.txnDate} desc))[1]`,
    })
    .from(transactions)
    .innerJoin(insiders, eq(transactions.insiderId, insiders.id))
    .where(and(eq(transactions.companyId, companyId), isNotNull(transactions.sharesOwnedAfter)))
    .groupBy(insiders.id, insiders.name)
    .orderBy(desc(sql`max(${transactions.txnDate})`))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    firstShares: num(r.firstShares),
    lastShares: num(r.lastShares),
  }));
}

// ── India disclosure panels (SAST / bulk-block / pledges) ───────────────────

export interface SastRow {
  id: string;
  acquirerName: string;
  regulation: string | null;
  category: string | null;
  acquisitionMode: string | null;
  side: string | null;
  shares: number | null;
  sharesPctAfter: number | null;
  /** NULL by design — the NSE SAST feed carries no monetary value. */
  value: number | null;
  valueUsd: number | null;
  currency: string;
  txnDate: string | null;
}

export async function querySastForSymbol(
  db: Database,
  symbol: string,
  limit = 15,
): Promise<SastRow[]> {
  const rows = await db
    .select()
    .from(sastDisclosures)
    .where(eq(sastDisclosures.symbol, symbol))
    .orderBy(sql`${sastDisclosures.txnDate} desc nulls last`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    acquirerName: r.acquirerName,
    regulation: r.regulation,
    category: r.category,
    acquisitionMode: r.acquisitionMode,
    side: r.side,
    shares: num(r.shares),
    sharesPctAfter: num(r.sharesPctAfter),
    value: num(r.value),
    valueUsd: num(r.valueUsd),
    currency: r.currency,
    txnDate: r.txnDate,
  }));
}

export interface BulkBlockRow {
  id: string;
  dealType: string;
  dealDate: string;
  clientName: string;
  side: string;
  quantity: number;
  wap: number | null;
  value: number | null;
  valueUsd: number | null;
  currency: string;
}

export async function queryBulkBlockForSymbol(
  db: Database,
  symbol: string,
  limit = 15,
): Promise<BulkBlockRow[]> {
  const rows = await db
    .select()
    .from(bulkBlockDeals)
    .where(eq(bulkBlockDeals.symbol, symbol))
    .orderBy(desc(bulkBlockDeals.dealDate))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    dealType: r.dealType,
    dealDate: r.dealDate,
    clientName: r.clientName,
    side: r.side,
    quantity: Number(r.quantity),
    wap: num(r.wap),
    value: num(r.value),
    valueUsd: num(r.valueUsd),
    currency: r.currency,
  }));
}

export interface PledgeRow {
  id: string;
  promoterName: string;
  eventType: string | null;
  shares: number | null;
  sharesPct: number | null;
  eventDate: string | null;
}

export async function queryPledgesForSymbol(
  db: Database,
  symbol: string,
  limit = 15,
): Promise<PledgeRow[]> {
  const rows = await db
    .select()
    .from(pledgeDisclosures)
    .where(eq(pledgeDisclosures.symbol, symbol))
    .orderBy(sql`${pledgeDisclosures.eventDate} desc nulls last`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    promoterName: r.promoterName,
    eventType: r.eventType,
    shares: num(r.shares),
    sharesPct: num(r.sharesPct),
    eventDate: r.eventDate,
  }));
}

// ── Insider profile ─────────────────────────────────────────────────────────

export interface InsiderProfile {
  insider: Insider;
  stats: {
    buys: number;
    sells: number;
    netUsd: number;
    companiesTraded: number;
    lastActivity: string | null;
  };
}

export async function queryInsiderProfile(
  db: Database,
  insiderId: string,
): Promise<InsiderProfile | null> {
  const [insider] = await db.select().from(insiders).where(eq(insiders.id, insiderId));
  if (!insider) return null;
  const [stats] = await db
    .select({
      buys: sql`count(*) filter (where ${transactions.acquiredDisposed} = 'A')`.mapWith(Number),
      sells: sql`count(*) filter (where ${transactions.acquiredDisposed} = 'D')`.mapWith(Number),
      netUsd:
        sql`coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'A'), 0)
          - coalesce(sum(${transactions.valueUsd}) filter (where ${transactions.acquiredDisposed} = 'D'), 0)`.mapWith(
          Number,
        ),
      companiesTraded: sql`count(distinct ${transactions.companyId})`.mapWith(Number),
      lastActivity: sql<string | null>`max(${transactions.txnDate})`,
    })
    .from(transactions)
    .where(eq(transactions.insiderId, insiderId));
  return {
    insider,
    stats: stats ?? { buys: 0, sells: 0, netUsd: 0, companiesTraded: 0, lastActivity: null },
  };
}
