import Link from "next/link";

import type { InsiderScoreDetail } from "@/lib/api/analytics-queries";
import { cn } from "@/lib/utils";

const pct = (v: number | null, digits = 1): string =>
  v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%`;

/**
 * Direction colour for a signed figure.
 *
 * Vermillion is this product's "up" and blue its "down", the same pair used
 * for buys and sells — a reader who has learned it once on the trade tape
 * should not have to learn a second scheme here. Never red/green.
 *
 * A null is neither: it takes the faint ink rather than being coloured as
 * though it were a positive number, which is what `?? 0` would have done.
 * The sign is also spelled out by the `+`/`−` prefix, so the hue is only
 * ever agreeing with something already written down.
 */
const signInk = (v: number | null): string =>
  v === null ? "text-ink-faint" : v >= 0 ? "text-buy-ink" : "text-sell-ink";

const STAT_LABEL = "text-2xs font-medium text-ink-muted";
const STAT_NOTE = "text-2xs mt-1 text-ink-faint";

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
        <h2 id="score-heading" className="text-sm font-semibold text-ink-muted">
          Performance
        </h2>
        <div className="surface rounded-lg px-4 py-8 text-center">
          <p className="text-sm text-ink-muted">Not enough scored trades yet.</p>
          <p className="text-2xs mt-2 text-ink-faint">
            Scoring needs a discretionary, non-superseded trade with at least 30 days of price
            history after it, plus a matching benchmark close.{" "}
            <Link
              href="/docs/methodology"
              className="cursor-pointer underline underline-offset-2 hover:text-ink"
            >
              How scoring works
            </Link>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="score-heading" className="flex flex-col gap-3">
      <h2 id="score-heading" className="text-sm font-semibold text-ink-muted">
        Performance
        <span className="ml-2 normal-case tracking-normal text-ink-faint">
          · <span className="num">{summary.scoredTrades}</span> scored trade
          {summary.scoredTrades === 1 ? "" : "s"}
        </span>
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="surface rounded-lg p-4">
          <p className={STAT_LABEL}>Score</p>
          <p className={cn("num mt-1.5 text-2xl font-semibold", signInk(summary.score))}>
            {summary.score === null ? "—" : summary.score.toFixed(2)}
          </p>
          <p className={STAT_NOTE}>Shrunk by sample size</p>
        </div>
        <div className="surface rounded-lg p-4">
          <p className={STAT_LABEL}>Avg excess 90d</p>
          <p className="num mt-1.5 text-2xl font-semibold text-ink">{pct(summary.avgExcess90d)}</p>
          <p className={STAT_NOTE}>vs SPY, signed by direction</p>
        </div>
        <div className="surface rounded-lg p-4">
          <p className={STAT_LABEL}>Hit rate</p>
          <p className="num mt-1.5 text-2xl font-semibold text-ink">
            {summary.hitRate90d === null ? "—" : `${(summary.hitRate90d * 100).toFixed(0)}%`}
          </p>
          <p className={STAT_NOTE}>
            <span className="num">
              {summary.wins90d}/{summary.scoredTrades}
            </span>{" "}
            beat the benchmark
          </p>
        </div>
        <div className="surface rounded-lg p-4">
          <p className={STAT_LABEL}>Realised</p>
          <p className="num mt-1.5 text-2xl font-semibold text-ink">
            {summary.realizedTrades === 0 ? "—" : pct(summary.realizedReturnPct)}
          </p>
          <p className={STAT_NOTE}>
            {summary.realizedTrades === 0
              ? "No closed round trips"
              : `${summary.realizedTrades} closed round trip${summary.realizedTrades === 1 ? "" : "s"}`}
          </p>
        </div>
      </div>

      {trades.length > 0 ? (
        <details className="surface rounded-lg p-4">
          <summary className="cursor-pointer select-none text-sm font-medium">
            The trades behind these numbers ({trades.length})
          </summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-2xs border-b border-border text-left tracking-wider text-ink-muted">
                  <th className="pb-2 pr-3 font-semibold">Date</th>
                  <th className="pb-2 pr-3 font-semibold">Company</th>
                  <th className="pb-2 pr-3 font-semibold">Side</th>
                  <th className="pb-2 pr-3 text-right font-semibold">Stock 90d</th>
                  <th className="pb-2 pr-3 text-right font-semibold">SPY 90d</th>
                  <th className="pb-2 text-right font-semibold">Excess</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => (
                  <tr
                    key={t.transactionId}
                    className="border-t border-border even:bg-fill/55 hover:bg-fill"
                  >
                    <td className="num py-1.5 pr-3 text-ink-muted">{t.txnDate}</td>
                    <td className="py-1.5 pr-3">
                      {t.ticker ? (
                        <Link
                          href={`/stock/${t.ticker}`}
                          className="num cursor-pointer font-semibold underline-offset-2 hover:underline"
                        >
                          {t.ticker}
                        </Link>
                      ) : (
                        t.companyName
                      )}
                    </td>
                    <td className="py-1.5 pr-3 capitalize text-ink-muted">{t.direction}</td>
                    <td className="num py-1.5 pr-3 text-right">{pct(t.ret90d)}</td>
                    <td className="num py-1.5 pr-3 text-right text-ink-muted">{pct(t.bench90d)}</td>
                    <td className={cn("num py-1.5 text-right font-medium", signInk(t.excess90d))}>
                      {pct(t.excess90d)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}

      <p className="text-2xs text-ink-faint">
        Informational only — backward-looking statistics on public filings, not a prediction.{" "}
        <Link
          href="/docs/methodology"
          className="cursor-pointer underline underline-offset-2 hover:text-ink"
        >
          Methodology
        </Link>{" "}
        · <strong>Not investment advice.</strong>
      </p>
    </section>
  );
}
