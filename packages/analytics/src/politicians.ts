/**
 * Congressional PTR ingestion.
 *
 * Runs nightly on GitHub Actions, not on the worker cron: the source datasets
 * are single JSON documents in the tens of megabytes, which is far past what
 * a Cloudflare Worker invocation should be pulling every minute, and PTRs
 * appear in daily batches anyway — there is nothing real-time to chase.
 *
 * Idempotent by dedup_key, so a re-run of the same snapshot is a no-op and a
 * partial run simply resumes.
 */
import {
  HOUSE_STOCK_WATCHER_URL,
  OUTBOUND_ALLOWLIST,
  parseStockWatcherFeed,
  politicianExternalKey,
  SENATE_STOCK_WATCHER_URL,
} from "@insiderflow/core";
import type { Chamber, FetchLike, RawPoliticianTrade } from "@insiderflow/core";
import { createGuardedFetch } from "@insiderflow/core/ssrf-fetch";
import { and, companies, eq, inArray, politicians, politicianTrades, sql } from "@insiderflow/db";
import type { Database } from "@insiderflow/db";

export interface PoliticianIngestOptions {
  db: Database;
  fetchFn?: FetchLike;
  houseUrl?: string;
  senateUrl?: string;
  /** Ignore disclosures older than this. Defaults to two years. */
  sinceDays?: number;
  /** Cap rows written per run so a first import can be paged across runs. */
  limit?: number;
  now?: Date;
  log?: (event: string, data?: Record<string, unknown>) => void;
}

export interface PoliticianIngestResult {
  fetched: number;
  politiciansUpserted: number;
  tradesInserted: number;
  /** Rows whose ticker matched a company we already track. */
  tickersLinked: number;
  failedSources: string[];
}

