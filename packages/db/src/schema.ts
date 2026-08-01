import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Unified transaction-code taxonomy (SEC-derived; every market maps into it
 * via its source adapter). Mirrors SEC_TRANSACTION_CODES in @insiderflow/core.
 */
export const transactionCodeEnum = pgEnum("transaction_code", [
  "P",
  "S",
  "V",
  "A",
  "D",
  "F",
  "I",
  "M",
  "C",
  "E",
  "H",
  "O",
  "X",
  "G",
  "L",
  "W",
  "Z",
  "J",
  "K",
  "U",
]);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Stable cross-source identity: "cik:0000320193", "ticker:IN:RELIANCE",
     * "isin:...". New markets bring new key prefixes — no schema change.
     */
    externalKey: text("external_key").notNull(),
    /** SEC CIK (US companies only). */
    cik: text("cik"),
    ticker: text("ticker"),
    name: text("name").notNull(),
    exchange: text("exchange"),
    sector: text("sector"),
    country: text("country").notNull().default("US"),
    logoUrl: text("logo_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("companies_external_key_unique").on(t.externalKey),
    uniqueIndex("companies_cik_unique").on(t.cik),
    index("companies_ticker_idx").on(t.ticker),
    // Requires the pg_trgm extension (created in the initial migration).
    index("companies_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

export const insiders = pgTable(
  "insiders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "cik:0001214156" when the source has one, else "name:<market>:<normalized name>". */
    externalKey: text("external_key").notNull(),
    /** SEC CIK (US insiders only). */
    cik: text("cik"),
    /** Normalized via normalizeInsiderName() in @insiderflow/core. */
    name: text("name").notNull(),
    isDirector: boolean("is_director").notNull().default(false),
    isOfficer: boolean("is_officer").notNull().default(false),
    isTenPctOwner: boolean("is_ten_pct_owner").notNull().default(false),
    officerTitle: text("officer_title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("insiders_external_key_unique").on(t.externalKey),
    uniqueIndex("insiders_cik_unique").on(t.cik),
    index("insiders_name_idx").on(t.name),
    index("insiders_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

export const filings = pgTable(
  "filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** EDGAR accession number (or source-scoped ID), canonical form — the idempotency key. */
    accessionNo: text("accession_no").notNull(),
    /** Raw form type as filed: "4", "4/A", "3", "5"... */
    formType: text("form_type").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
    sourceUrl: text("source_url"),
    issuerCompanyId: uuid("issuer_company_id")
      .notNull()
      .references(() => companies.id),
    rawXmlUrl: text("raw_xml_url"),
    /** Set on the ORIGINAL filing when an amendment (4/A...) replaces it; APIs hide superseded rows by default. */
    supersededByFilingId: uuid("superseded_by_filing_id").references((): AnyPgColumn => filings.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("filings_accession_no_unique").on(t.accessionNo),
    index("filings_issuer_company_id_idx").on(t.issuerCompanyId),
    index("filings_filed_at_idx").on(t.filedAt),
    index("filings_superseded_by_idx").on(t.supersededByFilingId),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which adapter produced the row: "edgar" | "finnhub" | "fmp" | "nse-bse" | ... */
    source: text("source").notNull().default("edgar"),
    /** Null for sources without filings (aggregator APIs). */
    filingId: uuid("filing_id").references(() => filings.id, { onDelete: "cascade" }),
    insiderId: uuid("insider_id")
      .notNull()
      .references(() => insiders.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    txnDate: date("txn_date").notNull(),
    code: transactionCodeEnum("code").notNull(),
    /** Source-native code/mode as reported ("Market Purchase", "S-Sale"...). */
    rawCode: text("raw_code"),
    shares: numeric("shares", { precision: 20, scale: 4 }),
    /** Price/value in the native reporting currency. */
    price: numeric("price", { precision: 20, scale: 4 }),
    value: numeric("value", { precision: 24, scale: 4 }),
    /** ISO 4217 currency of price/value. */
    currency: text("currency").notNull().default("USD"),
    /** USD equivalents via the fx_rates table (rate on txn_date). */
    priceUsd: numeric("price_usd", { precision: 20, scale: 4 }),
    valueUsd: numeric("value_usd", { precision: 24, scale: 4 }),
    acquiredDisposed: text("acquired_disposed", { enum: ["A", "D"] }),
    sharesOwnedAfter: numeric("shares_owned_after", { precision: 20, scale: 4 }),
    /** Covered by a Rule 10b5-1 trading plan (checkbox or footnote language). */
    is10b51: boolean("is_10b5_1").notNull().default(false),
    isDerivative: boolean("is_derivative").notNull().default(false),
    /** Routine (scheduled compensation plumbing) vs opportunistic (discretionary P/S). */
    relevance: text("relevance", { enum: ["routine", "opportunistic"] })
      .notNull()
      .default("routine"),
    /**
     * Cross-source identity + occurrence suffix, e.g.
     * "US|AAPL|DOE JANE A|2026-07-30|10000|S#0". The unique index makes the
     * same trade arriving from a second source a no-op.
     */
    dedupKey: text("dedup_key").notNull(),
    footnote: text("footnote"),
    country: text("country").notNull().default("US"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_dedup_key_unique").on(t.dedupKey),
    index("transactions_filing_id_idx").on(t.filingId),
    index("transactions_insider_id_idx").on(t.insiderId),
    index("transactions_company_id_idx").on(t.companyId),
    index("transactions_txn_date_idx").on(t.txnDate),
    index("transactions_code_idx").on(t.code),
    index("transactions_source_idx").on(t.source),
    index("transactions_relevance_idx").on(t.relevance),
  ],
);

/** Daily FX rates to USD (Frankfurter/ECB), cached forever — historical rates never change. */
export const fxRates = pgTable(
  "fx_rates",
  {
    /** ISO 4217. */
    currency: text("currency").notNull(),
    date: date("date").notNull(),
    /** USD per 1 unit of currency. */
    rateUsd: numeric("rate_usd", { precision: 20, scale: 10 }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.currency, t.date] })],
);

/** Daily close cache for price context (Stooq et al.), keyed by exchange symbol. */
export const dailyPrices = pgTable(
  "daily_prices",
  {
    symbol: text("symbol").notNull(),
    market: text("market").notNull().default("US"),
    priceDate: date("price_date").notNull(),
    close: numeric("close", { precision: 20, scale: 4 }).notNull(),
    currency: text("currency").notNull().default("USD"),
    source: text("source").notNull().default("stooq"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.market, t.priceDate] })],
);

/** Generic response cache so free-tier API budgets (Finnhub 60/min, FMP ~250/day) are never burned twice. */
export const apiCache = pgTable("api_cache", {
  key: text("key").primaryKey(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Small key/value store for ingestion cursors and heartbeats. */
export const ingestionState = pgTable("ingestion_state", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Insider = typeof insiders.$inferSelect;
export type NewInsider = typeof insiders.$inferInsert;
export type Filing = typeof filings.$inferSelect;
export type NewFiling = typeof filings.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type FxRate = typeof fxRates.$inferSelect;
export type DailyPrice = typeof dailyPrices.$inferSelect;
export type ApiCacheEntry = typeof apiCache.$inferSelect;
export type IngestionState = typeof ingestionState.$inferSelect;
