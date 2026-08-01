import { describe, expect, it } from "vitest";

import { classifyRelevance } from "./relevance";
import type { Relevance } from "./relevance";

/** Labeled fixture set: (case, expected) pairs the classifier must match. */
const LABELED_FIXTURES: Array<{
  label: string;
  input: { code: string; is10b51?: boolean };
  expected: Relevance;
}> = [
  { label: "open-market purchase", input: { code: "P" }, expected: "opportunistic" },
  { label: "discretionary sale", input: { code: "S" }, expected: "opportunistic" },
  { label: "10b5-1 planned sale", input: { code: "S", is10b51: true }, expected: "routine" },
  { label: "10b5-1 planned purchase", input: { code: "P", is10b51: true }, expected: "routine" },
  { label: "tax withholding", input: { code: "F" }, expected: "routine" },
  { label: "grant/award", input: { code: "A" }, expected: "routine" },
  { label: "bona fide gift", input: { code: "G" }, expected: "routine" },
  { label: "option exercise", input: { code: "M" }, expected: "routine" },
  { label: "conversion", input: { code: "C" }, expected: "routine" },
  { label: "in-the-money exercise", input: { code: "X" }, expected: "routine" },
  { label: "disposition to issuer", input: { code: "D" }, expected: "routine" },
  { label: "inheritance", input: { code: "W" }, expected: "routine" },
  { label: "tender in change of control", input: { code: "U" }, expected: "routine" },
  { label: "other/unknown code", input: { code: "J" }, expected: "routine" },
  { label: "lowercase input", input: { code: " p " }, expected: "opportunistic" },
];

describe("classifyRelevance", () => {
  it.each(LABELED_FIXTURES)("labels $label as $expected", ({ input, expected }) => {
    expect(classifyRelevance(input)).toBe(expected);
  });

  it("matches the full labeled fixture set", () => {
    const mismatches = LABELED_FIXTURES.filter(
      (f) => classifyRelevance(f.input) !== f.expected,
    ).map((f) => f.label);
    expect(mismatches).toEqual([]);
  });
});
