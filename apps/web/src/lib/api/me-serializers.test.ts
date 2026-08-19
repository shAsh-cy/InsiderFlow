import { alertRules, getTableColumns, userWatchlists } from "@insiderflow/db";
import type { AlertRule, UserWatchlist } from "@insiderflow/db";
import { describe, expect, it } from "vitest";

import {
  ALERT_RULE_PUBLIC_FIELDS,
  WATCHLIST_PUBLIC_FIELDS,
  serializeAlertRule,
  serializeWatchlistItem,
} from "./me-serializers";

/**
 * THE TWO HANDLERS WITH NO MAPPER WERE THE TWO THAT LEAKED.
 *
 * `e2e/api-envelope.spec.ts` has listed `userId` as forbidden since it was
 * written, and checked it against the PUBLIC endpoints only. Meanwhile
 * `GET /api/me/watchlist` returned `tx.select()` rows verbatim and
 * `GET|POST /api/me/alert-rules` did the same, so both shipped `userId` in
 * every response. Their sibling `/api/me/channels` hand-maps and does not.
 *
 * The assertion below is deliberately made against `getTableColumns` rather
 * than against a fixture row. A test written from an example object proves
 * that TODAY's columns are handled; the failure mode here is a migration
 * adding tomorrow's. Comparing the allowlist to the live schema means a new
 * column fails this test until somebody writes down which side it is on.
 */

const FORBIDDEN_ANYWHERE = [
  "userId",
  "user_id",
  "dedupKey",
  "dedup_key",
  "linkToken",
  "link_token",
  "unsubscribeToken",
  "unsubscribe_token",
  "rawXmlUrl",
  "raw_xml_url",
];

/** Every key present anywhere in a JSON value, at any depth. */
function allKeys(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      into.add(key);
      allKeys(nested, into);
    }
  }
  return into;
}

const watchlistRow: UserWatchlist = {
  id: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  kind: "company",
  refId: "ZZAB",
  label: "ZZ Alpha Industries",
  market: "US",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
};

const alertRuleRow: AlertRule = {
  id: "33333333-3333-4333-8333-333333333333",
  userId: "22222222-2222-4222-8222-222222222222",
  name: "Cluster buys over $1m",
  enabled: true,
  filters: { minValueUsd: 1_000_000 },
  trackedTicker: "ZZAB",
  trackedInsiderId: null,
  kind: "cluster",
  mode: "instant",
  channels: ["telegram"],
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  createdAt: new Date("2026-01-02T03:04:05.000Z"),
};

describe.each([
  {
    table: "user_watchlists",
    columns: () => Object.keys(getTableColumns(userWatchlists)),
    allowed: WATCHLIST_PUBLIC_FIELDS as readonly string[],
    row: watchlistRow as unknown,
    serialize: (row: unknown) => serializeWatchlistItem(row as UserWatchlist) as unknown,
  },
  {
    table: "alert_rules",
    columns: () => Object.keys(getTableColumns(alertRules)),
    allowed: ALERT_RULE_PUBLIC_FIELDS as readonly string[],
    row: alertRuleRow as unknown,
    serialize: (row: unknown) => serializeAlertRule(row as AlertRule) as unknown,
  },
])("$table", ({ columns, allowed, row, serialize }) => {
  it("emits exactly the allowlist, no more and no less", () => {
    expect(Object.keys(serialize(row) as object).sort()).toEqual([...allowed].sort());
  });

  it("carries none of the internal identifiers", () => {
    const keys = allKeys(serialize(row));
    const leaked = FORBIDDEN_ANYWHERE.filter((key) => keys.has(key));
    expect(leaked, `serialized row exposes ${leaked.join(", ")}`).toEqual([]);
  });

  it("has a decision recorded for every column the schema actually has", () => {
    // The point of the whole file. A migration that adds a column lands here
    // before it lands in a response, and the fix is to put the name on one
    // side of the line rather than to widen the test.
    const schemaColumns = columns();
    // Read the schema BEFORE trusting the difference against it. If
    // `getTableColumns` ever returned an empty list — a drizzle upgrade, a
    // changed export — every assertion below would pass while checking
    // nothing, and a vacuous pass is the same failure class as the missing
    // check this file exists to fix.
    expect(schemaColumns.length, "no columns read from the schema").toBeGreaterThan(4);
    expect(schemaColumns, "the partition key must be among them").toContain("userId");

    const undecided = schemaColumns.filter(
      (name) => !allowed.includes(name) && !FORBIDDEN_ANYWHERE.includes(name),
    );
    expect(
      undecided,
      `${undecided.join(", ")} exists in the schema but is neither in the public allowlist ` +
        "nor named as withheld. Decide, in me-serializers.ts, whether it is public.",
    ).toEqual([]);
  });

  it("never lets a column that is not on the allowlist reach the output", () => {
    // The row is widened with a column that does not exist yet, standing in
    // for the next migration. An object spread would carry it through.
    const widened = { ...(row as object), secretFutureColumn: "must not appear" };
    expect(Object.keys(serialize(widened) as object)).not.toContain("secretFutureColumn");
  });
});
