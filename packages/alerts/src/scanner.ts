/**
 * Cursor-driven alert scanner.
 *
 * Robustness model — the pipeline has several writers (Cloudflare EDGAR
 * worker, GitHub Actions backfill, the optional india-local runner), so the
 * scanner never assumes it caused a write:
 *
 *  - CURSOR: a (created_at, id) tuple, not a timestamp alone — ids break
 *    ties so a batch can never be split mid-tuple.
 *  - OVERLAP SAFETY: a lease lock (locked_until in the future) rather than
 *    a session advisory lock, because transaction-mode connection pooling
 *    does not guarantee session state between statements.
 *  - IDEMPOTENCY: alerts_log has a unique (rule_id, dedup_key). Re-runs,
 *    crashed batches, and amendment re-homes (same dedup_key, new filing
 *    id) can never double-fire.
 *  - AT-LEAST-ONCE: the cursor advances only AFTER dispatch. A crash
 *    re-scans; the unique index absorbs the duplicate work.
 *
 * CTE WARNING: cursor claim/advance and alerts_log writes are separate
 * statements on purpose. Data-modifying CTEs in one statement share a
 * snapshot and cannot see each other's rows — the same trap that silently
 * broke an amendment fixture (see linkAmendment in the ingestion worker).
 */
import {
  alertChannels,
  alertRules,
  alertsLog,
  and,
  asc,
  buildTradeConditions,
  companies,
  eq,
  filings,
  inArray,
  insiders,
  isNull,
  or,
  scannerState,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database, TradeFilterInput } from "@insiderflow/db";

import { effectiveMode, ruleMatches } from "./match";
import type { AlertCandidate, AlertMatch, Logger, MatchableRule } from "./types";

const SCANNER_NAME = "alerts";
const DEFAULT_LEASE_SECONDS = 300;
const DEFAULT_BATCH = 500;

const noopLog: Logger = () => {};

export interface ScanOptions {
  db: Database;
  /** Identifies this runner in the lease (for debugging stuck locks). */
  owner?: string;
  leaseSeconds?: number;
  batchSize?: number;
  now?: Date;
  log?: Logger;
}

export interface ScanResult {
  /** False when another scanner holds the lease. */
  acquired: boolean;
  scanned: number;
  matched: number;
  /** Rows written to alerts_log (already-logged matches are skipped). */
  logged: number;
  instant: number;
  digest: number;
  cursorAdvanced: boolean;
}

/**
 * Try to take the scanner lease. Compare-and-set: the UPDATE only matches
 * when the lease is free or expired, so two concurrent runners can never
 * both proceed.
 */
export async function acquireLease(
  db: Database,
  owner: string,
  leaseSeconds: number,
  now: Date,
): Promise<{ acquired: boolean; cursorCreatedAt: Date | null; cursorId: string | null }> {
  const lockedUntil = new Date(now.getTime() + leaseSeconds * 1000);
  const rows = await db
    .update(scannerState)
    .set({ lockedUntil, lockOwner: owner, updatedAt: now })
    .where(
      and(
        eq(scannerState.name, SCANNER_NAME),
        or(isNull(scannerState.lockedUntil), sql`${scannerState.lockedUntil} < ${now}`),
      ),
    )
    .returning({
      cursorCreatedAt: scannerState.cursorCreatedAt,
      cursorId: scannerState.cursorId,
    });

  const row = rows[0];
  if (!row) return { acquired: false, cursorCreatedAt: null, cursorId: null };
  return { acquired: true, cursorCreatedAt: row.cursorCreatedAt, cursorId: row.cursorId };
}

/** Advance the cursor and release the lease — a separate statement, after dispatch. */
export async function releaseLease(
  db: Database,
  cursor: { createdAt: Date; id: string } | null,
  now: Date,
): Promise<void> {
  await db
    .update(scannerState)
    .set({
      ...(cursor ? { cursorCreatedAt: cursor.createdAt, cursorId: cursor.id } : {}),
      lockedUntil: null,
      lockOwner: null,
      lastRunAt: now,
      updatedAt: now,
    })
    .where(eq(scannerState.name, SCANNER_NAME));
}

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Fetch transactions after the cursor. Rows on superseded filings are
 * excluded — an amendment replaced them, so they are not news.
 */
