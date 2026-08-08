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

/**
 * Grouping and timeframe are URL state, so they are links, not buttons — the
 * back button has to walk through them. They are pill-shaped because they are
 * interactive; the rectangular badges elsewhere are not, and that shape
 * difference is the only affordance a reader gets.
 *
 * The selected one is marked by weight and ground, never by the accent. A row
 * of oxblood pills would spend the page's one accent six times over.
 */
const PILL_BASE = "cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors";
const PILL_ON = "border-border bg-fill font-semibold text-ink";
const PILL_OFF = "border-transparent text-ink-muted hover:bg-fill hover:text-ink";

/**
 * Sticky header cell for the table view. Opaque, never translucent: a blurred
 * or semi-transparent sticky header repaints every row beneath it on each
 * scroll frame, which is the single most expensive thing a long table can do.
 */
const HEAD_CLASS =
  "sticky top-0 z-10 bg-surface py-2 pr-3 font-semibold shadow-[0_1px_0_var(--border)]";

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
      <header className="rail-bleed flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Insider flow heatmap</h1>
        <p className="max-w-2xl text-sm text-ink-muted">
          Area is gross notional traded; fill is how one-sided that flow was, on a sequential ramp.
          Direction is the ▲/▼ on the tile, never its colour. Click any tile to open the matching
          screen.
        </p>
      </header>

      <SyntheticDataNotice />

      {/* Filters in one row above the chart. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Group by</legend>
          <span className="text-2xs text-ink-faint">Group</span>
          {GROUPS.map((g) => (
            <Link
              key={g.key}
              href={href({ group_by: g.key === "company" ? "" : g.key })}
              aria-current={query.group_by === g.key ? "true" : undefined}
              className={cn(PILL_BASE, query.group_by === g.key ? PILL_ON : PILL_OFF)}
            >
              {g.label}
            </Link>
          ))}
        </fieldset>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Timeframe</legend>
          <span className="text-2xs text-ink-faint">Range</span>
          {TIMEFRAME_KEYS.map((tf) => (
            <Link
              key={tf}
              href={href({ timeframe: tf })}
              aria-current={activeTimeframe === tf ? "true" : undefined}
              className={cn(PILL_BASE, "num", activeTimeframe === tf ? PILL_ON : PILL_OFF)}
            >
              {tf}
            </Link>
          ))}
        </fieldset>

        <p className="ml-auto text-xs text-ink-muted">
          <span className="num">{cells.length}</span> cells ·{" "}
          <span className="num">{totals.trades.toLocaleString("en-US")}</span> trades · net{" "}
          <span
            className={cn(
              "num font-semibold",
              net > 0 ? "text-buy-ink" : net < 0 ? "text-sell-ink" : "text-ink-muted",
            )}
          >
            <span aria-hidden>{net > 0 ? "▲" : net < 0 ? "▼" : "▬"}</span> {net >= 0 ? "+" : "−"}$
            {Math.abs(Math.round(net)).toLocaleString("en-US")}
          </span>
        </p>
      </div>

      {/* The chart and its legend share one sheet of paper — a key that sits
          on a different surface from the thing it explains reads as a caption
          for the page rather than for the chart. */}
      <div className="surface rounded-lg p-3">
        <HeatmapTreemap
          cells={cells}
          groupBy={query.group_by}
          days={query.days}
          market={query.market}
        />
      </div>

      {/* A table view of the same data: identity is never colour-alone. */}
      <details className="surface rounded-lg p-4">
        <summary className="cursor-pointer text-sm font-medium text-ink">
          Table view ({cells.length} rows)
        </summary>
        <div className="mt-3 max-h-[26rem] overflow-auto">
          <table className="w-full min-w-[540px] text-sm">
            <thead>
              <tr className="text-left text-2xs text-ink-muted">
                <th scope="col" className={HEAD_CLASS}>
                  {query.group_by === "company"
                    ? "Company"
                    : GROUPS.find((g) => g.key === query.group_by)?.label}
                </th>
                <th scope="col" className={cn(HEAD_CLASS, "text-right")}>
                  Bought
                </th>
                <th scope="col" className={cn(HEAD_CLASS, "text-right")}>
                  Sold
                </th>
                <th scope="col" className={cn(HEAD_CLASS, "text-right")}>
                  Net
                </th>
                <th scope="col" className={cn(HEAD_CLASS, "pr-0 text-right")}>
                  Trades
                </th>
              </tr>
            </thead>
            <tbody>
              {cells.map((c, i) => (
                <tr
                  key={c.key}
                  // Zebra rather than a rule per row: banding survives a long
                  // scroll where a hairline grid turns into noise.
                  className={cn("border-t border-border", i % 2 === 1 && "bg-fill/55")}
                >
                  <td className="py-1.5 pr-3">
                    {c.ticker ? (
                      <Link
                        href={`/stock/${c.ticker}`}
                        className="num cursor-pointer font-medium text-ink underline-offset-4 transition-colors hover:underline"
                      >
                        {c.label}
                      </Link>
                    ) : (
                      c.label
                    )}
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-buy-ink">
                    ${Math.round(c.buyValueUsd).toLocaleString("en-US")}
                  </td>
                  <td className="num py-1.5 pr-3 text-right text-sell-ink">
                    ${Math.round(c.sellValueUsd).toLocaleString("en-US")}
                  </td>
                  <td className="num py-1.5 pr-3 text-right font-medium text-ink">
                    <span aria-hidden>
                      {c.netValueUsd > 0 ? "▲" : c.netValueUsd < 0 ? "▼" : "▬"}
                    </span>{" "}
                    {c.netValueUsd >= 0 ? "+" : "−"}$
                    {Math.abs(Math.round(c.netValueUsd)).toLocaleString("en-US")}
                  </td>
                  <td className="num py-1.5 text-right text-ink">
                    {c.trades.toLocaleString("en-US")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className="text-2xs text-ink-faint">
        Aggregated from public regulatory filings. Synthetic test fixtures are excluded.{" "}
        <strong>Not investment advice.</strong>
      </p>
    </div>
  );
}
