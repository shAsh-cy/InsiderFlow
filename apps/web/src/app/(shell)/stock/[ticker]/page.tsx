import Link from "next/link";
import { notFound } from "next/navigation";

import { CountryFlag } from "@/components/domain/country-flag";
import { StatCard } from "@/components/domain/stat-card";
import { PoliticianTradeTable } from "@/components/politicians/politician-trade-table";
import { ChartsPanel } from "@/components/stock/charts-panel";
import { BulkBlockPanel, PledgePanel, SastPanel } from "@/components/stock/india-panels";
import { TradeTable } from "@/components/trades/trade-table";
import { WatchlistButton } from "@/components/watchlist/watchlist-button";
import { queryCompanyAnomaly, queryPoliticianTradesForTicker } from "@/lib/api/analytics-queries";
import {
  queryCompanyStats,
  queryPriceContext,
  querySentiment,
  queryTrades,
} from "@/lib/api/queries";
import {
  queryBulkBlockForSymbol,
  queryClusterInfo,
  queryCompanyByTicker,
  queryNetFlow,
  queryOwnershipTimeline,
  queryPledgesForSymbol,
  querySastForSymbol,
} from "@/lib/api/page-queries";
import { flattenSearchParams, type NextSearchParams } from "@/lib/api/search-params";
import { tradesQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  return { title: `${(await params).ticker.toUpperCase()} insider activity` };
}

/**
 * Stock page — US and Indian tickers. Everything server-rendered through
 * the shared query layer; failures in optional panels degrade to empty
 * states rather than breaking the page.
 */
