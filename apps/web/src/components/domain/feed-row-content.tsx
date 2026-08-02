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
      <span className="font-mono text-xs font-semibold text-foreground">
        {trade.company.ticker ?? trade.company.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {trade.insider.name}
        {shares ? <span className="text-subtle-foreground"> · {shares} sh</span> : null}
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
          className="text-2xs hidden items-center rounded border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 font-mono uppercase tracking-wider text-amber-200/80 sm:inline-flex"
        >
          10b5-1
        </span>
      ) : null}
      <RelevanceBadge relevance={trade.relevance} className="hidden sm:inline-flex" />
      <SourceBadge source={trade.source} className="hidden md:inline-flex" />
      <span className="tnum hidden w-16 text-right text-2xs text-subtle-foreground lg:block">
        {timeAgo(trade.createdAt, now)}
      </span>
    </>
  );
}

export const FEED_ROW_CLASS = "glass flex items-center gap-3 rounded-lg px-3 py-2 text-sm";
