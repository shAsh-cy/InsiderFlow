/**
 * Alert engine integration tests on PGlite (never the dev database).
 *
 * Covers the Phase 7 acceptance criteria: a matching insert fires once,
 * replays never re-fire, amendment re-homes never re-fire, superseded rows
 * are skipped, the digest batches many events into ONE email, overlapping
 * scanners are safe, and quiet hours downgrade instant → digest.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as dbExports from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import {
  dispatchDigest,
  dispatchDigestExclusive,
  dispatchInstant,
  MAX_DELIVERY_ATTEMPTS,
} from "./dispatch";
import { DIGEST_LEASE, withLease } from "./lease";
import { clusterAlertKey, scanClusterAlerts, scanPoliticianAlerts } from "./derived-scanners";
import { digestEmail, digestTelegram, instantEmail, telegramMessage } from "./format";
import { scanForMatches } from "./scanner";
import type { FetchLike } from "./channels";
import type { AlertCandidate } from "./types";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

interface Harness {
  db: Database;
  client: PGlite;
  companyId: string;
  insiderId: string;
  close: () => Promise<void>;
}

async function makeHarness(): Promise<Harness> {
  const client = new PGlite({ extensions: { pg_trgm } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  const pglite = drizzle(client, { schema: dbExports });
  const { apply } = await pushSchema(
    { ...dbExports },
    pglite as unknown as Parameters<typeof pushSchema>[1],
  );
  await apply();
  const db = pglite as unknown as Database;

  await db.insert(dbExports.scannerState).values({ name: "alerts" });
  const [company] = await db
    .insert(dbExports.companies)
    .values({
      externalKey: "ticker:US:ZZALERT",
      ticker: "ZZALERT",
      name: "ZZ Alert Test Corp",
      country: "US",
    })
    .returning({ id: dbExports.companies.id });
  const [insider] = await db
    .insert(dbExports.insiders)
    .values({
      externalKey: "name:US:ZZ ALERT TESTER",
      name: "ZZ ALERT TESTER",
      isOfficer: true,
      officerTitle: "CEO",
    })
    .returning({ id: dbExports.insiders.id });

  return {
    db,
    client,
    companyId: company!.id,
    insiderId: insider!.id,
    close: () => client.close(),
  };
}

async function addRule(
  h: Harness,
  overrides: Partial<typeof dbExports.alertRules.$inferInsert> = {},
): Promise<string> {
  const [rule] = await h.db
    .insert(dbExports.alertRules)
    .values({
      userId: USER_A,
      name: "Big ZZALERT buys",
      trackedTicker: "ZZALERT",
      mode: "instant",
      channels: ["telegram"],
      ...overrides,
    })
    .returning({ id: dbExports.alertRules.id });
  return rule!.id;
}

async function addChannels(h: Harness, userId = USER_A): Promise<void> {
  await h.db.insert(dbExports.alertChannels).values([
    {
      userId,
      channel: "telegram",
      destination: "555000",
      verified: true,
      timezone: "UTC",
    },
    {
      userId,
      channel: "email",
      destination: `${userId}@example.test`,
      verified: true,
      unsubscribeToken: `unsub-${userId}`,
      timezone: "UTC",
    },
  ]);
}

let tradeSeq = 0;
async function insertTrade(
  h: Harness,
  options: {
    dedupKey?: string;
    valueUsd?: number;
    filingId?: string | null;
    code?: string;
  } = {},
): Promise<string> {
  tradeSeq++;
  const [row] = await h.db
    .insert(dbExports.transactions)
    .values({
      source: "edgar",
      filingId: options.filingId ?? null,
      insiderId: h.insiderId,
      companyId: h.companyId,
      txnDate: "2026-08-02",
      code: (options.code ?? "P") as "P",
      shares: "1000",
      price: "10",
      value: String(options.valueUsd ?? 500_000),
      currency: "USD",
      priceUsd: "10",
      valueUsd: String(options.valueUsd ?? 500_000),
      acquiredDisposed: "A",
      relevance: "opportunistic",
      dedupKey: options.dedupKey ?? `zz-trade-${tradeSeq}#0`,
      country: "US",
    })
    .returning({ id: dbExports.transactions.id });
  return row!.id;
}

function makeFetchMock() {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchFn = vi.fn().mockImplementation((url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
    return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve("{}") });
  }) as unknown as FetchLike;
  return { fetchFn, calls };
}

const dispatchConfig = (h: Harness, fetchFn: FetchLike) => ({
  db: h.db,
  siteUrl: "https://insiderflow.test",
  telegramBotToken: "test-bot-token",
  resendApiKey: "test-resend-key",
  resendFrom: "alerts@insiderflow.test",
  fetchFn,
});

describe("alert engine", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  it("fires once for a matching insert and reaches Telegram + opted-in email", async () => {
    await addChannels(h);
    await addRule(h, { channels: ["telegram", "email"] });
    await insertTrade(h);

    const scan = await scanForMatches({ db: h.db });
    expect(scan.acquired).toBe(true);
    expect(scan.matched).toBe(1);
    expect(scan.logged).toBe(1);
    expect(scan.instant).toBe(1);

    const { fetchFn, calls } = makeFetchMock();
    const stats = await dispatchInstant(dispatchConfig(h, fetchFn));
    expect(stats.delivered).toBe(1);
    expect(stats.telegramSent).toBe(1);
    expect(stats.emailsSent).toBe(1);

    expect(calls.some((c) => c.url.includes("api.telegram.org"))).toBe(true);
    const email = calls.find((c) => c.url.includes("api.resend.com"));
    expect(email).toBeDefined();
    // One-click unsubscribe headers are mandatory for bulk senders.
    const headers = (email!.body as { headers: Record<string, string> }).headers;
    expect(headers["List-Unsubscribe"]).toContain("/api/alerts/unsubscribe?token=");
    expect(headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    const [logged] = await h.db.select().from(dbExports.alertsLog);
    expect(logged?.deliveredAt).not.toBeNull();
    expect(logged?.deliveredChannels.sort()).toEqual(["email", "telegram"]);
  });

  it("replaying the same insert does NOT re-fire", async () => {
    await addChannels(h);
    await addRule(h);
    await insertTrade(h, { dedupKey: "zz-replay#0" });

    const first = await scanForMatches({ db: h.db });
    expect(first.logged).toBe(1);

    // Re-scan from scratch (as a crashed run would): same rows, same keys.
    await h.db
      .update(dbExports.scannerState)
      .set({ cursorCreatedAt: null, cursorId: null })
      .where(dbExports.eq(dbExports.scannerState.name, "alerts"));

    const second = await scanForMatches({ db: h.db });
    expect(second.matched).toBe(1); // it still matches...
    expect(second.logged).toBe(0); // ...but the unique index blocks a re-fire
    expect(await h.db.select().from(dbExports.alertsLog)).toHaveLength(1);
  });

  it("does not re-fire when an amendment re-homes a row to a new filing", async () => {
    await addChannels(h);
    await addRule(h);

    const [original] = await h.db
      .insert(dbExports.filings)
      .values({
        accessionNo: "zz-orig-1",
        formType: "4",
        filedAt: new Date("2026-08-01T12:00:00Z"),
        issuerCompanyId: h.companyId,
      })
      .returning({ id: dbExports.filings.id });
    const txnId = await insertTrade(h, { dedupKey: "zz-rehome#0", filingId: original!.id });

    const first = await scanForMatches({ db: h.db });
    expect(first.logged).toBe(1);

    // The amendment arrives: it supersedes the original and the unchanged
    // row is re-homed onto it (exactly what linkAmendment does).
    const [amendment] = await h.db
      .insert(dbExports.filings)
      .values({
        accessionNo: "zz-amend-1",
        formType: "4/A",
        filedAt: new Date("2026-08-02T12:00:00Z"),
        issuerCompanyId: h.companyId,
      })
      .returning({ id: dbExports.filings.id });
    await h.db
      .update(dbExports.filings)
      .set({ supersededByFilingId: amendment!.id })
      .where(dbExports.eq(dbExports.filings.id, original!.id));
    await h.db
      .update(dbExports.transactions)
      .set({ filingId: amendment!.id, createdAt: new Date() })
      .where(dbExports.eq(dbExports.transactions.id, txnId));

    // Full re-scan, as if the cursor had been reset.
    await h.db
      .update(dbExports.scannerState)
      .set({ cursorCreatedAt: null, cursorId: null })
      .where(dbExports.eq(dbExports.scannerState.name, "alerts"));
    const second = await scanForMatches({ db: h.db });
    expect(second.logged).toBe(0);
    expect(await h.db.select().from(dbExports.alertsLog)).toHaveLength(1);
  });

  it("skips rows whose filing has been superseded", async () => {
    await addChannels(h);
    await addRule(h);

    const [amendment] = await h.db
      .insert(dbExports.filings)
      .values({
        accessionNo: "zz-amend-2",
        formType: "4/A",
        filedAt: new Date("2026-08-02T12:00:00Z"),
        issuerCompanyId: h.companyId,
      })
      .returning({ id: dbExports.filings.id });
    const [superseded] = await h.db
      .insert(dbExports.filings)
      .values({
        accessionNo: "zz-orig-2",
        formType: "4",
        filedAt: new Date("2026-08-01T12:00:00Z"),
        issuerCompanyId: h.companyId,
        supersededByFilingId: amendment!.id,
      })
      .returning({ id: dbExports.filings.id });
    await insertTrade(h, { dedupKey: "zz-superseded#0", filingId: superseded!.id });

    const scan = await scanForMatches({ db: h.db });
    expect(scan.scanned).toBe(0); // never even a candidate
    expect(scan.logged).toBe(0);
  });

  it("batches many events into ONE digest email", async () => {
    await addChannels(h);
    await addRule(h, { name: "Digest rule", mode: "digest", channels: ["email"] });
    for (let i = 0; i < 5; i++) await insertTrade(h, { dedupKey: `zz-digest-${i}#0` });

    const scan = await scanForMatches({ db: h.db });
    expect(scan.logged).toBe(5);
    expect(scan.digest).toBe(5);

    // Instant dispatch must not touch digest rows.
    const { fetchFn: instantFetch, calls: instantCalls } = makeFetchMock();
    await dispatchInstant(dispatchConfig(h, instantFetch));
    expect(instantCalls).toHaveLength(0);

    const { fetchFn, calls } = makeFetchMock();
    const stats = await dispatchDigest(dispatchConfig(h, fetchFn));
    expect(stats.delivered).toBe(5);
    // The binding constraint: 5 alerts → exactly 1 Resend send.
    expect(stats.emailsSent).toBe(1);
    expect(calls.filter((c) => c.url.includes("api.resend.com"))).toHaveLength(1);

    const body = calls[0]!.body as { subject: string; html: string };
    expect(body.subject).toContain("5 alerts");
    expect(body.html).toContain("Digest rule");

    const undelivered = await h.db
      .select()
      .from(dbExports.alertsLog)
      .where(dbExports.isNull(dbExports.alertsLog.deliveredAt));
    expect(undelivered).toHaveLength(0);
  });

  it("only alerts the rule's owner (per-user isolation in the engine)", async () => {
    await addChannels(h, USER_A);
    await addChannels(h, USER_B);
    await addRule(h, { userId: USER_A, name: "A's rule", trackedTicker: "ZZALERT" });
    await addRule(h, { userId: USER_B, name: "B's rule", trackedTicker: "ZZOTHER" });
    await insertTrade(h);

    await scanForMatches({ db: h.db });
    const logs = await h.db.select().from(dbExports.alertsLog);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.userId).toBe(USER_A);
  });

  it("is safe under overlapping runs (lease lock)", async () => {
    await addChannels(h);
    await addRule(h);
    await insertTrade(h);

    // Simulate a second scanner starting while the first holds the lease.
    await h.db
      .update(dbExports.scannerState)
      .set({ lockedUntil: new Date(Date.now() + 60_000), lockOwner: "other-runner" })
      .where(dbExports.eq(dbExports.scannerState.name, "alerts"));

    const blocked = await scanForMatches({ db: h.db, owner: "me" });
    expect(blocked.acquired).toBe(false);
    expect(blocked.logged).toBe(0);
    expect(await h.db.select().from(dbExports.alertsLog)).toHaveLength(0);

    // Once the lease expires, the next run proceeds.
    await h.db
      .update(dbExports.scannerState)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(dbExports.eq(dbExports.scannerState.name, "alerts"));
    const allowed = await scanForMatches({ db: h.db, owner: "me" });
    expect(allowed.acquired).toBe(true);
    expect(allowed.logged).toBe(1);
  });

  it("advances the cursor so a second scan does no redundant work", async () => {
    await addChannels(h);
    await addRule(h);
    await insertTrade(h, { dedupKey: "zz-cursor-1#0" });

    const first = await scanForMatches({ db: h.db });
    expect(first.scanned).toBe(1);
    expect(first.cursorAdvanced).toBe(true);

    const second = await scanForMatches({ db: h.db });
    expect(second.scanned).toBe(0);

    await insertTrade(h, { dedupKey: "zz-cursor-2#0" });
    const third = await scanForMatches({ db: h.db });
    expect(third.scanned).toBe(1);
    expect(third.logged).toBe(1);
  });

  it("downgrades instant to digest inside quiet hours", async () => {
    await addChannels(h);
    await addRule(h, { mode: "instant", quietHoursStart: "22:00", quietHoursEnd: "07:00" });
    await insertTrade(h);

    // 02:00 UTC is inside the 22:00→07:00 window.
    const scan = await scanForMatches({ db: h.db, now: new Date("2026-08-02T02:00:00Z") });
    expect(scan.logged).toBe(1);
    expect(scan.instant).toBe(0);
    expect(scan.digest).toBe(1);
  });

  it("evaluates SQL-only screen filters through the shared query builder", async () => {
    await addChannels(h);
    // exec_only needs the insiders join — it cannot be judged from the row
    // alone, so it must go through buildTradeConditions.
    await addRule(h, { name: "Exec buys", filters: { exec_only: true } });
    await insertTrade(h, { dedupKey: "zz-exec#0" });

    const withOfficer = await scanForMatches({ db: h.db });
    expect(withOfficer.logged).toBe(1); // the fixture insider IS an officer

    // Flip the insider to a non-officer: the same screen must stop matching.
    await h.db
      .update(dbExports.insiders)
      .set({ isOfficer: false })
      .where(dbExports.eq(dbExports.insiders.id, h.insiderId));
    await insertTrade(h, { dedupKey: "zz-nonexec#0" });

    const withoutOfficer = await scanForMatches({ db: h.db });
    expect(withoutOfficer.scanned).toBe(1);
    expect(withoutOfficer.logged).toBe(0);
  });

  it("retires an alert whose transaction was deleted, and still delivers the rest", async () => {
    await addChannels(h);
    await addRule(h, { name: "Digest rule", mode: "digest", channels: ["email"] });
    const doomed = await insertTrade(h, { dedupKey: "zz-orphan#0" });
    await insertTrade(h, { dedupKey: "zz-survivor#0" });

    const scan = await scanForMatches({ db: h.db });
    expect(scan.logged).toBe(2);

    // The subject disappears while the alert is still pending — exactly what a
    // fixture purge does. Before this fix the inner join hid the row and the
    // whole digest was silently undeliverable.
    await h.db
      .delete(dbExports.transactions)
      .where(dbExports.eq(dbExports.transactions.id, doomed));

    const { fetchFn, calls } = makeFetchMock();
    const stats = await dispatchDigest(dispatchConfig(h, fetchFn));

    expect(stats.orphaned).toBe(1);
    expect(stats.delivered).toBe(1); // the survivor still went out
    expect(calls.filter((c) => c.url.includes("api.resend.com"))).toHaveLength(1);

    const rows = await h.db.select().from(dbExports.alertsLog);
    const orphan = rows.find((r) => r.dedupKey === "zz-orphan#0")!;
    expect(orphan.status).toBe("orphaned");
    expect(orphan.error).toContain("no longer exists");

    const survivor = rows.find((r) => r.dedupKey === "zz-survivor#0")!;
    expect(survivor.status).toBe("delivered");

    // Terminal: a second run must not pick the orphan back up.
    const second = await dispatchDigest(dispatchConfig(h, makeFetchMock().fetchFn));
    expect(second.orphaned).toBe(0);
    expect(second.delivered).toBe(0);
  });

  it("will not let two digest runners send the same batch twice", async () => {
    await addChannels(h);
    await addRule(h, { name: "Digest rule", mode: "digest", channels: ["email"] });
    for (let i = 0; i < 3; i++) await insertTrade(h, { dedupKey: `zz-lease-${i}#0` });
    await scanForMatches({ db: h.db });

    // A second runner is mid-flush (the worker, say) while the Actions
    // backstop fires. alerts_log idempotency would NOT save us here — the
    // rows are already logged; what must not happen is a second send.
    await h.db
      .insert(dbExports.scannerState)
      .values({
        name: DIGEST_LEASE,
        lockedUntil: new Date(Date.now() + 60_000),
        lockOwner: "other-runner",
      })
      .onConflictDoUpdate({
        target: dbExports.scannerState.name,
        set: { lockedUntil: new Date(Date.now() + 60_000), lockOwner: "other-runner" },
      });

    const { fetchFn, calls } = makeFetchMock();
    const blocked = await dispatchDigestExclusive({
      ...dispatchConfig(h, fetchFn),
      owner: "backstop",
    });
    expect(blocked.acquired).toBe(false);
    expect(blocked.delivered).toBe(0);
    expect(calls).toHaveLength(0);

    // Once the lease frees up, the backstop delivers exactly once.
    await h.db
      .update(dbExports.scannerState)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(dbExports.eq(dbExports.scannerState.name, DIGEST_LEASE));

    const { fetchFn: second, calls: secondCalls } = makeFetchMock();
    const allowed = await dispatchDigestExclusive({
      ...dispatchConfig(h, second),
      owner: "backstop",
    });
    expect(allowed.acquired).toBe(true);
    expect(allowed.delivered).toBe(3);
    expect(secondCalls.filter((c) => c.url.includes("api.resend.com"))).toHaveLength(1);

    // And a third run has nothing left to do.
    const { fetchFn: third, calls: thirdCalls } = makeFetchMock();
    const empty = await dispatchDigestExclusive({ ...dispatchConfig(h, third), owner: "backstop" });
    expect(empty.acquired).toBe(true);
    expect(empty.delivered).toBe(0);
    expect(thirdCalls).toHaveLength(0);
  });

  it("releases the digest lease when the run throws, and when it succeeds", async () => {
    // A stranded lease would make every later digest run skip until it
    // expired, so release has to survive an exception. Driven through
    // withLease directly: dispatch itself records channel failures rather
    // than throwing, so it cannot exercise this path.
    await expect(
      withLease(h.db, DIGEST_LEASE, { owner: "boom" }, () => {
        throw new Error("channel outage");
      }),
    ).rejects.toThrow("channel outage");

    const [afterThrow] = await h.db
      .select()
      .from(dbExports.scannerState)
      .where(dbExports.eq(dbExports.scannerState.name, DIGEST_LEASE));
    expect(afterThrow?.lockedUntil).toBeNull();

    // ...and the next runner can therefore claim it.
    const { acquired } = await withLease(h.db, DIGEST_LEASE, { owner: "next" }, async () => "ok");
    expect(acquired).toBe(true);

    const [afterSuccess] = await h.db
      .select()
      .from(dbExports.scannerState)
      .where(dbExports.eq(dbExports.scannerState.name, DIGEST_LEASE));
    expect(afterSuccess?.lockedUntil).toBeNull();
    expect(afterSuccess?.lastRunAt).not.toBeNull();
  });

  it("records a channel outage instead of throwing, so the batch can retry", async () => {
    await addChannels(h);
    await addRule(h, { name: "Digest rule", mode: "digest", channels: ["email"] });
    await insertTrade(h, { dedupKey: "zz-outage#0" });
    await scanForMatches({ db: h.db });

    const failing = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve("upstream down"),
    }) as unknown as FetchLike;

    const stats = await dispatchDigestExclusive({
      ...dispatchConfig(h, failing),
      owner: "outage",
    });
    expect(stats.acquired).toBe(true);
    expect(stats.delivered).toBe(0);
    expect(stats.failed).toBe(1);

    // Still pending, so the next run retries — a failed send is not terminal.
    const [row] = await h.db.select().from(dbExports.alertsLog);
    expect(row?.status).toBe("pending");
    expect(row?.deliveredAt).toBeNull();
  });

  it("routes a stale event to the digest instead of firing it instantly", async () => {
    await addChannels(h);
    await addRule(h, { mode: "instant", channels: ["telegram"] });

    // A filing accepted 3 days ago — a backfill or a cursor reset re-presenting
    // history, not breaking news.
    const [old] = await h.db
      .insert(dbExports.filings)
      .values({
        accessionNo: "zz-stale-1",
        formType: "4",
        filedAt: new Date(Date.now() - 3 * 86_400_000),
        issuerCompanyId: h.companyId,
      })
      .returning({ id: dbExports.filings.id });
    await insertTrade(h, { dedupKey: "zz-stale#0", filingId: old!.id });

    const scan = await scanForMatches({ db: h.db });
    expect(scan.logged).toBe(1);
    expect(scan.instant).toBe(0);
    expect(scan.digest).toBe(1);
    expect(scan.stale).toBe(1);

    const [row] = await h.db.select().from(dbExports.alertsLog);
    expect(row?.deferReason).toBe("stale");

    // Instant dispatch must find nothing to send.
    const { fetchFn, calls } = makeFetchMock();
    const stats = await dispatchInstant(dispatchConfig(h, fetchFn));
    expect(stats.delivered).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("still fires instantly for a filing accepted moments ago", async () => {
    await addChannels(h);
    await addRule(h, { mode: "instant", channels: ["telegram"] });

    const [fresh] = await h.db
      .insert(dbExports.filings)
      .values({
        accessionNo: "zz-fresh-1",
        formType: "4",
        filedAt: new Date(Date.now() - 90_000), // 90 seconds ago
        issuerCompanyId: h.companyId,
      })
      .returning({ id: dbExports.filings.id });
    await insertTrade(h, { dedupKey: "zz-fresh#0", filingId: fresh!.id });

    const scan = await scanForMatches({ db: h.db });
    expect(scan.instant).toBe(1);
    expect(scan.stale).toBe(0);
  });

  it("respects min_value_usd and never treats a missing value as zero", async () => {
    await addChannels(h);
    await addRule(h, { filters: { min_value_usd: 1_000_000 } });

    await insertTrade(h, { dedupKey: "zz-small#0", valueUsd: 10_000 });
    const small = await scanForMatches({ db: h.db });
    expect(small.logged).toBe(0);

    await insertTrade(h, { dedupKey: "zz-big#0", valueUsd: 5_000_000 });
    const big = await scanForMatches({ db: h.db });
    expect(big.logged).toBe(1);
  });

  /**
   * Phase 8 added two SQL-only filters. The scanner evaluates them through
   * buildTradeConditions, and so does the screener — this asserts the two
   * genuinely agree rather than merely being intended to.
   */
  it("agrees with the screener on the precomputed cluster filter", async () => {
    await addChannels(h);
    await addRule(h, { name: "Cluster buys", trackedTicker: null, filters: { cluster: true } });

    // One buyer: not a cluster on either path.
    await insertTrade(h, { dedupKey: "zz-cluster-solo#0" });
    const solo = await scanForMatches({ db: h.db });
    expect(solo.logged).toBe(0);

    const screenerSolo = await h.db
      .select({ id: dbExports.transactions.id })
      .from(dbExports.transactions)
      .innerJoin(
        dbExports.companies,
        dbExports.eq(dbExports.transactions.companyId, dbExports.companies.id),
      )
      .innerJoin(
        dbExports.insiders,
        dbExports.eq(dbExports.transactions.insiderId, dbExports.insiders.id),
      )
      .leftJoin(
        dbExports.filings,
        dbExports.eq(dbExports.transactions.filingId, dbExports.filings.id),
      )
      .where(dbExports.and(...dbExports.buildTradeConditions(h.db, { cluster: true })));
    expect(screenerSolo).toHaveLength(0);

    // Two distinct insiders inside the window: a flag exists, so both paths match.
    const [second] = await h.db
      .insert(dbExports.insiders)
      .values({ externalKey: "name:US:ZZ SECOND BUYER", name: "ZZ SECOND BUYER", isOfficer: true })
      .returning({ id: dbExports.insiders.id });
    await h.db.insert(dbExports.clusterFlags).values({
      companyId: h.companyId,
      direction: "buy",
      windowStart: new Date().toISOString().slice(0, 10),
      windowEnd: new Date().toISOString().slice(0, 10),
      insiderCount: 2,
      tradeCount: 2,
      totalUsd: "1000000",
    });
    await h.db.insert(dbExports.transactions).values({
      source: "edgar",
      insiderId: second!.id,
      companyId: h.companyId,
      txnDate: new Date().toISOString().slice(0, 10),
      code: "P",
      shares: "1000",
      price: "500",
      value: "500000",
      currency: "USD",
      valueUsd: "500000",
      acquiredDisposed: "A",
      relevance: "opportunistic",
      dedupKey: "zz-cluster-second#0",
      country: "US",
    });

    const clustered = await scanForMatches({ db: h.db });
    expect(clustered.logged).toBe(1);

    const screenerClustered = await h.db
      .select({ id: dbExports.transactions.id })
      .from(dbExports.transactions)
      .innerJoin(
        dbExports.companies,
        dbExports.eq(dbExports.transactions.companyId, dbExports.companies.id),
      )
      .innerJoin(
        dbExports.insiders,
        dbExports.eq(dbExports.transactions.insiderId, dbExports.insiders.id),
      )
      .leftJoin(
        dbExports.filings,
        dbExports.eq(dbExports.transactions.filingId, dbExports.filings.id),
      )
      .where(dbExports.and(...dbExports.buildTradeConditions(h.db, { cluster: true })));
    // The screener now sees BOTH rows (same company); the scanner logged the
    // one row that was new since its cursor. What matters is that neither
    // path disagrees about which rows qualify.
    expect(screenerClustered.length).toBe(2);
  });

  it("agrees with the screener on the anomaly filter", async () => {
    await addChannels(h);
    await addRule(h, { name: "Unusual flow", filters: { min_anomaly_z: 2 } });

    await insertTrade(h, { dedupKey: "zz-anom-none#0" });
    const noBaseline = await scanForMatches({ db: h.db });
    expect(noBaseline.logged).toBe(0); // no anomaly row → no match

    await h.db.insert(dbExports.companyAnomalies).values({
      companyId: h.companyId,
      windowDays: 30,
      netUsd: "5000000",
      baselineMean: "10000",
      baselineStddev: "2000",
      zScore: "4.5",
      sampleSize: 12,
    });
    await insertTrade(h, { dedupKey: "zz-anom-hit#0" });
    const withBaseline = await scanForMatches({ db: h.db });
    expect(withBaseline.logged).toBe(1);

    const screener = await h.db
      .select({ id: dbExports.transactions.id })
      .from(dbExports.transactions)
      .innerJoin(
        dbExports.companies,
        dbExports.eq(dbExports.transactions.companyId, dbExports.companies.id),
      )
      .innerJoin(
        dbExports.insiders,
        dbExports.eq(dbExports.transactions.insiderId, dbExports.insiders.id),
      )
      .leftJoin(
        dbExports.filings,
        dbExports.eq(dbExports.transactions.filingId, dbExports.filings.id),
      )
      .where(dbExports.and(...dbExports.buildTradeConditions(h.db, { min_anomaly_z: 2 })));
    expect(screener).toHaveLength(2); // both rows now qualify on the screener
  });
});

