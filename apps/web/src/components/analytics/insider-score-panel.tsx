import Link from "next/link";

import type { InsiderScoreDetail } from "@/lib/api/analytics-queries";
import { cn } from "@/lib/utils";

const pct = (v: number | null, digits = 1): string =>
  v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%`;

/**
 * Performance panel on an insider profile — the slot Phase 6 left as
 * "coming soon".
 *
 * Shows the trades behind the number, not just the number. A leaderboard
 * figure nobody can audit is indistinguishable from one that is wrong, and
 * these are descriptive statistics on a small sample, so the sample size is
 * given the same prominence as the score.
 */
export function InsiderScorePanel({ detail }: { detail: InsiderScoreDetail }) {
  const { summary, trades } = detail;

  if (!summary || summary.scoredTrades === 0) {
    return (
      <section aria-labelledby="score-heading" className="flex flex-col gap-3">
        <h2
          id="score-heading"
          className="text-sm font-semibold uppercase tracking-widest text-muted-foreground"
        >
          Performance
        </h2>
        <div className="glass rounded-xl px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">Not enough scored trades yet.</p>
          <p className="text-2xs mt-2 text-subtle-foreground">
            Scoring needs a discretionary, non-superseded trade with at least 30 days of price
            history after it, plus a matching benchmark close.{" "}
            <Link href="/docs/methodology" className="underline underline-offset-2">
              How scoring works
            </Link>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="score-heading" className="flex flex-col gap-3">
      <h2
        id="score-heading"
        className="text-sm font-semibold uppercase tracking-widest text-muted-foreground"
      >
        Performance
        <span className="ml-2 normal-case tracking-normal text-subtle-foreground">
          · {summary.scoredTrades} scored trade{summary.scoredTrades === 1 ? "" : "s"}
        </span>
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="glass rounded-xl p-4">
          <p className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
            Score
          </p>
          <p
            className={cn(
              "tnum mt-1.5 text-2xl font-semibold",
              (summary.score ?? 0) >= 0 ? "text-emerald-300" : "text-violet-300",
            )}
          >
            {summary.score === null ? "—" : summary.score.toFixed(2)}
          </p>
          <p className="text-2xs mt-1 text-subtle-foreground">Shrunk by sample size</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
            Avg excess 90d
          </p>
          <p className="tnum mt-1.5 text-2xl font-semibold">{pct(summary.avgExcess90d)}</p>
          <p className="text-2xs mt-1 text-subtle-foreground">vs SPY, signed by direction</p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
            Hit rate
          </p>
          <p className="tnum mt-1.5 text-2xl font-semibold">
            {summary.hitRate90d === null ? "—" : `${(summary.hitRate90d * 100).toFixed(0)}%`}
          </p>
          <p className="text-2xs mt-1 text-subtle-foreground">
            {summary.wins90d}/{summary.scoredTrades} beat the benchmark
          </p>
        </div>
        <div className="glass rounded-xl p-4">
          <p className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
            Realised
          </p>
          <p className="tnum mt-1.5 text-2xl font-semibold">
            {summary.realizedTrades === 0 ? "—" : pct(summary.realizedReturnPct)}
          </p>
          <p className="text-2xs mt-1 text-subtle-foreground">
            {summary.realizedTrades === 0
              ? "No closed round trips"
              : `${summary.realizedTrades} closed round trip${summary.realizedTrades === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {trades.length > 0 ? (
        <details className="glass rounded-xl p-4">
          <summary className="cursor-pointer text-sm font-medium">
            The trades behind these numbers ({trades.length})
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-2xs uppercase tracking-widest text-subtle-foreground">
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Company</th>
                  <th className="pb-2 pr-3 font-medium">Side</th>
                  <th className="pb-2 pr-3 text-right font-medium">Stock 90d</th>
                  <th className="pb-2 pr-3 text-right font-medium">SPY 90d</th>
                  <th className="pb-2 text-right font-medium">Excess</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {trades.map((t) => (
                  <tr key={t.transactionId} className="border-t border-white/5">
                    <td className="py-1.5 pr-3 text-muted-foreground">{t.txnDate}</td>
                    <td className="py-1.5 pr-3">
                      {t.ticker ? (
                        <Link href={`/stock/${t.ticker}`} className="hover:text-brand-teal">
                          {t.ticker}
                        </Link>
                      ) : (
                        t.companyName
                      )}
                    </td>
                    <td className="py-1.5 pr-3 capitalize text-muted-foreground">{t.direction}</td>
                    <td className="py-1.5 pr-3 text-right">{pct(t.ret90d)}</td>
                    <td className="py-1.5 pr-3 text-right text-muted-foreground">
                      {pct(t.bench90d)}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 text-right font-medium",
                        (t.excess90d ?? 0) >= 0 ? "text-emerald-300" : "text-violet-300",
                      )}
                    >
                      {pct(t.excess90d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <p className="text-2xs text-subtle-foreground">
        Informational only — backward-looking statistics on public filings, not a prediction.{" "}
        <Link href="/docs/methodology" className="underline underline-offset-2">
          Methodology
        </Link>{" "}
        · <strong>Not investment advice.</strong>
      </p>
    </section>
  );
}
