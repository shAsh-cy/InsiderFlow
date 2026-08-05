/**
 * Operational status, shared by the ops-check script.
 *
 * Kept out of apps/web so a self-hoster can run the check from anywhere with
 * a DATABASE_URL — an ops alert that requires the web app to be up cannot
 * tell you the web app is down.
 *
 * Thresholds mirror apps/web/src/lib/api/health.ts, and for the same reason:
 * EDGAR only files on business days, so "no filing since Friday" on a Sunday
 * is normal, while "our cron has not completed in 30 minutes" never is.
 */
import {
  alertsLog,
  desc,
  eq,
  filings,
  ingestionState,
  scannerState,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

/** The ingest cron ticks every minute. */
export const INGEST_RUN_STALE_SECONDS = 30 * 60;
/** The alert scanner rides the same cron. */
export const SCANNER_STALE_SECONDS = 30 * 60;
/** Long weekend + a federal holiday. */
export const FILING_STALE_SECONDS = 96 * 3600;

export interface OpsStatus {
  degraded: boolean;
  problems: string[];
  checkedAt: string;
  counts: {
    transactions: number;
    alertsPending: number;
    alertsOrphaned: number;
    alertsFailedPermanent: number;
  };
  ingestRunAgeSeconds: number | null;
  scannerRunAgeSeconds: number | null;
  filingAgeSeconds: number | null;
}

const ageOf = (value: Date | string | null | undefined): number | null => {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? Math.max(0, Math.floor((Date.now() - ms) / 1000)) : null;
};

const mins = (seconds: number | null): string =>
  seconds === null ? "never" : `${Math.round(seconds / 60)} min`;

export async function collectOpsStatus(db: Database): Promise<OpsStatus> {
  const [edgarState, scanner, latestFiling, txnCount, alertCounts] = await Promise.all([
    db.select().from(ingestionState).where(eq(ingestionState.key, "edgar:cursor")),
    db.select().from(scannerState).where(eq(scannerState.name, "alerts")),
    db.select({ filedAt: filings.filedAt }).from(filings).orderBy(desc(filings.filedAt)).limit(1),
    db.select({ n: sql`count(*)`.mapWith(Number) }).from(transactions),
    // Counted directly, unlike apps/web: ops-check runs from GitHub Actions on
    // the ADMIN connection, which is not bound by the user-table RLS policies.
    db
      .select({
        pending: sql`count(*) filter (where ${alertsLog.status} = 'pending')`.mapWith(Number),
        orphaned: sql`count(*) filter (where ${alertsLog.status} = 'orphaned')`.mapWith(Number),
        failedPermanent:
          sql`count(*) filter (where ${alertsLog.status} = 'failed_permanent')`.mapWith(Number),
      })
      .from(alertsLog),
  ]);

  const ingestRunAgeSeconds = ageOf(
    (edgarState[0]?.value as { lastRunAt?: string } | undefined)?.lastRunAt ?? null,
  );
  const scannerRunAgeSeconds = ageOf(scanner[0]?.lastRunAt ?? null);
  const filingAgeSeconds = ageOf(latestFiling[0]?.filedAt ?? null);

  const problems: string[] = [];
  if (ingestRunAgeSeconds === null) {
    problems.push("EDGAR cron has never completed a run.");
  } else if (ingestRunAgeSeconds > INGEST_RUN_STALE_SECONDS) {
    problems.push(`EDGAR cron last completed ${mins(ingestRunAgeSeconds)} ago.`);
  }

  if (scannerRunAgeSeconds !== null && scannerRunAgeSeconds > SCANNER_STALE_SECONDS) {
    problems.push(`Alert scanner last ran ${mins(scannerRunAgeSeconds)} ago.`);
  }

  if (filingAgeSeconds !== null && filingAgeSeconds > FILING_STALE_SECONDS) {
    problems.push(
      `No new EDGAR filing in ${Math.round(filingAgeSeconds / 3600)}h — longer than a holiday weekend.`,
    );
  }

  const orphaned = alertCounts[0]?.orphaned ?? 0;
  if (orphaned > 0) {
    problems.push(`${orphaned} orphaned alert${orphaned === 1 ? "" : "s"} (subject row deleted).`);
  }

  const failedPermanent = alertCounts[0]?.failedPermanent ?? 0;
  if (failedPermanent > 0) {
    problems.push(
      `${failedPermanent} alert${failedPermanent === 1 ? "" : "s"} undeliverable — channel rejected them ` +
        "or they exhausted their retries. Check the destination.",
    );
  }

  return {
    degraded: problems.length > 0,
    problems,
    checkedAt: new Date().toISOString(),
    counts: {
      transactions: txnCount[0]?.n ?? 0,
      alertsPending: alertCounts[0]?.pending ?? 0,
      alertsOrphaned: orphaned,
      alertsFailedPermanent: failedPermanent,
    },
    ingestRunAgeSeconds,
    scannerRunAgeSeconds,
    filingAgeSeconds,
  };
}

const escapeHtml = (s: string): string =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export function formatOpsMessage(status: OpsStatus): string {
  const header = status.degraded
    ? "⚠️ <b>InsiderFlow — degraded</b>"
    : "✅ <b>InsiderFlow — healthy</b>";
  const lines = [
    header,
    "",
    ...status.problems.map((p) => `• ${escapeHtml(p)}`),
    status.problems.length > 0 ? "" : null,
    `<i>ingest ${mins(status.ingestRunAgeSeconds)} ago · scanner ${mins(status.scannerRunAgeSeconds)} ago</i>`,
    `<i>${status.counts.transactions.toLocaleString("en-US")} transactions · ${status.counts.alertsPending} alerts pending</i>`,
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}