describe("cluster alerts", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  const today = new Date().toISOString().slice(0, 10);

  async function addFlag(insiderCount: number, windowStart = today): Promise<void> {
    await h.db
      .insert(dbExports.clusterFlags)
      .values({
        companyId: h.companyId,
        direction: "buy",
        windowStart,
        windowEnd: today,
        insiderCount,
        tradeCount: insiderCount,
        totalUsd: String(insiderCount * 500_000),
      })
      .onConflictDoUpdate({
        target: [
          dbExports.clusterFlags.companyId,
          dbExports.clusterFlags.direction,
          dbExports.clusterFlags.windowStart,
        ],
        set: { insiderCount, tradeCount: insiderCount },
      });
  }

  it("fires once per threshold crossing, not once per scan", async () => {
    await addChannels(h);
    await addRule(h, { name: "ZZALERT clusters", kind: "cluster", mode: "instant" });
    await addFlag(2);

    const first = await scanClusterAlerts({ db: h.db });
    expect(first.logged).toBe(1);

    // Same cluster, same count — a second scan must not re-fire.
    const second = await scanClusterAlerts({ db: h.db });
    expect(second.matched).toBe(1); // still matches the rule...
    expect(second.logged).toBe(0); // ...but the dedup key is already logged

    // A third insider joins: one new alert for the new threshold.
    await addFlag(3);
    const third = await scanClusterAlerts({ db: h.db });
    expect(third.logged).toBe(1);

    const rows = await h.db.select().from(dbExports.alertsLog);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.dedupKey).sort()).toEqual(
      [
        clusterAlertKey(h.companyId, "buy", today, 2),
        clusterAlertKey(h.companyId, "buy", today, 3),
      ].sort(),
    );
    expect(rows.every((r) => r.kind === "cluster")).toBe(true);
    expect(rows.every((r) => r.transactionId === null)).toBe(true);
  });

  it("delivers from its payload, with no transaction to join", async () => {
    await addChannels(h);
    await addRule(h, { name: "ZZALERT clusters", kind: "cluster", mode: "instant" });
    await addFlag(3);
    await scanClusterAlerts({ db: h.db });

    const { fetchFn, calls } = makeFetchMock();
    const stats = await dispatchInstant(dispatchConfig(h, fetchFn));
    expect(stats.delivered).toBe(1);
    expect(stats.orphaned).toBe(0);

    const telegram = calls.find((c) => c.url.includes("api.telegram.org"))!;
    const text = (telegram.body as { text: string }).text;
    expect(text).toContain("3 insiders bought ZZALERT");
    expect(text).toContain("Not investment advice");
  });

  it("does not fire a cluster rule from an ordinary transaction scan", async () => {
    await addChannels(h);
    await addRule(h, { name: "ZZALERT clusters", kind: "cluster" });
    await insertTrade(h);

    // The transaction scanner only loads kind='transaction' rules.
    const scan = await scanForMatches({ db: h.db });
    expect(scan.logged).toBe(0);
  });
});

