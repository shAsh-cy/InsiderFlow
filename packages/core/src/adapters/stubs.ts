/**
 * Stub adapters for markets whose primary sources have no free-tier access:
 * EU (MAR Art. 19 filings are scattered across national regulators) and
 * Canada (SEDI has no public API). Both normalize a generic aggregator
 * record shape, so wiring a commercial aggregator later is just fetch().
 */
import { normalizeInsiderName } from "../normalize";
import { AdapterNotConfiguredError, buildTransaction, rolesFromText } from "../unified";
import type { MarketMetadata, SourceAdapter, SourceId, UnifiedTransaction } from "../unified";

/** Generic record shape most commercial disclosure aggregators can provide. */
export interface AggregatorRecord {
  symbol?: string | null;
  companyName: string;
  insiderName: string;
  role?: string | null;
  side: "buy" | "sell";
  /** ISO date. */
  date: string;
  shares?: number | null;
  price?: number | null;
  value?: number | null;
  sourceUrl?: string | null;
}

export interface AggregatorRawBatch {
  records: AggregatorRecord[];
}

function makeAggregatorAdapter(
  id: SourceId,
  metadata: MarketMetadata,
): SourceAdapter<AggregatorRawBatch> {
  return {
    id,
    metadata,

    fetch(): Promise<AggregatorRawBatch> {
      return Promise.reject(
        new AdapterNotConfiguredError(
          id,
          "requires a commercial disclosure aggregator (no free-tier source exists); normalize() is ready once one is wired up",
        ),
      );
    },

    normalize(raw: AggregatorRawBatch): UnifiedTransaction[] {
      const out: UnifiedTransaction[] = [];
      for (const record of raw.records) {
        if (!/^\d{4}-\d{2}-\d{2}/.test(record.date ?? "")) continue;
        const name = normalizeInsiderName(record.insiderName ?? "");
        const roles = rolesFromText(record.role);
        const ticker = record.symbol?.trim().toUpperCase() || null;
        out.push(
          buildTransaction({
            source: id,
            market: metadata.market,
            country: metadata.country,
            currency: metadata.currency,
            company: {
              externalKey: ticker
                ? `ticker:${metadata.market}:${ticker}`
                : `name:${metadata.market}:${record.companyName.trim().toUpperCase()}`,
              cik: null,
              name: record.companyName,
              ticker,
              country: metadata.country,
            },
            insider: {
              externalKey: `name:${metadata.market}:${name}`,
              name,
              isDirector: roles.isDirector,
              isOfficer: roles.isOfficer,
              isTenPercentOwner: roles.isTenPercentOwner,
              title: roles.title,
            },
            filing: null,
            txnDate: record.date.slice(0, 10),
            code: record.side === "buy" ? "P" : "S",
            rawCode: record.side,
            shares: record.shares ?? null,
            price: record.price ?? null,
            value: record.value ?? null,
            acquiredDisposed: record.side === "buy" ? "A" : "D",
            sharesOwnedAfter: null,
            is10b51: false,
            isDerivative: false,
            footnote: null,
          }),
        );
      }
      return out;
    },
  };
}

export const euMarAdapter = makeAggregatorAdapter("eu-mar", {
  market: "EU",
  country: "EU",
  currency: "EUR",
  regulator: "National competent authorities under ESMA (MAR Art. 19)",
  disclosureDeadline: "3 business days",
  latencyClass: "delayed",
});

export const sediAdapter = makeAggregatorAdapter("sedi", {
  market: "CA",
  country: "CA",
  currency: "CAD",
  regulator: "CSA (SEDI)",
  disclosureDeadline: "5 calendar days",
  latencyClass: "delayed",
});
