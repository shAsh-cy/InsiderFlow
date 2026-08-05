/**
 * Alert scanners for the derived feeds (clusters, politician disclosures).
 *
 * These reuse the Phase 7 contract exactly — alerts_log (rule_id, dedup_key)
 * idempotency, quiet hours, freshness, digest batching, the same dispatch
 * path — and differ only in what they scan and how they mint a dedup key.
 * Neither feed has a transaction row to join, so both persist a rendered
 * candidate in alerts_log.payload.
 */
import {
  alertChannels,
  alertRules,
  alertsLog,
  and,
  asc,
  clusterFlags,
  companies,
  eq,
  gte,
  ingestionState,
  politicians,
  politicianTrades,
  sql,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";
import { formatAmountBracket } from "@insiderflow/core";

import { effectiveMode, isWithinQuietHours, localMinutesIn } from "./match";
import { isStaleForInstant } from "./scanner";
import type { AlertCandidate, AlertKind, Logger, MatchableRule } from "./types";

const noopLog: Logger = () => {};
const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const DEFAULT_INSTANT_MAX_AGE_MINUTES = 60;

export interface DerivedScanOptions {
  db: Database;
  now?: Date;
  log?: Logger;
  instantMaxAgeMinutes?: number;
  limit?: number;
}

export interface DerivedScanResult {
  scanned: number;
  matched: number;
  logged: number;
  instant: number;
  digest: number;
}

const emptyResult = (): DerivedScanResult => ({
  scanned: 0,
  matched: 0,
  logged: 0,
  instant: 0,
  digest: 0,
});

/**
 * Cluster alert identity.
 *
 * insider_count is part of the key ON PURPOSE: a cluster growing 2 → 3
 * insiders mints a new key and fires exactly once for that crossing, while a
 * scan that sees the same 3 insiders again reuses the key and is absorbed by
 * the unique index. window_start is the cluster's anchor (see
 * @insiderflow/analytics), so it does not churn day to day.
 */
export function clusterAlertKey(
  companyId: string,
  direction: string,
  windowStart: string,
  insiderCount: number,
): string {
  return `cluster:${companyId}:${direction}:${windowStart}:${insiderCount}`;
}

export function politicianAlertKey(tradeId: string): string {
  return `politician:${tradeId}`;
}

async function loadRulesOfKind(db: Database, kind: AlertKind): Promise<MatchableRule[]> {
  const rows = await db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.enabled, true), eq(alertRules.kind, kind)));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    enabled: r.enabled,
    filters: (r.filters ?? null) as MatchableRule["filters"],
    trackedTicker: r.trackedTicker,
    trackedInsiderId: r.trackedInsiderId,
    kind: r.kind,
    mode: r.mode,
    channels: r.channels,
    quietHoursStart: r.quietHoursStart,
    quietHoursEnd: r.quietHoursEnd,
  }));
}

async function loadTimezones(db: Database): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const rows = await db
    .select({ userId: alertChannels.userId, timezone: alertChannels.timezone })
    .from(alertChannels);
  for (const row of rows) if (!map.has(row.userId)) map.set(row.userId, row.timezone);
  return map;
}

interface PendingInsert {
  userId: string;
  ruleId: string;
  dedupKey: string;
  kind: AlertKind;
  payload: Record<string, unknown>;
  mode: "instant" | "digest";
  deferReason: string | null;
}

async function persist(
  db: Database,
  inserts: PendingInsert[],
  result: DerivedScanResult,
): Promise<void> {
  if (inserts.length === 0) return;
  const written = await db
    .insert(alertsLog)
    .values(
      inserts.map((i) => ({
        userId: i.userId,
        ruleId: i.ruleId,
        dedupKey: i.dedupKey,
        kind: i.kind,
        transactionId: null,
        payload: i.payload,
        mode: i.mode,
        deferReason: i.deferReason,
      })),
    )
    .onConflictDoNothing({ target: [alertsLog.ruleId, alertsLog.dedupKey] })
    .returning({ id: alertsLog.id, mode: alertsLog.mode });
  result.logged = written.length;
  result.instant = written.filter((w) => w.mode === "instant").length;
  result.digest = written.filter((w) => w.mode === "digest").length;
}