async function fetchFeed(
  fetchFn: FetchLike,
  url: string,
  chamber: Chamber,
): Promise<RawPoliticianTrade[]> {
  const response = await fetchFn(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${chamber} feed returned ${response.status}`);
  return parseStockWatcherFeed(JSON.parse(await response.text()), chamber);
}

export async function ingestPoliticianTrades(
  options: PoliticianIngestOptions,
): Promise<PoliticianIngestResult> {
  const { db } = options;
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const sinceDays = options.sinceDays ?? 730;
  const since = new Date(now.getTime() - sinceDays * 86_400_000).toISOString().slice(0, 10);

  const result: PoliticianIngestResult = {
    fetched: 0,
    politiciansUpserted: 0,
    tradesInserted: 0,
    tickersLinked: 0,
    failedSources: [],
  };

  const sources: Array<[Chamber, string]> = [
    ["house", options.houseUrl ?? HOUSE_STOCK_WATCHER_URL],
    ["senate", options.senateUrl ?? SENATE_STOCK_WATCHER_URL],
  ];

  /*
   * The default fetcher is the guarded one, so this ingestion cannot be
   * pointed at an internal address by a flag.
   *
   * `houseUrl` / `senateUrl` are operator overrides, so their hosts are
   * added to the allowlist — an operator is allowed to name their own
   * mirror, and a list compiled into `core` cannot know it. What they do
   * NOT get to do is skip the rest: the override still has to be https on
   * the default port with no embedded credentials, it still cannot resolve
   * to a private, loopback, link-local or metadata address, and it still
   * cannot redirect to one. That is the part worth having, and it is the
   * part a bare `fetch` here gave away.
   *
   * `options.fetchFn` remains for tests, which is why it is not itself a
   * hole: a test that injects a stub is not making a network request.
   */
  const fetchFn =
    options.fetchFn ??
    createGuardedFetch({
      allowedHosts: [
        ...OUTBOUND_ALLOWLIST,
        ...sources.map(([, url]) => {
          try {
            return new URL(url).hostname;
          } catch {
            // An unparseable override is left off the list, and the guard
            // refuses it a moment later with a better message than this
            // catch could produce.
            return "";
          }
        }),
      ].filter(Boolean),
    });

  let trades: RawPoliticianTrade[] = [];
  for (const [chamber, url] of sources) {
    try {
      // One chamber failing must not cost us the other.
      const rows = await fetchFeed(fetchFn, url, chamber);
      trades.push(...rows);
    } catch (error) {
      result.failedSources.push(chamber);
      log("politician_feed_failed", {
        chamber,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  trades = trades
    .filter((t) => (t.disclosedAt ?? t.txnDate) >= since)
    .sort((a, b) => (b.disclosedAt ?? b.txnDate).localeCompare(a.disclosedAt ?? a.txnDate))
    .slice(0, options.limit ?? 20_000);
  result.fetched = trades.length;
  if (trades.length === 0) return result;

  // ── Politicians ──────────────────────────────────────────────────────────
  const byKey = new Map<string, RawPoliticianTrade>();
  for (const t of trades) {
    const key = politicianExternalKey(t.chamber, t.politicianName);
    // Later rows can carry party/state the earlier ones lacked.
    const existing = byKey.get(key);
    if (!existing || (!existing.party && t.party) || (!existing.state && t.state)) {
      byKey.set(key, t);
    }
  }

  const politicianRows = [...byKey.entries()].map(([externalKey, t]) => ({
    externalKey,
    name: t.politicianName,
    chamber: t.chamber,
    party: t.party,
    state: t.state,
    district: t.district,
  }));

  for (let i = 0; i < politicianRows.length; i += 500) {
    await db
      .insert(politicians)
      .values(politicianRows.slice(i, i + 500))
      .onConflictDoUpdate({
        target: politicians.externalKey,
        set: {
          name: sql`excluded.name`,
          // coalesce: never blank a value we already have with a null.
          party: sql`coalesce(excluded.party, ${politicians.party})`,
          state: sql`coalesce(excluded.state, ${politicians.state})`,
          district: sql`coalesce(excluded.district, ${politicians.district})`,
        },
      });
  }
  result.politiciansUpserted = politicianRows.length;

  const idByKey = new Map<string, string>();
  for (let i = 0; i < politicianRows.length; i += 500) {
    const keys = politicianRows.slice(i, i + 500).map((p) => p.externalKey);
    const rows = await db
      .select({ id: politicians.id, externalKey: politicians.externalKey })
      .from(politicians)
      .where(inArray(politicians.externalKey, keys));
    for (const row of rows) idByKey.set(row.externalKey, row.id);
  }

  // ── Ticker → company linkage ─────────────────────────────────────────────
  const tickers = [...new Set(trades.map((t) => t.ticker).filter((t): t is string => !!t))];
  const companyByTicker = new Map<string, string>();
  for (let i = 0; i < tickers.length; i += 500) {
    const rows = await db
      .select({ id: companies.id, ticker: companies.ticker })
      .from(companies)
      .where(
        and(inArray(companies.ticker, tickers.slice(i, i + 500)), eq(companies.country, "US")),
      );
    for (const row of rows) if (row.ticker) companyByTicker.set(row.ticker, row.id);
  }

  // ── Trades ───────────────────────────────────────────────────────────────
  const values = trades
    .map((t) => {
      const politicianId = idByKey.get(politicianExternalKey(t.chamber, t.politicianName));
      if (!politicianId) return null;
      const companyId = t.ticker ? (companyByTicker.get(t.ticker) ?? null) : null;
      if (companyId) result.tickersLinked++;
      return {
        politicianId,
        companyId,
        ticker: t.ticker,
        assetDescription: t.assetDescription,
        assetType: t.assetType,
        txnType: t.txnType,
        txnDate: t.txnDate,
        disclosedAt: t.disclosedAt,
        // Brackets, never a synthesised point value.
        amountMin: t.amountMin === null ? null : t.amountMin.toFixed(2),
        amountMax: t.amountMax === null ? null : t.amountMax.toFixed(2),
        amountRange: t.amountRange,
        owner: t.owner,
        comment: t.comment,
        source: t.chamber === "house" ? "house-stock-watcher" : "senate-stock-watcher",
        sourceUrl: t.sourceUrl,
        dedupKey: t.dedupKey,
        createdAt: now,
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  for (let i = 0; i < values.length; i += 500) {
    const written = await db
      .insert(politicianTrades)
      .values(values.slice(i, i + 500))
      .onConflictDoNothing({ target: politicianTrades.dedupKey })
      .returning({ id: politicianTrades.id });
    result.tradesInserted += written.length;
  }

  log("politician_ingest_complete", { ...result });
  return result;
}

/**
 * Re-link disclosures whose ticker we did not track at ingest time. Companies
 * arrive continuously from EDGAR, so a PTR ingested before its issuer's first
 * Form 4 would otherwise stay unlinked forever.
 */
export async function relinkPoliticianCompanies(db: Database): Promise<number> {
  const updated = await db
    .update(politicianTrades)
    .set({
      companyId: sql`(select c.id from companies c
        where c.ticker = ${politicianTrades.ticker} and c.country = 'US' limit 1)`,
    })
    .where(
      sql`${politicianTrades.companyId} is null and ${politicianTrades.ticker} is not null
        and exists (select 1 from companies c
          where c.ticker = ${politicianTrades.ticker} and c.country = 'US')`,
    )
    .returning({ id: politicianTrades.id });
  return updated.length;
}
