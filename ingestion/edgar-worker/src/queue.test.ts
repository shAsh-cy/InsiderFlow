/**
 * The durability boundary: discovery, the pending queue, and the drain.
 *
 * The defect these cover: discovery used to be inseparable from processing.
 * One poll of EDGAR's "current events" feed — a rolling window of the 100 most
 * recent filings — ingested at most `maxFilings` of them and forgot the rest.
 * Under sustained arrival the unprocessed remainder grew past the window, the
 * oldest unprocessed filings scrolled out, and there was no cursor to go back
 * for them. Silent, permanent data loss with a green test suite.
 *
 * Everything here is expressed as "nothing is lost", not "the queue has the
 * right shape" — the queue is an implementation detail; not losing filings is
 * the promise.
 */
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { pushSchema } from "drizzle-kit/api";
import { beforeEach, describe, expect, it } from "vitest";

import { SAMPLE_FORM4_XML, wrapAsSubmissionText } from "@insiderflow/core/fixtures";
import * as dbExports from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

import type { FetchLike, FetchLikeResponse } from "./http";
import { discoverFilings, drainPendingFilings, ingestFromFeed, pendingBacklog } from "./pipeline";

/** How many filings the simulated burst puts in the feed. */
const BURST = 60;
const PAGE_SIZE = 100;

const accessionFor = (i: number): string => `0000320193-26-${String(100000 + i).slice(-6)}`;

/**
 * One feed entry per filing, newest first — the order EDGAR uses, and the
 * order that makes "the tail scrolls away" possible.
 */
function feedPage(form: string, start: number, total: number): string {
  const entries: string[] = [];
  for (let i = start; i < Math.min(start + PAGE_SIZE, total); i++) {
    const accession = accessionFor(i);
    // Descending timestamps: index 0 is the newest filing in the window.
    const minute = String(59 - (i % 60)).padStart(2, "0");
    const hour = String(17 - Math.floor(i / 60)).padStart(2, "0");
    entries.push(`
  <entry>
    <title>${form} - TESTER ${i} (000121415${i % 10}) (Reporting)</title>
    <link rel="alternate" href="https://www.sec.gov/Archives/edgar/data/320193/x/${accession}-index.htm"/>
    <category label="form type" term="${form}"/>
    <id>urn:tag:sec.gov,2008:accession-number=${accession}</id>
    <updated>2026-07-31T${hour}:${minute}:00-04:00</updated>
  </entry>`);
  }
  return `<?xml version="1.0" encoding="ISO-8859-1"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Latest Filings - Form ${form}</title>${entries.join("")}
</feed>`;
}

function textResponse(body: string, status = 200): FetchLikeResponse {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  };
}

interface MockOptions {
  /** Total filings in the form-4 window. */
  total?: number;
  /** Accession numbers EDGAR refuses to serve. */
  brokenAccessions?: Set<string>;
}

function makeFetchMock(options: MockOptions = {}) {
  const total = options.total ?? BURST;
  const broken = options.brokenAccessions ?? new Set<string>();
  const feedRequests: string[] = [];
  const documentRequests: string[] = [];

  const fetchFn: FetchLike = (url) => {
    if (url.includes("action=getcurrent")) {
      feedRequests.push(url);
      // Only form 4 has a window; 3 and 5 are empty, as in a quiet period.
      if (!url.includes("type=4")) return Promise.resolve(textResponse("<feed></feed>"));
      const start = Number(/[?&]start=(\d+)/.exec(url)?.[1] ?? "0");
      return Promise.resolve(textResponse(feedPage("4", start, total)));
    }

    const accession = /\/([\d-]+)\.txt$/.exec(url)?.[1];
    if (accession) {
      documentRequests.push(accession);
      if (broken.has(accession)) return Promise.resolve(textResponse("gone", 404));
      // A distinct insider per filing, so rows do not collide on dedup_key.
      const index = Number(accession.slice(-6)) - 100000;
      const xml = SAMPLE_FORM4_XML.replace("0001214156", String(1000000 + index)).replace(
        "Doe  Jane A.",
        `Tester ${index}`,
      );
      return Promise.resolve(textResponse(wrapAsSubmissionText(xml, "20260731170512")));
    }
    return Promise.resolve(textResponse("not found", 404));
  };

  return { fetchFn, feedRequests, documentRequests };
}

let client: PGlite;
let db: Database;

beforeEach(async () => {
  client = new PGlite({ extensions: { pg_trgm } });
  await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm;");
  const pglite = drizzle(client, { schema: dbExports });
  const { apply } = await pushSchema(
    { ...dbExports },
    pglite as unknown as Parameters<typeof pushSchema>[1],
  );
  await apply();
  db = pglite as unknown as Database;
}, 60_000);

const baseOptions = (fetchFn: FetchLike, maxFilings: number) => ({
  db,
  userAgent: "InsiderFlow-test/0.1 (test@example.com)",
  fetchFn,
  requestDelayMs: 0,
  maxFilings,
  log: () => {},
});

