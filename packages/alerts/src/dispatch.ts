/**
 * Delivery of logged alerts. Split from scanning so a channel outage can
 * never block the scan cursor: matches sit in alerts_log with
 * delivered_at = NULL until a dispatch run picks them up.
 */
import {
  alertChannels,
  alertRules,
  alertsLog,
  and,
  companies,
  eq,
  inArray,
  insiders,
  isNull,
  sql,
  transactions,
} from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import { sendEmail, sendTelegram } from "./channels";
import type { FetchLike } from "./channels";
import { DIGEST_LEASE, withLease } from "./lease";
import { digestEmail, digestTelegram, instantEmail, telegramMessage } from "./format";
import type { DigestGroup } from "./format";
import type { AlertCandidate, DispatchResult, Logger } from "./types";

const noopLog: Logger = () => {};

/**
 * How many times a transient failure is retried before the row is retired.
 *
 * Some failures are neither permanent nor self-healing — a chat id that now
 * 404s, a bot token an operator mistyped, a destination host that never comes
 * back. Without a ceiling those rows are reloaded, re-attempted, and re-failed
 * on every run forever: the dispatch batch fills with corpses, the pending
 * count never falls, and live alerts queue behind dead ones.
 */
export const MAX_DELIVERY_ATTEMPTS = 5;

export interface DispatchConfig {
  db: Database;
  siteUrl: string;
  telegramBotToken?: string;
  resendApiKey?: string;
  resendFrom?: string;
  fetchFn?: FetchLike;
  log?: Logger;
  now?: Date;
}

export interface DispatchStats {
  delivered: number;
  /** Rows that failed this run — includes the ones retired below. */
  failed: number;
  telegramSent: number;
  emailsSent: number;
  /** Pending rows retired because their subject no longer exists. */
  orphaned: number;
  /**
   * Rows retired as undeliverable: the channel rejected them in a repeatable
   * way, or they exhausted MAX_DELIVERY_ATTEMPTS. Counted separately from
   * `failed` so a stuck destination is visible rather than blended into
   * ordinary retry noise.
   */
  failedPermanent: number;
}

const zeroStats = (): DispatchStats => ({
  delivered: 0,
  failed: 0,
  telegramSent: 0,
  emailsSent: 0,
  orphaned: 0,
  failedPermanent: 0,
});

interface PendingRow {
  logId: string;
  userId: string;
  ruleId: string;
  ruleName: string;
  ruleChannels: string[];
  mode: "instant" | "digest";
  attempts: number;
  candidate: AlertCandidate;
}

interface PendingBatch {
  rows: PendingRow[];
  /** log ids whose subject row is gone — terminally undeliverable. */
  orphans: Array<{ logId: string; dedupKey: string; transactionId: string | null }>;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

/** Revive a candidate persisted in alerts_log.payload (JSON has no Date type). */
function candidateFromPayload(payload: Record<string, unknown> | null): AlertCandidate | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<AlertCandidate> & { createdAt?: string | Date };
  if (!p.dedupKey || !p.companyName) return null;
  return {
    ...(p as AlertCandidate),
    createdAt: p.createdAt ? new Date(p.createdAt) : new Date(),
  };
}

/**
 * Pending alerts for one mode, plus the ones that can never be delivered.
 *
 * The subject joins are LEFT joins on purpose. An inner join silently drops
 * alerts whose transaction was deleted (a fixture purge, a hard delete) —
 * they stay pending forever, invisible in every count, retried every run.
 * Surfacing them here is what lets dispatch retire them.
 */