/** Quiet hours + freshness, resolved the same way the transaction scanner does. */
function resolveMode(
  rule: MatchableRule,
  timezone: string,
  now: Date,
  eventAt: Date | null,
  maxAgeMinutes: number,
): { mode: "instant" | "digest"; deferReason: string | null } {
  let mode = effectiveMode(rule, timezone, now);
  let deferReason: string | null =
    rule.mode === "instant" &&
    isWithinQuietHours(rule.quietHoursStart, rule.quietHoursEnd, localMinutesIn(timezone, now))
      ? "quiet_hours"
      : null;
  if (
    mode === "instant" &&
    isStaleForInstant({ filedAt: eventAt, createdAt: now }, now, maxAgeMinutes)
  ) {
    mode = "digest";
    deferReason = "stale";
  }
  return { mode, deferReason };
}

// ── Clusters ────────────────────────────────────────────────────────────────

export interface ClusterRuleFilters {
  ticker?: string;
  direction?: "buy" | "sell";
  min_insiders?: number;
  min_total_usd?: number;
  market?: string;
}

/**
 * Scan live cluster flags. Unlike the transaction scanner this is NOT
 * cursor-driven — a cluster is a standing state, not an event, so the
 * dedup key (which encodes the insider count) is what makes it fire once.
 */
export async function scanClusterAlerts(
  options: DerivedScanOptions & { windowDays?: number },
): Promise<DerivedScanResult> {
  const { db } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? noopLog;
  const result = emptyResult();

  const rules = await loadRulesOfKind(db, "cluster");
  if (rules.length === 0) return result;

  // Same cutoff convention as cutoffIso() in @insiderflow/db.
  const windowDays = options.windowDays ?? 14;
  const cutoff = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);

  const flags = await db
    .select({
      companyId: clusterFlags.companyId,
      direction: clusterFlags.direction,
      windowStart: clusterFlags.windowStart,
      windowEnd: clusterFlags.windowEnd,
      insiderCount: clusterFlags.insiderCount,
      tradeCount: clusterFlags.tradeCount,
      totalUsd: clusterFlags.totalUsd,
      ticker: companies.ticker,
      companyName: companies.name,
      country: companies.country,
    })
    .from(clusterFlags)
    .innerJoin(companies, eq(clusterFlags.companyId, companies.id))
    .where(and(gte(clusterFlags.windowStart, cutoff), gte(clusterFlags.insiderCount, 2)))
    .limit(options.limit ?? 500);

  result.scanned = flags.length;
  if (flags.length === 0) return result;

  const timezones = await loadTimezones(db);
  const maxAge = options.instantMaxAgeMinutes ?? DEFAULT_INSTANT_MAX_AGE_MINUTES;
  const inserts: PendingInsert[] = [];

  for (const rule of rules) {
    const f = (rule.filters ?? {}) as ClusterRuleFilters;
    for (const flag of flags) {
      if (rule.trackedTicker && flag.ticker !== rule.trackedTicker.toUpperCase()) continue;
      if (f.ticker && flag.ticker !== f.ticker.toUpperCase()) continue;
      if (f.market && flag.country !== f.market) continue;
      if (f.direction && flag.direction !== f.direction) continue;
      if (f.min_insiders !== undefined && flag.insiderCount < f.min_insiders) continue;
      if (f.min_total_usd !== undefined) {
        // A missing total can never satisfy a minimum — never assume zero.
        if (flag.totalUsd === null || Number(flag.totalUsd) < f.min_total_usd) continue;
      }

      const verb = flag.direction === "buy" ? "bought" : "sold";
      const total =
        flag.totalUsd === null
          ? "an undisclosed total"
          : `$${Math.round(Number(flag.totalUsd)).toLocaleString("en-US")}`;
      const symbol = flag.ticker ?? flag.companyName;
      const headline = `${flag.insiderCount} insiders ${verb} ${symbol} between ${flag.windowStart} and ${flag.windowEnd} — ${flag.tradeCount} trades, ${total}`;

      // The cluster's most recent trade date is its event time for freshness.
      const eventAt = new Date(`${flag.windowEnd}T23:59:59Z`);
      const { mode, deferReason } = resolveMode(
        rule,
        timezones.get(rule.userId) ?? "UTC",
        now,
        eventAt,
        maxAge,
      );

      const candidate: AlertCandidate = {
        id: flag.companyId,
        dedupKey: clusterAlertKey(
          flag.companyId,
          flag.direction,
          flag.windowStart,
          flag.insiderCount,
        ),
        createdAt: now,
        txnDate: flag.windowEnd,
        code: flag.direction === "buy" ? "P" : "S",
        shares: null,
        price: null,
        value: null,
        valueUsd: flag.totalUsd === null ? null : Number(flag.totalUsd),
        currency: "USD",
        acquiredDisposed: flag.direction === "buy" ? "A" : "D",
        relevance: "opportunistic",
        source: "cluster-analytics",
        country: flag.country,
        is10b51: false,
        companyId: flag.companyId,
        ticker: flag.ticker,
        companyName: flag.companyName,
        insiderId: ZERO_UUID,
        insiderName: `${flag.insiderCount} insiders`,
        insiderTitle: null,
        headline,
        kind: "cluster",
      };

      result.matched++;
      inserts.push({
        userId: rule.userId,
        ruleId: rule.id,
        dedupKey: candidate.dedupKey,
        kind: "cluster",
        payload: { ...candidate, createdAt: candidate.createdAt.toISOString() },
        mode,
        deferReason,
      });
    }
  }

  await persist(db, inserts, result);
  if (result.logged > 0) log("cluster_alert_scan", { ...result });
  return result;
}

