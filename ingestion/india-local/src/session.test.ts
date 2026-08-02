import { describe, expect, it } from "vitest";

import { NSE_PRIME_URL } from "@insiderflow/core";
import { RateLimiter } from "@insiderflow/edgar-worker/http";

import { NseSession } from "./session";
import type { SessionFetch, SessionResponse } from "./session";

function response(status: number, body: string, setCookies: string[] = []): SessionResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null, getSetCookie: () => setCookies },
    text: () => Promise.resolve(body),
  };
}

describe("NseSession", () => {
  it("primes cookies before the first API call and sends them", async () => {
    const seen: Array<{ url: string; cookie: string | undefined }> = [];
    const fetchMock: SessionFetch = (url, init) => {
      seen.push({ url, cookie: init?.headers?.Cookie });
      if (url === NSE_PRIME_URL) {
        return Promise.resolve(
          response(200, "<html/>", ["nsit=abc; Path=/", "nseappid=xyz; Path=/"]),
        );
      }
      return Promise.resolve(response(200, '{"data":[{"symbol":"X"}]}'));
    };

    const session = new NseSession(fetchMock, new RateLimiter(0), () => {});
    const payload = await session.getJson<{ data: unknown[] }>(
      "https://www.nseindia.com/api/corporates-pit?x=1",
      NSE_PRIME_URL,
    );
    expect(payload.data).toHaveLength(1);
    expect(session.primeCount).toBe(1);
    expect(seen[0]!.url).toBe(NSE_PRIME_URL);
    expect(seen[1]!.cookie).toBe("nsit=abc; nseappid=xyz");
  });

  it("recovers from 403 by re-priming once, then succeeds", async () => {
    let apiCalls = 0;
    const fetchMock: SessionFetch = (url) => {
      if (url === NSE_PRIME_URL) {
        return Promise.resolve(response(200, "<html/>", ["bm_sv=fresh; Path=/"]));
      }
      apiCalls++;
      // First API attempt is rejected (stale/blocked session), second works.
      return apiCalls === 1
        ? Promise.resolve(response(403, "Access Denied"))
        : Promise.resolve(response(200, '{"data":[]}'));
    };

    const session = new NseSession(fetchMock, new RateLimiter(0), () => {});
    const payload = await session.getJson<{ data: unknown[] }>(
      "https://www.nseindia.com/api/corporates-pit?x=1",
      NSE_PRIME_URL,
    );
    expect(payload.data).toEqual([]);
    expect(session.primeCount).toBe(2); // initial prime + the 403 re-prime
    expect(apiCalls).toBe(2);
  });

  it("throws when the API keeps failing after the re-prime", async () => {
    const fetchMock: SessionFetch = (url) =>
      url === NSE_PRIME_URL
        ? Promise.resolve(response(200, "<html/>", ["c=1; Path=/"]))
        : Promise.resolve(response(403, "Access Denied"));
    const session = new NseSession(fetchMock, new RateLimiter(0), () => {});
    await expect(session.getJson("https://www.nseindia.com/api/x", NSE_PRIME_URL)).rejects.toThrow(
      /NSE responded 403/,
    );
  });

  it("stays under 3 req/s across prime + API calls", async () => {
    const timestamps: number[] = [];
    const fetchMock: SessionFetch = (url) => {
      timestamps.push(Date.now());
      return url === NSE_PRIME_URL
        ? Promise.resolve(response(200, "<html/>", ["c=1; Path=/"]))
        : Promise.resolve(response(200, '{"data":[]}'));
    };
    // Real spacing (350ms) — prime + 3 API calls = 4 requests.
    const session = new NseSession(fetchMock, new RateLimiter(350), () => {});
    await session.getJson("https://www.nseindia.com/api/a", NSE_PRIME_URL);
    await session.getJson("https://www.nseindia.com/api/b", NSE_PRIME_URL);
    await session.getJson("https://www.nseindia.com/api/c", NSE_PRIME_URL);
    const elapsed = timestamps[timestamps.length - 1]! - timestamps[0]!;
    // 4 requests spaced ≥350ms → ≥1050ms total → ≤ ~2.9 req/s.
    expect(elapsed).toBeGreaterThanOrEqual(1000);
  });
});
