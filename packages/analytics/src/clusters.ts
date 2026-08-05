/**
 * Precomputed insider clusters.
 *
 * A cluster is ≥N distinct insiders trading the same direction in the same
 * company inside a rolling window. Computing that at query time means a
 * GROUP BY + HAVING over the whole transactions table on every screener
 * request; this module maintains it as flags instead.
 *
 * MAINTENANCE MODEL
 *  - Incremental (every minute, inside the existing ingest cron): recompute
 *    only the companies touched by transactions created since the cluster
 *    cursor. Cost is O(new rows), not O(table). Driven by a cursor rather
 *    than by the ingest pipeline's return value, so it also covers rows
 *    written by the backfill, the India runner, and the secondary sources.
 *  - Full sweep (nightly, GitHub Actions): recompute every company with
 *    recent activity. This is what bounds staleness — a company with no new
 *    trades is never touched incrementally, so its flag would otherwise age
 *    as old trades slide out of the window. Drift is capped at one day, and
 *    it drifts toward false NEGATIVES (a flag stops matching), which is the
 *    safe direction for a signal.
 *
 * WINDOW ANCHORING
 * window_start is the earliest qualifying trade still inside the lookback,
 * NOT "today minus 14". An anchored window keeps a stable identity while a
 * cluster is alive, which is what lets the alert dedup key fire once per
 * threshold crossing instead of once per scan.
 *
 * CTE WARNING: the cursor read, the flag upsert, and the cursor write are
 * three separate statements. Data-modifying CTEs in one statement share a
 * snapshot and cannot see each other's rows — the trap that silently broke
 * an amendment fixture (see linkAmendment in the ingestion worker).
 */