export async function fetchCandidates(
  db: Database,
  cursor: { createdAt: Date | null; id: string | null },
  limit: number,
): Promise<AlertCandidate[]> {
  const conditions = [or(isNull(transactions.filingId), isNull(filings.supersededByFilingId))!];
  if (cursor.createdAt) {
    conditions.push(
      sql`(${transactions.createdAt}, ${transactions.id}) > (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id ?? ZERO_UUID}::uuid)`,
    );
  }

  const rows = await db
    .select({
      id: transactions.id,
      dedupKey: transactions.dedupKey,
      createdAt: transactions.createdAt,
      txnDate: transactions.txnDate,
      code: transactions.code,
      shares: transactions.shares,
      price: transactions.price,
      value: transactions.value,
      valueUsd: transactions.valueUsd,
      currency: transactions.currency,
      acquiredDisposed: transactions.acquiredDisposed,
      relevance: transactions.relevance,
      source: transactions.source,
      country: transactions.country,
      is10b51: transactions.is10b51,
      companyId: companies.id,
      ticker: companies.ticker,
      companyName: companies.name,
      insiderId: insiders.id,
      insiderName: insiders.name,
      insiderTitle: insiders.officerTitle,
    })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .innerJoin(insiders, eq(transactions.insiderId, insiders.id))
    .leftJoin(filings, eq(transactions.filingId, filings.id))
    .where(and(...conditions))
    .orderBy(asc(transactions.createdAt), asc(transactions.id))
    .limit(limit);

  const num = (v: string | null): number | null => (v === null ? null : Number(v));
  return rows.map((r) => ({
    ...r,
    shares: num(r.shares),
    price: num(r.price),
    value: num(r.value),
    valueUsd: num(r.valueUsd),
  }));
}

/**
 * Filters that cannot be judged from a single row — they need joins,
 * aggregates, or price history. These MUST go through the shared SQL
 * builder so a saved screen alerts exactly as it screens.
 */
const SQL_ONLY_FILTERS = ["cluster", "dip", "near_low", "sector", "role", "exec_only"] as const;

function needsSqlEvaluation(filters: TradeFilterInput | null): boolean {
  if (!filters) return false;
  return SQL_ONLY_FILTERS.some((key) => filters[key] !== undefined && filters[key] !== false);
}

/**
 * Re-evaluate a rule's filters in SQL against a known candidate set, using
 * buildTradeConditions — the SAME builder the screener page and /api/trades
 * use. Returns the subset of ids that genuinely match.
 *
 * Results are cached per distinct filter JSON, so ten users saving the same
 * screen cost one query, not ten.
 */
async function idsMatchingInSql(
  db: Database,
  filters: TradeFilterInput,
  candidateIds: string[],
  cache: Map<string, Set<string>>,
): Promise<Set<string>> {
  const key = JSON.stringify(filters);
  const cached = cache.get(key);
  if (cached) return cached;

  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .innerJoin(insiders, eq(transactions.insiderId, insiders.id))
    .leftJoin(filings, eq(transactions.filingId, filings.id))
    .where(
      and(
        inArray(transactions.id, candidateIds),
        ...buildTradeConditions(db, { ...filters, include_superseded: false }),
      ),
    );

  const ids = new Set(rows.map((r) => r.id));
  cache.set(key, ids);
  return ids;
}

async function loadRules(db: Database): Promise<MatchableRule[]> {
  const rows = await db.select().from(alertRules).where(eq(alertRules.enabled, true));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    enabled: r.enabled,
    filters: (r.filters ?? null) as MatchableRule["filters"],
    trackedTicker: r.trackedTicker,
    trackedInsiderId: r.trackedInsiderId,
    mode: r.mode,
    channels: r.channels,
    quietHoursStart: r.quietHoursStart,
    quietHoursEnd: r.quietHoursEnd,
  }));
}