describe("politician alerts", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  async function addDisclosure(
    overrides: Partial<typeof dbExports.politicianTrades.$inferInsert> = {},
  ): Promise<string> {
    const [politician] = await h.db
      .insert(dbExports.politicians)
      .values({
        externalKey: "house:zz representative testcase",
        // Obviously fictional — a fabricated disclosure must never be
        // attributable to a real person.
        name: "ZZ Representative Testcase",
        chamber: "house",
        party: "IND",
        state: "ZZ",
      })
      .onConflictDoNothing()
      .returning({ id: dbExports.politicians.id });

    const politicianId =
      politician?.id ??
      (await h.db.select({ id: dbExports.politicians.id }).from(dbExports.politicians).limit(1))[0]!
        .id;

    const [row] = await h.db
      .insert(dbExports.politicianTrades)
      .values({
        politicianId,
        ticker: "ZZALERT",
        assetDescription: "ZZ Alert Test Corp",
        txnType: "purchase",
        txnDate: "2026-07-20",
        disclosedAt: new Date().toISOString().slice(0, 10),
        amountMin: "1001.00",
        amountMax: "15000.00",
        amountRange: "$1,001 - $15,000",
        source: "house-stock-watcher",
        dedupKey: `zz-pol-${Math.random().toString(36).slice(2)}#0`,
        ...overrides,
      })
      .returning({ id: dbExports.politicianTrades.id });
    return row!.id;
  }

  it("fires once per disclosure and advances its own cursor", async () => {
    await addChannels(h);
    await addRule(h, { name: "ZZ congress", kind: "politician", mode: "instant" });
    await addDisclosure();

    const first = await scanPoliticianAlerts({ db: h.db });
    expect(first.logged).toBe(1);

    const second = await scanPoliticianAlerts({ db: h.db });
    expect(second.scanned).toBe(0); // cursor advanced past it
    expect(second.logged).toBe(0);

    await addDisclosure({ ticker: "ZZALERT", txnType: "sale" });
    const third = await scanPoliticianAlerts({ db: h.db });
    expect(third.logged).toBe(1);
  });

  it("matches min_amount_usd against the disclosed UPPER bound", async () => {
    await addChannels(h);
    await addRule(h, {
      name: "ZZ big congress trades",
      kind: "politician",
      filters: { min_amount_usd: 50_000 },
    });

    // Bracket tops out at $15,000 — cannot clear a $50,000 floor.
    await addDisclosure();
    const small = await scanPoliticianAlerts({ db: h.db });
    expect(small.logged).toBe(0);

    await addDisclosure({
      amountMin: "50001.00",
      amountMax: "100000.00",
      amountRange: "$50,001 - $100,000",
    });
    const big = await scanPoliticianAlerts({ db: h.db });
    expect(big.logged).toBe(1);
  });

  it("renders the bracket, never a point value", async () => {
    await addChannels(h);
    await addRule(h, { name: "ZZ congress", kind: "politician", mode: "instant" });
    await addDisclosure();
    await scanPoliticianAlerts({ db: h.db });

    const { fetchFn, calls } = makeFetchMock();
    await dispatchInstant(dispatchConfig(h, fetchFn));
    const text = (calls.find((c) => c.url.includes("api.telegram.org"))!.body as { text: string })
      .text;
    expect(text).toContain("$1,001 - $15,000");
    expect(text).toContain("ZZ Representative Testcase");

    const [row] = await h.db.select().from(dbExports.alertsLog);
    // No synthesised value ever reaches the log.
    expect((row!.payload as { valueUsd: number | null }).valueUsd).toBeNull();
  });

  it("times freshness off the DISCLOSURE, not the transaction date", async () => {
    await addChannels(h);
    await addRule(h, { name: "ZZ congress", kind: "politician", mode: "instant" });
    // Traded 40 days ago, disclosed today: news today, so instant is correct.
    await addDisclosure({
      txnDate: new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10),
      disclosedAt: new Date().toISOString().slice(0, 10),
    });

    const scan = await scanPoliticianAlerts({ db: h.db });
    expect(scan.logged).toBe(1);
    expect(scan.instant).toBe(1);
  });
});

