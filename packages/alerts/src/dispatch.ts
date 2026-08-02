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
import { digestEmail, instantEmail, telegramMessage } from "./format";
import type { DigestGroup } from "./format";
import type { AlertCandidate, Logger } from "./types";

const noopLog: Logger = () => {};

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
  failed: number;
  telegramSent: number;
  emailsSent: number;
}

interface PendingRow {
  logId: string;
  userId: string;
  ruleId: string;
  ruleName: string;
  ruleChannels: string[];
  mode: "instant" | "digest";
  candidate: AlertCandidate;
}

const num = (v: string | null): number | null => (v === null ? null : Number(v));

async function loadPending(
  db: Database,
  mode: "instant" | "digest",
  limit: number,
): Promise<PendingRow[]> {
  const rows = await db
    .select({
      logId: alertsLog.id,
      userId: alertsLog.userId,
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
    .innerJoin(transactions, eq(alertsLog.transactionId, transactions.id))
    .innerJoin(companies, eq(transactions.companyId, companies.id))
    .innerJoin(insiders, eq(transactions.insiderId, insiders.id))
    .where(and(isNull(alertsLog.deliveredAt), eq(alertsLog.mode, mode)))
    .limit(limit);

  return rows.map((r) => ({
    logId: r.logId,
    userId: r.userId,
    ruleId: r.ruleId,
    ruleName: r.ruleName,
    ruleChannels: r.ruleChannels,
    mode: r.mode,
    candidate: {
      id: r.id,
      dedupKey: r.dedupKey,
      createdAt: r.createdAt,
      txnDate: r.txnDate,
      code: r.code,
      shares: num(r.shares),
      price: num(r.price),
      value: num(r.value),
      valueUsd: num(r.valueUsd),
      currency: r.currency,
      acquiredDisposed: r.acquiredDisposed,
      relevance: r.relevance,
      source: r.source,
      country: r.country,
      is10b51: r.is10b51,
      companyId: r.companyId,
      ticker: r.ticker,
      companyName: r.companyName,
      insiderId: r.insiderId,
      insiderName: r.insiderName,
      insiderTitle: r.insiderTitle,
    },
  }));
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
    .set({ deliveredAt: now, deliveredChannels: channels, error: error ?? null })
    .where(inArray(alertsLog.id, logIds));
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
  const stats: DispatchStats = { delivered: 0, failed: 0, telegramSent: 0, emailsSent: 0 };

  const pending = await loadPending(db, "instant", limit);
  if (pending.length === 0) return stats;

  const byUser = await loadChannelsFor(db, [...new Set(pending.map((p) => p.userId))]);

  for (const row of pending) {
    const channels = byUser.get(row.userId);
    const delivered: string[] = [];
    const errors: string[] = [];

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
      // Leave delivered_at NULL so the next run retries; record why.
      await db
        .update(alertsLog)
        .set({ error: errors.join("; ") || "no verified channel" })
        .where(eq(alertsLog.id, row.logId));
    }
  }

  log("alert_dispatch_instant", { ...stats });
  return stats;
}

/**
 * Daily digest: every pending digest alert for a user collapses into ONE
 * Resend send — the free tier's 100/day cap is the binding constraint.
 */
export async function dispatchDigest(config: DispatchConfig, limit = 2000): Promise<DispatchStats> {
  const { db } = config;
  const now = config.now ?? new Date();
  const log = config.log ?? noopLog;
  const stats: DispatchStats = { delivered: 0, failed: 0, telegramSent: 0, emailsSent: 0 };

  const pending = await loadPending(db, "digest", limit);
  if (pending.length === 0) return stats;

  const byUser = await loadChannelsFor(db, [...new Set(pending.map((p) => p.userId))]);
  const grouped = new Map<string, PendingRow[]>();
  for (const row of pending) {
    grouped.set(row.userId, [...(grouped.get(row.userId) ?? []), row]);
  }

  for (const [userId, rows] of grouped) {
    const channels = byUser.get(userId);
    const logIds = rows.map((r) => r.logId);
    const delivered: string[] = [];

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
      if (result.ok) {
        delivered.push("email");
        stats.emailsSent++; // one send for the whole digest
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
      const summary = groups
        .map(
          (g) =>
            `<b>${g.ruleName}</b>\n${g.candidates.map((c) => `• ${c.ticker ?? c.companyName} ${c.code}`).join("\n")}`,
        )
        .join("\n\n");
      const result = await sendTelegram(
        { botToken: config.telegramBotToken, fetchFn: config.fetchFn },
        telegram.destination,
        `📰 <b>InsiderFlow digest</b> — ${rows.length} alerts\n\n${summary}\n\n<i>Not investment advice.</i>`,
      );
      if (result.ok) {
        delivered.push("telegram");
        stats.telegramSent++;
      }
    }

    if (delivered.length > 0) {
      stats.delivered += rows.length;
      await markDelivered(db, logIds, delivered, now);
    } else {
      stats.failed += rows.length;
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
    .where(and(eq(alertsLog.userId, userId), isNull(alertsLog.deliveredAt)));
  return row?.count ?? 0;
}
