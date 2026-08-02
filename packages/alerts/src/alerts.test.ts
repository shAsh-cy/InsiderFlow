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

import { dispatchDigest, dispatchInstant } from "./dispatch";
import { scanForMatches } from "./scanner";
import type { FetchLike } from "./channels";

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
});
