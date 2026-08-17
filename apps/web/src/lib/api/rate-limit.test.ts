import { describe, expect, it } from "vitest";

import { MemoryRateLimiter, upstashPipelineEndpoint } from "./rate-limit";

/**
 * The limiter ships a bearer token to whatever UPSTASH_REDIS_REST_URL
 * says, on every rate-limited request. A typo in that variable is a
 * credential delivery to somewhere unintended, which is why the URL is
 * judged before it is used rather than interpolated straight into a
 * template string.
 */
describe("upstashPipelineEndpoint", () => {
  it("builds the pipeline URL for a well-formed endpoint", () => {
    expect(upstashPipelineEndpoint("https://eu1-cute-name-12345.upstash.io")).toEqual({
      endpoint: "https://eu1-cute-name-12345.upstash.io/pipeline",
    });
  });

  it("does not double the slash on a URL that already has a trailing one", () => {
    expect(upstashPipelineEndpoint("https://eu1-x.upstash.io/")).toEqual({
      endpoint: "https://eu1-x.upstash.io/pipeline",
    });
  });

  it.each([
    ["http://eu1-x.upstash.io", "plaintext, which would put the token on the wire"],
    ["https://169.254.169.254", "the cloud metadata service"],
    ["https://127.0.0.1:8080", "loopback on another port"],
    ["https://10.0.0.5", "a private address"],
    ["https://[::1]", "IPv6 loopback"],
    ["https://user:pass@eu1-x.upstash.io", "credentials in the URL"],
    ["https://eu1-x.upstash.io:6379", "a non-default port"],
    ["eu1-x.upstash.io", "no scheme at all"],
    ["", "unset-but-present"],
  ])("refuses %s (%s)", (url) => {
    const result = upstashPipelineEndpoint(url);
    expect("reason" in result, `${url} must be refused`).toBe(true);
  });
});

describe("MemoryRateLimiter", () => {
  it("allows up to the limit within a window, then blocks", () => {
    const limiter = new MemoryRateLimiter();
    const now = 1_700_000_000_000;
    for (let i = 1; i <= 3; i++) {
      const result = limiter.hit("ip:1.2.3.4", 3, now + i);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(3 - i);
    }
    const blocked = limiter.hit("ip:1.2.3.4", 3, now + 10);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt).toBeGreaterThan(Math.floor(now / 1000));
  });

  it("tracks keys independently", () => {
    const limiter = new MemoryRateLimiter();
    const now = 1_700_000_000_000;
    limiter.hit("ip:a", 1, now);
    expect(limiter.hit("ip:a", 1, now + 1).allowed).toBe(false);
    expect(limiter.hit("ip:b", 1, now + 2).allowed).toBe(true);
  });

  it("resets in a new window", () => {
    const limiter = new MemoryRateLimiter();
    const now = 1_700_000_000_000;
    limiter.hit("ip:a", 1, now);
    expect(limiter.hit("ip:a", 1, now + 1).allowed).toBe(false);
    expect(limiter.hit("ip:a", 1, now + 61_000).allowed).toBe(true);
  });
});
