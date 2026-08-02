/**
 * OpenAPI 3.0 spec for the public API. Served at /api/openapi.json and
 * rendered at /docs. Hand-maintained alongside the Zod schemas in schemas.ts.
 */
import { SCREENER_PRESETS } from "./schemas";

type Param = {
  name: string;
  in: "query" | "path" | "header";
  description: string;
  required?: boolean;
  schema: Record<string, unknown>;
};

const q = (
  name: string,
  description: string,
  schema: Record<string, unknown> = { type: "string" },
): Param => ({ name, in: "query", description, schema });

const pathParam = (
  name: string,
  description: string,
  schema: Record<string, unknown> = { type: "string" },
): Param => ({ name, in: "path", required: true, description, schema });

const PAGINATION: Param[] = [
  q("limit", "Page size (1-100, default 50)", { type: "integer", default: 50 }),
  q("offset", "Rows to skip (default 0)", { type: "integer", default: 0 }),
];

const TRADE_FILTERS: Param[] = [
  q("market", "Two-letter market/country code (US, IN, ...)"),
  q("ticker", "Exchange symbol, e.g. AAPL"),
  q("code", "Unified transaction code (P, S, A, M, F, G, ...)"),
  q("role", "Insider role", { type: "string", enum: ["director", "officer", "ten_pct"] }),
  q("relevance", "routine (scheduled/compensation) or opportunistic (discretionary P/S)", {
    type: "string",
    enum: ["routine", "opportunistic"],
  }),
  q("source", "Originating adapter", {
    type: "string",
    enum: ["edgar", "nse-bse", "finnhub", "fmp", "eu-mar", "sedi"],
  }),
  q("side", "Acquired (buy) vs disposed (sell)", { type: "string", enum: ["buy", "sell"] }),
  q("sector", "Company sector (exact match)"),
  q("near_low", "Trade-day close within 5% of the 52-week low (needs price context)", {
    type: "boolean",
  }),
  q("insider_id", "Filter to one insider (UUID)", { type: "string", format: "uuid" }),
  q("min_value", "Minimum transaction value in the native currency", { type: "number" }),
  q("min_value_usd", "Minimum transaction value in USD", { type: "number" }),
  q("cluster", "Only companies where 2+ insiders bought within 14 days", { type: "boolean" }),
  q("dip", "Buys priced 5%+ below that day's close (needs price context)", { type: "boolean" }),
  q("exec_only", "Officers only", { type: "boolean" }),
  q("include_superseded", "Include rows from filings replaced by amendments", {
    type: "boolean",
    default: false,
  }),
  q("from", "Earliest transaction date (YYYY-MM-DD)", { type: "string", format: "date" }),
  q("to", "Latest transaction date (YYYY-MM-DD)", { type: "string", format: "date" }),
  q("sort", "Sort field", {
    type: "string",
    enum: ["txn_date", "value", "value_usd", "created_at"],
    default: "txn_date",
  }),
  q("order", "Sort direction", { type: "string", enum: ["asc", "desc"], default: "desc" }),
  ...PAGINATION,
];

const tradeRowSchema = {
  type: "object",
  description: "One normalized insider transaction (any market, any source).",
  properties: {
    id: { type: "string", format: "uuid" },
    source: { type: "string" },
    market: { type: "string" },
    txnDate: { type: "string", format: "date" },
    code: { type: "string" },
    rawCode: { type: "string", nullable: true },
    direction: { type: "string", enum: ["buy", "sell", "neutral"] },
    relevance: { type: "string", enum: ["routine", "opportunistic"] },
    signalWeight: { type: "number" },
    shares: { type: "number", nullable: true },
    price: { type: "number", nullable: true },
    value: { type: "number", nullable: true },
    currency: { type: "string" },
    priceUsd: { type: "number", nullable: true },
    valueUsd: { type: "number", nullable: true },
    acquiredDisposed: { type: "string", nullable: true, enum: ["A", "D"] },
    sharesOwnedAfter: { type: "number", nullable: true },
    is10b51: { type: "boolean" },
    isDerivative: { type: "boolean" },
    footnote: { type: "string", nullable: true },
    createdAt: { type: "string", format: "date-time" },
    company: { type: "object" },
    insider: { type: "object" },
    filing: { type: "object", nullable: true },
  },
};

