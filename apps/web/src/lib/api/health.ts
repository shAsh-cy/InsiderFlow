/**
 * Service health, computed from the data rather than from heartbeats where
 * possible.
 *
 * WHY DATA OVER HEARTBEATS: a heartbeat proves a job ran, not that it worked.
 * The EDGAR cron writes `edgar:cursor` before it finishes, so a run that
 * fetched nothing still updates it. So per-source health is `max(created_at)`
 * over rows that source actually produced; the heartbeat is reported beside it
 * as "last attempt" and the two disagreeing is itself the signal.
 *
 * WHY LAG THRESHOLDS ARE ASYMMETRIC: EDGAR publishes on business days roughly
 * 06:00–22:00 ET. A naive "no filing in 2 hours = broken" check would fire
 * every single night and all weekend. So the *filing* age is informational
 * with a 72-hour ceiling (long weekend + a federal holiday), while the thing
 * that must actually stay fresh — our own cron completing — is held to
 * minutes.
 */
import {
  clusterFlagStatus,
  companies,
  desc,
  eq,
  filings,
  ingestionState,
  politicianTrades,
  scannerState,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

export type HealthLevel = "ok" | "degraded" | "unknown";

export interface HealthCheck {
  name: string;
  level: HealthLevel;
  /** Human-readable, safe to show on a public status page. */
  detail: string;
  ageSeconds: number | null;
}

export interface SourceHealth {
  source: string;
  lastRowAt: string | null;
  ageSeconds: number | null;
  rows: number;
}

export interface HealthReport {
  status: "ok" | "degraded";
  checkedAt: string;
  /** Seconds since the ingest cron last completed a run. */
  ingestRunAgeSeconds: number | null;
  /** Seconds since the newest EDGAR filing acceptance time we hold. */
  filingAgeSeconds: number | null;
  latestFilingAt: string | null;
  sources: SourceHealth[];
  checks: HealthCheck[];
  counts: {
    transactions: number;
    companies: number;
    filings: number;
    politicianTrades: number;
    /**
     * null, not 0, when the queue depth could not be read. The app role is
     * bound by row-level security and cannot count other users' alerts
     * directly; it goes through a counts-only SECURITY DEFINER function. If
     * that call fails, saying "unknown" is the only honest answer — reporting
     * an empty queue would turn a broken monitor into a green dashboard.
     */
    alertsPending: number | null;
    alertsOrphaned: number | null;
    alertsFailedPermanent: number | null;
  };
}

interface AlertQueueDepth {
  pending: number;
  orphaned: number;
  failedPermanent: number;
}

/**
 * Alert queue depth across all users.
 *
 * Deliberately narrow: `alerts_queue_depth()` returns three integers and no
 * row content, and is the only grant the RLS-bound app role has into other
 * users' alert rows. See migration 0009.
 */
async function readAlertQueueDepth(db: Database): Promise<AlertQueueDepth | null> {
  try {
    const result = await db.execute<{
      pending: string | number;
      orphaned: string | number;
      failed_permanent: string | number;
    }>(sql`select * from alerts_queue_depth()`);
    const row = Array.isArray(result) ? result[0] : (result as { rows?: unknown[] }).rows?.[0];
    if (!row) return null;
    const r = row as { pending: string | number; orphaned: string; failed_permanent: string };
    return {
      pending: Number(r.pending),
      orphaned: Number(r.orphaned),
      failedPermanent: Number(r.failed_permanent),
    };
  } catch {
    // Missing function (migration not applied) or no EXECUTE grant.
    return null;
  }
}

/** The ingest cron ticks every minute; this much silence means it is stuck. */
const INGEST_RUN_STALE_SECONDS = 15 * 60;
/** Long weekend + a federal holiday, so a quiet market never reads as broken. */
const FILING_STALE_SECONDS = 72 * 3600;
/** The alert scanner rides the same 1-minute cron. */
const SCANNER_STALE_SECONDS = 15 * 60;

const ageOf = (value: Date | string | null | undefined, now: number): number | null => {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? Math.max(0, Math.floor((now - ms) / 1000)) : null;
};

const describeAge = (seconds: number | null): string => {
  if (seconds === null) return "never";
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
};

export async function buildHealthReport(db: Database): Promise<HealthReport> {
  const now = Date.now();

  const [
    latestFiling,
    edgarState,
    sourceRows,
    scanner,
    clusterCursor,
    counts,
    alertQueue,
    clusterFallback,
  ] = await Promise.all([
    db.select({ filedAt: filings.filedAt }).from(filings).orderBy(desc(filings.filedAt)).limit(1),
    db.select().from(ingestionState).where(eq(ingestionState.key, "edgar:cursor")),
    db
      .select({
        source: transactions.source,
        lastRowAt: sql<Date | null>`max(${transactions.createdAt})`,
        rows: sql`count(*)`.mapWith(Number),
      })
      .from(transactions)
      .groupBy(transactions.source),
    db.select().from(scannerState).where(eq(scannerState.name, "alerts")),
    db.select().from(ingestionState).where(eq(ingestionState.key, "cluster:cursor")),
    db
      .select({
        transactions: sql`(select count(*) from transactions)`.mapWith(Number),
        companies: sql`(select count(*) from ${companies})`.mapWith(Number),
        filings: sql`(select count(*) from ${filings})`.mapWith(Number),
        politicianTrades: sql`(select count(*) from ${politicianTrades})`.mapWith(Number),
      })
      .from(sql`(select 1) as _`),
    readAlertQueueDepth(db),
    clusterFlagStatus(db),
  ]);

  const filingAgeSeconds = ageOf(latestFiling[0]?.filedAt ?? null, now);
  const edgarLastRun = (edgarState[0]?.value as { lastRunAt?: string } | undefined)?.lastRunAt;
  const ingestRunAgeSeconds = ageOf(edgarLastRun ?? null, now);
  const scannerRunAge = ageOf(scanner[0]?.lastRunAt ?? null, now);
  const scannerCursorAge = ageOf(scanner[0]?.cursorCreatedAt ?? null, now);
  const clusterCursorAge = ageOf(
    (clusterCursor[0]?.value as { createdAt?: string } | undefined)?.createdAt ?? null,
    now,
  );
  const clusterFlags = clusterFallback[0]?.flags ?? 0;
  const clusterQualifying = clusterFallback[0]?.qualifying ?? 0;
  const clusterFallbackOn = clusterFlags === 0 && clusterQualifying > 0;

  const checks: HealthCheck[] = [
    {
      name: "ingest_cron",
      level:
        ingestRunAgeSeconds === null
          ? "unknown"
          : ingestRunAgeSeconds > INGEST_RUN_STALE_SECONDS
            ? "degraded"
            : "ok",
      detail:
        ingestRunAgeSeconds === null
          ? "The EDGAR cron has never recorded a completed run."
          : `EDGAR cron last completed ${describeAge(ingestRunAgeSeconds)}.`,
      ageSeconds: ingestRunAgeSeconds,
    },
    {
      name: "edgar_filings",
      // Informational: quiet nights and weekends are normal, not a fault.
      level:
        filingAgeSeconds === null
          ? "unknown"
          : filingAgeSeconds > FILING_STALE_SECONDS
            ? "degraded"
            : "ok",
      detail:
        filingAgeSeconds === null
          ? "No filings ingested yet."
          : `Newest filing accepted ${describeAge(filingAgeSeconds)}. EDGAR files on business days only, so overnight and weekend gaps are expected.`,
      ageSeconds: filingAgeSeconds,
    },
    {
      name: "alert_scanner",
      level:
        scannerRunAge === null
          ? "unknown"
          : scannerRunAge > SCANNER_STALE_SECONDS
            ? "degraded"
            : "ok",
      detail:
        scannerRunAge === null
          ? "The alert scanner has never run."
          : `Scanner last ran ${describeAge(scannerRunAge)}; cursor at ${describeAge(scannerCursorAge)}.`,
      ageSeconds: scannerRunAge,
    },
    {
      name: "cluster_flags",
      // Three distinguishable states, not two. The old check reported
      // "maintenance has not run yet" purely from the cursor, which stayed
      // null even after the analytics sweep had written flags — so the one
      // signal it gave was wrong in the healthy case and silent in the broken
      // one. Degraded is reserved for the case that actually matters: the
      // preset is being served by its fallback because nothing has ever run.
      level: clusterFallbackOn ? "degraded" : clusterFlags > 0 ? "ok" : "unknown",
      detail: clusterFallbackOn
        ? `cluster_flags is empty while ${clusterQualifying} compan${clusterQualifying === 1 ? "y" : "ies"} currently qualify, so the screener is answering from the query-time definition. Correct, but unmaintained and slower — run the analytics job (docker compose up analytics, or the analytics workflow).`
        : clusterFlags > 0
          ? `${clusterFlags} cluster flag${clusterFlags === 1 ? "" : "s"} maintained${clusterCursorAge === null ? "" : `; cursor at ${describeAge(clusterCursorAge)}`}.`
          : "No cluster flags, and no company currently qualifies — nothing to maintain.",
      ageSeconds: clusterCursorAge,
    },
  ];

  const sources: SourceHealth[] = sourceRows
    .map((r) => ({
      source: r.source,
      lastRowAt: r.lastRowAt ? new Date(r.lastRowAt).toISOString() : null,
      ageSeconds: ageOf(r.lastRowAt, now),
      rows: r.rows,
    }))
    .sort((a, b) => b.rows - a.rows);

  if (alertQueue === null) {
    checks.push({
      name: "alerts_queue",
      level: "unknown",
      detail:
        "Alert queue depth could not be read (alerts_queue_depth() is missing or not granted). " +
        "Run pnpm db:migrate.",
      ageSeconds: null,
    });
  } else if (alertQueue.orphaned > 0) {
    checks.push({
      name: "alerts_orphaned",
      level: "degraded",
      detail: `${alertQueue.orphaned} alert${alertQueue.orphaned === 1 ? "" : "s"} retired because their subject row no longer exists.`,
      ageSeconds: null,
    });
  }

  if (alertQueue !== null && alertQueue.failedPermanent > 0) {
    checks.push({
      name: "alerts_failed_permanent",
      level: "degraded",
      detail:
        `${alertQueue.failedPermanent} alert${alertQueue.failedPermanent === 1 ? "" : "s"} could not be delivered ` +
        "and will not be retried (channel rejected them, or they exhausted their attempts).",
      ageSeconds: null,
    });
  }

  return {
    status: checks.some((c) => c.level === "degraded") ? "degraded" : "ok",
    checkedAt: new Date(now).toISOString(),
    ingestRunAgeSeconds,
    filingAgeSeconds,
    latestFilingAt: latestFiling[0]?.filedAt ? latestFiling[0].filedAt.toISOString() : null,
    sources,
    checks,
    counts: {
      transactions: counts[0]?.transactions ?? 0,
      companies: counts[0]?.companies ?? 0,
      filings: counts[0]?.filings ?? 0,
      politicianTrades: counts[0]?.politicianTrades ?? 0,
      alertsPending: alertQueue?.pending ?? null,
      alertsOrphaned: alertQueue?.orphaned ?? null,
      alertsFailedPermanent: alertQueue?.failedPermanent ?? null,
    },
  };
}

export { describeAge };
