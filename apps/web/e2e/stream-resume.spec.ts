import { expect, test } from "@playwright/test";
import type { APIRequestContext, Page } from "@playwright/test";

import {
  cleanupSyntheticCompany,
  createSyntheticCompany,
  insertSyntheticTrade,
  psql,
} from "./fixtures";

/**
 * RESUME — what /api/stream owes a client that was not connected.
 *
 * `stream-limits.spec.ts` owns the concurrency ceiling and the hostile-cursor
 * fallback. This file owns the other half of the contract, and the half the
 * whole design leans on: the route deliberately holds no connection longer
 * than ~25 seconds, so EVERY client of this API is a reconnecting client. The
 * only thing between a window close and a hole in the tape is the cursor.
 *
 * Three surfaces, one cursor:
 *   - SSE with a `Last-Event-ID` request header — what a browser resends by
 *     itself after the server hangs up;
 *   - `?mode=poll&last_event_id=`, the documented EventSource-less fallback;
 *   - the `cursor` a poll batch returns, which the client feeds back next tick.
 *
 * Every cursor here is one the SERVER issued, read back off the wire. A cursor
 * this file computed itself would be a test of arithmetic; a cursor the route
 * emitted is a test of the round trip — and the round trip is precisely where
 * the defect pinned at the bottom of this file lives.
 *
 * With one deliberate exception. Round-tripping the route against itself can
 * show THAT resume returns the wrong rows and can never show WHY, so the
 * mechanism test near the bottom asks Postgres for the row instead and
 * compares the issued id against that. It is the only assertion in this file
 * whose expected value does not come from the subject under test, and it is
 * what keeps the defect write-up below falsifiable rather than merely
 * plausible.
 *
 * Rows are always narrowed to our own synthetic ticker before being asserted
 * on. Other specs insert live-dated trades into the same global window, and a
 * resume test that counted everything would be measuring the suite.
 */

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";

/** Distinct per row so a trade is identifiable on the wire by its size alone. */
let sharesSeq = 640_000;
const nextShares = (): number => (sharesSeq += 1);

/**
 * The DATABASE's clock as a cursor, taken before the rows under test exist.
 *
 * Not `Date.now()`. The cursor is compared against `created_at`, which
 * Postgres stamps from its own clock inside a container; the two agree on this
 * box today, and a cursor built from the wrong one fails on a machine where
 * they drift, for a reason that has nothing to do with resume.
 */
function cursorBeforeNow(): string {
  return `${psql("SELECT floor(extract(epoch from now()) * 1000)::bigint;")}:${ZERO_UUID}`;
}

interface WireEvent {
  id: string;
  event: string;
  data: { id: string; shares: number | null; company: { ticker: string | null } };
}

interface PollBatch {
  events: WireEvent[];
  cursor: string;
}

async function pollFrom(request: APIRequestContext, cursor: string): Promise<PollBatch> {
  const response = await request.get(
    `/api/stream?mode=poll&last_event_id=${encodeURIComponent(cursor)}`,
  );
  expect(response.status(), "the poll fallback is the resume path for clients without SSE").toBe(
    200,
  );
  return (await response.json()) as PollBatch;
}

const ourShares = (events: WireEvent[], ticker: string): number[] =>
  events.filter((e) => e.data.company.ticker === ticker).map((e) => e.data.shares ?? 0);

/** The id the ROUTE gave a row — never one reconstructed from `created_at`. */
function issuedIdFor(events: WireEvent[], ticker: string, shares: number): string {
  const match = events.find((e) => e.data.company.ticker === ticker && e.data.shares === shares);
  if (!match) throw new Error(`the route never emitted ${ticker} @ ${shares} shares`);
  return match.id;
}

interface Frame {
  id: string;
  ticker: string | null;
  shares: number | null;
}

/**
 * One real SSE window, read frame by frame, resumed from `cursor`.
 *
 * Driven with `fetch` rather than `EventSource` because Last-Event-ID is a
 * REQUEST header: the browser sends it on its own reconnect and offers no way
 * to seed it, so the only way to exercise the header path deliberately is to
 * make the request by hand. It is the same connection the browser would open,
 * which is what makes this @stream — it holds one of the four concurrency
 * slots for as long as it reads.
 *
 * Returns whatever arrived before `untilShares` was seen or the deadline hit.
 * A short read is a real result; the assertions say what had to be in it.
 */
