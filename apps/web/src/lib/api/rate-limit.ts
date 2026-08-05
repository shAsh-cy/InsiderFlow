/**
 * IP-based rate limiting with an API-key tier for heavier use.
 *
 * Backend: Upstash Redis (free tier) via plain REST when
 * UPSTASH_REDIS_REST_URL/TOKEN are set — otherwise a per-instance in-memory
 * fixed window. In-memory is per serverless instance, so treat the public
 * limit as per-instance-approximate; Upstash makes it global.
 */

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

async function upstashHit(key: string, limit: number): Promise<RateLimitResult | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const windowStart = Math.floor(Date.now() / WINDOW_MS) * WINDOW_MS;
  const redisKey = `rl:${key}:${windowStart}`;
  try {
    const response = await fetch(`${url}/pipeline`, {
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
