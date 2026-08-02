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

/**
 * SEBI SAST (Reg. 29/31) disclosures — substantial acquisitions and takeover
 * filings. Populated only by the optional, off-by-default India local-scrape
 * runner (ingestion/india-local); the hosted deployment never writes here.
 */
export const sastDisclosures = pgTable(
  "sast_disclosures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    country: text("country").notNull().default("IN"),
    exchange: text("exchange").notNull().default("NSE"),
    symbol: text("symbol").notNull(),
    companyName: text("company_name").notNull(),
    acquirerName: text("acquirer_name").notNull(),
    /** e.g. "29(1)", "29(2)", "31(1)" */
    regulation: text("regulation"),
    /** Promoter / Promoter Group / Public ... */
    category: text("category"),
    acquisitionMode: text("acquisition_mode"),
    side: text("side", { enum: ["acquisition", "disposal"] }),
    shares: numeric("shares", { precision: 20, scale: 4 }),
    sharesPctBefore: numeric("shares_pct_before", { precision: 9, scale: 4 }),
    sharesPctAfter: numeric("shares_pct_after", { precision: 9, scale: 4 }),
    value: numeric("value", { precision: 24, scale: 4 }),
    currency: text("currency").notNull().default("INR"),
    valueUsd: numeric("value_usd", { precision: 24, scale: 4 }),
    txnDate: date("txn_date"),
    intimatedAt: date("intimated_at"),
    sourceUrl: text("source_url"),
    dedupKey: text("dedup_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sast_dedup_key_unique").on(t.dedupKey),
    index("sast_symbol_idx").on(t.symbol),
    index("sast_txn_date_idx").on(t.txnDate),
  ],
);

/** Exchange bulk/block deals (India). Same off-by-default provenance as sast_disclosures. */
export const bulkBlockDeals = pgTable(
  "bulk_block_deals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    country: text("country").notNull().default("IN"),
    exchange: text("exchange").notNull().default("NSE"),
    dealType: text("deal_type", { enum: ["bulk", "block"] }).notNull(),
    dealDate: date("deal_date").notNull(),
    symbol: text("symbol").notNull(),
    companyName: text("company_name"),
    clientName: text("client_name").notNull(),
    side: text("side", { enum: ["buy", "sell"] }).notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 4 }).notNull(),
    /** Weighted average trade price. */
    wap: numeric("wap", { precision: 20, scale: 4 }),
    value: numeric("value", { precision: 24, scale: 4 }),
    currency: text("currency").notNull().default("INR"),
    valueUsd: numeric("value_usd", { precision: 24, scale: 4 }),
    remarks: text("remarks"),
    dedupKey: text("dedup_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bulk_block_dedup_key_unique").on(t.dedupKey),
    index("bulk_block_symbol_idx").on(t.symbol),
    index("bulk_block_deal_date_idx").on(t.dealDate),
  ],
);

