/**
 * The real /api/stream contract, tested against a fake EventSource:
 * window closes must not mutate state, replays dedupe by id, repeated
 * failures fall back to mode=poll with cursor continuation.
 */
import { describe, expect, it, vi } from "vitest";

import type { TradeRow } from "../api/queries";
import { TradeStreamCore } from "./trade-stream-core";
import type { EventSourceLike, MessageEventLike } from "./trade-stream-core";

class FakeEventSource implements EventSourceLike {
  listeners = new Map<string, Array<(event: MessageEventLike) => void>>();
  closed = false;

  addEventListener(type: string, listener: (event: MessageEventLike) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: MessageEventLike = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const trade = (id: string, ticker = "AAPL"): TradeRow =>
  ({
    id,
    source: "edgar",
    market: "US",
    txnDate: "2026-07-30",
    code: "P",
    rawCode: "P",
    direction: "buy",
    relevance: "opportunistic",
    signalWeight: 1,
    shares: 100,
    price: 10,
    value: 1000,
    currency: "USD",
    priceUsd: 10,
    valueUsd: 1000,
    acquiredDisposed: "A",
    sharesOwnedAfter: null,
    is10b51: false,
    isDerivative: false,
    footnote: null,
    createdAt: "2026-08-02T10:00:00.000Z",
    company: { id: "c", ticker, name: ticker },
    insider: {
      id: "i",
      name: "DOE JANE A",
      title: null,
      isDirector: false,
      isOfficer: false,
      isTenPctOwner: false,
    },
    filing: null,
  }) as TradeRow;

const frame = (t: TradeRow, eventId: string): MessageEventLike => ({
  data: JSON.stringify(t),
  lastEventId: eventId,
});

function make(overrides: Partial<ConstructorParameters<typeof TradeStreamCore>[0]> = {}) {
  const es = new FakeEventSource();
  const core = new TradeStreamCore({
    eventSourceFactory: () => es,
    maxItems: 3,
    ...overrides,
  });
  return { es, core };
}

describe("TradeStreamCore over SSE", () => {
  it("collects trade events newest-first, capped at maxItems", () => {
    const { es, core } = make();
    core.start();
    es.emit("open");
    for (let i = 1; i <= 5; i++) es.emit("trade", frame(trade(`t${i}`), `${i}:t${i}`));
    const snapshot = core.getSnapshot();
    expect(snapshot.status).toBe("live");
    expect(snapshot.trades.map((t) => t.id)).toEqual(["t5", "t4", "t3"]);
    expect(snapshot.lastEventId).toBe("5:t5");
  });

  it("keeps state identical across a window close + reconnect replay (no flicker)", () => {
    const { es, core } = make();
    core.start();
    es.emit("open");
    es.emit("trade", frame(trade("t1"), "1:t1"));
    const before = core.getSnapshot();

    // Server ends the window; the browser reconnects and replays t1.
    es.emit("window_end", { data: '{"reconnect":true}' });
    es.emit("error"); // transient close event surfaced by EventSource
    expect(core.getSnapshot().trades).toBe(before.trades); // same array — zero re-render churn
    es.emit("open");
    es.emit("trade", frame(trade("t1"), "1:t1")); // replayed frame

    const after = core.getSnapshot();
    expect(after.trades.map((t) => t.id)).toEqual(["t1"]); // deduped
    expect(after.status).toBe("live");
  });

  it("a successful open resets the failure counter", () => {
    const { es, core } = make({ maxSseFailures: 3 });
    core.start();
    es.emit("error");
    es.emit("error");
    es.emit("open"); // recovered — counter resets
    es.emit("error");
    es.emit("error");
    expect(core.getSnapshot().status).toBe("live");
    expect(es.closed).toBe(false);
  });
});

describe("poll fallback", () => {
  it("switches to mode=poll after repeated SSE failures and continues the cursor", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            events: [{ id: "7:t7", event: "trade", data: trade("t7") }],
            cursor: "7:t7",
            retryMs: 5000,
          }),
      })
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ events: [], cursor: "7:t7", retryMs: 5000 }),
      });

    const intervals: Array<() => void> = [];
    const { es, core } = make({
      maxSseFailures: 2,
      fetchFn: fetchMock as unknown as typeof fetch,
      setIntervalFn: (fn) => {
        intervals.push(fn);
        return 0 as unknown as ReturnType<typeof setInterval>;
      },
      clearIntervalFn: () => {},
    });
    core.start();
    es.emit("error");
    es.emit("error"); // threshold reached → close SSE, start polling

    expect(es.closed).toBe(true);
    expect(core.getSnapshot().status).toBe("polling");
    await vi.waitFor(() => {
      expect(core.getSnapshot().trades.map((t) => t.id)).toEqual(["t7"]);
    });
    expect(core.getSnapshot().lastEventId).toBe("7:t7");

    // Next tick polls with the cursor.
    intervals[0]!();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1]![0])).toContain("mode=poll&last_event_id=7%3At7");
  });

  it("polls immediately when EventSource is unavailable", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ events: [], cursor: "0:x", retryMs: 5000 }),
    });
    const core = new TradeStreamCore({
      eventSourceFactory: () => null,
      fetchFn: fetchMock as unknown as typeof fetch,
      setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
      clearIntervalFn: () => {},
    });
    core.start();
    expect(core.getSnapshot().status).toBe("polling");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });
});
