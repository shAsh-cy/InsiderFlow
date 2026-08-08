/**
 * Aggregates for the landing page's signature panel.
 *
 * These are real figures read from the live database at ISR time — the
 * whole point of the panel is that the numbers on the marketing page are
 * the same numbers the product serves. They obey `excludeSynthetic()`
 * like every other aggregate, so a production deployment never counts
 * fabricated `ZZ*` fixtures; a locally seeded stack that opts in shows
 * them and says so via SyntheticDataNotice.
 */
import {
  and,
  companies,
  cutoffIso,
  desc,
  eq,
  excludeSynthetic,
  gte,
  isNotNull,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

export interface LandingStats {
  /**
   * Filings ingested since midnight UTC yesterday.
   *
   * Not a rolling 24 hours — `cutoffIso` truncates to a date, so the
   * window runs from 24 to 48 hours wide depending on the time of day.
   * That is the intended behaviour for a figure labelled "today" (a
   * rolling window makes the count fall as the day goes on, which reads
   * as the pipeline slowing down), but the label and the SQL disagreed
   * about it in writing, and on this project that is worth stating.
   */
  filingsToday: number;
  /** Total absolute notional (USD) across those filings. */
  notionalUsd: number;
  /** Companies with 2+ distinct opportunistic buyers in the last 14 days. */
  clusterSignals: number;
  /**
   * When the ingester last wrote a row, as an ISO string — or null if it
   * never has.
   *
   * The counts above are windowed, so a zero is ambiguous on its face:
   * it means either "a quiet 24 hours" or "nothing has run in a week",
   * and those are very different statements about a data product. This
   * is what lets the page say which. Deliberately NOT the request time
   * dressed up as freshness — it is max(created_at), and if it is three
   * days old the page says three days old.
   */
  latestIngestAt: string | null;
}

export async function queryLandingStats(db: Database): Promise<LandingStats> {
  const since = cutoffIso(1);

  // Keyed on `createdAt`, not `txnDate`: "filings today" is a statement
  // about what the ingester has seen since yesterday midnight, which is the
  // claim the landing page is actually making. A Form 4 filed today
  // routinely reports a trade from two days ago, so filtering on the
  // trade date would undercount exactly the filings the page is
  // advertising it caught.
  const [totals] = await db
    .select({
      filings: sql`count(*)`.mapWith(Number),
      notional: sql`coalesce(sum(abs(${transactions.valueUsd})), 0)`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .where(and(gte(transactions.createdAt, new Date(`${since}T00:00:00Z`)), excludeSynthetic()));

  // Query-time cluster definition rather than the precomputed flags table:
  // this figure must be correct on a stack where the analytics job has
  // never run, and a headline that reads zero because a cron is missing
  // would be worse than no headline at all.
  const clusterRows = await db
    .select({ companyId: transactions.companyId })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .where(
      and(gte(transactions.txnDate, cutoffIso(14)), eq(transactions.code, "P"), excludeSynthetic()),
    )
    .groupBy(transactions.companyId)
    .having(sql`count(distinct ${transactions.insiderId}) >= 2`);

  // Unwindowed on purpose: the whole point is to be able to say "as of
  // three days ago" when that is the truth.
  const [freshest] = await db
    .select({ at: sql<Date | null>`max(${transactions.createdAt})` })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .where(excludeSynthetic());

  return {
    filingsToday: totals?.filings ?? 0,
    notionalUsd: totals?.notional ?? 0,
    clusterSignals: clusterRows.length,
    latestIngestAt: freshest?.at ? new Date(freshest.at).toISOString() : null,
  };
}

export interface FlowSpark {
  ticker: string;
  name: string;
  /** Signed daily net USD, oldest first. Length is always `days`. */
  points: number[];
  netUsd: number;
}

/**
 * Daily signed net insider flow per company, for the sparkline field.
 *
 * One grouped query, bucketed in JS: issuing N queries for N sparklines
 * is the classic way to turn a decorative strip into the slowest thing
 * on the page.
 */
export async function queryFlowSparklines(
  db: Database,
  limit = 6,
  days = 30,
): Promise<FlowSpark[]> {
  const since = cutoffIso(days);

  const rows = await db
    .select({
      ticker: companies.ticker,
      name: companies.name,
      day: sql<string>`to_char(${transactions.txnDate}::date, 'YYYY-MM-DD')`,
      // Acquisitions add, dispositions subtract — the signed flow.
      net: sql`coalesce(sum(
        case when ${transactions.acquiredDisposed} = 'A'
             then abs(${transactions.valueUsd})
             else -abs(${transactions.valueUsd}) end
      ), 0)`.mapWith(Number),
      total: sql`coalesce(sum(abs(${transactions.valueUsd})), 0)`.mapWith(Number),
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .where(
      and(
        gte(transactions.txnDate, since),
        isNotNull(companies.ticker),
        isNotNull(transactions.valueUsd),
        excludeSynthetic(),
      ),
    )
    .groupBy(companies.ticker, companies.name, sql`3`)
    .orderBy(desc(sql`5`));

  // Rank companies by total traded notional, keep the busiest `limit`.
  const byCompany = new Map<string, { name: string; days: Map<string, number>; total: number }>();
  for (const row of rows) {
    if (!row.ticker) continue;
    const entry = byCompany.get(row.ticker) ?? {
      name: row.name,
      days: new Map<string, number>(),
      total: 0,
    };
    entry.days.set(row.day, (entry.days.get(row.day) ?? 0) + row.net);
    entry.total += row.total;
    byCompany.set(row.ticker, entry);
  }

  const axis: string[] = [];
  const start = new Date(`${since}T00:00:00Z`);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    axis.push(d.toISOString().slice(0, 10));
  }

  return [...byCompany.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, limit)
    .map(([ticker, entry]) => {
      const points = axis.map((day) => entry.days.get(day) ?? 0);
      return {
        ticker,
        name: entry.name,
        points,
        netUsd: points.reduce((sum, n) => sum + n, 0),
      };
    });
}