async function loadPending(
  db: Database,
  mode: "instant" | "digest",
  limit: number,
): Promise<PendingBatch> {
  const rows = await db
    .select({
      logId: alertsLog.id,
      userId: alertsLog.userId,
      logKind: alertsLog.kind,
      logDedupKey: alertsLog.dedupKey,
      logTransactionId: alertsLog.transactionId,
      payload: alertsLog.payload,
      attempts: alertsLog.attempts,
      ruleId: alertRules.id,
      ruleName: alertRules.name,
      ruleChannels: alertRules.channels,
      mode: alertsLog.mode,
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
    .from(alertsLog)
    .innerJoin(alertRules, eq(alertsLog.ruleId, alertRules.id))
    .leftJoin(transactions, eq(alertsLog.transactionId, transactions.id))
    .leftJoin(companies, eq(transactions.companyId, companies.id))
    .leftJoin(insiders, eq(transactions.insiderId, insiders.id))
    .where(
      and(eq(alertsLog.status, "pending"), isNull(alertsLog.deliveredAt), eq(alertsLog.mode, mode)),
    )
    .limit(limit);

  const batch: PendingBatch = { rows: [], orphans: [] };

  for (const r of rows) {
    const base = {
      logId: r.logId,
      userId: r.userId,
      ruleId: r.ruleId,
      ruleName: r.ruleName,
      ruleChannels: r.ruleChannels,
      mode: r.mode,
      attempts: r.attempts,
    };

    // Cluster/politician alerts have no transaction — they render from payload.
    if (r.logKind !== "transaction") {
      const candidate = candidateFromPayload(r.payload);
      if (!candidate) {
        batch.orphans.push({
          logId: r.logId,
          dedupKey: r.logDedupKey,
          transactionId: r.logTransactionId,
        });
        continue;
      }
      batch.rows.push({ ...base, candidate: { ...candidate, kind: r.logKind } });
      continue;
    }

    if (r.id === null || r.companyName === null || r.insiderName === null) {
      batch.orphans.push({
        logId: r.logId,
        dedupKey: r.logDedupKey,
        transactionId: r.logTransactionId,
      });
      continue;
    }

    batch.rows.push({
      ...base,
      candidate: {
        id: r.id,
        dedupKey: r.dedupKey!,
        createdAt: r.createdAt!,
        txnDate: r.txnDate!,
        code: r.code!,
        shares: num(r.shares),
        price: num(r.price),
        value: num(r.value),
        valueUsd: num(r.valueUsd),
        currency: r.currency!,
        acquiredDisposed: r.acquiredDisposed,
        relevance: r.relevance!,
        source: r.source!,
        country: r.country!,
        is10b51: r.is10b51!,
        companyId: r.companyId!,
        ticker: r.ticker,
        companyName: r.companyName,
        insiderId: r.insiderId!,
        insiderName: r.insiderName,
        insiderTitle: r.insiderTitle,
        kind: "transaction",
      },
    });
  }

  return batch;
}

/**
 * Retire alerts whose subject is gone. Terminal, and loud: an alert that can
 * never be delivered is an operational fact, not something to swallow.
 */
async function retireOrphans(
  db: Database,
  orphans: PendingBatch["orphans"],
  mode: "instant" | "digest",
  log: Logger,
): Promise<number> {
  if (orphans.length === 0) return 0;
  await db
    .update(alertsLog)
    .set({ status: "orphaned", error: "subject row no longer exists" })
    .where(
      inArray(
        alertsLog.id,
        orphans.map((o) => o.logId),
      ),
    );
  log("alert_orphaned", {
    mode,
    count: orphans.length,
    dedupKeys: orphans.map((o) => o.dedupKey).slice(0, 20),
  });
  return orphans.length;
}

async function loadChannelsFor(db: Database, userIds: string[]) {
  if (userIds.length === 0)
    return new Map<string, Map<string, typeof alertChannels.$inferSelect>>();
  const rows = await db.select().from(alertChannels).where(inArray(alertChannels.userId, userIds));
  const byUser = new Map<string, Map<string, typeof alertChannels.$inferSelect>>();
  for (const row of rows) {
    const inner = byUser.get(row.userId) ?? new Map();
    inner.set(row.channel, row);
    byUser.set(row.userId, inner);
  }
  return byUser;
}

async function markDelivered(
  db: Database,
  logIds: string[],
  channels: string[],
  now: Date,
  error?: string,
): Promise<void> {
  if (logIds.length === 0) return;
  await db
    .update(alertsLog)
    .set({
      status: "delivered",
      deliveredAt: now,
      deliveredChannels: channels,
      error: error ?? null,
    })
    .where(inArray(alertsLog.id, logIds));
}

/**
 * Is this batch of channel results worth trying again?
 *
 * Permanent only when EVERY channel we actually attempted said so. A rule on
 * both Telegram and email whose Telegram send is permanently rejected but
 * whose email hit a 500 still has a live path — retiring it would silently
 * drop a deliverable alert.
 *
 * No attempted channels at all (nothing verified yet) is treated as transient:
 * the user may finish verifying. The attempt cap stops that waiting forever.
 */
function isPermanentFailure(results: DispatchResult[]): boolean {
  const attempted = results.filter((r) => !r.ok);
  return attempted.length > 0 && attempted.every((r) => r.permanent === true);
}

/**
 * Record a failed delivery: bump the attempt counter, and retire the rows that
 * can never succeed instead of leaving them pending for the next run.
 */
async function recordFailure(
  db: Database,
  rows: Array<{ logId: string; attempts: number }>,
  errors: string[],
  permanent: boolean,
  now: Date,
  log: Logger,
  context: Record<string, unknown>,
): Promise<number> {
  if (rows.length === 0) return 0;
  const error = errors.join("; ") || "no verified channel";

  const retire: string[] = [];
  const retry: string[] = [];
  for (const row of rows) {
    (permanent || row.attempts + 1 >= MAX_DELIVERY_ATTEMPTS ? retire : retry).push(row.logId);
  }

  if (retry.length > 0) {
    // Stays `pending` with delivered_at NULL, so the next run picks it up.
    await db
      .update(alertsLog)
      .set({ error, attempts: sql`${alertsLog.attempts} + 1` })
      .where(inArray(alertsLog.id, retry));
  }

  if (retire.length > 0) {
    await db
      .update(alertsLog)
      .set({
        status: "failed_permanent",
        error,
        attempts: sql`${alertsLog.attempts} + 1`,
        deliveredAt: now,
      })
      .where(inArray(alertsLog.id, retire));
    log("alert_delivery_retired", {
      ...context,
      count: retire.length,
      reason: permanent ? "channel_rejected" : "attempts_exhausted",
      error,
    });
  }

  return retire.length;
}

const unsubscribeUrl = (siteUrl: string, token: string | null): string =>
  `${siteUrl}/api/alerts/unsubscribe?token=${encodeURIComponent(token ?? "")}`;

/**
 * Deliver instant alerts. Telegram is the primary channel (free,
 * unlimited); email only goes out when the rule explicitly opted in.
 */
export async function dispatchInstant(config: DispatchConfig, limit = 100): Promise<DispatchStats> {
  const { db } = config;
  const now = config.now ?? new Date();
  const log = config.log ?? noopLog;
  const stats = zeroStats();

  const batch = await loadPending(db, "instant", limit);
  stats.orphaned = await retireOrphans(db, batch.orphans, "instant", log);
  const pending = batch.rows;
  if (pending.length === 0) return stats;

  const byUser = await loadChannelsFor(db, [...new Set(pending.map((p) => p.userId))]);

  for (const row of pending) {
    const channels = byUser.get(row.userId);
    const delivered: string[] = [];
    const errors: string[] = [];
    const results: DispatchResult[] = [];

    const telegram = channels?.get("telegram");
    if (
      row.ruleChannels.includes("telegram") &&
      telegram?.verified &&
      telegram.destination &&
      config.telegramBotToken
    ) {
      const result = await sendTelegram(
        { botToken: config.telegramBotToken, fetchFn: config.fetchFn },
        telegram.destination,
        telegramMessage(row.ruleName, row.candidate),
      );
      results.push(result);
      if (result.ok) {
        delivered.push("telegram");
        stats.telegramSent++;
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    const email = channels?.get("email");
    if (
      row.ruleChannels.includes("email") &&
      email?.verified &&
      email.destination &&
      config.resendApiKey
    ) {
      const url = unsubscribeUrl(config.siteUrl, email.unsubscribeToken);
      const result = await sendEmail(
        {
          apiKey: config.resendApiKey,
          from: config.resendFrom ?? "alerts@insiderflow.dev",
          fetchFn: config.fetchFn,
        },
        email.destination,
        instantEmail(row.ruleName, row.candidate, { siteUrl: config.siteUrl, unsubscribeUrl: url }),
        url,
      );
      results.push(result);
      if (result.ok) {
        delivered.push("email");
        stats.emailsSent++;
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    if (delivered.length > 0) {
      stats.delivered++;
      await markDelivered(db, [row.logId], delivered, now);
    } else {
      stats.failed++;
      stats.failedPermanent += await recordFailure(
        db,
        [{ logId: row.logId, attempts: row.attempts }],
        errors,
        isPermanentFailure(results),
        now,
        log,
        { mode: "instant", dedupKey: row.candidate.dedupKey },
      );
    }
  }

  log("alert_dispatch_instant", { ...stats });
  return stats;
}

/**
 * Daily digest under a lease — safe to run from more than one place.
 *
 * The worker's hourly cron is the primary runner; a GitHub Actions job is the
 * backstop for when the worker was down. Without a lease those two can load
 * the same pending rows and send them both: `alerts_log` idempotency prevents
 * a duplicate ROW, not a duplicate SEND of an already-logged row.
 *
 * Returns `acquired: false` (and zeroed stats) when another runner holds it.
 */
export async function dispatchDigestExclusive(
  config: DispatchConfig & { owner?: string; leaseSeconds?: number },
  limit = 2000,
): Promise<DispatchStats & { acquired: boolean }> {
  const log = config.log ?? noopLog;
  const zero = zeroStats();

  const { acquired, result } = await withLease(
    config.db,
    DIGEST_LEASE,
    {
      owner: config.owner ?? "digest",
      leaseSeconds: config.leaseSeconds ?? 600,
      now: config.now,
    },
    () => dispatchDigest(config, limit),
  );

  if (!acquired) {
    log("alert_digest_skipped", { reason: "lease_held" });
    return { ...zero, acquired: false };
  }
  return { ...(result ?? zero), acquired: true };
}

/**
 * Daily digest: every pending digest alert for a user collapses into ONE
 * Resend send — the free tier's 100/day cap is the binding constraint.
 *
 * Prefer `dispatchDigestExclusive` anywhere more than one runner exists.
 */
export async function dispatchDigest(config: DispatchConfig, limit = 2000): Promise<DispatchStats> {
  const { db } = config;
  const now = config.now ?? new Date();
  const log = config.log ?? noopLog;
  const stats = zeroStats();

  const batch = await loadPending(db, "digest", limit);
  stats.orphaned = await retireOrphans(db, batch.orphans, "digest", log);
  const pending = batch.rows;
  if (pending.length === 0) {
    if (stats.orphaned > 0) log("alert_dispatch_digest", { ...stats, users: 0 });
    return stats;
  }

  const byUser = await loadChannelsFor(db, [...new Set(pending.map((p) => p.userId))]);
  const grouped = new Map<string, PendingRow[]>();
  for (const row of pending) {
    grouped.set(row.userId, [...(grouped.get(row.userId) ?? []), row]);
  }

  for (const [userId, rows] of grouped) {
    const channels = byUser.get(userId);
    const logIds = rows.map((r) => r.logId);
    const delivered: string[] = [];
    const errors: string[] = [];
    const results: DispatchResult[] = [];

    // One group per rule, so the digest reads as "what fired, and why".
    const groups: DigestGroup[] = [];
    for (const row of rows) {
      const existing = groups.find((g) => g.ruleName === row.ruleName);
      if (existing) existing.candidates.push(row.candidate);
      else groups.push({ ruleName: row.ruleName, candidates: [row.candidate] });
    }

    const email = channels?.get("email");
    if (email?.verified && email.destination && config.resendApiKey) {
      const url = unsubscribeUrl(config.siteUrl, email.unsubscribeToken);
      const result = await sendEmail(
        {
          apiKey: config.resendApiKey,
          from: config.resendFrom ?? "alerts@insiderflow.dev",
          fetchFn: config.fetchFn,
        },
        email.destination,
        digestEmail(groups, { siteUrl: config.siteUrl, unsubscribeUrl: url }),
        url,
      );
      results.push(result);
      if (result.ok) {
        delivered.push("email");
        stats.emailsSent++; // one send for the whole digest
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    const telegram = channels?.get("telegram");
    if (
      delivered.length === 0 &&
      telegram?.verified &&
      telegram.destination &&
      config.telegramBotToken
    ) {
      // No email configured — deliver the digest over Telegram instead.
      // digestTelegram escapes every interpolation; building the markup here
      // is exactly how the unescaped version got in.
      const result = await sendTelegram(
        { botToken: config.telegramBotToken, fetchFn: config.fetchFn },
        telegram.destination,
        digestTelegram(groups),
      );
      results.push(result);
      if (result.ok) {
        delivered.push("telegram");
        stats.telegramSent++;
      } else if (result.error) {
        errors.push(result.error);
      }
    }

    if (delivered.length > 0) {
      stats.delivered += rows.length;
      await markDelivered(db, logIds, delivered, now);
    } else {
      stats.failed += rows.length;
      stats.failedPermanent += await recordFailure(
        db,
        rows.map((r) => ({ logId: r.logId, attempts: r.attempts })),
        errors,
        isPermanentFailure(results),
        now,
        log,
        { mode: "digest", userId },
      );
    }
  }

  log("alert_dispatch_digest", { ...stats, users: grouped.size });
  return stats;
}

/** Count of alerts still awaiting delivery — surfaced on the settings page. */
export async function pendingCount(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql`count(*)`.mapWith(Number) })
    .from(alertsLog)
    .where(
      and(
        eq(alertsLog.userId, userId),
        eq(alertsLog.status, "pending"),
        isNull(alertsLog.deliveredAt),
      ),
    );
  return row?.count ?? 0;
}
