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
      <RelevanceBadge relevance={trade.relevance} className="hidden sm:inline-flex" />
      <SourceBadge source={trade.source} className="hidden md:inline-flex" />
      <span className="tnum hidden w-16 text-right text-2xs text-subtle-foreground lg:block">
        {timeAgo(trade.createdAt, now)}
      </span>
    </>
  );
}

export const FEED_ROW_CLASS = "glass flex items-center gap-3 rounded-lg px-3 py-2 text-sm";
