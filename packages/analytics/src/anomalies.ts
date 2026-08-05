/**
 * Statistical anomaly score: how unusual a company's CURRENT net insider flow
 * is against its OWN trailing history.
 *
 * Each company is its own control. $2M of net buying is extraordinary for a
 * micro-cap and rounding for a mega-cap, so there is no cross-company scale on
 * which a raw dollar figure means anything. The published number is a z-score
 * against that company's previous windows, and it is suppressed entirely when
 * the baseline is too thin to support one.
 *
 * INFORMATIONAL ONLY, not investment advice. Formula: /docs/methodology.
 */
import { and, companies, companyAnomalies, eq, gte, lte, sql, transactions } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import { zScore } from "./scoring-math";

export const DEFAULT_WINDOW_DAYS = 30;
/** Trailing windows behind the current one that form the baseline. */
export const DEFAULT_BASELINE_WINDOWS = 12;
/** Below this many baseline windows the z-score is not published. */
export const MIN_SAMPLE = 6;

export interface AnomalyOptions {
  db: Database;
  windowDays?: number;
  baselineWindows?: number;
  now?: Date;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export interface AnomalyResult {
  companiesConsidered: number;
  published: number;
  /** Had recent flow but too little history to score. */
  suppressed: number;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Net USD flow per company per window, in one pass.
 *
 * Bucketing is a floor-divide on day offset so the whole baseline comes back
 * as one grouped result rather than N queries per company.
 *
 * The bucket expression is built with sql.raw and reused BY REFERENCE in both
 * the projection and the GROUP BY. Passing the same values as bind parameters
 * twice yields `$1` in one place and `$6` in the other, and Postgres compares
 * grouping expressions structurally — it sees two different expressions and
 * rejects the query ("must appear in the GROUP BY clause"). Both inputs are
 * server-controlled (a formatted date, a validated integer), never user input.
 */
async function netFlowByWindow(
  db: Database,
  from: string,
  windowDays: number,
  now: Date,
): Promise<Map<string, Map<number, number>>> {
  const asOf = iso(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new Error(`bad as-of date: ${asOf}`);
  if (!Number.isInteger(windowDays) || windowDays < 1) {
    throw new Error(`bad window size: ${windowDays}`);
  }

  // 0 = the current window, 1 = the one before it, ...
  const bucketExpr = sql`floor((${sql.raw(`date '${asOf}'`)} - ${transactions.txnDate}) / ${sql.raw(String(windowDays))})`;

  const rows = await db
    .select({
      companyId: transactions.companyId,
      bucket: bucketExpr.mapWith(Number),
      net: sql<string>`coalesce(sum(
        case when ${transactions.acquiredDisposed} = 'A' then ${transactions.valueUsd}
             when ${transactions.acquiredDisposed} = 'D' then -${transactions.valueUsd}
             else 0 end), 0)`,
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .where(
      and(
        gte(transactions.txnDate, from),
        lte(transactions.txnDate, asOf),
        eq(transactions.relevance, "opportunistic"),
      ),
    )
    .groupBy(transactions.companyId, bucketExpr);

  const out = new Map<string, Map<number, number>>();
  for (const row of rows) {
    const inner = out.get(row.companyId) ?? new Map<number, number>();
    inner.set(row.bucket, Number(row.net));
    out.set(row.companyId, inner);
  }
  return out;
}

export async function computeAnomalies(options: AnomalyOptions): Promise<AnomalyResult> {
  const { db } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const baselineWindows = options.baselineWindows ?? DEFAULT_BASELINE_WINDOWS;

  const totalDays = windowDays * (baselineWindows + 1);
  const from = iso(new Date(now.getTime() - totalDays * 86_400_000));

  const byCompany = await netFlowByWindow(db, from, windowDays, now);
  const result: AnomalyResult = {
    companiesConsidered: byCompany.size,
    published: 0,
    suppressed: 0,
  };
  if (byCompany.size === 0) return result;

  const values: Array<typeof companyAnomalies.$inferInsert> = [];
  for (const [companyId, buckets] of byCompany) {
    const current = buckets.get(0) ?? 0;

    // A window with no trades is a real observation of zero flow, not a gap —
    // omitting them would make every company look permanently anomalous.
    const baseline: number[] = [];
    for (let i = 1; i <= baselineWindows; i++) baseline.push(buckets.get(i) ?? 0);

    const stats = zScore(current, baseline, MIN_SAMPLE);
    if (!stats) {
      result.suppressed++;
      // Still record the flow so the UI can say "not enough history" honestly.
      values.push({
        companyId,
        windowDays,
        netUsd: current.toFixed(4),
        baselineMean: null,
        baselineStddev: null,
        zScore: null,
        sampleSize: baseline.length,
        computedAt: now,
      });
      continue;
    }

    result.published++;
    values.push({
      companyId,
      windowDays,
      netUsd: current.toFixed(4),
      baselineMean: stats.mean.toFixed(4),
      baselineStddev: stats.stddev.toFixed(4),
      zScore: stats.z.toFixed(6),
      sampleSize: baseline.length,
      computedAt: now,
    });
  }

  for (let i = 0; i < values.length; i += 500) {
    await db
      .insert(companyAnomalies)
      .values(values.slice(i, i + 500))
      .onConflictDoUpdate({
        target: companyAnomalies.companyId,
        set: {
          windowDays: sql`excluded.window_days`,
          netUsd: sql`excluded.net_usd`,
          baselineMean: sql`excluded.baseline_mean`,
          baselineStddev: sql`excluded.baseline_stddev`,
          zScore: sql`excluded.z_score`,
          sampleSize: sql`excluded.sample_size`,
          computedAt: sql`excluded.computed_at`,
        },
      });
  }

  log("anomalies_complete", { ...result });
  return result;
}
