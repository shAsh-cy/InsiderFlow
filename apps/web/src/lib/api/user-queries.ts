/**
 * User-scoped queries. EVERY function takes userId as its first argument
 * and scopes the statement by it — this is the primary enforcement, since
 * the server connects to Postgres directly as the app role (RLS is defense
 * in depth for anything arriving with an end-user JWT).
 *
 * Never add a function here that reads or writes a user table without a
 * user_id predicate.
 */
import {
  alertChannels,
  alertRules,
  alertsLog,
  and,
  desc,
  eq,
  sql,
  userWatchlists,
} from "@insiderflow/db";
import type { AlertChannelRow, AlertRule, Database, UserWatchlist } from "@insiderflow/db";

import { randomToken } from "@/lib/auth/tokens";

// ── Watchlists ──────────────────────────────────────────────────────────────

export function listWatchlist(db: Database, userId: string): Promise<UserWatchlist[]> {
  return db
    .select()
    .from(userWatchlists)
    .where(eq(userWatchlists.userId, userId))
    .orderBy(desc(userWatchlists.createdAt));
}

export async function addWatchlistItem(
  db: Database,
  userId: string,
  item: { kind: "company" | "insider"; refId: string; label: string; market: string },
): Promise<void> {
  await db
    .insert(userWatchlists)
    .values({ userId, ...item })
    .onConflictDoNothing({
      target: [userWatchlists.userId, userWatchlists.kind, userWatchlists.refId],
    });
}

export async function removeWatchlistItem(
  db: Database,
  userId: string,
  kind: string,
  refId: string,
): Promise<void> {
  await db
    .delete(userWatchlists)
    .where(
      and(
        eq(userWatchlists.userId, userId),
        eq(userWatchlists.kind, kind as "company"),
        eq(userWatchlists.refId, refId),
      ),
    );
}

/** Bulk import (localStorage → account on first login). Existing rows are kept. */
export async function importWatchlistItems(
  db: Database,
  userId: string,
  items: Array<{ kind: "company" | "insider"; refId: string; label: string; market: string }>,
): Promise<number> {
  if (items.length === 0) return 0;
  const inserted = await db
    .insert(userWatchlists)
    .values(items.map((item) => ({ userId, ...item })))
    .onConflictDoNothing({
      target: [userWatchlists.userId, userWatchlists.kind, userWatchlists.refId],
    })
    .returning({ id: userWatchlists.id });
  return inserted.length;
}

// ── Alert rules ─────────────────────────────────────────────────────────────

export function listAlertRules(db: Database, userId: string): Promise<AlertRule[]> {
  return db
    .select()
    .from(alertRules)
    .where(eq(alertRules.userId, userId))
    .orderBy(desc(alertRules.createdAt));
}

export async function createAlertRule(
  db: Database,
  userId: string,
  rule: {
    name: string;
    filters?: Record<string, unknown> | null;
    trackedTicker?: string | null;
    trackedInsiderId?: string | null;
    mode?: "instant" | "digest";
    channels?: string[];
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
  },
): Promise<AlertRule> {
  const [created] = await db
    .insert(alertRules)
    .values({
      userId,
      name: rule.name,
      filters: rule.filters ?? null,
      trackedTicker: rule.trackedTicker ?? null,
      trackedInsiderId: rule.trackedInsiderId ?? null,
      mode: rule.mode ?? "digest",
      channels: rule.channels ?? ["telegram"],
      quietHoursStart: rule.quietHoursStart ?? null,
      quietHoursEnd: rule.quietHoursEnd ?? null,
    })
    .returning();
  return created!;
}

export async function updateAlertRule(
  db: Database,
  userId: string,
  ruleId: string,
  patch: Partial<{
    name: string;
    enabled: boolean;
    mode: "instant" | "digest";
    channels: string[];
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  }>,
): Promise<void> {
  await db
    .update(alertRules)
    .set(patch)
    .where(and(eq(alertRules.id, ruleId), eq(alertRules.userId, userId)));
}

export async function deleteAlertRule(db: Database, userId: string, ruleId: string): Promise<void> {
  await db.delete(alertRules).where(and(eq(alertRules.id, ruleId), eq(alertRules.userId, userId)));
}

// ── Channels ────────────────────────────────────────────────────────────────

export function listChannels(db: Database, userId: string): Promise<AlertChannelRow[]> {
  return db.select().from(alertChannels).where(eq(alertChannels.userId, userId));
}

/** Issue a fresh one-time token for the Telegram `/start <token>` deep link. */
export async function startTelegramLink(db: Database, userId: string): Promise<string> {
  const token = randomToken(24);
  await db
    .insert(alertChannels)
    .values({ userId, channel: "telegram", linkToken: token, verified: false })
    .onConflictDoUpdate({
      target: [alertChannels.userId, alertChannels.channel],
      set: { linkToken: token, verified: false, destination: null },
    });
  return token;
}

/** Called by the Telegram webhook once the user sends /start <token>. */
export async function completeTelegramLink(
  db: Database,
  token: string,
  chatId: string,
): Promise<boolean> {
  const updated = await db
    .update(alertChannels)
    .set({ destination: chatId, verified: true, linkToken: null })
    .where(and(eq(alertChannels.channel, "telegram"), eq(alertChannels.linkToken, token)))
    .returning({ id: alertChannels.id });
  return updated.length > 0;
}

export async function upsertEmailChannel(
  db: Database,
  userId: string,
  email: string,
): Promise<void> {
  await db
    .insert(alertChannels)
    .values({
      userId,
      channel: "email",
      destination: email,
      // The address came from a verified Supabase Auth session.
      verified: true,
      unsubscribeToken: randomToken(24),
    })
    .onConflictDoUpdate({
      target: [alertChannels.userId, alertChannels.channel],
      set: { destination: email, verified: true },
    });
}

export async function updateChannelPrefs(
  db: Database,
  userId: string,
  channel: "telegram" | "email" | "webpush",
  patch: Partial<{ digestHour: string; timezone: string; verified: boolean }>,
): Promise<void> {
  await db
    .update(alertChannels)
    .set(patch)
    .where(and(eq(alertChannels.userId, userId), eq(alertChannels.channel, channel)));
}

/** One-click unsubscribe: disables email delivery without touching Telegram. */
export async function unsubscribeByToken(db: Database, token: string): Promise<boolean> {
  const updated = await db
    .update(alertChannels)
    .set({ verified: false })
    .where(and(eq(alertChannels.channel, "email"), eq(alertChannels.unsubscribeToken, token)))
    .returning({ userId: alertChannels.userId });
  if (updated.length === 0) return false;

  // Also drop email from every rule so nothing tries to re-send.
  const userId = updated[0]!.userId;
  await db
    .update(alertRules)
    .set({
      channels: sql`(select coalesce(jsonb_agg(c), '[]'::jsonb)
      from jsonb_array_elements(${alertRules.channels}) c where c <> '"email"'::jsonb)`,
    })
    .where(eq(alertRules.userId, userId));
  return true;
}

// ── Alert history ───────────────────────────────────────────────────────────

export function listRecentAlerts(db: Database, userId: string, limit = 20) {
  return db
    .select({
      id: alertsLog.id,
      ruleId: alertsLog.ruleId,
      dedupKey: alertsLog.dedupKey,
      mode: alertsLog.mode,
      deliveredAt: alertsLog.deliveredAt,
      deliveredChannels: alertsLog.deliveredChannels,
      createdAt: alertsLog.createdAt,
    })
    .from(alertsLog)
    .where(eq(alertsLog.userId, userId))
    .orderBy(desc(alertsLog.createdAt))
    .limit(limit);
}
