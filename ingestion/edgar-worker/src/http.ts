/**
 * Runtime-agnostic HTTP helpers (Cloudflare Workers + Node) with the retry
 * and rate-limit behavior the SEC fair-access policy requires.
 */

/** Minimal structural fetch so the pipeline runs on Workers, Node, and mocks. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchLikeResponse>;

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type Logger = (event: string, data?: Record<string, unknown>) => void;

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
