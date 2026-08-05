/**
 * User-scoped queries. Two layers guard every row here, and they fail in
 * different ways on purpose.
 *
 *   1. PRIMARY — every function takes `userId` and puts it in the statement's
 *      WHERE clause. This is what protects data on every request path today.
 *   2. BACKSTOP — every statement also runs inside `withUserContext`, which
 *      sets the transaction-local `app.user_id` that the row-level-security
 *      policies read. The web app connects as `insiderflow_app`, a role with
 *      NOBYPASSRLS, so those policies actually apply.
 *
 * Layer 2 is not redundant with layer 1: it is the layer that catches the day
 * someone forgets layer 1. A predicate-less `select` inside a user context
 * returns that user's rows and nobody else's; the same query without a
 * context returns nothing at all. `pnpm db:bootstrap` proves this against a
 * live database rather than asserting it — see packages/db/scripts/bootstrap.mjs.
 *
 * RULES FOR THIS FILE
 * - Never add a function that reads or writes a user table outside
 *   `withUserContext` or `withCapability`. Under RLS such a function silently
 *   returns zero rows, which reads as "no data" rather than as a bug.
 * - Two functions here have NO user id, and cannot: `completeTelegramLink`
 *   and `unsubscribeByToken`. Both are authorised by a bearer capability — a
 *   192-bit single-use token — arriving with no session. They run under
 *   `withCapability`, where the POLICY compares the token against the row's
 *   own column, so the database itself limits them to the single row whose
 *   token the caller already held.
 */
import {
  alertChannels,
  alertRules,
  alertsLog,
  and,
  desc,
  eq,
  setLocalSetting,
  sql,
  USER_ID_SETTING,
  userWatchlists,
  withCapability,
  withUserContext,
} from "@insiderflow/db";
import type { AlertChannelRow, AlertRule, Database, UserWatchlist } from "@insiderflow/db";

import { randomToken } from "@/lib/auth/tokens";

// ── Watchlists ──────────────────────────────────────────────────────────────

export function listWatchlist(db: Database, userId: string): Promise<UserWatchlist[]> {
  return withUserContext(db, userId, (tx) =>
    tx
      .select()
      .from(userWatchlists)
      .where(eq(userWatchlists.userId, userId))
      .orderBy(desc(userWatchlists.createdAt)),
  );
}

export async function addWatchlistItem(
  db: Database,
  userId: string,
  item: { kind: "company" | "insider"; refId: string; label: string; market: string },
): Promise<void> {
  await withUserContext(db, userId, (tx) =>
    tx
      .insert(userWatchlists)
      .values({ userId, ...item })
      .onConflictDoNothing({
        target: [userWatchlists.userId, userWatchlists.kind, userWatchlists.refId],
      }),
  );
}

