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

/** Mirrors `Market` in @insiderflow/core. */
export const marketEnum = pgEnum("market", ["US", "IN"]);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    market: marketEnum("market").notNull().default("US"),
    /** SEC CIK (10-digit zero-padded) for US; exchange symbol for other markets. */
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    ticker: text("ticker"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("companies_market_external_id_idx").on(t.market, t.externalId),
    index("companies_ticker_idx").on(t.ticker),
  ],
);

export const insiders = pgTable(
  "insiders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    market: marketEnum("market").notNull().default("US"),
    /** SEC CIK for US insiders. */
    externalId: text("external_id").notNull(),
    /** Normalized via normalizeInsiderName() in @insiderflow/core. */
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("insiders_market_external_id_idx").on(t.market, t.externalId)],
);

export const filings = pgTable(
  "filings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    market: marketEnum("market").notNull().default("US"),
    /** EDGAR accession number, canonical dashed form. */
    accessionNumber: text("accession_number").notNull(),
    formType: text("form_type").notNull().default("4"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    insiderId: uuid("insider_id")
      .notNull()
      .references(() => insiders.id),
    /** Insider roles at filing time, e.g. ["Director", "10% Owner"]. */
    insiderRoles: jsonb("insider_roles").$type<string[]>().notNull().default([]),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull(),
    periodOfReport: date("period_of_report"),
    sourceUrl: text("source_url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("filings_accession_number_idx").on(t.accessionNumber),
    index("filings_company_id_idx").on(t.companyId),
    index("filings_insider_id_idx").on(t.insiderId),
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
    /** SEC transaction code (P, S, M, ...) — see SEC_TRANSACTION_CODES in @insiderflow/core. */
    code: text("code").notNull(),
    /** Denormalized classifyTransaction() result for cheap filtering. */
    direction: text("direction", { enum: ["buy", "sell", "neutral"] }).notNull(),
    transactionDate: date("transaction_date").notNull(),
    securityTitle: text("security_title"),
    shares: numeric("shares", { precision: 20, scale: 4 }),
    pricePerShare: numeric("price_per_share", { precision: 20, scale: 4 }),
    totalValue: numeric("total_value", { precision: 20, scale: 4 }),
    sharesOwnedAfter: numeric("shares_owned_after", { precision: 20, scale: 4 }),
    /** "D" = direct, "I" = indirect ownership. */
    ownershipForm: text("ownership_form", { enum: ["D", "I"] }),
    isDerivative: boolean("is_derivative").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("transactions_filing_id_idx").on(t.filingId),
    index("transactions_date_idx").on(t.transactionDate),
    index("transactions_direction_idx").on(t.direction),
  ],
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
export type Insider = typeof insiders.$inferSelect;
export type NewInsider = typeof insiders.$inferInsert;
export type Filing = typeof filings.$inferSelect;
export type NewFiling = typeof filings.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