export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: NextSearchParams;
}) {
  const ticker = (await params).ticker.toUpperCase().slice(0, 12);
  const showAmendments = flattenSearchParams(await searchParams).amendments === "1";

  const db = getDb();
  const header = await queryCompanyByTicker(db, ticker).catch(() => null);
  if (!header) notFound();
  const { company, lastClose } = header;
  const isIndia = company.country === "IN";

  const base = tradesQuerySchema.parse({});
  const [
    stats,
    trades,
    priceContext,
    netFlow,
    ownership,
    cluster,
    sentiment,
    anomaly,
    politicianTrades,
    sast,
    bulkBlock,
    pledges,
  ] = await Promise.all([
    queryCompanyStats(db, company.id).catch(() => null),
    queryTrades(db, {
      ...base,
      ticker,
      limit: 100,
      include_superseded: showAmendments,
    }).catch(() => ({ data: [], meta: null })),
    queryPriceContext(db, company.id).catch(() => []),
    queryNetFlow(db, company.id).catch(() => []),
    queryOwnershipTimeline(db, company.id).catch(() => []),
    queryClusterInfo(db, company.id).catch(() => null),
    company.ticker ? querySentiment(db, company.ticker).catch(() => []) : Promise.resolve([]),
    queryCompanyAnomaly(db, company.id).catch(() => null),
    // Congressional overlay — US equities only; the STOCK Act covers no others.
    company.country === "US"
      ? queryPoliticianTradesForTicker(db, ticker).catch(() => [])
      : Promise.resolve([]),
    isIndia ? querySastForSymbol(db, ticker).catch(() => []) : Promise.resolve([]),
    isIndia ? queryBulkBlockForSymbol(db, ticker).catch(() => []) : Promise.resolve([]),
    isIndia ? queryPledgesForSymbol(db, ticker).catch(() => []) : Promise.resolve([]),
  ]);

  return (
    /*
     * Asymmetric two-column at xl: the record on the left, the read-at-a-
     * glance panel on the right.
     *
     * xl (1280px) and not lg, deliberately. Inside the sidebar shell, lg
     * leaves 716px of content region — the nine-column trade table already
     * scrolls in that, and dividing it again would reproduce the dead-zone
     * problem in miniature rather than fix it. The two-column form starts
     * where the page has width to divide. The landing page, which has no
     * sidebar and 976px at lg, splits there instead.
     *
     * The rail is SECOND in the DOM and placed into column 2 by grid, so
     * the single-column reading order stays header → figures → tables. Put
     * it third and every phone would read the whole filing history before
     * being told the ninety-day net flow.
     */
    <div className="grid gap-8 pb-24 xl:grid-cols-[minmax(0,1fr)_21rem] xl:gap-x-8">
      {/* Header */}
      <header className="rail-bleed flex flex-wrap items-center gap-4 xl:col-span-2">
        {/* A tile of stock with the symbol stamped on it — not a gradient
            chip and not the page's accent. The accent is already spent, once,
            on the net-flow stat card below. */}
        <span
          aria-hidden
          className="surface-sunken num flex size-12 items-center justify-center rounded-lg text-lg font-semibold text-ink-muted"
        >
          {ticker.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex min-w-0 flex-wrap items-center gap-2.5 text-2xl font-semibold tracking-tight text-ink">
            {/* `truncate` on the symbol itself: the route admits twelve
                characters, and twelve characters of 24px mono is 202px —
                wider than the whole name column on a 360px phone. Without
                it the symbol paints outside its own box. */}
            <span className="num max-w-full truncate">{ticker}</span>
            <CountryFlag country={company.country} className="text-lg" />
            {/* Rectangular, not a pill: these annotate the symbol, they are
                not controls, and in this product a pill promises a click. */}
            {cluster && cluster.distinctBuyers >= 2 ? (
              <span
                className="text-2xs rounded-sm border border-buy-ink/30 bg-buy-soft px-2 py-0.5 font-medium tracking-wide text-buy-ink"
                title={
                  cluster.windowStart && cluster.windowEnd
                    ? `${cluster.distinctBuyers} distinct insiders bought across ${cluster.tradeCount} trades between ${cluster.windowStart} and ${cluster.windowEnd}`
                    : `${cluster.distinctBuyers} distinct insiders bought within ${cluster.windowDays} days`
                }
              >
                cluster buying · <span className="num">{cluster.distinctBuyers}</span> insiders
              </span>
            ) : null}
            {/* Only shown when the baseline is deep enough to support one.
                Deliberately colourless: unusual flow has no side, and giving
                it a buy or sell hue would assert a direction the z-score
                does not carry. Weight and ground do the work instead. */}
            {anomaly?.zScore !== null && anomaly && Math.abs(anomaly.zScore!) >= 2 ? (
              <span
                className="text-2xs rounded-sm border border-border bg-fill px-2 py-0.5 font-medium tracking-wide text-ink-muted"
                title={`Net insider flow over the last ${anomaly.windowDays} days is ${anomaly.zScore!.toFixed(1)} standard deviations from this company's own trailing average, across ${anomaly.sampleSize} prior windows`}
              >
                unusual flow ·{" "}
                <span className="num text-ink">
                  {anomaly.zScore! > 0 ? "+" : "−"}
                  {Math.abs(anomaly.zScore!).toFixed(1)}σ
                </span>
              </span>
            ) : null}
          </h1>
          <p className="truncate text-sm text-ink-muted">
            {company.name}
            {company.sector ? ` · ${company.sector}` : ""}
            {company.exchange ? ` · ${company.exchange}` : ""}
          </p>
        </div>
        {/* `w-full` below sm forces this group onto its own line. Left
            inline it takes ~176px of max-content off the top of the line
            box, which leaves the symbol and company name 56px at 360px —
            i.e. the page's own title becomes an ellipsis. */}
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
          {lastClose ? (
            <div className="text-right">
              <p className="num text-lg font-semibold text-ink">
                {company.country === "IN" ? "₹" : "$"}
                {lastClose.close.toLocaleString("en-US")}
              </p>
              <p className="text-2xs text-ink-faint">
                close <span className="num">{lastClose.date}</span>
              </p>
            </div>
          ) : null}
          <WatchlistButton
            kind="company"
            refId={ticker}
            label={company.name}
            market={company.country}
          />
        </div>
      </header>

      {/* ── The panel rail ─────────────────────────────────────────────
          Figures and notes, never a table: at 21rem a five-column table
          would only scroll, and a rail whose contents scroll sideways is
          worse than no rail. Below xl this is a full-width band and the
          stat cards spread across it, which is what the strip should do
          when there is a strip to be had. */}
      <aside data-testid="stock-rail" className="flex flex-col gap-6 xl:col-start-2 xl:row-start-2">
        {/* 90-day stats */}
        {stats ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-1">
            <StatCard label="Trades · 90d" value={stats.trades} />
            <StatCard label="Bought · 90d" value={stats.buyValueUsd} preset="usd" />
            <StatCard label="Sold · 90d" value={stats.sellValueUsd} preset="usd" />
            <StatCard label="Net flow · 90d" value={stats.netValueUsd} preset="signed-usd" accent />
          </div>
        ) : null}

        {/* ── Reserved slot: insider trades against the price line ────────
            Framed now rather than left blank so the page's rhythm does not
            shift when the chart lands, and so the gap reads as "not built"
            rather than "no data" — the two are very different claims to make
            about a company, and only one of them is true here.

            What goes here: the daily close for this symbol with each non-routine
            insider trade marked on the date it happened, buys and sells in the
            Wong tokens, so a reader can see whether the filing led the move or
            followed it. Do not synthesise prices for dates we do not hold. */}
        <section
          aria-labelledby="price-overlay-heading"
          className="surface-sunken flex min-h-28 flex-col justify-center rounded-lg p-4"
        >
          <h2 id="price-overlay-heading" className="text-sm font-semibold text-ink-muted">
            Trades vs price
          </h2>
          <p className="text-2xs mt-2 max-w-prose text-ink-faint">
            Reserved for the trade-marker overlay on this symbol&rsquo;s daily close — not built
            yet.
          </p>
        </section>
      </aside>

      {/* ── The record ──────────────────────────────────────────────── */}
      <div
        data-testid="stock-record"
        className="flex min-w-0 flex-col gap-8 xl:col-start-1 xl:row-start-2"
      >
        <ChartsPanel netFlow={netFlow} sentiment={sentiment} />

        {/* Filing history */}
        <section aria-label="Insider trade history" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-muted">Insider trades</h2>
            {/* A control, so it takes the pill shape — its state is carried by
              the label flipping, which is why it needs no active styling. */}
            <Link
              href={showAmendments ? `/stock/${ticker}` : `/stock/${ticker}?amendments=1`}
              data-testid="amendments-toggle"
              className="text-2xs inline-flex h-8 cursor-pointer items-center rounded-full border border-border bg-surface px-3 text-ink-muted transition-colors hover:bg-fill hover:text-ink"
            >
              {showAmendments ? "Hide amendments" : "Show amendments"}
            </Link>
          </div>
          {trades.data.length === 0 ? (
            <p className="surface rounded-lg px-4 py-8 text-center text-sm text-ink-muted">
              No insider transactions on record for {ticker}
              {isIndia
                ? " — PIT rows appear only when an operator runs the optional India ingestion."
                : "."}
            </p>
          ) : (
            <TradeTable
              rows={trades.data}
              priceContext={priceContext}
              aria-label={`Insider trades for ${ticker}`}
            />
          )}
        </section>

        {/* Congressional overlay — a separate disclosure regime, kept visually
          separate from Section 16 insider filings rather than merged into them. */}
        {politicianTrades.length > 0 ? (
          <section
            aria-labelledby="congress-heading"
            className="flex flex-col gap-3"
            data-testid="politician-overlay"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="congress-heading" className="text-sm font-semibold text-ink-muted">
                Congressional disclosures
              </h2>
              <Link
                href={`/politicians?ticker=${ticker}`}
                className="text-2xs cursor-pointer text-ink-muted underline underline-offset-2 hover:text-ink"
              >
                All <span className="num">{ticker}</span> disclosures
              </Link>
            </div>
            <p className="text-2xs text-ink-faint">
              STOCK Act filings by members of Congress. Amounts are disclosed brackets, never exact
              figures, and a PTR may be filed up to 45 days after the trade.
            </p>
            <PoliticianTradeTable
              rows={politicianTrades}
              caption={`Congressional disclosures involving ${ticker}`}
            />
          </section>
        ) : null}

        {/* Ownership timeline */}
        {ownership.length > 0 ? (
          <section aria-label="Ownership timeline" className="surface rounded-lg p-4">
            <h2 className="mb-1 text-sm font-semibold text-ink-muted">Ownership timeline</h2>
            <p className="text-2xs mb-3 text-ink-faint">
              First vs latest disclosed post-transaction holdings per insider — no interpolation.
            </p>
            {/* Scroll lives on the wrapper, not the card: a wide table slides
              under its own header instead of dragging the page sideways. */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-2xs border-b border-border tracking-wider text-ink-muted">
                    <th className="py-1.5 pr-4 font-semibold">Insider</th>
                    <th className="py-1.5 pr-4 font-semibold">First filing</th>
                    <th className="py-1.5 pr-4 font-semibold">Latest filing</th>
                    <th className="py-1.5 pr-4 text-right font-semibold">Held then</th>
                    <th className="py-1.5 text-right font-semibold">Held now</th>
                  </tr>
                </thead>
                <tbody>
                  {ownership.map((entry) => (
                    <tr
                      key={entry.insiderId}
                      className="border-b border-border last:border-0 even:bg-fill/55 hover:bg-fill"
                    >
                      <td className="max-w-56 truncate py-2 pr-4">
                        <Link
                          href={`/insider/${entry.insiderId}`}
                          className="cursor-pointer underline-offset-2 hover:underline"
                        >
                          {entry.insiderName}
                        </Link>
                      </td>
                      <td className="num py-2 pr-4 text-ink-muted">{entry.firstDate}</td>
                      <td className="num py-2 pr-4 text-ink-muted">{entry.lastDate}</td>
                      <td className="num py-2 pr-4 text-right">
                        {entry.firstShares?.toLocaleString("en-US") ?? "—"}
                      </td>
                      <td className="num py-2 text-right">
                        {entry.lastShares?.toLocaleString("en-US") ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* India disclosures */}
        {isIndia ? (
          <div className="flex flex-col gap-5" data-testid="india-panels">
            <SastPanel rows={sast} />
            <BulkBlockPanel rows={bulkBlock} />
            <PledgePanel rows={pledges} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