describe("a burst larger than the per-run cap", () => {
  it("queues everything it discovers and loses nothing across runs", async () => {
    const { fetchFn } = makeFetchMock({ total: BURST });
    const options = baseOptions(fetchFn, 25);

    const first = await ingestFromFeed(options);
    expect(first.ingested).toBe(25);
    // The number the old code discarded. 60 discovered, 25 done, 35 waiting.
    expect(first.backlog).toBe(BURST - 25);

    const second = await ingestFromFeed(options);
    expect(second.ingested).toBe(25);
    expect(second.backlog).toBe(BURST - 50);

    const third = await ingestFromFeed(options);
    expect(third.ingested).toBe(BURST - 50);
    expect(third.backlog).toBe(0);

    // Every filing in the window reached the database — the whole promise.
    const rows = await db
      .select({ accessionNo: dbExports.filings.accessionNo })
      .from(dbExports.filings);
    const stored = new Set(rows.map((r) => r.accessionNo));
    expect(stored.size).toBe(BURST);
    for (let i = 0; i < BURST; i++) {
      expect(stored.has(accessionFor(i)), `${accessionFor(i)} was lost`).toBe(true);
    }
  });

  it("drains oldest-first, so the tail is never starved", async () => {
    // Newest-first under sustained load is the same data loss in slow motion:
    // the oldest filing never reaches the head of the batch.
    const { fetchFn } = makeFetchMock({ total: BURST });
    const options = baseOptions(fetchFn, 10);

    await ingestFromFeed(options);
    const ingested = await db
      .select({ accessionNo: dbExports.filings.accessionNo })
      .from(dbExports.filings);
    const indices = ingested
      .map((r) => Number(r.accessionNo.slice(-6)) - 100000)
      .sort((a, b) => a - b);

    // The feed lists newest first, so the OLDEST are the highest indices.
    expect(indices).toEqual(
      Array.from({ length: 10 }, (_, k) => BURST - 10 + k).sort((a, b) => a - b),
    );
  });

  it("does not re-fetch a filing it has already ingested", async () => {
    const { fetchFn, documentRequests } = makeFetchMock({ total: 30 });
    const options = baseOptions(fetchFn, 30);

    await ingestFromFeed(options);
    const afterFirst = documentRequests.length;
    expect(afterFirst).toBe(30);

    await ingestFromFeed(options);
    expect(documentRequests.length, "a second run must fetch nothing new").toBe(afterFirst);
  });
});

describe("discovery paging", () => {
  it("walks back past the first page rather than seeing only the newest 100", async () => {
    // 250 filings in the window: a single-page poll can only ever see 100 of
    // them, and the other 150 were exactly what used to be lost.
    const { fetchFn } = makeFetchMock({ total: 250 });
    const stats = await discoverFilings({ ...baseOptions(fetchFn, 25), maxDiscoveryPages: 3 });

    expect(stats.enqueued).toBe(250);
    const { depth } = await pendingBacklog(db);
    expect(depth).toBe(250);
  });

  it("stops paging as soon as a page holds nothing new", async () => {
    const { fetchFn, feedRequests } = makeFetchMock({ total: 20 });
    await discoverFilings({ ...baseOptions(fetchFn, 25), maxDiscoveryPages: 5 });
    const firstPass = feedRequests.length;

    // Second pass: page 1 of form 4 is entirely known, so it must not page on.
    feedRequests.length = 0;
    await discoverFilings({ ...baseOptions(fetchFn, 25), maxDiscoveryPages: 5 });
    expect(feedRequests.filter((u) => u.includes("type=4"))).toHaveLength(1);
    expect(feedRequests.length).toBeLessThanOrEqual(firstPass);
  });
});

describe("a filing EDGAR will not serve", () => {
  it("stops being retried but stays visible, and never blocks the queue", async () => {
    // Oldest-first ordering means a permanently-broken filing sits at the head
    // of the queue. If it were retried forever it would consume a slot on
    // every run; if it were deleted it would vanish without trace.
    const brokenIndex = 59; // the OLDEST in the window, so it drains first
    const { fetchFn } = makeFetchMock({
      total: BURST,
      brokenAccessions: new Set([accessionFor(brokenIndex)]),
    });
    const options = baseOptions(fetchFn, 25);

    // Enough runs for the rest of the burst to drain AND for the broken
    // filing to exhaust its attempts (one per run).
    for (let run = 0; run < dbExports.PENDING_FILING_MAX_ATTEMPTS + 1; run++) {
      await ingestFromFeed(options);
    }

    const stored = await db
      .select({ accessionNo: dbExports.filings.accessionNo })
      .from(dbExports.filings);
    // Everything else landed despite the broken one being first in line.
    expect(stored).toHaveLength(BURST - 1);

    const backlog = await pendingBacklog(db);
    expect(backlog.depth, "the broken filing must not count as work still to do").toBe(0);
    expect(backlog.stuck).toBe(1);

    const [stuck] = await db.select().from(dbExports.pendingFilings);
    expect(stuck!.accessionNo).toBe(accessionFor(brokenIndex));
    expect(stuck!.attempts).toBeGreaterThanOrEqual(dbExports.PENDING_FILING_MAX_ATTEMPTS);
    // Kept, with the reason, so an operator can see WHAT got stuck and why.
    expect(stuck!.lastError).toBeTruthy();
  });
});

describe("backlog reporting", () => {
  it("reports depth and the age of the oldest waiting filing", async () => {
    const { fetchFn } = makeFetchMock({ total: 40 });
    await discoverFilings(baseOptions(fetchFn, 25));

    const backlog = await pendingBacklog(db);
    expect(backlog.depth).toBe(40);
    expect(backlog.stuck).toBe(0);
    expect(backlog.oldestDiscoveredAt).toBeInstanceOf(Date);

    await drainPendingFilings(baseOptions(fetchFn, 25));
    expect((await pendingBacklog(db)).depth).toBe(15);
  });
});