async function readResumedWindow(
  page: Page,
  options: { cursor: string; ticker: string; untilShares: number; timeoutMs: number },
): Promise<Frame[]> {
  return page.evaluate(async (opts) => {
    const frames: Frame[] = [];
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), opts.timeoutMs);
    try {
      const response = await fetch("/api/stream", {
        headers: { "last-event-id": opts.cursor },
        signal: controller.signal,
      });
      const body = response.body;
      if (!body) return frames;
      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let satisfied = false;
      while (!satisfied) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          const lines = frame.split("\n");
          const idLine = lines.find((l) => l.startsWith("id: "));
          const dataLine = lines.find((l) => l.startsWith("data: "));
          // `retry:`, `: ping` comments and the id-less `window_end` frame are
          // not trades and carry no cursor position.
          if (!idLine || !dataLine) continue;
          const trade = JSON.parse(dataLine.slice(6)) as {
            shares: number | null;
            company: { ticker: string | null };
          };
          frames.push({
            id: idLine.slice(4),
            ticker: trade.company?.ticker ?? null,
            shares: trade.shares ?? null,
          });
          if (trade.company?.ticker === opts.ticker && trade.shares === opts.untilShares) {
            satisfied = true;
          }
        }
      }
    } catch {
      // The deadline aborts the fetch. Whatever was read still gets asserted.
    } finally {
      clearTimeout(deadline);
      // Hand the concurrency slot back now rather than in 25 seconds.
      controller.abort();
    }
    return frames;
  }, options);
}

/** Wall clock, not a UI wait: the point is that the row lands MID-window. */
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test("an SSE client resuming with Last-Event-ID gets what it missed, not what it had @stream", async ({
  page,
  request,
}) => {
  // Long on purpose: a real window is read, and a row has to arrive inside it.
  test.setTimeout(90_000);

  const target = createSyntheticCompany("ZZRSSE");
  try {
    const before = cursorBeforeNow();
    const hadEarlier = nextShares();
    const resumePoint = nextShares();
    const missed = nextShares();
    const live = nextShares();

    insertSyntheticTrade(target, { shares: hadEarlier });
    insertSyntheticTrade(target, { shares: resumePoint });

    // What the client is holding when it drops: the id of the last event the
    // server handed it, taken from the server.
    const seeded = await pollFrom(request, before);
    expect(
      ourShares(seeded.events, target.ticker),
      "both seeded rows must be on the tape, in arrival order, before resume means anything",
    ).toEqual([hadEarlier, resumePoint]);
    const resumeCursor = issuedIdFor(seeded.events, target.ticker, resumePoint);

    // Written while nobody is connected. This is the row a broken resume
    // silently loses: with no cursor the route starts from "now", and by the
    // time the connection opens this trade is already in the past.
    insertSyntheticTrade(target, { shares: missed });

    await page.goto("/");
    const windowRead = readResumedWindow(page, {
      cursor: resumeCursor,
      ticker: target.ticker,
      untilShares: live,
      timeoutMs: 20_000,
    });

    // …and then one that arrives DURING the window, so the connection is shown
    // to be a live tape rather than a catch-up query that happened to reply.
    await sleep(4_000);
    insertSyntheticTrade(target, { shares: live });

    const streamed = (await windowRead)
      .filter((f) => f.ticker === target.ticker)
      .map((f) => f.shares);

    expect(streamed, "a row written while disconnected must be replayed on resume").toContain(
      missed,
    );
    expect(streamed, "a row written inside the window must stream without a reconnect").toContain(
      live,
    );
    // The whole point of carrying a cursor. `hadEarlier` sits strictly before
    // the resume point, and a client that gets it back is being handed its
    // entire history again on every 25-second reconnect — which is a growing
    // replay, not a feed.
    expect(streamed, "resume must not rewind past the cursor it was given").not.toContain(
      hadEarlier,
    );
  } finally {
    cleanupSyntheticCompany(target);
  }
});