import {
  and,
  asc,
  clusterFlags,
  eq,
  gte,
  inArray,
  ingestionState,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

export const CLUSTER_CURSOR_KEY = "cluster:cursor";

/** Buys cluster on code P, sells on code S — the same codes the SQL fallback used. */
export const CLUSTER_CODES = { buy: "P", sell: "S" } as const;
export type ClusterDirection = keyof typeof CLUSTER_CODES;

export const DEFAULT_CLUSTER_WINDOW_DAYS = 14;
export const DEFAULT_MIN_INSIDERS = 2;

export interface ClusterOptions {
  windowDays?: number;
  minInsiders?: number;
  /** Treated as "today" — the end of the lookback. */
  asOf?: Date;
  /** Cap on companies recomputed in one incremental pass. */
  maxCompanies?: number;
}

export interface ClusterMaintenanceResult {
  companiesConsidered: number;
  flagsWritten: number;
  cursorAdvanced: boolean;
}

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Must match cutoffIso() in @insiderflow/db exactly — the SQL fallback and the
 * flags path have to agree on where the window starts, or the two disagree by
 * a day and the parity test is measuring the wrong thing.
 */
const lookbackStart = (asOf: Date, windowDays: number): string =>
  isoDay(new Date(asOf.getTime() - windowDays * 86_400_000));

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Recompute flags for an explicit set of companies. Idempotent: running it
 * twice over the same data produces the same rows.
 *
 * RETRACTION MATTERS AS MUCH AS DETECTION. A flag can stop being true — a
 * transaction is deleted, an amendment supersedes one, trades age out of the
 * window — and an upsert-only recompute would leave the stale flag standing
 * until its anchor expired, up to a full window of false positives. So any
 * in-window flag for a recomputed company that no longer qualifies is deleted
 * in the same pass. Flags OUTSIDE the lookback are left alone: those are
 * settled history for the stock-page timeline, not live claims.
 *
 * Synthetic ZZ* fixtures are NOT filtered here — they are filtered at the
 * publish surfaces (see excludeSynthetic in @insiderflow/db). Filtering
 * during computation would make the flags path and the SQL fallback
 * incomparable, and would break the ZZ*-based alert smoke test.
 */
export async function recomputeClusterFlags(
  db: Database,
  companyIds: string[],
  options: ClusterOptions = {},
): Promise<number> {
  if (companyIds.length === 0) return 0;
  const windowDays = options.windowDays ?? DEFAULT_CLUSTER_WINDOW_DAYS;
  const minInsiders = options.minInsiders ?? DEFAULT_MIN_INSIDERS;
  const from = lookbackStart(options.asOf ?? new Date(), windowDays);

  const rows = await db
    .select({
      companyId: transactions.companyId,
      direction: sql<string>`case when ${transactions.code} = 'P' then 'buy' else 'sell' end`,
      windowStart: sql<string>`min(${transactions.txnDate})::text`,
      windowEnd: sql<string>`max(${transactions.txnDate})::text`,
      insiderCount: sql<number>`count(distinct ${transactions.insiderId})`.mapWith(Number),
      tradeCount: sql<number>`count(*)`.mapWith(Number),
      totalUsd: sql<string | null>`sum(${transactions.valueUsd})`,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.companyId, companyIds),
        inArray(transactions.code, ["P", "S"]),
        gte(transactions.txnDate, from),
      ),
    )
    .groupBy(
      transactions.companyId,
      sql`case when ${transactions.code} = 'P' then 'buy' else 'sell' end`,
    )
    .having(sql`count(distinct ${transactions.insiderId}) >= ${minInsiders}`);

  // Retract first, then write. Separate statements from the upsert below —
  // a data-modifying CTE could not see rows the same statement had inserted
  // (the trap documented at linkAmendment in the ingestion worker).
  const survivors = new Set(rows.map((r) => `${r.companyId}|${r.direction}|${r.windowStart}`));
  const existing = await db
    .select({
      companyId: clusterFlags.companyId,
      direction: clusterFlags.direction,
      windowStart: clusterFlags.windowStart,
    })
    .from(clusterFlags)
    .where(and(inArray(clusterFlags.companyId, companyIds), gte(clusterFlags.windowStart, from)));

  const stale = existing.filter(
    (e) => !survivors.has(`${e.companyId}|${e.direction}|${e.windowStart}`),
  );
  for (const flag of stale) {
    await db
      .delete(clusterFlags)
      .where(
        and(
          eq(clusterFlags.companyId, flag.companyId),
          eq(clusterFlags.direction, flag.direction),
          eq(clusterFlags.windowStart, flag.windowStart),
        ),
      );
  }

  if (rows.length === 0) return 0;

  await db
    .insert(clusterFlags)
    .values(
      rows.map((r) => ({
        companyId: r.companyId,
        direction: r.direction as ClusterDirection,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        insiderCount: r.insiderCount,
        tradeCount: r.tradeCount,
        totalUsd: r.totalUsd,
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: [clusterFlags.companyId, clusterFlags.direction, clusterFlags.windowStart],
      set: {
        windowEnd: sql`excluded.window_end`,
        insiderCount: sql`excluded.insider_count`,
        tradeCount: sql`excluded.trade_count`,
        totalUsd: sql`excluded.total_usd`,
        updatedAt: sql`excluded.updated_at`,
      },
    });

  return rows.length;
}

interface Cursor extends Record<string, unknown> {
  createdAt: string | null;
  id: string | null;
}

async function readCursor(db: Database): Promise<Cursor> {
  const [row] = await db
    .select()
    .from(ingestionState)
    .where(eq(ingestionState.key, CLUSTER_CURSOR_KEY));
  const value = row?.value as Partial<Cursor> | undefined;
  return { createdAt: value?.createdAt ?? null, id: value?.id ?? null };
}

async function writeCursor(db: Database, cursor: Cursor): Promise<void> {
  await db
    .insert(ingestionState)
    .values({ key: CLUSTER_CURSOR_KEY, value: cursor, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: ingestionState.key,
      set: { value: cursor, updatedAt: new Date() },
    });
}

/**
 * The 1-minute pass: find companies touched since the cursor and recompute
 * just those. Safe to run concurrently with ingestion — worst case a row is
 * seen twice, and the recompute is idempotent.
 */
export async function maintainClusterFlags(
  db: Database,
  options: ClusterOptions = {},
): Promise<ClusterMaintenanceResult> {
  const cursor = await readCursor(db);
  const limit = options.maxCompanies ?? 500;

  const conditions = [inArray(transactions.code, ["P", "S"])];
  if (cursor.createdAt) {
    conditions.push(
      sql`(${transactions.createdAt}, ${transactions.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id ?? ZERO_UUID}::uuid)`,
    );
  }

  const touched = await db
    .select({
      companyId: transactions.companyId,
      createdAt: transactions.createdAt,
      id: transactions.id,
    })
    .from(transactions)
    .where(and(...conditions))
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
    .limit(limit);

  if (touched.length === 0) {
    return { companiesConsidered: 0, flagsWritten: 0, cursorAdvanced: false };
  }

  const companyIds = [...new Set(touched.map((t) => t.companyId))];
  const flagsWritten = await recomputeClusterFlags(db, companyIds, options);

  // Separate statement from the upsert above (see the CTE warning).
  const last = touched[touched.length - 1]!;
  await writeCursor(db, { createdAt: last.createdAt.toISOString(), id: last.id });

  return { companiesConsidered: companyIds.length, flagsWritten, cursorAdvanced: true };
}

/**
 * The nightly pass: recompute every company with activity in the lookback,
 * repairing flags that aged out without new trades to trigger an incremental
 * recompute. Also prunes flags whose window has fully expired.
 */
export async function sweepClusterFlags(
  db: Database,
  options: ClusterOptions = {},
): Promise<{ companiesConsidered: number; flagsWritten: number; pruned: number }> {
  const windowDays = options.windowDays ?? DEFAULT_CLUSTER_WINDOW_DAYS;
  const asOf = options.asOf ?? new Date();
  const from = lookbackStart(asOf, windowDays);

  const active = await db
    .selectDistinct({ companyId: transactions.companyId })
    .from(transactions)
    .where(and(inArray(transactions.code, ["P", "S"]), gte(transactions.txnDate, from)));

  const companyIds = active.map((a) => a.companyId);
  const flagsWritten = await recomputeClusterFlags(db, companyIds, { ...options, asOf });

  // Retention: keep a quarter of history for the stock-page timeline, then drop.
  const retentionCutoff = isoDay(new Date(asOf.getTime() - 90 * 86_400_000));
  const pruned = await db
    .delete(clusterFlags)
    .where(sql`${clusterFlags.windowEnd} < ${retentionCutoff}`)
    .returning({ companyId: clusterFlags.companyId });

  return { companiesConsidered: companyIds.length, flagsWritten, pruned: pruned.length };
}

export interface ActiveCluster {
  companyId: string;
  direction: ClusterDirection;
  windowStart: string;
  windowEnd: string;
  insiderCount: number;
  tradeCount: number;
  totalUsd: number | null;
}

/**
 * Clusters currently inside the lookback. `window_start >= cutoff` (not
 * window_end) is deliberate: it means every trade in the anchored window is
 * still within the lookback, which is exactly what the query-time GROUP BY
 * asserted. Using window_end would keep matching a window whose earliest
 * trades have already expired.
 */
export async function activeClusters(
  db: Database,
  options: ClusterOptions & { direction?: ClusterDirection } = {},
): Promise<ActiveCluster[]> {
  const windowDays = options.windowDays ?? DEFAULT_CLUSTER_WINDOW_DAYS;
  const from = lookbackStart(options.asOf ?? new Date(), windowDays);
  const conds = [
    gte(clusterFlags.windowStart, from),
    gte(clusterFlags.insiderCount, options.minInsiders ?? DEFAULT_MIN_INSIDERS),
  ];
  if (options.direction) conds.push(eq(clusterFlags.direction, options.direction));

  const rows = await db
    .select()
    .from(clusterFlags)
    .where(and(...conds));

  return rows.map((r) => ({
    companyId: r.companyId,
    direction: r.direction,
    windowStart: r.windowStart,
    windowEnd: r.windowEnd,
    insiderCount: r.insiderCount,
    tradeCount: r.tradeCount,
    totalUsd: r.totalUsd === null ? null : Number(r.totalUsd),
  }));
}
