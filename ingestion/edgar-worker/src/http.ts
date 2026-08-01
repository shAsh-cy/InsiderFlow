/**
 * Runtime-agnostic HTTP helpers (Cloudflare Workers + Node): retry with
 * backoff, rate limiting, and a DB-backed cache so free-tier API budgets
 * (Finnhub 60/min, FMP ~250/day) are never spent twice on the same request.
 */
import type { FetchLike, FetchLikeResponse, Logger } from "@insiderflow/core";
import { apiCache, eq } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

export type { FetchLike, FetchLikeResponse, Logger };

/** Structured JSON logs — one line per event, greppable in wrangler tail / CI. */
export const jsonLogger: Logger = (event, data = {}) => {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
};

export class EdgarHttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`EDGAR responded ${status} for ${url}`);
    this.name = "EdgarHttpError";
  }
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Enforces a minimum interval between sequential requests. */
export class RateLimiter {
  private nextAllowedAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const now = Date.now();
    const delay = this.nextAllowedAt - now;
    this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + this.minIntervalMs;
    if (delay > 0) await sleep(delay);
  }
}

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  log?: Logger;
}

/**
 * Fetch with exponential backoff on 429/403/5xx (the statuses EDGAR uses for
 * throttling). Honors Retry-After. Other errors (e.g. 404) throw immediately.
 */
export async function fetchWithRetry(
  fetchFn: FetchLike,
  url: string,
  headers: Record<string, string>,
  { retries = 3, baseDelayMs = 1000, log = jsonLogger }: RetryOptions = {},
): Promise<FetchLikeResponse> {
  for (let attempt = 0; ; attempt++) {
    const response = await fetchFn(url, { headers });
    if (response.ok) return response;

    const retryable = response.status === 429 || response.status === 403 || response.status >= 500;
    if (!retryable || attempt >= retries) {
      throw new EdgarHttpError(response.status, url);
    }

    const retryAfterSec = Number(response.headers.get("Retry-After"));
    const delayMs =
      Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 250);
    log("edgar_retry", { url, status: response.status, attempt: attempt + 1, delayMs });
    await sleep(delayMs);
  }
}

/** Mask credential query params so they never land in cache keys or logs. */
export function stripSecretParams(url: string): string {
  return url.replace(/([?&])(token|apikey|api_key)=[^&]*/gi, "$1$2=***");
}

export interface CachedFetchOptions {
  db: Database;
  /** Underlying transport; defaults to global fetch. */
  fetchFn?: FetchLike;
  /** How long successful responses stay fresh. */
  ttlSeconds: number;
  /** Applied only on cache misses. */
  limiter?: RateLimiter;
  log?: Logger;
}

const syntheticResponse = (status: number, body: string): FetchLikeResponse => ({
  ok: status >= 200 && status < 400,
  status,
  headers: { get: () => null },
  text: () => Promise.resolve(body),
});

/**
 * Wrap a fetch in the api_cache table: cache hits skip the network (and the
 * rate limiter) entirely; misses are rate-limited and stored on success.
 * Cache keys mask credentials, so API keys are never persisted.
 */
export function createCachedFetch(options: CachedFetchOptions): FetchLike {
  const base = options.fetchFn ?? (fetch as FetchLike);
  return async (url, init) => {
    const key = stripSecretParams(url);
    const [row] = await options.db.select().from(apiCache).where(eq(apiCache.key, key));
    if (row && row.expiresAt.getTime() > Date.now()) {
      const body = typeof row.payload.body === "string" ? row.payload.body : "";
      return syntheticResponse(200, body);
    }

    await options.limiter?.wait();
    const response = await base(url, init);
    if (!response.ok) return response;

    const body = await response.text();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + options.ttlSeconds * 1000);
    await options.db
      .insert(apiCache)
      .values({ key, payload: { body }, expiresAt, fetchedAt: now })
      .onConflictDoUpdate({
        target: apiCache.key,
        set: { payload: { body }, expiresAt, fetchedAt: now },
      });
    return syntheticResponse(response.status, body);
  };
}