const pagedTrades = {
  description: "Paginated trade list",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          data: { type: "array", items: { $ref: "#/components/schemas/Trade" } },
          meta: { $ref: "#/components/schemas/PageMeta" },
        },
      },
    },
  },
};

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "InsiderFlow API",
    version: "0.1.0",
    description:
      "Free, public, rate-limited API for normalized multi-market insider-trading data. " +
      "Data is for research and education only — NOT investment advice. " +
      "Public tier: 60 requests/min per IP. Send an `x-api-key` header for higher limits.",
    license: { name: "AGPL-3.0", url: "https://www.gnu.org/licenses/agpl-3.0.html" },
  },
  servers: [{ url: "/" }],
  paths: {
    "/api/trades": {
      get: {
        summary: "List insider trades",
        description:
          "Normalized transactions across all markets and sources, filterable and paginated. " +
          "Rows from filings superseded by amendments are hidden unless include_superseded=true.",
        parameters: TRADE_FILTERS,
        responses: { "200": pagedTrades, "400": { description: "Invalid parameters" } },
      },
    },
    "/api/companies/{ticker}": {
      get: {
        summary: "Company profile",
        description:
          "Company record, 90-day insider aggregates, recent trades, insider sentiment (MSPR) " +
          "when available, and trade-price-vs-close price context.",
        parameters: [pathParam("ticker", "Exchange symbol, e.g. AAPL")],
        responses: {
          "200": { description: "Company detail" },
          "404": { description: "Unknown ticker" },
        },
      },
    },
    "/api/companies/{ticker}/sentiment": {
      get: {
        summary: "Insider sentiment (MSPR) time series",
        parameters: [pathParam("ticker", "Exchange symbol")],
        responses: { "200": { description: "Monthly MSPR points (empty when not tracked)" } },
      },
    },
    "/api/insiders/{id}": {
      get: {
        summary: "Insider profile",
        parameters: [pathParam("id", "Insider UUID", { type: "string", format: "uuid" })],
        responses: {
          "200": { description: "Insider detail with recent trades" },
          "404": { description: "Unknown insider" },
        },
      },
    },
    "/api/screener/{preset}": {
      get: {
        summary: "Run a canned screen",
        description: `Presets: ${Object.entries(SCREENER_PRESETS)
          .map(([name, p]) => `${name} (${p.description})`)
          .join("; ")}. Additional trade filters compose with the preset.`,
        parameters: [
          pathParam("preset", "Preset name", {
            type: "string",
            enum: Object.keys(SCREENER_PRESETS),
          }),
          ...PAGINATION,
        ],
        responses: { "200": pagedTrades, "404": { description: "Unknown preset" } },
      },
    },
    "/api/heatmap": {
      get: {
        summary: "Per-company buy/sell heatmap",
        parameters: [
          q("days", "Lookback window in days (default 30)", { type: "integer", default: 30 }),
          q("market", "Two-letter market code"),
          q("relevance", "Filter by relevance", {
            type: "string",
            enum: ["routine", "opportunistic"],
          }),
          q("limit", "Max companies (default 50)", { type: "integer", default: 50 }),
        ],
        responses: { "200": { description: "Aggregated USD buy/sell values per company" } },
      },
    },
    "/api/politicians": {
      get: {
        summary: "Politician trading disclosures (placeholder)",
        description:
          "Congressional trading ingestion (Senate/House PTR filings) is not implemented yet; " +
          "returns an empty, correctly-shaped page so clients can integrate now.",
        parameters: PAGINATION,
        responses: { "200": { description: "Empty paginated list (for now)" } },
      },
    },
    "/api/rss/{screen}": {
      get: {
        summary: "RSS 2.0 feed of a screen",
        parameters: [
          pathParam("screen", "Screen preset", {
            type: "string",
            enum: Object.keys(SCREENER_PRESETS),
          }),
        ],
        responses: {
          "200": { description: "RSS 2.0 XML", content: { "application/rss+xml": {} } },
        },
      },
    },
    "/api/stream": {
      get: {
        summary: "Live trade feed (SSE)",
        description:
          "Server-Sent Events with `trade` events. Serverless-friendly: the server closes each " +
          "window after ~25s and EventSource auto-reconnects; Last-Event-ID resumes without loss. " +
          "For SWR/polling clients, pass mode=poll to get a JSON batch plus the next cursor.",
        parameters: [
          q("last_event_id", "Resume cursor (also read from the Last-Event-ID header)"),
          q("mode", "Set to 'poll' for the JSON polling fallback", {
            type: "string",
            enum: ["poll"],
          }),
        ],
        responses: {
          "200": {
            description: "text/event-stream (or JSON batch in poll mode)",
            content: { "text/event-stream": {}, "application/json": {} },
          },
        },
      },
    },
    "/api/openapi.json": {
      get: { summary: "This document", responses: { "200": { description: "OpenAPI 3.0 spec" } } },
    },
  },
  components: {
    schemas: {
      Trade: tradeRowSchema,
      PageMeta: {
        type: "object",
        properties: {
          limit: { type: "integer" },
          offset: { type: "integer" },
          count: { type: "integer" },
          hasMore: { type: "boolean" },
          nextOffset: { type: "integer", nullable: true },
        },
      },
    },
    securitySchemes: {
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "Optional — raises the rate limit from 60/min to 600/min.",
      },
    },
  },
} as const;
