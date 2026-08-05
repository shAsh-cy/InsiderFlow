/**
 * SEC Standard Industrial Classification → investor-facing sector.
 *
 * WHY SIC AT ALL: every US filer already carries a SIC code, and the EDGAR
 * submissions API serves it for free with no key, no quota, and no licence.
 * The commercial alternative (GICS) is licensed and cannot ship in an
 * AGPL project. So SIC is the only classification we can actually publish.
 *
 * WHAT THIS IS NOT: SIC is a 1987 taxonomy. It has no "Technology" division —
 * software sits under Services, semiconductors under Manufacturing. The map
 * below is therefore an OPINIONATED regrouping into the eleven sectors
 * investors expect, not a standards-body mapping. It is published in full at
 * /docs/methodology so anyone can check where a company landed and why.
 *
 * `industry` is NOT derived here: EDGAR ships its own `sicDescription`
 * string, which is more specific than anything we could infer.
 *
 * Ranges are INCLUSIVE and evaluated in order — the first match wins, so
 * narrow special cases are listed before the broad range they sit inside.
 */
export const SECTORS = [
  "Agriculture",
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Energy",
  "Financials",
  "Government",
  "Health Care",
  "Industrials",
  "Materials",
  "Real Estate",
  "Technology",
  "Utilities",
] as const;

export type Sector = (typeof SECTORS)[number];

interface SicRange {
  from: number;
  to: number;
  sector: Sector;
  /** Why this range is not where a naive reading of SIC would put it. */
  note?: string;
}

/** Ordered: narrow overrides first, broad divisions after. */
export const SIC_SECTOR_RANGES: readonly SicRange[] = [
  // ── Narrow overrides ─────────────────────────────────────────────────────
  { from: 2830, to: 2836, sector: "Health Care", note: "drugs, diagnostics, biologics" },
  { from: 2840, to: 2844, sector: "Consumer Staples", note: "soap, cosmetics" },
  { from: 3570, to: 3579, sector: "Technology", note: "computer & office equipment" },
  { from: 3660, to: 3699, sector: "Technology", note: "comms equipment, semiconductors" },
  { from: 3720, to: 3799, sector: "Industrials", note: "aerospace, rail, shipbuilding" },
  { from: 3826, to: 3826, sector: "Health Care", note: "lab analytical instruments" },
  { from: 3840, to: 3851, sector: "Health Care", note: "medical & ophthalmic devices" },
  { from: 4610, to: 4619, sector: "Energy", note: "pipelines" },
  { from: 5400, to: 5499, sector: "Consumer Staples", note: "grocery" },
  { from: 5912, to: 5912, sector: "Consumer Staples", note: "drug stores" },
  { from: 6500, to: 6599, sector: "Real Estate" },
  { from: 6798, to: 6798, sector: "Real Estate", note: "REITs" },
  { from: 7310, to: 7319, sector: "Communication Services", note: "advertising" },
  { from: 7370, to: 7379, sector: "Technology", note: "software & IT services" },
  { from: 8200, to: 8299, sector: "Consumer Discretionary", note: "education" },
  { from: 8731, to: 8731, sector: "Health Care", note: "commercial biological research" },

  // ── Broad divisions ──────────────────────────────────────────────────────
  { from: 100, to: 999, sector: "Agriculture" },
  { from: 1000, to: 1119, sector: "Materials", note: "metal mining" },
  { from: 1200, to: 1299, sector: "Energy", note: "coal" },
  { from: 1310, to: 1399, sector: "Energy", note: "oil & gas extraction and services" },
  { from: 1400, to: 1499, sector: "Materials", note: "nonmetallic minerals" },
  { from: 1500, to: 1799, sector: "Industrials", note: "construction" },
  { from: 2000, to: 2199, sector: "Consumer Staples", note: "food, beverage, tobacco" },
  { from: 2200, to: 2399, sector: "Consumer Discretionary", note: "textiles & apparel" },
  { from: 2400, to: 2499, sector: "Materials", note: "lumber" },
  { from: 2500, to: 2599, sector: "Consumer Discretionary", note: "furniture" },
  { from: 2600, to: 2699, sector: "Materials", note: "paper" },
  { from: 2700, to: 2799, sector: "Communication Services", note: "publishing" },
  { from: 2800, to: 2899, sector: "Materials", note: "chemicals" },
  { from: 2900, to: 2999, sector: "Energy", note: "petroleum refining" },
  { from: 3000, to: 3099, sector: "Materials", note: "rubber & plastics" },
  { from: 3100, to: 3199, sector: "Consumer Discretionary", note: "leather" },
  { from: 3200, to: 3399, sector: "Materials", note: "stone, clay, glass, primary metals" },
  { from: 3400, to: 3499, sector: "Industrials", note: "fabricated metal" },
  { from: 3500, to: 3599, sector: "Industrials", note: "industrial machinery" },
  { from: 3600, to: 3659, sector: "Industrials", note: "electrical equipment" },
  { from: 3700, to: 3719, sector: "Consumer Discretionary", note: "motor vehicles" },
  { from: 3800, to: 3999, sector: "Industrials", note: "instruments & misc manufacturing" },
  { from: 4000, to: 4599, sector: "Industrials", note: "transportation" },
  { from: 4600, to: 4799, sector: "Industrials" },
  { from: 4800, to: 4899, sector: "Communication Services", note: "telecom & broadcasting" },
  { from: 4900, to: 4999, sector: "Utilities" },
  { from: 5000, to: 5199, sector: "Industrials", note: "wholesale" },
  { from: 5200, to: 5999, sector: "Consumer Discretionary", note: "retail" },
  { from: 6000, to: 6499, sector: "Financials", note: "banks, brokers, insurers" },
  { from: 6600, to: 6799, sector: "Financials", note: "holding & investment offices" },
  { from: 7000, to: 7299, sector: "Consumer Discretionary", note: "hotels & personal services" },
  { from: 7300, to: 7399, sector: "Industrials", note: "business services" },
  { from: 7400, to: 7699, sector: "Industrials" },
  { from: 7700, to: 7999, sector: "Communication Services", note: "entertainment & media" },
  { from: 8000, to: 8099, sector: "Health Care", note: "health services" },
  { from: 8100, to: 8199, sector: "Industrials", note: "legal services" },
  { from: 8300, to: 8699, sector: "Industrials" },
  { from: 8700, to: 8999, sector: "Industrials", note: "engineering & management services" },
  { from: 9000, to: 9999, sector: "Government" },
];

