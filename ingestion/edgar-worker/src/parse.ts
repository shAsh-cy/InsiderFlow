import { normalizeAccessionNumber } from "@insiderflow/core";

/**
 * Extract unique accession numbers from an EDGAR "current events" Atom feed.
 * The feed embeds them as 0001234567-26-000123 in entry links and titles.
 */
export function parseAccessionNumbersFromAtom(atomXml: string): string[] {
  const matches = atomXml.match(/\d{10}-\d{2}-\d{6}/g) ?? [];
  const unique = new Set(matches.map((raw) => normalizeAccessionNumber(raw)));
  return [...unique];
}
