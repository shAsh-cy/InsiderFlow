import { describe, expect, it } from "vitest";

import {
  formatCompact,
  formatDualCurrency,
  formatIndianCompact,
  formatMoney,
  formatPct,
  timeAgo,
} from "./format";

describe("formatCompact", () => {
  it("uses Western compact suffixes", () => {
    expect(formatCompact(2_790_000)).toBe("2.79M");
    expect(formatCompact(1_234)).toBe("1.23K");
    expect(formatCompact(950)).toBe("950");
    expect(formatCompact(3_150_000_000)).toBe("3.15B");
    expect(formatCompact(-42_000)).toBe("-42K");
  });
});

describe("formatIndianCompact", () => {
  it("uses lakh/crore notation", () => {
    expect(formatIndianCompact(245_000_000)).toBe("24.5 Cr");
    expect(formatIndianCompact(10_000_000)).toBe("1 Cr");
    expect(formatIndianCompact(320_000)).toBe("3.2 L");
    expect(formatIndianCompact(99_999)).toBe("99,999");
  });
});

describe("formatDualCurrency", () => {
  it("renders INR as native crore plus USD", () => {
    expect(formatDualCurrency(245_000_000, "INR", 2_793_000)).toBe("₹24.5 Cr · $2.79M");
  });

  it("collapses USD-native trades to one figure", () => {
    expect(formatDualCurrency(565_250, "USD", 565_250)).toBe("$565.25K");
  });

  it("degrades when only one side is known", () => {
    expect(formatDualCurrency(245_000_000, "INR", null)).toBe("₹24.5 Cr");
    expect(formatDualCurrency(null, "INR", 2_793_000)).toBe("$2.79M");
  });

  it("returns null for fully undisclosed values (NotDisclosed treatment)", () => {
    expect(formatDualCurrency(null, "INR", null)).toBeNull();
    expect(formatDualCurrency(null, "USD", null)).toBeNull();
  });
});

describe("formatMoney / formatPct / timeAgo", () => {
  it("formats money by market", () => {
    expect(formatMoney(245_000_000, "INR")).toBe("₹24.5 Cr");
    expect(formatMoney(2_790_000, "USD")).toBe("$2.79M");
  });

  it("signs percentages", () => {
    expect(formatPct(4.2)).toBe("+4.2%");
    expect(formatPct(-2.75, 2)).toBe("-2.75%");
  });

  it("renders relative timestamps", () => {
    const now = new Date("2026-08-02T12:00:00Z");
    expect(timeAgo("2026-08-02T11:59:58Z", now)).toBe("just now");
    expect(timeAgo("2026-08-02T11:58:30Z", now)).toBe("1m ago");
    expect(timeAgo("2026-08-02T09:00:00Z", now)).toBe("3h ago");
    expect(timeAgo("2026-07-30T12:00:00Z", now)).toBe("3d ago");
  });
});