/**
 * Map a SIC code to a sector. Returns null for unknown, blank, or
 * unmappable codes — an unclassified company must stay unclassified rather
 * than be swept into a bucket it does not belong to.
 */
export function sicToSector(sic: string | number | null | undefined): Sector | null {
  if (sic === null || sic === undefined) return null;
  const code = typeof sic === "number" ? sic : Number.parseInt(String(sic).trim(), 10);
  if (!Number.isFinite(code) || code <= 0) return null;
  for (const range of SIC_SECTOR_RANGES) {
    if (code >= range.from && code <= range.to) return range.sector;
  }
  return null;
}

/** EDGAR submissions endpoint for a CIK — the only place SIC is free to read. */
export function edgarSubmissionsUrl(cik: string): string {
  const padded = String(cik).replace(/\D/g, "").padStart(10, "0");
  return `https://data.sec.gov/submissions/CIK${padded}.json`;
}

export interface EdgarCompanyProfile {
  cik: string;
  sicCode: string | null;
  /** EDGAR's own industry label — more specific than anything we'd infer. */
  industry: string | null;
  sector: Sector | null;
  exchange: string | null;
  tickers: string[];
}

/** Parse the fields we need out of a submissions payload; tolerant of shape drift. */
export function parseEdgarSubmissionProfile(payload: unknown): EdgarCompanyProfile | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const cik = p.cik === undefined || p.cik === null ? null : String(p.cik);
  if (!cik) return null;

  const sicCode = p.sic ? String(p.sic).trim() : null;
  const industry = typeof p.sicDescription === "string" ? p.sicDescription.trim() || null : null;

  const tickersRaw = (p.tickers ?? []) as unknown;
  const tickers = Array.isArray(tickersRaw) ? tickersRaw.map(String).filter(Boolean) : [];
  const exchangesRaw = (p.exchanges ?? []) as unknown;
  const exchange =
    Array.isArray(exchangesRaw) && exchangesRaw.length > 0 ? String(exchangesRaw[0]) : null;

  return { cik, sicCode, industry, sector: sicToSector(sicCode), exchange, tickers };
}