/** Promoter pledge events (create/revoke/invoke). Same off-by-default provenance. */
export const pledgeDisclosures = pgTable(
  "pledge_disclosures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    country: text("country").notNull().default("IN"),
    exchange: text("exchange").notNull().default("NSE"),
    symbol: text("symbol").notNull(),
    companyName: text("company_name"),
    promoterName: text("promoter_name").notNull(),
    /** "pledge" | "revoke" | "invoke" (invocation transfers the shares). */
    eventType: text("event_type", { enum: ["pledge", "revoke", "invoke"] }),
    shares: numeric("shares", { precision: 20, scale: 4 }),
    sharesPct: numeric("shares_pct", { precision: 9, scale: 4 }),
    value: numeric("value", { precision: 24, scale: 4 }),
    currency: text("currency").notNull().default("INR"),
    valueUsd: numeric("value_usd", { precision: 24, scale: 4 }),
    eventDate: date("event_date"),
    intimatedAt: date("intimated_at"),
    sourceUrl: text("source_url"),
    dedupKey: text("dedup_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pledge_dedup_key_unique").on(t.dedupKey),
    index("pledge_symbol_idx").on(t.symbol),
    index("pledge_event_date_idx").on(t.eventDate),
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

// ─────────────────────────────────────────────────────────────────────────
// User-scoped tables (Phase 7). `user_id` is the Supabase Auth user UUID
// (the JWT `sub`). RLS policies live in the migration; the shared query
// layer ALSO scopes every read/write by user_id — the server talks to
// Postgres directly, so query-layer scoping is the primary enforcement and
// RLS is defense in depth.
// ─────────────────────────────────────────────────────────────────────────

export const watchlistKindEnum = pgEnum("watchlist_kind", ["company", "insider"]);
export const alertModeEnum = pgEnum("alert_mode", ["instant", "digest"]);
export const alertChannelEnum = pgEnum("alert_channel", ["telegram", "email", "webpush"]);

export const userWatchlists = pgTable(
  "user_watchlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    kind: watchlistKindEnum("kind").notNull(),
    /** Ticker for companies, insider UUID for insiders. */
    refId: text("ref_id").notNull(),
    label: text("label").notNull(),
    market: text("market").notNull().default("US"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_watchlists_unique").on(t.userId, t.kind, t.refId),
    index("user_watchlists_user_idx").on(t.userId),
  ],
);

export const alertRules = pgTable(
  "alert_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /**
     * Saved screen filters, in the same shape the trades query layer
     * accepts (market/code/relevance/min_value_usd/...). Null for rules
     * that only track a watchlist entity.
     */
    filters: jsonb("filters").$type<Record<string, unknown>>(),
    /** Restrict to one ticker (companies) — null means "any". */
    trackedTicker: text("tracked_ticker"),
    /** Restrict to one insider id — null means "any". */
    trackedInsiderId: uuid("tracked_insider_id"),
    /** Fire immediately, or roll into the daily digest. */
    mode: alertModeEnum("mode").notNull().default("digest"),
    channels: jsonb("channels").$type<string[]>().notNull().default(["telegram"]),
    /** Local-time quiet window; instant alerts inside it fall back to the digest. */
    quietHoursStart: text("quiet_hours_start"),
    quietHoursEnd: text("quiet_hours_end"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("alert_rules_user_idx").on(t.userId),
    index("alert_rules_enabled_idx").on(t.enabled),
  ],
);

export const alertChannels = pgTable(
  "alert_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    channel: alertChannelEnum("channel").notNull(),
    /** Email address, Telegram chat id, or push endpoint. */
    destination: text("destination"),
    verified: boolean("verified").notNull().default(false),
    /** One-time token for Telegram's `/start <token>` deep link. */
    linkToken: text("link_token"),
    /** Opaque token for one-click email unsubscribe. */
    unsubscribeToken: text("unsubscribe_token"),
    /** Local HH:MM the daily digest is sent. */
    digestHour: text("digest_hour").notNull().default("08:00"),
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("alert_channels_user_channel_unique").on(t.userId, t.channel),
    uniqueIndex("alert_channels_link_token_unique").on(t.linkToken),
    index("alert_channels_user_idx").on(t.userId),
  ],
);

/**
 * Every alert ever matched. The (rule_id, dedup_key) unique index is the
 * idempotency guarantee: re-runs, overlapping scanners, and amendment
 * re-homes (same dedup_key, new filing id) can never double-fire.
 */
export const alertsLog = pgTable(
  "alerts_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    /** The transaction's cross-source dedup key — stable across re-homes. */
    dedupKey: text("dedup_key").notNull(),
    transactionId: uuid("transaction_id"),
    mode: alertModeEnum("mode").notNull(),
    /** null until dispatched — digest rows sit here until the digest cron runs. */
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveredChannels: jsonb("delivered_channels").$type<string[]>().notNull().default([]),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("alerts_log_rule_dedup_unique").on(t.ruleId, t.dedupKey),
    index("alerts_log_user_idx").on(t.userId),
    index("alerts_log_pending_idx").on(t.deliveredAt),
  ],
);

/**
 * Lease-based lock + cursor for the alert scanner. A lease (rather than a
 * session advisory lock) survives transaction-mode connection pooling,
 * where session state is not guaranteed between statements.
 */
export const scannerState = pgTable("scanner_state", {
  name: text("name").primaryKey(),
  /** Last transaction created_at/id processed — the scan cursor. */
  cursorCreatedAt: timestamp("cursor_created_at", { withTimezone: true }),
  cursorId: uuid("cursor_id"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lockOwner: text("lock_owner"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
export type UserWatchlist = typeof userWatchlists.$inferSelect;
export type NewUserWatchlist = typeof userWatchlists.$inferInsert;
export type AlertRule = typeof alertRules.$inferSelect;
export type NewAlertRule = typeof alertRules.$inferInsert;
export type AlertChannelRow = typeof alertChannels.$inferSelect;
export type NewAlertChannel = typeof alertChannels.$inferInsert;
export type AlertLogRow = typeof alertsLog.$inferSelect;
export type NewAlertLog = typeof alertsLog.$inferInsert;
export type ScannerState = typeof scannerState.$inferSelect;
export type SastDisclosure = typeof sastDisclosures.$inferSelect;
export type NewSastDisclosure = typeof sastDisclosures.$inferInsert;
export type BulkBlockDeal = typeof bulkBlockDeals.$inferSelect;
export type NewBulkBlockDeal = typeof bulkBlockDeals.$inferInsert;
export type PledgeDisclosure = typeof pledgeDisclosures.$inferSelect;
export type NewPledgeDisclosure = typeof pledgeDisclosures.$inferInsert;
