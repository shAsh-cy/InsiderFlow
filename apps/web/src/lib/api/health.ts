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
  alertsLog,
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
    alertsPending: number;
    alertsOrphaned: number;
  };
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

  const [latestFiling, edgarState, sourceRows, scanner, clusterCursor, counts, alertCounts] =
    await Promise.all([
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
      db
        .select({
          pending: sql`count(*) filter (where ${alertsLog.status} = 'pending')`.mapWith(Number),
          orphaned: sql`count(*) filter (where ${alertsLog.status} = 'orphaned')`.mapWith(Number),
        })
        .from(alertsLog),
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
      level: clusterCursorAge === null ? "unknown" : "ok",
      detail:
        clusterCursorAge === null
          ? "Cluster maintenance has not run yet."
          : `Cluster cursor at ${describeAge(clusterCursorAge)}.`,
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

  const orphaned = alertCounts[0]?.orphaned ?? 0;
  if (orphaned > 0) {
    checks.push({
      name: "alerts_orphaned",
      level: "degraded",
      detail: `${orphaned} alert${orphaned === 1 ? "" : "s"} retired because their subject row no longer exists.`,
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
      alertsPending: alertCounts[0]?.pending ?? 0,
      alertsOrphaned: orphaned,
    },
  };
}

export { describeAge };
