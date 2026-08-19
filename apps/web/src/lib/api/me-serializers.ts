import type { AlertRule, UserWatchlist } from "@insiderflow/db";

/**
 * WHAT `/api/me/*` IS ALLOWED TO PUT ON THE WIRE.
 *
 * `/api/me/channels` already hand-maps its rows and drops `userId`,
 * `linkToken` and `unsubscribeToken`. Its two siblings did not: both
 * `GET /api/me/watchlist` and `GET|POST /api/me/alert-rules` returned whole
 * Drizzle rows straight from `tx.select()` and `.returning()`, so every
 * response carried `userId` — a column the e2e envelope spec has listed as
 * forbidden since it was written, and only ever checked against the PUBLIC
 * endpoints.
 *
 * The leak is small and the shape of it is not: these are the two handlers
 * with no mapper, and they are the two that leaked. A response built by
 * naming fields cannot acquire a new one by accident; a response built by
 * serializing a row acquires whatever the next migration adds. `alert_rules`
 * is one column away from holding something worse than an opaque uuid.
 *
 * So the allowlists below are the contract, and `me-serializers.test.ts`
 * checks them against the SCHEMA rather than against a fixture: add a column
 * to either table and the test fails until someone decides, in writing,
 * whether it is public. A test built from a hand-written example row would
 * have gone on passing.
 */

/** Columns of `user_watchlists` that may be returned to their owner. */
export const WATCHLIST_PUBLIC_FIELDS = [
  "id",
  "kind",
  "refId",
  "label",
  "market",
  "createdAt",
] as const;

/** Columns of `alert_rules` that may be returned to their owner. */
export const ALERT_RULE_PUBLIC_FIELDS = [
  "id",
  "name",
  "enabled",
  "filters",
  "trackedTicker",
  "trackedInsiderId",
  "kind",
  "mode",
  "channels",
  "quietHoursStart",
  "quietHoursEnd",
  "createdAt",
] as const;

/**
 * Columns deliberately withheld, with the reason, so a later reader does not
 * have to reconstruct it from the absence.
 *
 * `userId` is the caller's own id, which is why this is a hygiene failure
 * rather than a cross-user disclosure — but it is the Supabase `sub`, it is
 * the key every user table is partitioned by, and it appears in an
 * unnecessary place on a page a browser extension can read. Nothing in the
 * client needs it: the session already identifies the caller.
 */
export const WITHHELD_REASON: Record<string, string> = {
  userId: "the caller already is the user; the id is the partition key for every user table",
};

export type WatchlistItemDto = Pick<UserWatchlist, (typeof WATCHLIST_PUBLIC_FIELDS)[number]>;
export type AlertRuleDto = Pick<AlertRule, (typeof ALERT_RULE_PUBLIC_FIELDS)[number]>;

export function serializeWatchlistItem(row: UserWatchlist): WatchlistItemDto {
  return {
    id: row.id,
    kind: row.kind,
    refId: row.refId,
    label: row.label,
    market: row.market,
    createdAt: row.createdAt,
  };
}

export function serializeAlertRule(row: AlertRule): AlertRuleDto {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    filters: row.filters,
    trackedTicker: row.trackedTicker,
    trackedInsiderId: row.trackedInsiderId,
    kind: row.kind,
    mode: row.mode,
    channels: row.channels,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    createdAt: row.createdAt,
  };
}
