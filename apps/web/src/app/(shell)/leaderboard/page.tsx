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
        <h1 className="text-2xl font-semibold tracking-tight">Insider leaderboard</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">
          How insiders&rsquo; discretionary trades performed against the S&amp;P 500 over the
          following 30/90/180 days. Sales are scored on the stock <em>falling</em>, so a well-timed
          exit counts as a win.
        </p>
      </header>

      {/* Stated up front, not buried in a footer. */}
      <div className="glass flex items-start gap-3 rounded-xl border border-white/8 p-4 text-sm">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-muted-foreground">
          These are <strong>backward-looking descriptive statistics</strong> on public filings, not
          predictions and <strong>not investment advice</strong>. Past returns say nothing about
          future ones, and a high rank can still be luck — which is why the composite score is
          shrunk toward zero by sample size and why the default requires at least {query.min_trades}{" "}
          scored trades.{" "}
          <Link href="/docs/methodology" className="text-brand-teal underline underline-offset-2">
            Read the full methodology
          </Link>
          .
        </p>
      </div>

      <SyntheticDataNotice />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <fieldset className="flex flex-wrap items-center gap-1.5">
          <legend className="sr-only">Rank by</legend>
          <span className="text-2xs uppercase tracking-widest text-subtle-foreground">Rank by</span>
          {METRICS.map((m) => (
            <Link
              key={m.key}
              href={href({ metric: m.key === "score" ? "" : m.key })}
              title={m.hint}
              aria-current={query.metric === m.key ? "true" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                query.metric === m.key
                  ? "bg-white/8 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
              )}
            >
              {m.label}
            </Link>
          ))}
        </fieldset>

        <fieldset className="flex items-center gap-1.5">
          <legend className="sr-only">Minimum scored trades</legend>
          <span className="text-2xs uppercase tracking-widest text-subtle-foreground">
            Min trades
          </span>
          {[3, 5, 10, 25].map((n) => (
            <Link
              key={n}
              href={href({ min_trades: String(n) })}
              aria-current={query.min_trades === n ? "true" : undefined}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs tabular-nums transition-colors",
                query.min_trades === n
                  ? "bg-white/8 font-medium text-foreground"
                  : "text-muted-foreground hover:bg-white/4 hover:text-foreground",
              )}
            >
              {n}
            </Link>
          ))}
        </fieldset>
      </div>

      {data.length === 0 ? (
        <div className="glass rounded-xl px-4 py-12 text-center">
          <p className="text-sm text-muted-foreground">
            No insiders have enough scored trades yet.
          </p>
          <p className="text-2xs mt-2 text-subtle-foreground">
            Scoring runs nightly and needs at least 30 days of price history after each trade, so a
            fresh database has nothing to rank. Lower the minimum-trades filter, or wait for the
            next nightly run.
          </p>
        </div>
      ) : (
        <div className="glass overflow-x-auto rounded-xl">
          <table className="w-full min-w-[820px] text-sm">
            <caption className="sr-only">
              Insiders ranked by {METRICS.find((m) => m.key === query.metric)?.label}
            </caption>
            <thead>
              <tr className="border-b border-white/8 text-left text-2xs uppercase tracking-widest text-subtle-foreground">
                <th scope="col" className="px-4 py-3 font-medium">
                  #
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Insider
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Score
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Avg excess 90d
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Median 90d
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Hit rate
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Realised
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Trades
                </th>
              </tr>
            </thead>
            <tbody className="tnum">
              {data.map((row, i) => (
                <tr key={row.insiderId} className="border-b border-white/4 last:border-0">
                  <td className="px-4 py-2.5 text-subtle-foreground">{query.offset + i + 1}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/insider/${row.insiderId}`}
                      className="font-medium hover:text-brand-teal"
                    >
                      {row.name}
                    </Link>
                    {row.title ? (
                      <span className="ml-2 text-2xs text-subtle-foreground">{row.title}</span>
                    ) : null}
                  </td>
                  <td
                    className={cn(
                      "px-4 py-2.5 text-right font-semibold",
                      (row.score ?? 0) >= 0 ? "text-emerald-300" : "text-violet-300",
                    )}
                  >
                    {row.score === null ? "—" : row.score.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-right">{pct(row.avgExcess90d)}</td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">
                    {pct(row.medianExcess90d)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {row.hitRate90d === null ? "—" : `${(row.hitRate90d * 100).toFixed(0)}%`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">
                    {row.realizedTrades === 0 ? "—" : pct(row.realizedReturnPct)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-muted-foreground">
                    {row.scoredTrades}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-2xs text-subtle-foreground">
        Only discretionary (non-routine), non-superseded trades with usable price history are
        scored. Excess returns are measured against SPY.{" "}
        <Link href="/docs/methodology" className="underline underline-offset-2">
          Methodology
        </Link>{" "}
        · <strong>Not investment advice.</strong>
      </p>
    </div>
  );
}
