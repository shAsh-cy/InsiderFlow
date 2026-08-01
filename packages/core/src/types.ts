import type { SecTransactionCode, TradeDirection } from "./transaction-codes";

/**
 * Markets InsiderFlow understands. Only US (SEC EDGAR) ingestion ships today;
 * IN (NSE/BSE) is planned and gated on licensed data access — see README legal notes.
 */
export type Market = "US" | "IN";

export interface NormalizedCompany {
  market: Market;
  /** SEC CIK (10-digit zero-padded) for US; exchange symbol for other markets. */
  externalId: string;
  name: string;
  ticker: string | null;
}

export interface NormalizedInsider {
  market: Market;
  externalId: string;
  name: string;
  /** e.g. "Chief Executive Officer", "Director", "10% Owner" */
  roles: string[];
}

export interface NormalizedTransaction {
  market: Market;
  accessionNumber: string;
  /** Raw code from the filing; SecTransactionCode for US filings. */
  code: SecTransactionCode | (string & {});
  direction: TradeDirection;
  /** ISO 8601 date (YYYY-MM-DD). */
  transactionDate: string;
  securityTitle: string | null;
  shares: number | null;
  pricePerShare: number | null;
  totalValue: number | null;
  sharesOwnedAfter: number | null;
  /** "D" = direct ownership, "I" = indirect. */
  ownershipForm: "D" | "I" | null;
  isDerivative: boolean;
  sourceUrl: string;
}
