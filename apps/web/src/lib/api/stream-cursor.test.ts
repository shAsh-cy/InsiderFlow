import { describe, expect, it } from "vitest";

import { parseCursor } from "./stream-cursor";

/**
 * The case this file exists for is `1e30`, which was a live 500 on
 * `GET /api/stream?mode=poll` for any unauthenticated caller. Everything
 * else here is the surrounding contract, asserted so the bound cannot be
 * loosened back without something going red.
 */
describe("parseCursor", () => {
  it("accepts a well-formed cursor", () => {
    expect(parseCursor("1700000000000:0f8fad5b-d9cb-469f-a165-70867728950e")).toEqual({
      epochMs: 1700000000000,
      id: "0f8fad5b-d9cb-469f-a165-70867728950e",
    });
  });

  it("accepts the epoch itself and the zero uuid the route issues", () => {
    expect(parseCursor("0:00000000-0000-0000-0000-000000000000")).toEqual({
      epochMs: 0,
      id: "00000000-0000-0000-0000-000000000000",
    });
  });

  // The defect. `Number.isFinite(1e30)` is true, so these parsed, and then
  // `new Date(1e30).toISOString()` threw RangeError inside the handler.
  it.each(["1e30", "-1e30", "8.64e15", "-8.64e15", "99999999999999999999"])(
    "refuses %s — finite is not the same as representable as a Date",
    (ms) => {
      const cursor = parseCursor(`${ms}:00000000-0000-0000-0000-000000000000`);
      expect(cursor).toBeNull();
    },
  );

  // The property behind the bound, stated as itself: whatever survives
  // parsing must be something Date can render. This is what a future
  // loosening has to keep true.
  it.each([
    "1e30",
    "-1e30",
    "1e400",
    "8.64e15",
    "1700000000000",
    "0",
    `${Date.now()}`,
    "not-a-number",
  ])("anything it returns for %s is a renderable Date", (ms) => {
    const cursor = parseCursor(`${ms}:00000000-0000-0000-0000-000000000000`);
    if (cursor === null) return;
    expect(() => new Date(cursor.epochMs).toISOString()).not.toThrow();
  });

  it("refuses a cursor far in the future but allows a little clock skew", () => {
    const zero = "00000000-0000-0000-0000-000000000000";
    expect(parseCursor(`${Date.now() + 3_600_000}:${zero}`)).toBeNull();
    expect(parseCursor(`${Date.now() + 5_000}:${zero}`)).not.toBeNull();
  });

  it.each([
    ["", "an empty string"],
    ["1700000000000", "no id"],
    ["1700000000000:", "an empty id"],
    ["1700000000000:not-a-uuid", "an id of the wrong shape"],
    ["abc:0f8fad5b-d9cb-469f-a165-70867728950e", "a non-numeric timestamp"],
    ["1e400:0f8fad5b-d9cb-469f-a165-70867728950e", "an overflow to Infinity"],
  ])("refuses %s (%s)", (raw) => {
    expect(parseCursor(raw)).toBeNull();
  });

  it("refuses a null header, which is how an absent one arrives", () => {
    expect(parseCursor(null)).toBeNull();
  });
});
