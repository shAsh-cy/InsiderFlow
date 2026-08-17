import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { constantTimeEquals } from "./constant-time";

describe("constantTimeEquals", () => {
  it("is true only for an exact match", () => {
    const secret = "5f4dcc3b5aa765d61d8327deb882cf99";
    expect(constantTimeEquals(secret, secret)).toBe(true);
    expect(constantTimeEquals(secret, secret.toUpperCase())).toBe(false);
    expect(constantTimeEquals(secret, `${secret} `)).toBe(false);
    expect(constantTimeEquals(secret, secret.slice(0, -1))).toBe(false);
    expect(constantTimeEquals("", secret)).toBe(false);
    expect(constantTimeEquals(secret, "")).toBe(false);
  });

  it("handles the empty-against-empty case without throwing", () => {
    // Reachable if a caller ever compares two unset values. It must answer
    // rather than crash — and the caller above refuses before it gets here.
    expect(constantTimeEquals("", "")).toBe(true);
  });

  it("compares values of different lengths without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch, which is why both
    // sides are hashed to a fixed width first. A guard that threw here
    // would turn a wrong secret into a 500 and a stack trace.
    expect(constantTimeEquals("a", "a".repeat(4096))).toBe(false);
    expect(constantTimeEquals("a".repeat(4096), "a")).toBe(false);
  });

  it("handles non-ASCII without a byte-length mismatch crashing it", () => {
    expect(constantTimeEquals("señor–🔑", "señor–🔑")).toBe(true);
    expect(constantTimeEquals("señor–🔑", "senor-🔑")).toBe(false);
  });

  /**
   * CONSTANT-TIME BY CONSTRUCTION, asserted on the source.
   *
   * Timing cannot be measured reliably in a unit test — a wall-clock
   * comparison on a shared CI runner is noise, and a test that fails one
   * run in twenty gets deleted. So the property is asserted structurally
   * instead: the implementation must go through `timingSafeEqual` and must
   * NOT contain the two constructs that would silently reintroduce the
   * leak — a `===`/`!==` between the operands, or an early return on
   * length.
   *
   * This catches the realistic regression, which is not someone breaking
   * the maths. It is someone "simplifying" the hashing away because two
   * strings can obviously be compared with `===`.
   */
  it("is built on timingSafeEqual, with no early return and no === on the operands", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "constant-time.ts"),
      "utf8",
    );
    // Comments explain the reasoning and legitimately mention `===`, so
    // they are stripped before the source is inspected.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code, "must use timingSafeEqual").toContain("timingSafeEqual");
    expect(code, "must not compare the operands directly").not.toMatch(/[!=]==/);
    expect(code, "must not branch on length").not.toMatch(/\.length/);
    // Both sides go through the same digest, so the comparison is always
    // over two fixed-width buffers whatever came in.
    expect(code).toMatch(/createHmac\(/);
  });
});
