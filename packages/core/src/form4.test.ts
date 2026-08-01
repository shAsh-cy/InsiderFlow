import { describe, expect, it } from "vitest";

import { SAMPLE_FORM4_XML } from "./fixtures/form4-sample";
import { parseOwnershipDocument } from "./form4";

describe("parseOwnershipDocument", () => {
  const doc = parseOwnershipDocument(SAMPLE_FORM4_XML);

  it("parses document metadata", () => {
    expect(doc.formType).toBe("4");
    expect(doc.periodOfReport).toBe("2026-07-30");
    expect(doc.affTenB51).toBe(true);
    expect(Object.keys(doc.footnotes)).toEqual(["F1", "F2", "F3", "F4"]);
  });

  it("parses the issuer with a zero-padded CIK", () => {
    expect(doc.issuer).toEqual({
      cik: "0000320193",
      name: "Apple Inc.",
      ticker: "AAPL",
    });
  });

  it("parses the reporting owner with normalized name and role flags", () => {
    expect(doc.owners).toHaveLength(1);
    expect(doc.owners[0]).toEqual({
      cik: "0001214156",
      name: "DOE JANE A",
      isDirector: true,
      isOfficer: true,
      isTenPercentOwner: false,
      officerTitle: "Chief Financial Officer",
    });
  });

  it("extracts transactions from both tables and ignores holdings rows", () => {
    expect(doc.transactions).toHaveLength(3);
    expect(doc.transactions.map((t) => t.code)).toEqual(["S", "P", "M"]);
    expect(doc.transactions.map((t) => t.isDerivative)).toEqual([false, false, true]);
  });

  it("normalizes the open-market sale (Table I row 1)", () => {
    const sale = doc.transactions[0]!;
    expect(sale.securityTitle).toBe("Common Stock");
    expect(sale.transactionDate).toBe("2026-07-30");
    expect(sale.shares).toBe(10_000);
    expect(sale.pricePerShare).toBe(228.4501);
    expect(sale.value).toBe(2_284_501);
    expect(sale.acquiredDisposed).toBe("D");
    expect(sale.sharesOwnedAfter).toBe(150_000);
    expect(sale.ownershipForm).toBe("D");
    expect(sale.footnote).toContain("Rule 10b5-1 trading plan");
    expect(sale.footnote).toContain("Weighted average sale price");
    expect(sale.isTenB51).toBe(true);
  });

  it("normalizes the indirect purchase (Table I row 2)", () => {
    const buy = doc.transactions[1]!;
    expect(buy.code).toBe("P");
    expect(buy.transactionDate).toBe("2026-07-29");
    expect(buy.shares).toBe(2500);
    expect(buy.pricePerShare).toBe(226.1);
    expect(buy.value).toBe(565_250);
    expect(buy.acquiredDisposed).toBe("A");
    expect(buy.ownershipForm).toBe("I");
    expect(buy.footnote).toContain("Doe Family Trust");
  });

  it("normalizes the derivative RSU conversion (Table II)", () => {
    const rsu = doc.transactions[2]!;
    expect(rsu.code).toBe("M");
    expect(rsu.isDerivative).toBe(true);
    expect(rsu.shares).toBe(2000);
    expect(rsu.pricePerShare).toBe(0);
    expect(rsu.value).toBe(0);
    expect(rsu.sharesOwnedAfter).toBe(78_000);
    expect(rsu.footnote).toContain("one-for-one basis");
  });

  it("detects 10b5-1 from footnote text when the checkbox is absent", () => {
    const withoutCheckbox = SAMPLE_FORM4_XML.replace(
      "<aff10b5One>1</aff10b5One>",
      "<aff10b5One>0</aff10b5One>",
    );
    const parsed = parseOwnershipDocument(withoutCheckbox);
    expect(parsed.affTenB51).toBe(false);
    // The sale references footnote F1 which mentions the plan; the others do not.
    expect(parsed.transactions.map((t) => t.isTenB51)).toEqual([true, false, false]);
  });

  it("rejects non-ownership XML", () => {
    expect(() => parseOwnershipDocument("<html><body>404</body></html>")).toThrow();
  });
});
