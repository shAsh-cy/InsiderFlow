import Link from "next/link";

import { SyntheticDataNotice } from "@/components/domain/synthetic-data-notice";
import { HeatmapTreemap } from "@/components/heatmap/heatmap-treemap";
import { queryHeatmap } from "@/lib/api/queries";
import { heatmapQuerySchema, TIMEFRAMES } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Heatmap",
  description: "Net insider buying and selling by company, sector, or country.",
};

// Revalidated rather than dynamic: the underlying aggregate moves on the
// ingest cron, not per request, and the API route caches for the same window.
export const revalidate = 300;

const GROUPS = [
  { key: "company", label: "Company" },
  { key: "sector", label: "Sector" },
  { key: "country", label: "Country" },
] as const;

const TIMEFRAME_KEYS = Object.keys(TIMEFRAMES) as Array<keyof typeof TIMEFRAMES>;

export default async function HeatmapPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const flat = Object.fromEntries(
    Object.entries(raw)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, Array.isArray(v) ? v[0]! : v]),
  );
  const query = heatmapQuerySchema.parse({ ...flat, limit: flat.limit ?? "120" });
  const cells = await queryHeatmap(getDb(), query).catch(() => []);

  const totals = cells.reduce(
    (acc, c) => ({
      buy: acc.buy + c.buyValueUsd,
      sell: acc.sell + c.sellValueUsd,
      trades: acc.trades + c.trades,
    }),
    { buy: 0, sell: 0, trades: 0 },
  );
  const net = totals.buy - totals.sell;

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams();
    if (query.group_by !== "company") params.set("group_by", query.group_by);
    if (query.timeframe) params.set("timeframe", query.timeframe);
    if (query.market) params.set("market", query.market);
    if (query.relevance) params.set("relevance", query.relevance);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    return qs ? `/heatmap?${qs}` : "/heatmap";
  };

  const activeTimeframe =
    query.timeframe ?? (TIMEFRAME_KEYS.find((k) => TIMEFRAMES[k] === query.days) || "30d");

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Insider flow heatmap</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Area is gross notional traded; colour is net direction —{" "}
          <span className="text-emerald-300">teal for net buying</span>,{" "}
          <span className="text-violet-300">violet for net selling</span>. Click any tile to open
          the matching screen.
        </p>
      </header>

      <SyntheticDataNotice />

      {/* Filters in one row above the chart. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Group by</legend>
          <span className="text-2xs uppercase tracking-widest text-subtle-foreground">Group</span>
          {GROUPS.map((g) => (
            <Link
              key={g.key}
              href={href({ group_by: g.key === "company" ? "" : g.key })}
              aria-current={query.group_by === g.key ? "true" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                query.group_by === g.key
                  ? "bg-white/8 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
              )}
            >
              {g.label}
            </Link>
          ))}
        </fieldset>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Timeframe</legend>
          <span className="text-2xs uppercase tracking-widest text-subtle-foreground">Range</span>
          {TIMEFRAME_KEYS.map((tf) => (
            <Link
              key={tf}
              href={href({ timeframe: tf })}
              aria-current={activeTimeframe === tf ? "true" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs tabular-nums transition-colors",
                activeTimeframe === tf
                  ? "bg-white/8 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
              )}
            >
              {tf}
            </Link>
          ))}
        </fieldset>

        <p className="tnum ml-auto text-xs text-subtle-foreground">
          {cells.length} cells · {totals.trades.toLocaleString("en-US")} trades · net{" "}
          <span className={net >= 0 ? "text-emerald-300" : "text-violet-300"}>
            {net >= 0 ? "+" : "−"}${Math.abs(Math.round(net)).toLocaleString("en-US")}
          </span>
        </p>
      </div>

      <div className="glass rounded-xl p-2">
        <HeatmapTreemap
          cells={cells}
          groupBy={query.group_by}
          days={query.days}
          market={query.market}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-2xs text-subtle-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-3 rounded-sm"
            style={{ background: "oklch(0.54 0.16 178)" }}
          />
          Net buying
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-3 rounded-sm"
            style={{ background: "oklch(0.30 0.012 260)" }}
          />
          Balanced
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-3 rounded-sm"
            style={{ background: "oklch(0.54 0.16 305)" }}
          />
          Net selling
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 rounded-full"
            style={{ background: "oklch(0.78 0.15 178)" }}
          />
          MSPR available (sparse — Finnhub coverage only)
        </span>
      </div>

      {/* A table view of the same data: identity is never colour-alone. */}
      <details className="glass rounded-xl p-4">
        <summary className="cursor-pointer text-sm font-medium">
          Table view ({cells.length} rows)
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr className="text-left text-2xs uppercase tracking-widest text-subtle-foreground">
                <th className="pb-2 pr-3 font-medium">
                  {query.group_by === "company"
                    ? "Company"
                    : GROUPS.find((g) => g.key === query.group_by)?.label}
                </th>
                <th className="pb-2 pr-3 text-right font-medium">Bought</th>
                <th className="pb-2 pr-3 text-right font-medium">Sold</th>
                <th className="pb-2 pr-3 text-right font-medium">Net</th>
                <th className="pb-2 text-right font-medium">Trades</th>
              </tr>
            </thead>
            <tbody className="tnum">
              {cells.map((c) => (
                <tr key={c.key} className="border-t border-white/5">
                  <td className="py-1.5 pr-3">
                    {c.ticker ? (
                      <Link href={`/stock/${c.ticker}`} className="hover:text-foreground">
                        {c.label}
                      </Link>
                    ) : (
                      c.label
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-emerald-300/90">
                    ${Math.round(c.buyValueUsd).toLocaleString("en-US")}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-violet-300/90">
                    ${Math.round(c.sellValueUsd).toLocaleString("en-US")}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-medium">
                    {c.netValueUsd >= 0 ? "+" : "−"}$
                    {Math.abs(Math.round(c.netValueUsd)).toLocaleString("en-US")}
                  </td>
                  <td className="py-1.5 text-right">{c.trades.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="text-2xs text-subtle-foreground">
        Aggregated from public regulatory filings. Synthetic test fixtures are excluded.{" "}
        <strong>Not investment advice.</strong>
      </p>
    </div>
  );
}
