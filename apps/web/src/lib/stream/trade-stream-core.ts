/**
 * Framework-free core of the live trade stream, implementing the real
 * /api/stream contract:
 *
 *  - SSE `trade` events with `id: <epochMs>:<uuid>`; the server closes each
 *    window after ~25s (`window_end` event, then EOF). EventSource
 *    auto-reconnects and the browser resends Last-Event-ID — so a window
 *    close must cause NO state change (no flicker, no buffer reset).
 *  - Events are deduped by trade id: reconnect replays are silently dropped.
 *  - If SSE keeps failing (or EventSource does not exist), we degrade to
 *    the documented `?mode=poll` JSON fallback with cursor continuation.
 *
 * The React hook is a thin wrapper; all behavior lives here so it can be
 * unit-tested without a DOM.
 */
import type { TradeRow } from "../api/queries";

export type StreamStatus = "connecting" | "live" | "polling";

export interface StreamSnapshot {
  trades: TradeRow[];
  status: StreamStatus;
  lastEventId: string | null;
}

/** Structural EventSource so tests can inject a fake. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEventLike) => void): void;
  close(): void;
}

export interface MessageEventLike {
  data?: string;
  lastEventId?: string;
}

export interface TradeStreamOptions {
  url?: string;
  /** Ring-buffer size, newest first. */
  maxItems?: number;
  /** Consecutive SSE errors (with no successful open between) before poll fallback. */
  maxSseFailures?: number;
  pollIntervalMs?: number;
  /** Returns null when EventSource is unavailable → poll mode immediately. */
  eventSourceFactory?: (url: string) => EventSourceLike | null;
  fetchFn?: typeof fetch;
  setIntervalFn?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (handle: ReturnType<typeof setInterval>) => void;
}

interface PollResponse {
  events?: Array<{ id: string; data: TradeRow }>;
  cursor?: string;
  retryMs?: number;
}

const defaultEventSourceFactory = (url: string): EventSourceLike | null =>
  typeof EventSource === "undefined" ? null : new EventSource(url);

export class TradeStreamCore {
  private readonly url: string;
  private readonly maxItems: number;
  private readonly maxSseFailures: number;
  private readonly pollIntervalMs: number;
  private readonly makeEventSource: (url: string) => EventSourceLike | null;
  private readonly fetchFn: typeof fetch;
  private readonly setIntervalFn: TradeStreamOptions["setIntervalFn"];
  private readonly clearIntervalFn: TradeStreamOptions["clearIntervalFn"];

  private eventSource: EventSourceLike | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private readonly seenIds = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private snapshot: StreamSnapshot = { trades: [], status: "connecting", lastEventId: null };
  private stopped = false;

  constructor(options: TradeStreamOptions = {}) {
    this.url = options.url ?? "/api/stream";
    this.maxItems = options.maxItems ?? 30;
    this.maxSseFailures = options.maxSseFailures ?? 3;
    this.pollIntervalMs = options.pollIntervalMs ?? 5000;
    this.makeEventSource = options.eventSourceFactory ?? defaultEventSourceFactory;
    this.fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
    this.setIntervalFn = options.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn = options.clearIntervalFn ?? ((h) => clearInterval(h));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StreamSnapshot => this.snapshot;

  start(): void {
    this.stopped = false;
    const es = this.makeEventSource(this.url);
    if (!es) {
      this.startPolling();
      return;
    }
    this.eventSource = es;

    es.addEventListener("open", () => {
      this.consecutiveFailures = 0;
      this.update({ status: "live" });
    });

    es.addEventListener("trade", (event) => {
      if (!event.data) return;
      try {
        this.push(JSON.parse(event.data) as TradeRow, event.lastEventId ?? null);
      } catch {
        // A malformed frame must never take the stream down.
      }
    });

    // The server ends every window with this event before closing; the
    // browser reconnects with Last-Event-ID on its own. State stays put —
    // this handler existing (and doing nothing) is the no-flicker contract.
    es.addEventListener("window_end", () => {});

    es.addEventListener("error", () => {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.maxSseFailures) {
        es.close();
        this.eventSource = null;
        this.startPolling();
      }
      // Below the threshold: EventSource retries by itself; keep state as-is.
    });
  }

  stop(): void {
    this.stopped = true;
    this.eventSource?.close();
    this.eventSource = null;
    if (this.pollHandle !== null) {
      this.clearIntervalFn?.(this.pollHandle);
      this.pollHandle = null;
    }
  }

  private startPolling(): void {
    if (this.stopped || this.pollHandle !== null) return;
    this.update({ status: "polling" });
    const tick = async (): Promise<void> => {
      try {
        const cursor = this.snapshot.lastEventId;
        const url = `${this.url}?mode=poll${cursor ? `&last_event_id=${encodeURIComponent(cursor)}` : ""}`;
        const response = await this.fetchFn(url, { headers: { Accept: "application/json" } });
        if (!response.ok) return;
        const payload = (await response.json()) as PollResponse;
        for (const event of payload.events ?? []) {
          this.push(event.data, event.id);
        }
        if (payload.cursor && (payload.events?.length ?? 0) === 0) {
          // Advance the cursor even on empty batches so we never re-scan.
          this.update({ lastEventId: payload.cursor });
        }
      } catch {
        // Transient poll failure — next tick retries.
      }
    };
    void tick();
    this.pollHandle = this.setIntervalFn!(() => void tick(), this.pollIntervalMs);
  }

  private push(trade: TradeRow, eventId: string | null): void {
    if (this.seenIds.has(trade.id)) {
      // Replay after reconnect — advance the cursor, change nothing else.
      if (eventId) this.update({ lastEventId: eventId });
      return;
    }
    this.seenIds.add(trade.id);
    if (this.seenIds.size > this.maxItems * 20) {
      // Bound memory: rebuild the seen-set from what is still displayed.
      this.seenIds.clear();
      for (const t of this.snapshot.trades) this.seenIds.add(t.id);
      this.seenIds.add(trade.id);
    }
    this.update({
      trades: [trade, ...this.snapshot.trades].slice(0, this.maxItems),
      lastEventId: eventId ?? this.snapshot.lastEventId,
    });
  }

  private update(patch: Partial<StreamSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
