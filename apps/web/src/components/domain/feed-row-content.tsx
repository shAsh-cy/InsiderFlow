import type { TradeRow } from "@/lib/api/queries";
import { formatShares, timeAgo } from "@/lib/format";

import { CountryFlag } from "./country-flag";
import { CurrencyValue } from "./currency-value";
import { RelevanceBadge } from "./relevance-badge";
import { SourceBadge } from "./source-badge";
import { TransactionCodeBadge } from "./transaction-code-badge";

/** Shared inner markup for the animated and static feed rows. */
export function FeedRowContent({ trade, now }: { trade: TradeRow; now?: Date }) {
  const shares = formatShares(trade.shares);
  return (
    <>
      <TransactionCodeBadge code={trade.code} />
      <CountryFlag country={trade.market} className="text-xs" />
      <span className="num text-xs font-semibold text-ink">
        {trade.company.ticker ?? trade.company.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink-muted">
        {trade.insider.name}
        {shares ? <span className="num text-ink-faint"> · {shares} sh</span> : null}
      </span>
      <CurrencyValue
        value={trade.value}
        currency={trade.currency}
        valueUsd={trade.valueUsd}
        className="text-xs font-medium"
      />
      {trade.is10b51 ? (
        <span
          title="Executed under a pre-scheduled Rule 10b5-1 trading plan"
          className="hidden items-center rounded-sm border border-border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wider text-ink-faint sm:inline-flex"
        >
          10b5-1
        </span>
      ) : null}
      <RelevanceBadge relevance={trade.relevance} className="hidden sm:inline-flex" />
      <SourceBadge source={trade.source} className="hidden md:inline-flex" />
      <span className="num hidden w-16 text-right text-2xs text-ink-faint lg:block">
        {timeAgo(trade.createdAt, now)}
      </span>
    </>
  );
}

/**
 * A tape line, not a card. Rows are separated by a single hairline and
 * share one surrounding surface — stacking individual cards would put a
 * border and a shadow between every filing and destroy the sense of a
 * continuous tape.
 *
 * Deliberately cheap to paint: no shadow, no blur, no gradient. The
 * virtualized table holds this to a median frame under 20ms while
 * scrolling ten thousand rows.
 */
export const FEED_ROW_CLASS =
  "flex items-center gap-3 border-b border-border px-3 py-2 text-sm transition-colors last:border-b-0 hover:bg-fill";
