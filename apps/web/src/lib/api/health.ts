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
  pendingFilings,
  PENDING_FILING_MAX_ATTEMPTS,
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
  /** Human label, so a status page does not have to know the enum. */
  label: string;
  /**
   * What this deployment CLAIMS about the source, independent of whether
   * rows exist. `live` and zero rows is a fault; `off` and zero rows is
   * the documented arrangement — and a reader cannot tell those apart
   * from a row count alone.
   */
  posture: SourcePosture;
  note: string;
}

export type SourcePosture = "live" | "off-by-default" | "upstream-dead" | "not-in-hosted-deploy";

interface DeclaredSource {
  key: string;
  label: string;
  posture: SourcePosture;
  note: string;
}

/**
 * Every source this project talks about, whether or not it has ever
 * produced a row.
 *
 * ── WHY A DECLARED LIST AND NOT JUST GROUP BY ─────────────────────────
 *
 * `sources` used to be built purely by grouping `transactions` on
 * `source`. That is honest about what arrived and silent about what did
 * not: a source with zero rows was ABSENT from the response entirely.
 *
 * Absent and "never" are different claims, and the difference is the
 * whole point of this page. India ingestion is off by default and
 * politician ingestion has a dead upstream — both correct, both
 * deliberate, and both previously invisible here. A reader saw a list
 * containing EDGAR and concluded EDGAR was all there is, rather than
 * learning that two other sources exist and are not currently producing.
 *
 * So the list is declared, the observed rows are merged onto it, and a
 * source that has never produced reads `never` with a note saying why.
 */
const DECLARED_SOURCES: readonly DeclaredSource[] = [
  {
    key: "sec_edgar",
    label: "SEC EDGAR (US)",
    posture: "live",
    note: "Form 4/3/5 ownership filings, polled continuously. The only real-time source in the hosted deployment.",
  },
  {
    key: "nse_india",
    label: "NSE (India)",
    posture: "not-in-hosted-deploy",
    note: "Exchange terms of use and IT Act §43 keep scraping out of the hosted build. Self-hosters can enable it with ENABLE_INDIA_INGEST; a licensed feed can be pointed at INDIA_FEED_URL. Smoked live from a residential Indian line on 2026-08-18: SAST, bulk deals and pledges returned real rows and their field names are confirmed. The PIT endpoint — the one carrying actual insider trades — answered HTTP 200 with an empty envelope over a 90-day window, so its row shape remains INFERRED and unverified.",
  },
  {
    key: "bse_india",
    label: "BSE (India)",
    posture: "not-in-hosted-deploy",
    note: "Same posture as NSE. Announcements are confirmed live (2026-08-18) and carry metadata plus PDF links, never structured trade numbers; one of two attempts failed on a malformed response header. The insider-trading endpoints are not shipped.",
  },
  {
    key: "politicians",
    label: "Congressional PTRs (US)",
    posture: "upstream-dead",
    note: "The house/senate-stock-watcher S3 buckets now answer 403. The pipeline is built and tested; it has no upstream. HOUSE_PTR_URL / SENATE_PTR_URL are env-swappable.",
  },
];

/**
 * A pre-public step that is a HUMAN's to perform, not a job's.
 *
 * These are not health: nothing is broken, and the app is behaving as
 * configured. They are readiness — things that must be true before this
 * deployment is public, that no amount of correct code can make true,
 * and that are therefore easy to carry to launch unnoticed.
 *
 * They live beside health rather than only in DEPLOYMENT_STATE.md for one
 * reason: a checklist in a repository is read once, and a status page is
 * read every time something looks wrong.
 */
export interface ReadinessItem {
  name: string;
  /** `ready` | `pending` | `unknown` — never a bare boolean; see below. */
  state: "ready" | "pending" | "unknown";
  detail: string;
  /** Where the step is actually performed. */
  where: string;
}

/**
 * `unknown` is a distinct state from `pending`, deliberately.
 *
 * Turnstile can be observed from here: the site key is either compiled in
 * or it is not. The Supabase email+password provider CANNOT — it is a
 * setting in a dashboard this process cannot read, and reporting it as
 * `ready` because we would like it to be would be the exact dishonesty
 * this page exists to prevent.
 */
function readiness(): ReadinessItem[] {
  const turnstileConfigured = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
  return [
    {
      name: "Bot protection (Turnstile)",
      state: turnstileConfigured ? "ready" : "pending",
      detail: turnstileConfigured
        ? "A site key is configured, so the auth forms render the challenge and Supabase verifies the token."
        : "No site key. The magic-link form has no bot protection beyond Supabase's own rate limits, which are reported as inconsistently enforced. See docs/auth.md.",
      where: "Cloudflare Turnstile + Supabase → Authentication → Attack Protection",
    },
    {
      name: "Email+password provider disabled",
      // Not observable from this process, and saying so is the point.
      state: "unknown",
      detail:
        "A Supabase dashboard setting this app cannot read. It exists for the dev project so the cross-user exploitation suite can mint users, and must be OFF in production. SECURITY_CHECKLIST.md item 13 — “N/A, prod has no password” — only becomes true once it is.",
      where: "Supabase → Authentication → Sign In / Providers",
    },
    {
      name: "RLS verified against Supabase",
      state: "unknown",
      detail:
        "The background-job over-read is fixed and proved locally against the real migrations, but PGlite is not Supabase: the hosted postgres role's attributes and the behaviour of SET LOCAL through the 6543 transaction pooler are unconfirmed. See DEPLOYMENT_STATE.md.",
      where: "Deploy-time runbook, before the first public request",
    },
  ];
}