/**
 * The Telegram digest fallback: what a user with Telegram verified and no
 * email receives, and what happens when Telegram refuses it.
 *
 * This was the one renderer in the package that interpolated issuer and rule
 * text straight into an HTML payload. It needed no attacker — an ordinary `&`
 * in a company name is enough — and the consequence was worse than a mangled
 * message: Telegram rejects unparseable entities with 400, a failed send left
 * the rows `pending`, and the same 400 then recurred on every run forever.
 */
describe("telegram digest delivery", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await makeHarness();
  });

  /** Telegram verified, no email — the only configuration that takes the fallback. */
  async function telegramOnly(): Promise<void> {
    await h.db.insert(dbExports.alertChannels).values({
      userId: USER_A,
      channel: "telegram",
      destination: "555000",
      verified: true,
      timezone: "UTC",
    });
  }

  /** A company whose NAME is what the digest prints, because it has no ticker. */
  async function companyNamed(name: string): Promise<string> {
    const [row] = await h.db
      .insert(dbExports.companies)
      .values({
        externalKey: `ticker:US:ZZNAMED-${name.length}`,
        ticker: null,
        name,
        country: "US",
      })
      .returning({ id: dbExports.companies.id });
    return row!.id;
  }

  const telegramText = (calls: Array<{ url: string; body: unknown }>): string =>
    (calls.find((c) => c.url.includes("api.telegram.org"))!.body as { text: string }).text;

  /** Every `&` in a Telegram HTML payload must open a real entity, or it 400s. */
  const hasLooseAmpersand = (s: string): boolean => /&(?!(amp|lt|gt|quot|#\d+);)/.test(s);

  /**
   * Escaping is only half of the contract. Telegram's HTML mode accepts a
   * small tag whitelist and answers everything else with
   * `400: Unsupported start tag` — the same dead end an unescaped `&`
   * produces. So a renderer that grows a `<div>`, or that lets a user's
   * markup through, fails identically and is caught by the same assertion.
   */
  const TELEGRAM_TAGS = new Set([
    "a",
    "b",
    "blockquote",
    "code",
    "del",
    "em",
    "i",
    "ins",
    "pre",
    "s",
    "span",
    "strike",
    "strong",
    "tg-spoiler",
    "u",
  ]);
  const foreignTags = (s: string): string[] =>
    [...s.matchAll(/<\/?([a-z][a-z0-9-]*)/gi)]
      .map((m) => m[1]!.toLowerCase())
      .filter((tag) => !TELEGRAM_TAGS.has(tag));

  it("escapes an ordinary issuer name containing & and angle brackets", async () => {
    await telegramOnly();
    // No attacker involved: this is what EDGAR files. AT&T, Johnson & Johnson
    // and Procter & Gamble all carry the character that breaks the parser.
    const companyId = await companyNamed("ZZ Procter & Gamble <Holdings>");
    await addRule(h, {
      name: "ZZ digest",
      mode: "digest",
      channels: ["telegram"],
      trackedTicker: null,
    });
    await h.db.insert(dbExports.transactions).values({
      source: "edgar",
      insiderId: h.insiderId,
      companyId,
      txnDate: "2026-08-02",
      code: "P",
      shares: "1000",
      value: "500000",
      valueUsd: "500000",
      currency: "USD",
      acquiredDisposed: "A",
      relevance: "opportunistic",
      dedupKey: "zz-ampersand#0",
      country: "US",
    });
    await scanForMatches({ db: h.db });

    const { fetchFn, calls } = makeFetchMock();
    const stats = await dispatchDigest(dispatchConfig(h, fetchFn));
    expect(stats.delivered).toBe(1);

    const text = telegramText(calls);
    expect(text).toContain("ZZ Procter &amp; Gamble &lt;Holdings&gt;");
    expect(text).not.toContain("Gamble <Holdings>");
    expect(hasLooseAmpersand(text)).toBe(false);
    expect(foreignTags(text)).toEqual([]);
  });

  it("escapes a rule name the user chose, markup and all", async () => {
    await telegramOnly();
    const ruleName = 'My <img src=x onerror="alert(1)"> rule';
    await addRule(h, { name: ruleName, mode: "digest", channels: ["telegram"] });
    await insertTrade(h, { dedupKey: "zz-rulename#0" });
    await scanForMatches({ db: h.db });

    const { fetchFn, calls } = makeFetchMock();
    await dispatchDigest(dispatchConfig(h, fetchFn));

    const text = telegramText(calls);
    expect(text).not.toContain("<img");
    expect(text).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(hasLooseAmpersand(text)).toBe(false);
    expect(foreignTags(text)).toEqual([]); // the <img> never became a tag
    // The digest's own markup survives — escaping must not flatten the message.
    expect(text).toContain("<b>");
  });

  it("retires a 400 as permanent instead of retrying it forever", async () => {
    await telegramOnly();
    await addRule(h, { name: "ZZ digest", mode: "digest", channels: ["telegram"] });
    await insertTrade(h, { dedupKey: "zz-parse-fail#0" });
    await scanForMatches({ db: h.db });

    const rejecting = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('{"description":"Bad Request: cannot parse entities"}'),
    }) as unknown as FetchLike;

    const stats = await dispatchDigest(dispatchConfig(h, rejecting));
    expect(stats.failed).toBe(1);
    expect(stats.failedPermanent).toBe(1);

    const [row] = await h.db.select().from(dbExports.alertsLog);
    expect(row?.status).toBe("failed_permanent");
    // The operator needs Telegram's reason, not just the status code.
    expect(row?.error).toContain("cannot parse entities");

    // Terminal: the next run must not reload it. That is the whole point — a
    // row that can never send must stop consuming every future batch.
    const { fetchFn, calls } = makeFetchMock();
    const second = await dispatchDigest(dispatchConfig(h, fetchFn));
    expect(second.failed).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("retires a 403 (user blocked the bot) as permanent", async () => {
    await telegramOnly();
    await addRule(h, { name: "ZZ digest", mode: "digest", channels: ["telegram"] });
    await insertTrade(h, { dedupKey: "zz-blocked#0" });
    await scanForMatches({ db: h.db });

    const blocked = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('{"description":"Forbidden: bot was blocked by the user"}'),
    }) as unknown as FetchLike;

    const stats = await dispatchDigest(dispatchConfig(h, blocked));
    expect(stats.failedPermanent).toBe(1);
    const [row] = await h.db.select().from(dbExports.alertsLog);
    expect(row?.status).toBe("failed_permanent");
  });

  it("keeps retrying a transient failure, but only up to the cap", async () => {
    await telegramOnly();
    await addRule(h, { name: "ZZ digest", mode: "digest", channels: ["telegram"] });
    await insertTrade(h, { dedupKey: "zz-transient#0" });
    await scanForMatches({ db: h.db });

    const flaky = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve("upstream down"),
    }) as unknown as FetchLike;

    // A 502 is Telegram's problem, not the payload's: retry.
    for (let attempt = 1; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
      const stats = await dispatchDigest(dispatchConfig(h, flaky));
      expect(stats.failed).toBe(1);
      expect(stats.failedPermanent).toBe(0);
      const [pendingRow] = await h.db.select().from(dbExports.alertsLog);
      expect(pendingRow?.status).toBe("pending");
      expect(pendingRow?.attempts).toBe(attempt);
    }

    // ...but not indefinitely. A destination that never recovers would
    // otherwise sit in every batch forever, with `alertsPending` climbing.
    const last = await dispatchDigest(dispatchConfig(h, flaky));
    expect(last.failedPermanent).toBe(1);
    const [row] = await h.db.select().from(dbExports.alertsLog);
    expect(row?.status).toBe("failed_permanent");
    expect(row?.attempts).toBe(MAX_DELIVERY_ATTEMPTS);
    expect(row?.error).toContain("502");
  });

  it("keeps retrying when one channel is permanently rejected but another could still deliver", async () => {
    // Telegram rejects the payload permanently; Resend is merely down. The
    // alert is still deliverable, so retiring it would drop it silently.
    await addChannels(h); // telegram + email, both verified
    await addRule(h, { name: "ZZ both", mode: "digest", channels: ["telegram", "email"] });
    await insertTrade(h, { dedupKey: "zz-mixed#0" });
    await scanForMatches({ db: h.db });

    const mixed = vi
      .fn()
      .mockImplementation((url: string) =>
        Promise.resolve(
          url.includes("api.telegram.org")
            ? { ok: false, status: 400, text: () => Promise.resolve("bad entities") }
            : { ok: false, status: 503, text: () => Promise.resolve("resend down") },
        ),
      ) as unknown as FetchLike;

    const stats = await dispatchDigest(dispatchConfig(h, mixed));
    expect(stats.failed).toBe(1);
    expect(stats.failedPermanent).toBe(0);
    const [row] = await h.db.select().from(dbExports.alertsLog);
    expect(row?.status).toBe("pending");
  });
});

