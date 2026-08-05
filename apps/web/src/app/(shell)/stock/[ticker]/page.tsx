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
    <div className="flex flex-col gap-8 pb-24">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden
          className="bg-gradient-accent flex size-12 items-center justify-center rounded-xl text-lg font-bold text-[#06231f]"
        >
          {ticker.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <span className="font-mono">{ticker}</span>
            <CountryFlag country={company.country} className="text-lg" />
            {cluster && cluster.distinctBuyers >= 2 ? (
              <span
                className="text-2xs rounded-full bg-buy-soft px-2 py-0.5 font-medium uppercase tracking-wide text-buy ring-1 ring-inset ring-buy/30"
                title={
                  cluster.windowStart && cluster.windowEnd
                    ? `${cluster.distinctBuyers} distinct insiders bought across ${cluster.tradeCount} trades between ${cluster.windowStart} and ${cluster.windowEnd}`
                    : `${cluster.distinctBuyers} distinct insiders bought within ${cluster.windowDays} days`
                }
              >
                cluster buying · {cluster.distinctBuyers} insiders
              </span>
            ) : null}
            {/* Only shown when the baseline is deep enough to support one. */}
            {anomaly?.zScore !== null && anomaly && Math.abs(anomaly.zScore!) >= 2 ? (
              <span
                className="text-2xs rounded-full bg-white/6 px-2 py-0.5 font-medium uppercase tracking-wide text-amber-200 ring-1 ring-inset ring-amber-300/25"
                title={`Net insider flow over the last ${anomaly.windowDays} days is ${anomaly.zScore!.toFixed(1)} standard deviations from this company's own trailing average, across ${anomaly.sampleSize} prior windows`}
              >
                unusual flow · {anomaly.zScore! > 0 ? "+" : "−"}
                {Math.abs(anomaly.zScore!).toFixed(1)}σ
              </span>
            ) : null}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {company.name}
            {company.sector ? ` · ${company.sector}` : ""}
            {company.exchange ? ` · ${company.exchange}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastClose ? (
            <div className="text-right">
              <p className="tnum text-lg font-semibold">
                {company.country === "IN" ? "₹" : "$"}
                {lastClose.close.toLocaleString("en-US")}
              </p>
              <p className="text-2xs text-subtle-foreground">close {lastClose.date}</p>
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

      {/* 90-day stats */}
      {stats ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Trades · 90d" value={stats.trades} />
          <StatCard label="Bought · 90d" value={stats.buyValueUsd} preset="usd" />
          <StatCard label="Sold · 90d" value={stats.sellValueUsd} preset="usd" />
          <StatCard label="Net flow · 90d" value={stats.netValueUsd} preset="signed-usd" accent />
        </div>
      ) : null}

      <ChartsPanel netFlow={netFlow} sentiment={sentiment} />

      {/* Filing history */}
      <section aria-label="Insider trade history" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Insider trades
          </h2>
          <Link
            href={showAmendments ? `/stock/${ticker}` : `/stock/${ticker}?amendments=1`}
            data-testid="amendments-toggle"
            className="text-2xs glass rounded-lg px-2.5 py-1.5 uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            {showAmendments ? "Hide amendments" : "Show amendments"}
          </Link>
        </div>
        {trades.data.length === 0 ? (
          <p className="glass rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
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
            <h2
              id="congress-heading"
              className="text-sm font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Congressional disclosures
            </h2>
            <Link
              href={`/politicians?ticker=${ticker}`}
              className="text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              All {ticker} disclosures
            </Link>
          </div>
          <p className="text-2xs text-subtle-foreground">
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
        <section aria-label="Ownership timeline" className="glass overflow-x-auto rounded-xl p-4">
          <h2 className="mb-1 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Ownership timeline
          </h2>
          <p className="text-2xs mb-3 text-subtle-foreground">
            First vs latest disclosed post-transaction holdings per insider — no interpolation.
          </p>
          <table className="tnum w-full text-left text-sm">
            <thead>
              <tr className="text-2xs border-b border-white/8 uppercase text-subtle-foreground">
                <th className="py-1.5 pr-4">Insider</th>
                <th className="py-1.5 pr-4">First filing</th>
                <th className="py-1.5 pr-4">Latest filing</th>
                <th className="py-1.5 pr-4">Held then</th>
                <th className="py-1.5">Held now</th>
              </tr>
            </thead>
            <tbody>
              {ownership.map((entry) => (
                <tr key={entry.insiderId} className="border-b border-white/4">
                  <td className="max-w-56 truncate py-2 pr-4">
                    <Link href={`/insider/${entry.insiderId}`} className="hover:text-teal">
                      {entry.insiderName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">{entry.firstDate}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{entry.lastDate}</td>
                  <td className="py-2 pr-4">{entry.firstShares?.toLocaleString("en-US") ?? "—"}</td>
                  <td className="py-2">{entry.lastShares?.toLocaleString("en-US") ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
  );
}
