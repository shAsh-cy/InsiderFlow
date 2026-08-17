/**
 * IP-based rate limiting with an API-key tier for heavier use.
 *
 * Backend: Upstash Redis (free tier) via plain REST when
 * UPSTASH_REDIS_REST_URL/TOKEN are set — otherwise a per-instance in-memory
 * fixed window. In-memory is per serverless instance, so treat the public
 * limit as per-instance-approximate; Upstash makes it global.
 */
import { checkOutboundUrl } from "@insiderflow/core";

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Epoch seconds when the current window resets. */
  resetAt: number;
}

const WINDOW_MS = 60_000;

/** Fixed-window counter used when no Redis is configured (and by tests). */
export class MemoryRateLimiter {
  private readonly windows = new Map<string, { windowStart: number; count: number }>();

  hit(key: string, limit: number, now = Date.now()): RateLimitResult {
    const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    const entry = this.windows.get(key);
    const count = entry && entry.windowStart === windowStart ? entry.count + 1 : 1;
    this.windows.set(key, { windowStart, count });
    if (this.windows.size > 10_000) this.prune(now);
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt: Math.ceil((windowStart + WINDOW_MS) / 1000),
    };
  }

  private prune(now: number): void {
    const current = Math.floor(now / WINDOW_MS) * WINDOW_MS;
    for (const [key, entry] of this.windows) {
      if (entry.windowStart !== current) this.windows.delete(key);
    }
  }
}

const globalStore = globalThis as unknown as { __insiderflowRateLimiter?: MemoryRateLimiter };
function memoryLimiter(): MemoryRateLimiter {
  globalStore.__insiderflowRateLimiter ??= new MemoryRateLimiter();
  return globalStore.__insiderflowRateLimiter;
}

/**
 * The limiter's own URL, checked once and remembered.
 *
 * ── WHY THE URL CHECK AND NOT THE GUARDED TRANSPORT ───────────────────
 *
 * `@insiderflow/core/ssrf-fetch` exists and does more than this: it pins
 * the resolved address at connect time and re-judges every redirect. It
 * is deliberately NOT used here, and the reason is the hot path. This
 * function runs on every rate-limited API request, and swapping undici
 * for a `node:https` request per call is a latency change to the busiest
 * code in the app, made for a threat that is not the one this call has.
 *
 * What this call actually risks is an operator setting
 * UPSTASH_REDIS_REST_URL to something wrong — `http://`, an address in
 * the metadata range, a URL with credentials in it — and shipping a
 * bearer token to it on every request. That is a URL-shaped problem and
 * `checkOutboundUrl` is the URL-shaped answer. It runs once per process
 * rather than once per request, so it costs nothing.
 *
 * The residual, stated: a host that passes the check and later resolves
 * to a private address is not caught here. It would be caught by the
 * guarded transport, and if this ever fetches something less hot than a
 * counter, that is the upgrade.
 */
export function upstashPipelineEndpoint(url: string): { endpoint: string } | { reason: string } {
  // The configured host is allowlisted, so the operator is agreeing with
  // themselves — a list compiled into `core` cannot know a per-deployment
  // Upstash hostname. Everything else `checkOutboundUrl` enforces still
  // applies, and that is the part with teeth here.
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return { reason: "UPSTASH_REDIS_REST_URL is not a valid absolute URL" };
  }
  const decision = checkOutboundUrl(url, [host]);
  if (!decision.allowed) return { reason: decision.reason };
  return { endpoint: `${decision.url.origin}${decision.url.pathname.replace(/\/$/, "")}/pipeline` };
}

/** Checked once per process, not once per request. */
let upstashEndpoint: string | null | undefined;
function resolveUpstashEndpoint(url: string): string | null {
  if (upstashEndpoint !== undefined) return upstashEndpoint;
  const result = upstashPipelineEndpoint(url);
  if ("reason" in result) {
    // Once, not per request: a limiter that logs on every call during a
    // misconfiguration is its own outage.
    console.error(`rate limiter: refusing UPSTASH_REDIS_REST_URL — ${result.reason}`);
    upstashEndpoint = null;
    return null;
  }
  upstashEndpoint = result.endpoint;
  return upstashEndpoint;
}

async function upstashHit(key: string, limit: number): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const endpoint = resolveUpstashEndpoint(url);
  if (!endpoint) return null; // fail open on misconfiguration, as on outage

  const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  const redisKey = `rl:${key}:${windowStart}`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["EXPIRE", redisKey, "90", "NX"],
      ]),
    });
    if (!response.ok) return null; // fail open on limiter outage
    const results = (await response.json()) as Array<{ result?: number }>;
    const count = Number(results[0]?.result ?? 1);
    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt: Math.ceil((windowStart + WINDOW_MS) / 1000),
    };
  } catch {
    return null; // fail open — availability over strictness for a public API
  }
}

/**
 * Who is asking, for limiting purposes: an API key when one is presented and
 * valid, otherwise the client IP. Exported so the SSE connection ceiling
 * buckets by exactly the same identity as the request-rate limiter — two
 * limiters disagreeing about who a caller is would be worse than one.
 */
export function rateLimitIdentity(req: Request): string {
  return clientId(req).key;
}

function clientId(req: Request): { key: string; limit: number } {
  const apiKey =
    req.headers.get("x-api-key") ?? new URL(req.url).searchParams.get("api_key") ?? null;
  const validKeys = (process.env.API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (apiKey && validKeys.includes(apiKey)) {
    return {
      key: `key:${apiKey}`,
      limit: Number(process.env.RATE_LIMIT_APIKEY_PER_MIN ?? 600),
    };
  }
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "anonymous";
  return { key: `ip:${ip}`, limit: Number(process.env.RATE_LIMIT_PUBLIC_PER_MIN ?? 60) };
}

export async function checkRateLimit(req: Request): Promise<RateLimitResult> {
  const { key, limit } = clientId(req);
  return (await upstashHit(key, limit)) ?? memoryLimiter().hit(key, limit);
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.resetAt),
  };
}