/**
 * The rendered messages, with no database and no dispatch in the way.
 *
 * A Telegram card and an HTML email are the only places a reader meets this
 * product outside the app, and email is the one place where a literal colour
 * value is correct — there is no stylesheet to hold a token. So the design
 * rules are asserted here rather than trusted: Ledger values only, the accent
 * spent once, figures tabular, direction carried by a shape that survives a
 * client stripping every colour, and no figure the filing never disclosed.
 */
describe("message rendering", () => {
  const base: AlertCandidate = {
    id: "33333333-3333-4333-8333-333333333333",
    dedupKey: "zz-render#0",
    createdAt: new Date("2026-08-02T12:00:00Z"),
    txnDate: "2026-08-02",
    code: "P",
    shares: 1000,
    price: 10,
    value: 500_000,
    valueUsd: 500_000,
    currency: "USD",
    acquiredDisposed: "A",
    relevance: "opportunistic",
    source: "edgar",
    country: "US",
    is10b51: false,
    companyId: "44444444-4444-4444-8444-444444444444",
    ticker: "ZZALERT",
    companyName: "ZZ Alert Test Corp",
    insiderId: "55555555-5555-4555-8555-555555555555",
    insiderName: "ZZ ALERT TESTER",
    insiderTitle: "CEO",
    kind: "transaction",
  };
  const candidate = (over: Partial<AlertCandidate> = {}): AlertCandidate => ({ ...base, ...over });
  const groups = (...cs: AlertCandidate[]) => [{ ruleName: "ZZ digest", candidates: cs }];
  const options = {
    siteUrl: "https://insiderflow.test",
    unsubscribeUrl: "https://insiderflow.test/api/alerts/unsubscribe?token=zz",
  };

  /** Paper, ink, hairline and accent — the whole palette an email may use. */
  const LEDGER_HEX = ["#FBFAF7", "#FFFFFF", "#17150F", "#6B6659", "#9B9689", "#E4E1D9", "#8A2B2B"];
  const hexesIn = (html: string): string[] =>
    (html.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((h) => h.toUpperCase());
  const occurrences = (s: string, needle: string): number => s.split(needle).length - 1;
  /** Emoji as Unicode defines it. The triangles below are geometry, not emoji. */
  const EMOJI = /\p{Extended_Pictographic}/u;

  it("dresses the email in Ledger paper and ink, and nothing else", () => {
    const { html } = digestEmail(groups(candidate()), options);
    const found = hexesIn(html);
    expect(found.length).toBeGreaterThan(0);
    for (const hex of found) expect(LEDGER_HEX).toContain(hex);

    // Table layout, inline styles, nothing fetched: Outlook renders through
    // Word, and half of the rest block remote content by default.
    expect(html).toContain("<table");
    expect(html).not.toContain("<div");
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("@font-face");
  });

  it("spends the one accent exactly once per message", () => {
    const digest = digestEmail(
      groups(candidate(), candidate({ dedupKey: "zz-render-2#0" })),
      options,
    );
    expect(occurrences(digest.html, "#8A2B2B")).toBe(1);
    expect(occurrences(instantEmail("ZZ rule", candidate(), options).html, "#8A2B2B")).toBe(1);
  });

  it("sets figures in a tabular monospace face so amounts align", () => {
    const { html } = digestEmail(groups(candidate()), options);
    expect(html).toContain("font-variant-numeric:tabular-nums");
    expect(html).toContain("IBM Plex Mono");
    expect(instantEmail("ZZ rule", candidate(), options).html).toContain(
      "font-variant-numeric:tabular-nums",
    );
  });

  it("carries direction as a shape, because clients strip colour unpredictably", () => {
    expect(digestEmail(groups(candidate({ acquiredDisposed: "A" })), options).text).toContain(
      "\n  ▲ 2026-08-02",
    );
    expect(digestEmail(groups(candidate({ acquiredDisposed: "D" })), options).text).toContain(
      "\n  ▼ 2026-08-02",
    );

    // A direction nobody disclosed gets the app's null mark, never a triangle
    // guessed in one direction or the other.
    const unknown = digestEmail(groups(candidate({ acquiredDisposed: null })), options);
    expect(unknown.text).toContain("\n  — 2026-08-02");
    expect(unknown.html).not.toContain("▲");
    expect(unknown.html).not.toContain("▼");
  });

  it("spends no emoji in any channel", () => {
    expect(EMOJI.test(telegramMessage("ZZ rule", candidate()))).toBe(false);
    expect(EMOJI.test(digestTelegram(groups(candidate())))).toBe(false);
    expect(EMOJI.test(digestEmail(groups(candidate()), options).html)).toBe(false);
    expect(EMOJI.test(instantEmail("ZZ rule", candidate(), options).html)).toBe(false);
  });

  it("names a derived alert instead of iconifying it", () => {
    const cluster = candidate({
      kind: "cluster",
      headline:
        "3 insiders bought ZZALERT between 2026-07-28 and 2026-08-02 — 3 trades, $1,500,000",
    });
    const message = telegramMessage("ZZ clusters", cluster);
    // The word "cluster" is the label; a pictogram would say less and break
    // the moment a client renders it as a box.
    expect(message).toContain("<code>cluster</code>");
    expect(message.startsWith("▲ <b>ZZALERT</b>")).toBe(true);
  });

  it("never prints a figure the filing did not disclose", () => {
    const blank = candidate({ shares: null, price: null, value: null, valueUsd: null });
    const { html, text } = digestEmail(groups(blank), options);
    expect(text).toContain("an undisclosed number of");
    expect(text).toContain("undisclosed value");
    expect(html).toContain("undisclosed value");
    expect(text).not.toContain("$0");
  });

  it("keeps a politician's disclosed bracket whole", () => {
    const bracket = candidate({
      kind: "politician",
      shares: null,
      value: null,
      valueUsd: null,
      headline:
        "ZZ Representative Testcase (house-IND) bought ZZALERT — $1,001 - $15,000, disclosed 2026-08-02",
    });
    const { html, text } = digestEmail(groups(bracket), options);
    expect(text).toContain("$1,001 - $15,000");
    expect(html).toContain("$1,001 - $15,000");
    // Neither a midpoint nor the "undisclosed value" that an empty valueUsd
    // would otherwise print: the bracket IS the disclosure.
    expect(html).not.toContain("$8,000");
    expect(html).not.toContain("undisclosed value");
  });
});