test("?mode=poll resumes from the last_event_id query param and advances its cursor", async ({
  request,
}) => {
  const target = createSyntheticCompany("ZZRPOL");
  try {
    const before = cursorBeforeNow();
    const hadEarlier = nextShares();
    const resumePoint = nextShares();
    const missed = nextShares();

    insertSyntheticTrade(target, { shares: hadEarlier });
    insertSyntheticTrade(target, { shares: resumePoint });

    const seeded = await pollFrom(request, before);
    expect(ourShares(seeded.events, target.ticker)).toEqual([hadEarlier, resumePoint]);
    const resumeCursor = issuedIdFor(seeded.events, target.ticker, resumePoint);

    insertSyntheticTrade(target, { shares: missed });

    const resumed = await pollFrom(request, resumeCursor);
    const ours = ourShares(resumed.events, target.ticker);
    expect(ours, "the query-param cursor must replay what the client missed").toContain(missed);
    expect(ours, "…and must not rewind past the position it names").not.toContain(hadEarlier);

    // The batch cursor is what the client sends next tick. A cursor that came
    // back unchanged would leave a polling client re-scanning the same window
    // forever — a busy loop wearing a feed's clothes.
    expect(resumed.cursor, "a batch with events must move the cursor on").not.toBe(resumeCursor);
    expect(
      Number(resumed.cursor.split(":")[0]),
      "the cursor must move forward in time, never back",
    ).toBeGreaterThan(Number(resumeCursor.split(":")[0]));
  } finally {
    cleanupSyntheticCompany(target);
  }
});

test("a mid-tape resume cursor delivers each missed row exactly once", async ({ request }) => {
  const target = createSyntheticCompany("ZZRDUP");
  try {
    const before = cursorBeforeNow();
    const rows = [nextShares(), nextShares(), nextShares(), nextShares()];
    for (const shares of rows) insertSyntheticTrade(target, { shares });

    const all = await pollFrom(request, before);
    expect(ourShares(all.events, target.ticker)).toEqual(rows);

    // A client that had rows 1 and 2 and then dropped out.
    const resumed = await pollFrom(request, issuedIdFor(all.events, target.ticker, rows[1]!));
    const ours = ourShares(resumed.events, target.ticker);

    // Exactly once each, not merely present. The poll fallback is documented
    // and public; anything consuming it that is not this app's own hook has no
    // seen-set of its own, so a repeat here is a double count downstream.
    expect(ours.filter((s) => s === rows[2]).length, "row 3 must arrive exactly once").toBe(1);
    expect(ours.filter((s) => s === rows[3]).length, "row 4 must arrive exactly once").toBe(1);
    // Nothing strictly before the cursor may come back.
    expect(ours, "a resume must not rewind to rows the client already had").not.toContain(rows[0]);
    // Row 2 — the cursor's OWN event — is deliberately not asserted here. It
    // comes back, and the test below is what says so.
  } finally {
    cleanupSyntheticCompany(target);
  }
});

/**
 * THE MECHANISM behind the defect pinned below — asserted, not assumed.
 *
 * Everything above compares the route with itself: a cursor the route issued,
 * handed back to the route. That is the right shape for a round-trip claim and
 * it is exactly why none of it can tell you what is broken. If the real cause
 * were something else entirely — a stray `>=`, a timezone, a lost tiebreak —
 * every test above would fail in precisely the same way and the diagnosis in
 * the comment below would be confident and wrong.
 *
 * So this one asks the DATABASE. Two facts, and the defect is the gap:
 *
 *   - the id the route issues is the row's `created_at` floored to a whole
 *     millisecond, and
 *   - `created_at` is a `timestamptz`, which keeps more than that.
 *
 * An id therefore names an instant its own row is strictly AFTER, so a cursor
 * built from it cannot exclude the row it came from, and the uuid tiebreak
 * that would have settled it is never reached. Change `eventId` to carry the
 * microseconds and this test goes red — correctly, because the write-up below
 * would then no longer describe the code.
 */
test("the id the route issues is the row's created_at, floored to a millisecond", async ({
  request,
}) => {
  const target = createSyntheticCompany("ZZRMEC");
  try {
    const before = cursorBeforeNow();
    const shares = nextShares();
    insertSyntheticTrade(target, { shares });

    // A sub-millisecond remainder that is there because we put it there.
    // `now()` supplies one ~999 times in 1000, and the thousandth run would
    // read as a flake rather than as the column's resolution having changed.
    psql(
      `UPDATE transactions
          SET created_at = date_trunc('milliseconds', created_at) + interval '500 microseconds'
        WHERE company_id = '${target.companyId}';`,
    );

    const issued = issuedIdFor((await pollFrom(request, before)).events, target.ticker, shares);

    // The independent source of truth: the row as Postgres actually holds it.
    const [rowId, exactMs] = psql(
      `SELECT id || '|' || (extract(epoch from created_at) * 1000)::numeric(30,3)
         FROM transactions WHERE company_id = '${target.companyId}';`,
    ).split("|");

    expect(issued, "the event id is this row's own created_at, floored to a millisecond").toBe(
      `${Math.floor(Number(exactMs))}:${rowId}`,
    );
    expect(
      Number(exactMs) % 1,
      "…and the column keeps precision below that floor, which is the entire defect",
    ).toBeGreaterThan(0);
  } finally {
    cleanupSyntheticCompany(target);
  }
});

