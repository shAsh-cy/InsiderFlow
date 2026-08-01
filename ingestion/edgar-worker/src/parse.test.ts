import { describe, expect, it } from "vitest";

import { parseAccessionNumbersFromAtom } from "./parse";

const SAMPLE_ATOM = `<?xml version="1.0" encoding="ISO-8859-1"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Latest Filings - Form 4</title>
  <entry>
    <title>4 - DOE JANE (0001234567) (Reporting)</title>
    <link href="https://www.sec.gov/Archives/edgar/data/1234567/000123456726000123/0001234567-26-000123-index.htm"/>
  </entry>
  <entry>
    <title>4 - ACME CORP (0007654321) (Issuer)</title>
    <link href="https://www.sec.gov/Archives/edgar/data/7654321/000076543212600004/0000765432-26-000045-index.htm"/>
  </entry>
  <entry>
    <title>4/A - DOE JANE (0001234567) (Reporting)</title>
    <link href="https://www.sec.gov/Archives/edgar/data/1234567/000123456726000123/0001234567-26-000123-index.htm"/>
  </entry>
</feed>`;

describe("parseAccessionNumbersFromAtom", () => {
  it("extracts unique accession numbers", () => {
    const result = parseAccessionNumbersFromAtom(SAMPLE_ATOM);
    expect(result).toEqual(["0001234567-26-000123", "0000765432-26-000045"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(parseAccessionNumbersFromAtom("<feed></feed>")).toEqual([]);
  });
});