export interface HealthReport {
  status: "ok" | "degraded";
  checkedAt: string;
  /** Seconds since the ingest cron last completed a run. */
  ingestRunAgeSeconds: number | null;
  /** Seconds since the newest EDGAR filing acceptance time we hold. */
  filingAgeSeconds: number | null;
  latestFilingAt: string | null;
  /**
   * Filings discovered but not yet fetched, and how long the oldest has
   * waited.
   *
   * The number the previous version threw away. Discovery used to be
   * inseparable from processing: whatever a run could not fetch was simply
   * forgotten, so the only trace of a burst was a log line. With the queue,
   * depth IS the backlog and this is the signal that the drain has stopped
   * keeping up — the difference between "the cron ran" and "the cron is
   * winning".
   */
  ingestBacklog: number;
  ingestBacklogOldestSeconds: number | null;
  /** Queued filings that exhausted their retries — stuck, not merely waiting. */
  ingestStuck: number;
  sources: SourceHealth[];
  checks: HealthCheck[];
  /** Human pre-public steps; see ReadinessItem. */
  readiness: ReadinessItem[];
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
/**
 * How long a discovered filing may sit unfetched before the drain is judged to
 * be losing. Generous: a genuine post-close burst of a few hundred filings
 * takes several cron ticks to clear at 25/run, and that is working as designed.
 */
const INGEST_BACKLOG_STALE_SECONDS = 30 * 60;

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
    politicianRows,
    alertQueue,
    clusterFallback,
    backlogRow,
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
    db
      .select({
        lastRowAt: sql<Date | null>`max(${politicianTrades.createdAt})`,
        rows: sql`count(*)`.mapWith(Number),
      })
      .from(politicianTrades),
    readAlertQueueDepth(db),
    clusterFlagStatus(db),
    db
      .select({
        depth:
          sql`count(*) filter (where ${pendingFilings.attempts} < ${PENDING_FILING_MAX_ATTEMPTS})`.mapWith(
            Number,
          ),
        stuck:
          sql`count(*) filter (where ${pendingFilings.attempts} >= ${PENDING_FILING_MAX_ATTEMPTS})`.mapWith(
            Number,
          ),
        oldest: sql<Date | null>`min(${pendingFilings.discoveredAt}) filter (where ${pendingFilings.attempts} < ${PENDING_FILING_MAX_ATTEMPTS})`,
      })
      .from(pendingFilings),
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
  const ingestBacklog = backlogRow[0]?.depth ?? 0;
  const ingestStuck = backlogRow[0]?.stuck ?? 0;
  const ingestBacklogOldestSeconds = ageOf(backlogRow[0]?.oldest ?? null, now);
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
      name: "ingest_backlog",
      // Depth alone is not the signal — a burst SHOULD queue, that is the
      // point. What matters is whether the drain is winning: if the oldest
      // waiting filing keeps aging, arrivals are outrunning the per-run cap
      // and the latency claim no longer holds.
      level:
        ingestStuck > 0
          ? "degraded"
          : ingestBacklogOldestSeconds !== null &&
              ingestBacklogOldestSeconds > INGEST_BACKLOG_STALE_SECONDS
            ? "degraded"
            : "ok",
      detail:
        ingestBacklog === 0 && ingestStuck === 0
          ? "No filings waiting to be fetched."
          : [
              `${ingestBacklog} filing${ingestBacklog === 1 ? "" : "s"} queued`,
              ingestBacklogOldestSeconds === null
                ? null
                : `oldest discovered ${describeAge(ingestBacklogOldestSeconds)}`,
              ingestStuck > 0
                ? `${ingestStuck} gave up after ${PENDING_FILING_MAX_ATTEMPTS} attempts`
                : null,
            ]
              .filter(Boolean)
              .join("; ") + ".",
      ageSeconds: ingestBacklogOldestSeconds,
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

  /**
   * Declared sources first, then anything observed that nobody declared.
   *
   * The second half matters as much as the first: a source key arriving
   * that this file does not know about is a real event — a new adapter
   * shipped, or a value written under the wrong key — and dropping it
   * because it is not in the list would hide exactly that.
   */
  const observed = new Map(sourceRows.map((r) => [r.source, r]));
  const politicianFreshness = politicianRows[0] ?? { lastRowAt: null, rows: 0 };

  const sources: SourceHealth[] = DECLARED_SOURCES.map((declared) => {
    // Politician rows live in their own table, not in `transactions`.
    const row =
      declared.key === "politicians"
        ? { lastRowAt: politicianFreshness.lastRowAt, rows: politicianFreshness.rows }
        : (observed.get(declared.key) ?? { lastRowAt: null, rows: 0 });
    observed.delete(declared.key);
    return {
      source: declared.key,
      label: declared.label,
      posture: declared.posture,
      note: declared.note,
      lastRowAt: row.lastRowAt ? new Date(row.lastRowAt).toISOString() : null,
      ageSeconds: ageOf(row.lastRowAt, now),
      rows: row.rows,
    };
  });

  for (const [key, row] of observed) {
    sources.push({
      source: key,
      label: key,
      posture: "live",
      note: "Producing rows, but not declared in lib/api/health.ts — add it there so its posture is stated rather than inferred.",
      lastRowAt: row.lastRowAt ? new Date(row.lastRowAt).toISOString() : null,
      ageSeconds: ageOf(row.lastRowAt, now),
      rows: row.rows,
    });
  }

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
    ingestBacklog,
    ingestBacklogOldestSeconds,
    ingestStuck,
    sources,
    checks,
    readiness: readiness(),
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
