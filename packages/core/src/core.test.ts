import { describe, expect, it } from "vitest";

import {
  classifyTransaction,
  edgarFilingIndexUrl,
  isSecTransactionCode,
  normalizeAccessionNumber,
  normalizeCik,
  normalizeInsiderName,
  parseFilingNumber,
  SEC_TRANSACTION_CODES,
  signalWeight,
  TRANSACTION_SIGNAL_WEIGHTS,
} from "./index";

describe("transaction codes", () => {
  it("knows all 20 SEC Form 4 codes", () => {
    expect(Object.keys(SEC_TRANSACTION_CODES)).toHaveLength(20);
  });

  it("recognizes valid and invalid codes", () => {
    expect(isSecTransactionCode("P")).toBe(true);
    expect(isSecTransactionCode("Q")).toBe(false);
  });

  it("classifies buys, sells, and neutral codes", () => {
    expect(classifyTransaction("P")).toBe("buy");
    expect(classifyTransaction("M")).toBe("buy");
    expect(classifyTransaction("S")).toBe("sell");
    expect(classifyTransaction("F")).toBe("sell");
    expect(classifyTransaction("G")).toBe("neutral");
    expect(classifyTransaction("??")).toBe("neutral");
    expect(classifyTransaction(" s ")).toBe("sell");
  });
});

describe("signal weights", () => {
  it("covers every transaction code", () => {
    expect(Object.keys(TRANSACTION_SIGNAL_WEIGHTS).sort()).toEqual(
      Object.keys(SEC_TRANSACTION_CODES).sort(),
    );
  });

  it("anchors open-market trades at full weight", () => {
    expect(signalWeight("P")).toBe(1);
    expect(signalWeight("S")).toBe(-1);
  });

  it("stays within [-1, 1] and agrees in sign with classifyTransaction", () => {
    for (const [code, weight] of Object.entries(TRANSACTION_SIGNAL_WEIGHTS)) {
      expect(Math.abs(weight)).toBeLessThanOrEqual(1);
      const direction = classifyTransaction(code);
      if (direction === "buy") expect(weight).toBeGreaterThan(0);
      if (direction === "sell") expect(weight).toBeLessThan(0);
      if (direction === "neutral") expect(weight).toBe(0);
    }
  });

  it("weighs unknown codes at 0", () => {
    expect(signalWeight("Q")).toBe(0);
    expect(signalWeight("")).toBe(0);
  });
});

describe("normalizeInsiderName", () => {
  it("collapses whitespace and uppercases", () => {
    expect(normalizeInsiderName("  Smith   John a ")).toBe("SMITH JOHN A");
  });

  it("strips trailing punctuation", () => {
    expect(normalizeInsiderName("MUSK ELON,")).toBe("MUSK ELON");
  });
});

describe("normalizeCik", () => {
  it("zero-pads to 10 digits", () => {
    expect(normalizeCik(320193)).toBe("0000320193");
    expect(normalizeCik("320193")).toBe("0000320193");
  });

  it("rejects garbage", () => {
    expect(() => normalizeCik("")).toThrow();
    expect(() => normalizeCik("123456789012")).toThrow();
  });
});

describe("normalizeAccessionNumber", () => {
  it("formats 18 digits with dashes", () => {
    expect(normalizeAccessionNumber("000032019326000012")).toBe("0000320193-26-000012");
    expect(normalizeAccessionNumber("0000320193-26-000012")).toBe("0000320193-26-000012");
  });

  it("rejects wrong lengths", () => {
    expect(() => normalizeAccessionNumber("12345")).toThrow();
  });
});

describe("edgarFilingIndexUrl", () => {
  it("builds the archive directory URL", () => {
    expect(edgarFilingIndexUrl(320193, "0000320193-26-000012")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019326000012/",
    );
  });
});

describe("parseFilingNumber", () => {
  it("parses formatted filing numbers", () => {
    expect(parseFilingNumber("1,234.56")).toBe(1234.56);
    expect(parseFilingNumber("$12.00")).toBe(12);
  });

  it("returns null for missing or invalid values", () => {
    expect(parseFilingNumber(null)).toBeNull();
    expect(parseFilingNumber(undefined)).toBeNull();
    expect(parseFilingNumber("")).toBeNull();
    expect(parseFilingNumber("n/a")).toBeNull();
  });
});
