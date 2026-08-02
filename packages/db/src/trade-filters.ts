/**
 * Shared trade-filter SQL. Lives in packages/db so BOTH the web query
 * layer and the alert scanner build identical predicates — a saved screen
 * must match in an alert exactly as it does on the screener page.
 *
 * Phase 8 swap points: clusterCompaniesSubquery / dipCondition /
 * nearLowCondition are the only places these are computed at query time.
 */
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { companies, filings, insiders, transactions } from "./schema";
import type { Database } from "./client";

export interface TradeFilterInput {
  market?: string;
  ticker?: string;
  code?: string;
  role?: "director" | "officer" | "ten_pct";
  relevance?: "routine" | "opportunistic";
  source?: string;
  side?: "buy" | "sell";
  sector?: string;
  insider_id?: string;
  min_value?: number;
  min_value_usd?: number;
  cluster?: boolean;
  dip?: boolean;
  near_low?: boolean;
  exec_only?: boolean;
  include_superseded?: boolean;
  from?: string;
  to?: string;
}

export function cutoffIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Companies where ≥2 distinct insiders bought (code P) within a rolling window. */
export function clusterCompaniesSubquery(db: Database, windowDays = 14) {
  return db
    .select({ companyId: transactions.companyId })
    .from(transactions)
    .where(and(eq(transactions.code, "P"), gte(transactions.txnDate, cutoffIso(windowDays))))
    .groupBy(transactions.companyId)
    .having(sql`count(distinct ${transactions.insiderId}) >= 2`);
}

/** Buys priced 5%+ below that day's close (needs cached price context). */
export function dipCondition(): SQL {
  return sql`exists (select 1 from daily_prices dp
    where dp.symbol = ${companies.ticker}
      and dp.market = ${transactions.country}
      and dp.price_date = ${transactions.txnDate}
      and ${transactions.price} <= dp.close * 0.95)`;
}

/** Trade-day close within 5% of the 52-week low of cached prices. */
export function nearLowCondition(): SQL {
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

/**
 * Build the WHERE conditions for a trade query. Assumes the query joins
 * companies, insiders, and (left) filings.
 */
export function buildTradeConditions(db: Database, q: TradeFilterInput): SQL[] {
  const conds: SQL[] = [];
  const push = (c: SQL | undefined) => {
    if (c) conds.push(c);
  };

  if (q.market) push(eq(transactions.country, q.market));
  if (q.ticker) push(eq(companies.ticker, q.ticker));
  if (q.code) push(eq(transactions.code, q.code as typeof transactions.code._.data));
  if (q.relevance) push(eq(transactions.relevance, q.relevance));
  if (q.source) push(eq(transactions.source, q.source));
  if (q.side) push(eq(transactions.acquiredDisposed, q.side === "buy" ? "A" : "D"));
  if (q.sector) push(eq(companies.sector, q.sector));
  if (q.insider_id) push(eq(transactions.insiderId, q.insider_id));
  if (q.min_value !== undefined) push(gte(transactions.value, String(q.min_value)));
  if (q.min_value_usd !== undefined) push(gte(transactions.valueUsd, String(q.min_value_usd)));
  if (q.from) push(gte(transactions.txnDate, q.from));
  if (q.to) push(lte(transactions.txnDate, q.to));
  if (q.role === "director") push(eq(insiders.isDirector, true));
  if (q.role === "officer" || q.exec_only) push(eq(insiders.isOfficer, true));
  if (q.role === "ten_pct") push(eq(insiders.isTenPctOwner, true));
  if (q.near_low) push(nearLowCondition());
  if (q.dip) push(dipCondition());
  if (q.cluster) push(inArray(transactions.companyId, clusterCompaniesSubquery(db)));

  // Amendments replace originals: hide superseded filings unless asked.
  if (!q.include_superseded) {
    push(or(isNull(transactions.filingId), isNull(filings.supersededByFilingId)));
  }
  return conds;
}
