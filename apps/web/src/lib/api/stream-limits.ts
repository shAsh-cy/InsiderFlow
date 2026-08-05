/**
 * A ceiling on CONCURRENT SSE connections, which the request-rate limiter
 * cannot express.
 *
 * `/api/stream` is rate-limited per minute like every other route, and that
 * bounds how often a client may OPEN a stream — not how many it may hold. Each
 * connection occupies a serverless function for up to WINDOW_MS (25s), so a
 * caller well inside the request limit can still pin an unbounded number of
 * invocations simply by never closing them. On a free tier that is the whole
 * concurrency budget, and the failure looks like "the site is down" rather
 * than like abuse.
 *
 * Two ceilings, because they answer different questions:
 *
 *   PER IDENTITY — one caller must not be able to consume the pool. Low, and
 *                  generous enough for a few real tabs.
 *   GLOBAL       — the pool itself. Beyond it, refusing quickly is kinder than
 *                  accepting and degrading every other request on the box.
 *
 * Per instance, like the in-memory rate limiter: a global cap across a
 * horizontally scaled deployment would need shared state, and the honest
 * reading of the number is "per instance" (the same caveat .env.example makes
 * about RATE_LIMIT_* without Upstash).
 */

export interface StreamSlot {
  /** Idempotent: safe to call from both the abort handler and the finally. */
  release: () => void;
}

export interface StreamCapacity {
  global: number;
  perIdentity: number;
}

export function streamCapacity(): StreamCapacity {
  return {
    global: Number(process.env.SSE_MAX_CONCURRENT ?? 200),
    perIdentity: Number(process.env.SSE_MAX_CONCURRENT_PER_IP ?? 4),
  };
}

/**
 * The counter itself. A class rather than module-level state so tests can
 * exercise it without reaching into a singleton — the singleton below is a
 * thin wrapper over one instance.
 */
export class StreamConnectionLimiter {
  private total = 0;
  private readonly perIdentity = new Map<string, number>();

  constructor(private readonly capacity: StreamCapacity) {}

  /** Current holders, for tests and for the response headers. */
  get open(): number {
    return this.total;
  }

  openFor(identity: string): number {
    return this.perIdentity.get(identity) ?? 0;
  }

  /**
   * Take a slot, or null when full.
   *
   * Returning null rather than throwing keeps the caller's decision explicit:
   * this is a 503 with Retry-After, not an error.
   */
  acquire(identity: string): StreamSlot | null {
    const mine = this.perIdentity.get(identity) ?? 0;
    if (this.total >= this.capacity.global) return null;
    if (mine >= this.capacity.perIdentity) return null;

    this.total++;
    this.perIdentity.set(identity, mine + 1);

    let released = false;
    return {
      release: () => {
        // A stream can end by abort AND by its own finally block. Double
        // release would drift the counter down until the ceiling never
        // applied — the exact bug that makes a limiter look like it works.
        if (released) return;
        released = true;
        this.total = Math.max(0, this.total - 1);
        const next = (this.perIdentity.get(identity) ?? 1) - 1;
        if (next <= 0) this.perIdentity.delete(identity);
        else this.perIdentity.set(identity, next);
      },
    };
  }
}

const store = globalThis as unknown as { __insiderflowStreamLimiter?: StreamConnectionLimiter };

/** Process-wide limiter, surviving HMR in dev the same way getDb() does. */
export function streamLimiter(): StreamConnectionLimiter {
  store.__insiderflowStreamLimiter ??= new StreamConnectionLimiter(streamCapacity());
  return store.__insiderflowStreamLimiter;
}

/** Seconds a refused client should wait — just past one stream window. */
export const STREAM_RETRY_AFTER_SECONDS = 30;
