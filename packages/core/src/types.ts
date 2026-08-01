/**
 * Markets InsiderFlow understands. Only US (SEC EDGAR) ingestion ships today;
 * IN (NSE/BSE) is planned and gated on licensed data access — see README legal notes.
 */
export type Market = "US" | "IN";
