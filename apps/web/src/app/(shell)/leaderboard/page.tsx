import { Info } from "lucide-react";
import Link from "next/link";

import { SyntheticDataNotice } from "@/components/domain/synthetic-data-notice";
import { queryLeaderboard } from "@/lib/api/analytics-queries";
import { leaderboardQuerySchema } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Insider leaderboard",
  description:
    "Backward-looking performance statistics for insiders, measured against SPY. Informational only.",
};

export const revalidate = 3600;

const METRICS = [
  { key: "score", label: "Score", hint: "Mean 90-day excess return, shrunk by sample size" },
  { key: "avg_excess_90d", label: "Avg excess 90d", hint: "Unshrunk mean 90-day excess return" },
  { key: "hit_rate_90d", label: "Hit rate", hint: "Share of trades that beat the benchmark" },
  { key: "realized", label: "Realised", hint: "Closed buy→sell round trips, FIFO matched" },
] as const;

const pct = (v: number | null, digits = 1): string =>
  v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%`;

/**
 * Rank-control chip. These are links, not buttons — every ranking is a URL
 * you can send someone — but they behave as controls, so they take the pill
 * shape that means "clickable" everywhere else in the product.
 *
 * The selected one is weight and ground, never oxblood: the accent is spent
 * once per view, and a row of eight highlighted filters would spend it eight
 * times over and mean nothing.
 */
const chip = (selected: boolean): string =>
  cn(
    "inline-flex h-8 cursor-pointer items-center rounded-full border px-3 text-xs transition-colors",
    selected
      ? "border-border bg-fill font-semibold text-ink"
      : "border-transparent text-ink-muted hover:bg-fill hover:text-ink",
  );

/**
 * Vermillion up, blue down — the same pair the trade tape uses for buys and
 * sells, never red/green. A null score is faint rather than coloured as if
 * it were positive, and the sign is spelled out in the figure itself, so the
 * hue only ever agrees with something already written.
 */
const signInk = (v: number | null): string =>
  v === null ? "text-ink-faint" : v >= 0 ? "text-buy-ink" : "text-sell-ink";

/** Figure columns are right-aligned so the digits stack; each cell also
    takes `num` for the mono, tabular face that keeps them stacked. */
const FIGURE = "px-4 py-2.5 text-right";
const COL_HEAD = "px-4 py-3 text-right font-semibold";

export default async function LeaderboardPage({
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
  const query = leaderboardQuerySchema.parse(flat);
  const { data } = await queryLeaderboard(getDb(), query).catch(() => ({ data: [] }));

  const href = (patch: Record<string, string>) => {
    const params = new URLSearchParams();
    if (query.metric !== "score") params.set("metric", query.metric);
    if (query.min_trades !== 5) params.set("min_trades", String(query.min_trades));
    if (query.role) params.set("role", query.role);
    for (const [k, v] of Object.entries(patch)) {
      if (v) params.set(k, v);
      else params.delete(k);
    }
    const qs = params.toString();
    return qs ? `/leaderboard?${qs}` : "/leaderboard";
  };

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Insider leaderboard</h1>
        <p className="max-w-3xl text-sm text-ink-muted">
          How insiders&rsquo; discretionary trades performed against the S&amp;P 500 over the
          following 30/90/180 days. Sales are scored on the stock <em>falling</em>, so a well-timed
          exit counts as a win.
        </p>
      </header>

      {/* Stated up front, not buried in a footer. A sunken well rather than a
          coloured callout: the one place on this page allowed to spend the
          accent is SyntheticDataNotice below, and only when it fires. */}
      <div className="surface-sunken flex items-start gap-3 rounded-lg p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-ink-faint" aria-hidden />
        <p className="text-ink-muted">
          These are <strong>backward-looking descriptive statistics</strong> on public filings, not
          predictions and <strong>not investment advice</strong>. Past returns say nothing about
          future ones, and a high rank can still be luck — which is why the composite score is
          shrunk toward zero by sample size and why the default requires at least {query.min_trades}{" "}
          scored trades.{" "}
          <Link
            href="/docs/methodology"
            className="cursor-pointer font-medium text-ink underline underline-offset-2 hover:text-accent-ink"
          >
            Read the full methodology
          </Link>
          .
        </p>
      </div>

      <SyntheticDataNotice />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Rank by</legend>
          <span className="text-2xs uppercase tracking-widest text-ink-faint">Rank by</span>
          {METRICS.map((m) => (
            <Link
              key={m.key}
              href={href({ metric: m.key === "score" ? "" : m.key })}
              title={m.hint}
              aria-current={query.metric === m.key ? "true" : undefined}
              className={chip(query.metric === m.key)}
            >
              {m.label}
            </Link>
          ))}
        </fieldset>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Minimum scored trades</legend>
          <span className="text-2xs uppercase tracking-widest text-ink-faint">Min trades</span>
          {[3, 5, 10, 25].map((n) => (
            <Link
              key={n}
              href={href({ min_trades: String(n) })}
              aria-current={query.min_trades === n ? "true" : undefined}
              className={cn(chip(query.min_trades === n), "num")}
            >
              {n}
            </Link>
          ))}
        </fieldset>
      </div>

      {data.length === 0 ? (
        <div className="surface rounded-lg px-4 py-12 text-center">
          <p className="text-sm text-ink-muted">No insiders have enough scored trades yet.</p>
          <p className="text-2xs mt-2 text-ink-faint">
            Scoring runs nightly and needs at least 30 days of price history after each trade, so a
            fresh database has nothing to rank. Lower the minimum-trades filter, or wait for the
            next nightly run.
          </p>
        </div>
      ) : (
        // The card is the scroll container, so a wide ranking slides inside
        // its own hairline instead of pushing the page sideways.
        <div className="surface overflow-x-auto rounded-lg">
          <table className="w-full min-w-[820px] text-sm">
            <caption className="sr-only">
              Insiders ranked by {METRICS.find((m) => m.key === query.metric)?.label}
            </caption>
            {/* Header ground is opaque, never a wash: it has to sit over the
                zebra bands cleanly. It is not sticky, because the wrapper
                scrolls horizontally and `overflow-x` forces the vertical axis
                to scroll with it — sticky would pin to a box that never moves. */}
            <thead>
              <tr className="text-2xs border-b border-border bg-surface text-left uppercase tracking-wider text-ink-muted">
                <th scope="col" className="px-4 py-3 font-semibold">
                  #
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Insider
                </th>
                <th scope="col" className={COL_HEAD}>
                  Score
                </th>
                <th scope="col" className={COL_HEAD}>
                  Avg excess 90d
                </th>
                <th scope="col" className={COL_HEAD}>
                  Median 90d
                </th>
                <th scope="col" className={COL_HEAD}>
                  Hit rate
                </th>
                <th scope="col" className={COL_HEAD}>
                  Realised
                </th>
                <th scope="col" className={COL_HEAD}>
                  Trades
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Zebra is a flat background band and the rules are hairlines —
                  no per-row shadow, blur or gradient, because this list is
                  scrolled and every one of those costs a frame. */}
              {data.map((row, i) => (
                <tr
                  key={row.insiderId}
                  className="border-b border-border last:border-0 even:bg-fill/55 hover:bg-fill"
                >
                  <td className="num px-4 py-2.5 text-ink-faint">{query.offset + i + 1}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/insider/${row.insiderId}`}
                      className="cursor-pointer font-medium underline-offset-2 hover:underline"
                    >
                      {row.name}
                    </Link>
                    {row.title ? (
                      <span className="text-2xs ml-2 text-ink-faint">{row.title}</span>
                    ) : null}
                  </td>
                  <td className={cn(FIGURE, "num font-semibold", signInk(row.score))}>
                    {row.score === null ? "—" : row.score.toFixed(2)}
                  </td>
                  <td className={cn(FIGURE, "num")}>{pct(row.avgExcess90d)}</td>
                  <td className={cn(FIGURE, "num text-ink-muted")}>{pct(row.medianExcess90d)}</td>
                  <td className={cn(FIGURE, "num")}>
                    {row.hitRate90d === null ? "—" : `${(row.hitRate90d * 100).toFixed(0)}%`}
                  </td>
                  <td className={cn(FIGURE, "num text-ink-muted")}>
                    {row.realizedTrades === 0 ? "—" : pct(row.realizedReturnPct)}
                  </td>
                  <td className={cn(FIGURE, "num text-ink-muted")}>{row.scoredTrades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-2xs text-ink-faint">
        Only discretionary (non-routine), non-superseded trades with usable price history are
        scored. Excess returns are measured against SPY.{" "}
        <Link
          href="/docs/methodology"
          className="cursor-pointer underline underline-offset-2 hover:text-ink"
        >
          Methodology
        </Link>{" "}
        · <strong>Not investment advice.</strong>
      </p>
    </div>
  );
}