/**
 * Scan for new matches and record them in alerts_log. Dispatch is a
 * separate step (see dispatchPending) so a delivery outage never blocks
 * the cursor or loses matches.
 */
export async function scanForMatches(options: ScanOptions): Promise<ScanResult> {
  const { db } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? noopLog;
  const owner = options.owner ?? "scanner";

  const lease = await acquireLease(db, owner, options.leaseSeconds ?? DEFAULT_LEASE_SECONDS, now);
  if (!lease.acquired) {
    log("alert_scan_skipped", { reason: "lease_held" });
    return {
      acquired: false,
      scanned: 0,
      matched: 0,
      logged: 0,
      instant: 0,
      digest: 0,
      cursorAdvanced: false,
    };
  }

  const result: ScanResult = {
    acquired: true,
    scanned: 0,
    matched: 0,
    logged: 0,
    instant: 0,
    digest: 0,
    cursorAdvanced: false,
  };
  let newCursor: { createdAt: Date; id: string } | null = null;

  try {
    const candidates = await fetchCandidates(
      db,
      { createdAt: lease.cursorCreatedAt, id: lease.cursorId },
      options.batchSize ?? DEFAULT_BATCH,
    );
    result.scanned = candidates.length;
    if (candidates.length === 0) return result;

    const rules = await loadRules(db);
    const timezones = await loadTimezones(db, rules);

    const candidateIds = candidates.map((c) => c.id);
    const sqlCache = new Map<string, Set<string>>();

    const matches: AlertMatch[] = [];
    for (const rule of rules) {
      // Row-local predicates first (cheap), then the SQL-only ones through
      // the shared builder so screens and alerts can never diverge.
      const shortlist = candidates.filter((candidate) => ruleMatches(rule, candidate));
      if (shortlist.length === 0) continue;

      let allowed: Set<string> | null = null;
      if (needsSqlEvaluation(rule.filters)) {
        allowed = await idsMatchingInSql(db, rule.filters!, candidateIds, sqlCache);
      }

      for (const candidate of shortlist) {
        if (allowed && !allowed.has(candidate.id)) continue;
        const mode = effectiveMode(rule, timezones.get(rule.userId) ?? "UTC", now);
        matches.push({ rule, candidate, mode });
      }
    }
    result.matched = matches.length;

    if (matches.length > 0) {
      // ON CONFLICT DO NOTHING on (rule_id, dedup_key) is the idempotency
      // guarantee — only genuinely new matches come back.
      const inserted = await db
        .insert(alertsLog)
        .values(
          matches.map((m) => ({
            userId: m.rule.userId,
            ruleId: m.rule.id,
            dedupKey: m.candidate.dedupKey,
            transactionId: m.candidate.id,
            mode: m.mode,
          })),
        )
        .onConflictDoNothing({ target: [alertsLog.ruleId, alertsLog.dedupKey] })
        .returning({ id: alertsLog.id, mode: alertsLog.mode });
      result.logged = inserted.length;
      result.instant = inserted.filter((r) => r.mode === "instant").length;
      result.digest = inserted.filter((r) => r.mode === "digest").length;
    }

    const last = candidates[candidates.length - 1]!;
    newCursor = { createdAt: last.createdAt, id: last.id };
    result.cursorAdvanced = true;
    log("alert_scan_complete", { ...result });
    return result;
  } finally {
    // Separate statement from every write above (see the CTE warning).
    await releaseLease(db, newCursor, now);
  }
}

async function loadTimezones(db: Database, rules: MatchableRule[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (rules.length === 0) return map;
  const rows = await db
    .select({ userId: alertChannels.userId, timezone: alertChannels.timezone })
    .from(alertChannels);
  for (const row of rows) {
    if (!map.has(row.userId)) map.set(row.userId, row.timezone);
  }
  return map;
}
