import { describe, expect, it } from "vitest";

import { MemoryRateLimiter } from "./rate-limit";

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
