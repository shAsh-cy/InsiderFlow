import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Mirrors SEC_TRANSACTION_CODES in @insiderflow/core. */
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
    /** SEC CIK, 10-digit zero-padded. */
    cik: text("cik").notNull(),
    ticker: text("ticker"),
    name: text("name").notNull(),
    exchange: text("exchange"),
    sector: text("sector"),
    country: text("country").notNull().default("US"),
    logoUrl: text("logo_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
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
    /** SEC CIK, 10-digit zero-padded. */
    cik: text("cik").notNull(),
    /** Normalized via normalizeInsiderName() in @insiderflow/core. */
    name: text("name").notNull(),
    isDirector: boolean("is_director").notNull().default(false),
    isOfficer: boolean("is_officer").notNull().default(false),
    isTenPctOwner: boolean("is_ten_pct_owner").notNull().default(false),
    officerTitle: text("officer_title"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("insiders_cik_unique").on(t.cik),
    index("insiders_name_trgm_idx").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

export const filings = pgTable(
  "filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** EDGAR accession number, canonical dashed form — the idempotency key. */
    accessionNo: text("accession_no").notNull(),
    /** Raw form type as filed: "4", "4/A", "3", "5"... */
    formType: text("form_type").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
    sourceUrl: text("source_url"),
    issuerCompanyId: uuid("issuer_company_id")
      .notNull()
      .references(() => companies.id),
    rawXmlUrl: text("raw_xml_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("filings_accession_no_unique").on(t.accessionNo),
    index("filings_issuer_company_id_idx").on(t.issuerCompanyId),
    index("filings_filed_at_idx").on(t.filedAt),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filingId: uuid("filing_id")
      .notNull()
      .references(() => filings.id, { onDelete: "cascade" }),
    insiderId: uuid("insider_id")
      .notNull()
      .references(() => insiders.id),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    txnDate: date("txn_date").notNull(),
    code: transactionCodeEnum("code").notNull(),
    shares: numeric("shares", { precision: 20, scale: 4 }),
    price: numeric("price", { precision: 20, scale: 4 }),
    /** shares × price when both are reported. */
    value: numeric("value", { precision: 24, scale: 4 }),
    acquiredDisposed: text("acquired_disposed", { enum: ["A", "D"] }),
    sharesOwnedAfter: numeric("shares_owned_after", { precision: 20, scale: 4 }),
    /** Covered by a Rule 10b5-1 trading plan (checkbox or footnote language). */
    is10b51: boolean("is_10b5_1").notNull().default(false),
    isDerivative: boolean("is_derivative").notNull().default(false),
    footnote: text("footnote"),
    country: text("country").notNull().default("US"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_filing_id_idx").on(t.filingId),
    index("transactions_insider_id_idx").on(t.insiderId),
    index("transactions_company_id_idx").on(t.companyId),
    index("transactions_txn_date_idx").on(t.txnDate),
    index("transactions_code_idx").on(t.code),
  ],
);

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
export type IngestionState = typeof ingestionState.$inferSelect;
