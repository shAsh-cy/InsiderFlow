/**
 * Shared API plumbing: rate limiting, Zod validation errors, per-endpoint
 * edge-cache headers (s-maxage + stale-while-revalidate), and ETag/304.
 */
import { createHash } from "node:crypto";
import { ZodError } from "zod";

import { checkRateLimit, rateLimitHeaders } from "./rate-limit";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface CachePolicy {
  sMaxAge: number;
  staleWhileRevalidate: number;
}

/** Per-endpoint TTLs, tuned to how fast the underlying data moves. */
export const CACHE_POLICIES = {
  trades: { sMaxAge: 60, staleWhileRevalidate: 300 },
  company: { sMaxAge: 300, staleWhileRevalidate: 1800 },
  sentiment: { sMaxAge: 600, staleWhileRevalidate: 3600 },
  insider: { sMaxAge: 300, staleWhileRevalidate: 1800 },
  screener: { sMaxAge: 120, staleWhileRevalidate: 600 },
  heatmap: { sMaxAge: 300, staleWhileRevalidate: 1800 },
  politicians: { sMaxAge: 3600, staleWhileRevalidate: 86_400 },
  // Rebuilt once a night, so a long TTL costs nothing in freshness.
  leaderboard: { sMaxAge: 3600, staleWhileRevalidate: 86_400 },
  rss: { sMaxAge: 300, staleWhileRevalidate: 900 },
  openapi: { sMaxAge: 3600, staleWhileRevalidate: 86_400 },
} satisfies Record<string, CachePolicy>;

export function searchParamsToObject(searchParams: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of searchParams.entries()) {
    if (!(key in out)) out[key] = value;
  }
  return out;
}

export type ApiPayload = { json: unknown } | { body: string; contentType: string };

/**
 * Wrap a route handler with the shared behavior. The handler returns either
 * `{ json }` or `{ body, contentType }` (RSS/XML); everything else — 429s,
 * 400s from Zod, ETag revalidation, cache and CORS headers — happens here.
 */
export async function handleApi(
  req: Request,
  cache: CachePolicy | null,
  handler: () => Promise<ApiPayload>,
): Promise<Response> {
  const rate = await checkRateLimit(req);
  const baseHeaders: Record<string, string> = {
    ...rateLimitHeaders(rate),
    "Access-Control-Allow-Origin": "*",
  };
  if (!rate.allowed) {
    return Response.json(
      {
        error: {
          code: "rate_limited",
          message: "Rate limit exceeded. Add an API key for higher limits.",
        },
      },
      {
        status: 429,
        headers: {
          ...baseHeaders,
          "Retry-After": String(Math.max(1, rate.resetAt - Math.floor(Date.now() / 1000))),
        },
      },
    );
  }

  let payload: ApiPayload;
  try {
    payload = await handler();
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        {
          error: {
            code: "bad_request",
            message: "Invalid query parameters",
            issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          },
        },
        { status: 400, headers: baseHeaders },
      );
    }
    if (error instanceof ApiError) {
      return Response.json(
        { error: { code: error.status === 404 ? "not_found" : "error", message: error.message } },
        { status: error.status, headers: baseHeaders },
      );
    }
    console.error("api_error", error);
    return Response.json(
      { error: { code: "internal", message: "Internal server error" } },
      { status: 500, headers: baseHeaders },
    );
  }

  const body = "json" in payload ? JSON.stringify(payload.json) : payload.body;
  const contentType = "json" in payload ? "application/json; charset=utf-8" : payload.contentType;

  const etag = `W/"${createHash("sha1").update(body).digest("base64url")}"`;
  const headers: Record<string, string> = {
    ...baseHeaders,
    "Content-Type": contentType,
    ETag: etag,
    "Cache-Control": cache
      ? `public, max-age=0, s-maxage=${cache.sMaxAge}, stale-while-revalidate=${cache.staleWhileRevalidate}`
      : "no-store",
  };

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}
