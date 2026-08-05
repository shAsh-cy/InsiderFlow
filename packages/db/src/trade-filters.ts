/**
 * Shared trade-filter SQL. Lives in packages/db so BOTH the web query
 * layer and the alert scanner build identical predicates — a saved screen
 * must match in an alert exactly as it does on the screener page.
 *
 * Phase 8 moved cluster detection off the query path onto precomputed
 * cluster_flags. The query-time GROUP BY survives as a fallback for
 * self-hosters who do not run the analytics cron (see clusterSource).
 */
import { and, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { clusterFlags, companies, filings, insiders, transactions } from "./schema";
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
  /** Companies whose current net insider flow is ≥N sigma from their own baseline. */
  min_anomaly_z?: number;
  include_superseded?: boolean;
  from?: string;
  to?: string;
}

export function cutoffIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Where cluster membership comes from.
 *
 *  - "flags" (default): read precomputed cluster_flags, maintained by the
 *    1-minute ingest cron. O(1) per query.
 *  - "sql": the original query-time GROUP BY. Correct without any cron, but
 *    it scans transactions on every request — the fallback for self-hosters
 *    running the web app alone.
 *
 * Set INSIDERFLOW_CLUSTER_SOURCE=sql to force the fallback. Read defensively:
 * this module also runs inside a Cloudflare Worker, where `process` may not
 * exist.
 */
export type ClusterSource = "flags" | "sql";

export function resolveClusterSource(): ClusterSource {
  try {
    if (typeof process !== "undefined" && process.env?.INSIDERFLOW_CLUSTER_SOURCE === "sql") {
      return "sql";
    }
  } catch {
    /* no process — Workers runtime */
  }
  return "flags";
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

/**
 * The same set, read from precomputed flags.
 *
 * `window_start >= cutoff` (not window_end) is what makes this equivalent to
 * the GROUP BY: the window is anchored to its earliest qualifying trade, so
 * requiring the anchor to be inside the lookback asserts that every trade
 * behind the flag still is too.
 */
export function clusterCompaniesFromFlags(db: Database, windowDays = 14, direction = "buy") {
  return db
    .select({ companyId: clusterFlags.companyId })
    .from(clusterFlags)
    .where(
      and(
        eq(clusterFlags.direction, direction as "buy"),
        gte(clusterFlags.windowStart, cutoffIso(windowDays)),
        gte(clusterFlags.insiderCount, 2),
      ),
    );
}

export function clusterCondition(
  db: Database,
  source: ClusterSource = resolveClusterSource(),
  windowDays = 14,
): SQL {
  return inArray(
    transactions.companyId,
    source === "sql"
      ? clusterCompaniesSubquery(db, windowDays)
      : clusterCompaniesFromFlags(db, windowDays),
  );
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
 * Companies whose net insider flow is at least `z` standard deviations from
 * their OWN trailing baseline. Never a cross-company ranking — a small
 * company's $2M is unusual, a mega-cap's is not.
 */
export function anomalyCondition(minZ: number): SQL {
  return sql`exists (select 1 from company_anomalies ca
    where ca.company_id = ${transactions.companyId}
      and ca.sample_size >= 6
      and abs(ca.z_score) >= ${minZ})`;
}

/**
 * Whether synthetic ZZ* fixtures may appear on aggregate surfaces.
 *
 * Defaults to FALSE — a fabricated trade must never be presented as market
 * data on a public deployment. But a locally seeded stack contains *nothing
 * but* synthetic rows, and hiding them makes `docker compose up` look broken
 * rather than honest. So docker-compose opts in explicitly, and the UI says so
 * (see SyntheticDataNotice) whenever it does.
 *
 * The default is the safe one, so forgetting to set this can only ever hide
 * data, never publish fabricated data.
 */
export function showSyntheticData(): boolean {
  try {
    if (typeof process !== "undefined") {
      return process.env?.INSIDERFLOW_SHOW_SYNTHETIC === "true";
    }
  } catch {
    /* no process — Workers runtime */
  }
  return false;
}

/**
 * Reserved fixture namespace. Applied to every AGGREGATE surface — heatmap,
 * leaderboard, anomaly rankings — so a fabricated trade can never be
 * presented as market data.
 *
 * Deliberately NOT applied to trade-level screens or the alert scanner, where
 * the ZZ* namespace is the supported smoke-test path: a developer inserting a
 * ZZ row expects their own alert to fire.
 */
export function excludeSynthetic(): SQL {
  // `true` rather than a no-op string so callers can always spread it into
  // an and(...) without branching.
  if (showSyntheticData()) return sql`true`;
  return sql`(${companies.ticker} is null or ${companies.ticker} not like 'ZZ%')`;
}

/**
 * Build the WHERE conditions for a trade query. Assumes the query joins
 * companies, insiders, and (left) filings.
 */
export function buildTradeConditions(
  db: Database,
  q: TradeFilterInput,
  options: { clusterSource?: ClusterSource } = {},
): SQL[] {
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
  if (q.cluster) push(clusterCondition(db, options.clusterSource));
  if (q.min_anomaly_z !== undefined) push(anomalyCondition(q.min_anomaly_z));

  // Amendments replace originals: hide superseded filings unless asked.
  if (!q.include_superseded) {
    push(or(isNull(transactions.filingId), isNull(filings.supersededByFilingId)));
  }
  return conds;
}
