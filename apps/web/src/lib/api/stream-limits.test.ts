import { describe, expect, it } from "vitest";

import { StreamConnectionLimiter } from "./stream-limits";

const limiter = (global: number, perIdentity: number) =>
  new StreamConnectionLimiter({ global, perIdentity });

describe("SSE connection ceiling", () => {
  it("lets one client hold up to its share and no more", () => {
    const l = limiter(100, 3);
    const slots = [l.acquire("ip:1"), l.acquire("ip:1"), l.acquire("ip:1")];
    expect(slots.every(Boolean)).toBe(true);
    expect(l.openFor("ip:1")).toBe(3);
    expect(l.acquire("ip:1"), "the fourth must be refused").toBeNull();
  });

  it("does not let one client consume the whole pool", () => {
    // The point of a per-identity cap: a single caller opening connections in
    // a loop must not be able to starve everyone else off the instance.
    const l = limiter(10, 2);
    l.acquire("ip:noisy");
    l.acquire("ip:noisy");
    expect(l.acquire("ip:noisy")).toBeNull();
    expect(l.acquire("ip:someone-else"), "an unrelated client is unaffected").not.toBeNull();
  });

  it("refuses everyone once the global pool is full", () => {
    const l = limiter(2, 5);
    expect(l.acquire("ip:a")).not.toBeNull();
    expect(l.acquire("ip:b")).not.toBeNull();
    expect(l.acquire("ip:c"), "global cap outranks the per-client allowance").toBeNull();
  });

  it("frees the slot on release", () => {
    const l = limiter(100, 1);
    const first = l.acquire("ip:1")!;
    expect(l.acquire("ip:1")).toBeNull();
    first.release();
    expect(l.openFor("ip:1")).toBe(0);
    expect(l.acquire("ip:1")).not.toBeNull();
  });

  it("ignores a double release", () => {
    // A stream can end by client abort AND by its own finally block. Counting
    // that twice would drift the counter below zero until the ceiling stopped
    // applying at all — a limiter that looks present and enforces nothing.
    const l = limiter(2, 2);
    const slot = l.acquire("ip:1")!;
    slot.release();
    slot.release();
    slot.release();
    expect(l.open).toBe(0);
    expect(l.acquire("ip:1")).not.toBeNull();
    expect(l.acquire("ip:1")).not.toBeNull();
    expect(l.acquire("ip:1"), "capacity must still be 2, not 5").toBeNull();
  });

  it("forgets a client once it has no connections left", () => {
    const l = limiter(100, 2);
    const slot = l.acquire("ip:transient")!;
    expect(l.openFor("ip:transient")).toBe(1);
    slot.release();
    // Not merely zero — the entry is gone, so the map cannot grow without
    // bound across every IP that ever connected.
    expect(l.openFor("ip:transient")).toBe(0);
  });
});
