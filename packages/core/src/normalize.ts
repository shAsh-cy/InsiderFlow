/**
 * Normalization helpers for turning raw filing data (EDGAR today, other
 * markets later) into canonical values used across the database and UI.
 */

/** Collapse whitespace and uppercase so the same insider matches across filings. */
export function normalizeInsiderName(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/[,.]+$/g, "")
    .trim()
    .toUpperCase();
}

/** SEC CIKs are canonically 10-digit zero-padded strings. */
export function normalizeCik(raw: string | number): string {
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 10) {
    throw new Error(`Invalid CIK: ${String(raw)}`);
  }
  return digits.padStart(10, "0");
}

/** Canonical accession number format: 0001234567-26-000123. */
export function normalizeAccessionNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length !== 18) {
    throw new Error(`Invalid accession number: ${raw}`);
  }
  return `${digits.slice(0, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
}

/** Directory listing URL for a filing on EDGAR. */
export function edgarFilingIndexUrl(cik: string | number, accessionNumber: string): string {
  const cikNoPad = Number(normalizeCik(cik));
  const accession = normalizeAccessionNumber(accessionNumber).replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNoPad}/${accession}/`;
}

/** Parse numbers as they appear in filings ("1,234.56", "$12.00", ""). Returns null when absent/invalid. */
export function parseFilingNumber(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned.length === 0) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