// ── Politicians ─────────────────────────────────────────────────────────────

export const POLITICIAN_CURSOR_KEY = "politician-alerts:cursor";

export interface PoliticianRuleFilters {
  ticker?: string;
  politician_id?: string;
  chamber?: "house" | "senate";
  party?: string;
  txn_type?: string;
  /** Fires only when the DISCLOSED UPPER bound clears this — ranges, never a point value. */
  min_amount_usd?: number;
}

// Single formatter, shared with the UI and the RSS feed — see
// formatAmountBracket in @insiderflow/core for why there is only one.
const AMOUNT_LABEL = (min: string | null, max: string | null): string =>
  formatAmountBracket(min, max);

/**
 * Cursor-driven scan over newly ingested PTR disclosures. The cursor is
 * (created_at, id) on politician_trades — ingestion time, not transaction
 * date, because a PTR routinely discloses a trade made 45 days ago.
 */
export async function scanPoliticianAlerts(
  options: DerivedScanOptions,
): Promise<DerivedScanResult> {
  const { db } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? noopLog;
  const result = emptyResult();

  const rules = await loadRulesOfKind(db, "politician");
  if (rules.length === 0) return result;

  const [state] = await db
    .select()
    .from(ingestionState)
    .where(eq(ingestionState.key, POLITICIAN_CURSOR_KEY));
  const cursor = (state?.value ?? {}) as { createdAt?: string; id?: string };

  const conds = [];
  if (cursor.createdAt) {
    conds.push(
      sql`(${politicianTrades.createdAt}, ${politicianTrades.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id ?? ZERO_UUID}::uuid)`,
    );
  }

  const rows = await db
    .select({
      id: politicianTrades.id,
      ticker: politicianTrades.ticker,
      assetDescription: politicianTrades.assetDescription,
      txnType: politicianTrades.txnType,
      txnDate: politicianTrades.txnDate,
      disclosedAt: politicianTrades.disclosedAt,
      amountMin: politicianTrades.amountMin,
      amountMax: politicianTrades.amountMax,
      amountRange: politicianTrades.amountRange,
      companyId: politicianTrades.companyId,
      createdAt: politicianTrades.createdAt,
      source: politicianTrades.source,
      politicianId: politicians.id,
      politicianName: politicians.name,
      chamber: politicians.chamber,
      party: politicians.party,
      state: politicians.state,
    })
    .from(politicianTrades)
    .innerJoin(politicians, eq(politicianTrades.politicianId, politicians.id))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(asc(politicianTrades.createdAt), asc(politicianTrades.id))
    .limit(options.limit ?? 500);

  result.scanned = rows.length;
  if (rows.length === 0) return result;

  const timezones = await loadTimezones(db);
  const maxAge = options.instantMaxAgeMinutes ?? DEFAULT_INSTANT_MAX_AGE_MINUTES;
  const inserts: PendingInsert[] = [];

  for (const rule of rules) {
    const f = (rule.filters ?? {}) as PoliticianRuleFilters;
    for (const row of rows) {
      if (rule.trackedTicker && row.ticker !== rule.trackedTicker.toUpperCase()) continue;
      if (f.ticker && row.ticker !== f.ticker.toUpperCase()) continue;
      if (f.politician_id && row.politicianId !== f.politician_id) continue;
      if (f.chamber && row.chamber !== f.chamber) continue;
      if (f.party && row.party !== f.party) continue;
      if (f.txn_type && row.txnType !== f.txn_type) continue;
      if (f.min_amount_usd !== undefined) {
        if (row.amountMax === null || Number(row.amountMax) < f.min_amount_usd) continue;
      }

      const verb = row.txnType === "purchase" ? "bought" : "sold";
      const amount = row.amountRange ?? AMOUNT_LABEL(row.amountMin, row.amountMax);
      const symbol = row.ticker ?? row.assetDescription;
      const headline = `${row.politicianName} (${row.chamber}${row.party ? `-${row.party}` : ""}) ${verb} ${symbol} — ${amount}, disclosed ${row.disclosedAt ?? "date unknown"}`;

      // Freshness runs off the DISCLOSURE, not the trade: a PTR filed today
      // for a 40-day-old trade is genuinely news today.
      //
      // Two clocks, and the OLDER wins:
      //  - the disclosure date, so a first import of two years of history
      //    lands in the digest instead of firing thousands of instant alerts;
      //  - our own row age, so a cursor reset re-presenting old rows does not
      //    either.
      // The disclosure date is a date with no time, so it is taken at end of
      // day — anchoring it to noon would make every same-day disclosure
      // "stale" from 13:00 UTC onward.
      const disclosedEndOfDay = row.disclosedAt
        ? new Date(`${row.disclosedAt}T23:59:59Z`).getTime()
        : Number.POSITIVE_INFINITY;
      const eventAt = new Date(Math.min(disclosedEndOfDay, row.createdAt.getTime()));
      const { mode, deferReason } = resolveMode(
        rule,
        timezones.get(rule.userId) ?? "UTC",
        now,
        eventAt,
        maxAge,
      );

      const candidate: AlertCandidate = {
        id: row.id,
        dedupKey: politicianAlertKey(row.id),
        createdAt: row.createdAt,
        txnDate: row.txnDate,
        code: row.txnType === "purchase" ? "P" : "S",
        shares: null,
        price: null,
        value: null,
        // Deliberately null: the filing discloses a bracket, not a figure.
        valueUsd: null,
        currency: "USD",
        acquiredDisposed: row.txnType === "purchase" ? "A" : "D",
        relevance: "opportunistic",
        source: row.source,
        country: "US",
        is10b51: false,
        companyId: row.companyId ?? ZERO_UUID,
        ticker: row.ticker,
        companyName: row.assetDescription,
        insiderId: row.politicianId,
        insiderName: row.politicianName,
        insiderTitle: `${row.chamber}${row.state ? ` · ${row.state}` : ""}`,
        headline,
        kind: "politician",
      };

      result.matched++;
      inserts.push({
        userId: rule.userId,
        ruleId: rule.id,
        dedupKey: candidate.dedupKey,
        kind: "politician",
        payload: { ...candidate, createdAt: candidate.createdAt.toISOString() },
        mode,
        deferReason,
      });
    }
  }

  await persist(db, inserts, result);

  // Separate statement from the insert above (see the CTE warning in scanner.ts).
  const last = rows[rows.length - 1]!;
  const next = { createdAt: last.createdAt.toISOString(), id: last.id };
  await db
    .insert(ingestionState)
    .values({ key: POLITICIAN_CURSOR_KEY, value: next, updatedAt: now })
    .onConflictDoUpdate({
      target: ingestionState.key,
      set: { value: next, updatedAt: now },
    });

  if (result.logged > 0) log("politician_alert_scan", { ...result });
  return result;
}