export async function removeWatchlistItem(
  db: Database,
  userId: string,
  kind: string,
  refId: string,
): Promise<void> {
  await withUserContext(db, userId, (tx) =>
    tx
      .delete(userWatchlists)
      .where(
        and(
          eq(userWatchlists.userId, userId),
          eq(userWatchlists.kind, kind as "company"),
          eq(userWatchlists.refId, refId),
        ),
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
  const inserted = await withUserContext(db, userId, (tx) =>
    tx
      .insert(userWatchlists)
      .values(items.map((item) => ({ userId, ...item })))
      .onConflictDoNothing({
        target: [userWatchlists.userId, userWatchlists.kind, userWatchlists.refId],
      })
      .returning({ id: userWatchlists.id }),
  );
  return inserted.length;
}

// ── Alert rules ─────────────────────────────────────────────────────────────

export function listAlertRules(db: Database, userId: string): Promise<AlertRule[]> {
  return withUserContext(db, userId, (tx) =>
    tx
      .select()
      .from(alertRules)
      .where(eq(alertRules.userId, userId))
      .orderBy(desc(alertRules.createdAt)),
  );
}

export async function createAlertRule(
  db: Database,
  userId: string,
  rule: {
    name: string;
    filters?: Record<string, unknown> | null;
    trackedTicker?: string | null;
    trackedInsiderId?: string | null;
    kind?: "transaction" | "cluster" | "politician";
    mode?: "instant" | "digest";
    channels?: string[];
    quietHoursStart?: string | null;
    quietHoursEnd?: string | null;
  },
): Promise<AlertRule> {
  const created = await withUserContext(db, userId, (tx) =>
    tx
      .insert(alertRules)
      .values({
        userId,
        name: rule.name,
        filters: rule.filters ?? null,
        trackedTicker: rule.trackedTicker ?? null,
        trackedInsiderId: rule.trackedInsiderId ?? null,
        kind: rule.kind ?? "transaction",
        mode: rule.mode ?? "digest",
        channels: rule.channels ?? ["telegram"],
        quietHoursStart: rule.quietHoursStart ?? null,
        quietHoursEnd: rule.quietHoursEnd ?? null,
      })
      .returning(),
  );
  return created[0]!;
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
  await withUserContext(db, userId, (tx) =>
    tx
      .update(alertRules)
      .set(patch)
      .where(and(eq(alertRules.id, ruleId), eq(alertRules.userId, userId))),
  );
}

export async function deleteAlertRule(db: Database, userId: string, ruleId: string): Promise<void> {
  await withUserContext(db, userId, (tx) =>
    tx.delete(alertRules).where(and(eq(alertRules.id, ruleId), eq(alertRules.userId, userId))),
  );
}

// ── Channels ────────────────────────────────────────────────────────────────

export function listChannels(db: Database, userId: string): Promise<AlertChannelRow[]> {
  return withUserContext(db, userId, (tx) =>
    tx.select().from(alertChannels).where(eq(alertChannels.userId, userId)),
  );
}

/** Issue a fresh one-time token for the Telegram `/start <token>` deep link. */
export async function startTelegramLink(db: Database, userId: string): Promise<string> {
  const token = randomToken(24);
  await withUserContext(db, userId, (tx) =>
    tx
      .insert(alertChannels)
      .values({ userId, channel: "telegram", linkToken: token, verified: false })
      .onConflictDoUpdate({
        target: [alertChannels.userId, alertChannels.channel],
        set: { linkToken: token, verified: false, destination: null },
      }),
  );
  return token;
}

/**
 * Called by the Telegram webhook once the user sends /start <token>.
 *
 * No user id exists at this point — the request comes from Telegram, not from
 * a session. Authorisation is the 192-bit single-use `link_token`, and under
 * `withCapability` the RLS policy checks that token against the row itself,
 * so this statement cannot reach any other user's channel even in principle.
 */
export async function completeTelegramLink(
  db: Database,
  token: string,
  chatId: string,
): Promise<boolean> {
  const updated = await withCapability(db, token, (tx) =>
    tx
      .update(alertChannels)
      .set({ destination: chatId, verified: true, linkToken: null })
      .where(and(eq(alertChannels.channel, "telegram"), eq(alertChannels.linkToken, token)))
      .returning({ id: alertChannels.id }),
  );
  return updated.length > 0;
}

export async function upsertEmailChannel(
  db: Database,
  userId: string,
  email: string,
): Promise<void> {
  await withUserContext(db, userId, (tx) =>
    tx
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
      }),
  );
}

export async function updateChannelPrefs(
  db: Database,
  userId: string,
  channel: "telegram" | "email" | "webpush",
  patch: Partial<{ digestHour: string; timezone: string; verified: boolean }>,
): Promise<void> {
  await withUserContext(db, userId, (tx) =>
    tx
      .update(alertChannels)
      .set(patch)
      .where(and(eq(alertChannels.userId, userId), eq(alertChannels.channel, channel))),
  );
}

/**
 * One-click unsubscribe: disables email delivery without touching Telegram.
 *
 * Two phases in ONE transaction. The capability token identifies the channel
 * row; the user id it yields then opens the user context needed to edit that
 * user's rules. Splitting them would leave a window where the channel is off
 * but the rules still name email.
 */
export async function unsubscribeByToken(db: Database, token: string): Promise<boolean> {
  return withCapability(db, token, async (tx) => {
    const updated = await tx
      .update(alertChannels)
      .set({ verified: false })
      .where(and(eq(alertChannels.channel, "email"), eq(alertChannels.unsubscribeToken, token)))
      .returning({ userId: alertChannels.userId });
    if (updated.length === 0) return false;

    // Also drop email from every rule so nothing tries to re-send.
    const userId = updated[0]!.userId;
    await setLocalSetting(tx, USER_ID_SETTING, userId);
    await tx
      .update(alertRules)
      .set({
        channels: sql`(select coalesce(jsonb_agg(c), '[]'::jsonb)
      from jsonb_array_elements(${alertRules.channels}) c where c <> '"email"'::jsonb)`,
      })
      .where(eq(alertRules.userId, userId));
    return true;
  });
}

// ── Alert history ───────────────────────────────────────────────────────────

export function listRecentAlerts(db: Database, userId: string, limit = 20) {
  return withUserContext(db, userId, (tx) =>
    tx
      .select({
        id: alertsLog.id,
        ruleId: alertsLog.ruleId,
        dedupKey: alertsLog.dedupKey,
        mode: alertsLog.mode,
        status: alertsLog.status,
        deliveredAt: alertsLog.deliveredAt,
        deliveredChannels: alertsLog.deliveredChannels,
        createdAt: alertsLog.createdAt,
      })
      .from(alertsLog)
      .where(eq(alertsLog.userId, userId))
      .orderBy(desc(alertsLog.createdAt))
      .limit(limit),
  );
}