/**
 * KNOWN DEFECT, PINNED — this test runs, fails, and is expected to.
 *
 * `test.fail()` is not a skip: every assertion below executes. It records that
 * the current answer is wrong, and turns the suite RED the moment the route is
 * fixed, so whoever fixes it is told to delete this annotation. The alternative
 * — asserting today's behaviour and calling it the contract — is how a bug
 * becomes a documented feature.
 *
 * ── WHAT IS WRONG ─────────────────────────────────────────────────────
 *
 * An event id is `${new Date(t.createdAt).getTime()}:${t.id}` — MILLISECONDS.
 * `transactions.created_at` is `timestamptz`, which Postgres stores to the
 * MICROSECOND, and `now()` fills those microseconds in. So the id issued for a
 * row created at 11:24:06.922265 is `…922`, and feeding it back produces
 *
 *     (created_at, id) > ('…922.000'::timestamptz, id::uuid)
 *
 * which is TRUE of the row itself: .922265 > .922000, and the id tiebreak is
 * never reached. Measured on the running server, resuming from a row's own id
 * returns that row again, every time:
 *
 *     resume from A → A, B, C      resume from B → B, C      resume from C → C
 *
 * Consequences, in order of how much they matter:
 *
 *   - `?mode=poll` never advances past the tail. A polling client re-fetches
 *     and re-emits the newest trade every 5 seconds, forever, and the
 *     "advance the cursor on an empty batch" branch in TradeStreamCore is
 *     unreachable because the batch is never empty.
 *   - SSE is worse than "once per reconnect". The in-window loop rebuilds the
 *     cursor from that same millisecond id every POLL_INTERVAL_MS, so the tail
 *     row is re-sent on EVERY 2.5s tick rather than once per window. Measured
 *     on the running server — one row, one window, TEN deliveries, at 13, 2549,
 *     5058, 7575, 10096, 12652, 15175, 17702, 20223 and 22743ms, then
 *     `window_end` at 25257ms and the whole thing again on reconnect.
 *   - Nothing above asserts that tenfold repeat: the @stream test is written
 *     with `toContain`, which cannot see a duplicate. A fix applied only to
 *     the poll branch would turn the tripwire below green while SSE stayed
 *     broken, so the fix belongs in `fetchSince`, which both paths share.
 *   - This app survives it because TradeStreamCore dedupes on `trade.id`.
 *     Nothing else does, and the fallback is a documented public shape.
 *
 * The fix has to make the comparison and the id agree on a resolution: either
 * compare against `date_trunc('milliseconds', created_at)` (and order by the
 * same, or the cursor stops being a total order), or carry the microseconds in
 * the id and pass them to Postgres losslessly. Both are route changes, not
 * test changes, which is why this file pins the bug instead of hiding it.
 */
test("a resume cursor at an already-consumed position returns no duplicates", async ({
  request,
}) => {
  test.fail();

  const target = createSyntheticCompany("ZZRTAI");
  try {
    const before = cursorBeforeNow();
    const tail = nextShares();
    insertSyntheticTrade(target, { shares: tail });

    // Pin the sub-millisecond remainder instead of trusting `now()` to supply
    // one. It does, ~999 times in 1000 — and a test that fails 999 times in
    // 1000 is a flake, not a finding.
    psql(
      `UPDATE transactions
          SET created_at = date_trunc('milliseconds', created_at) + interval '500 microseconds'
        WHERE company_id = '${target.companyId}';`,
    );

    const batch = await pollFrom(request, before);
    const issued = issuedIdFor(batch.events, target.ticker, tail);

    const again = await pollFrom(request, issued);
    expect(
      ourShares(again.events, target.ticker),
      "an event id fed back as a cursor must not return its own event",
    ).toEqual([]);
  } finally {
    cleanupSyntheticCompany(target);
  }
});
