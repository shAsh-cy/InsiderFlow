import type { TradeRow } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

import { FEED_ROW_CLASS, FeedRowContent } from "./feed-row-content";

/**
 * Motion-free feed row: identical markup to LiveFeedRow, no animation
 * runtime. Used for first paint (and anywhere animation is unwanted) so
 * `motion` stays off the critical path.
 */
export function StaticFeedRow({
  trade,
  now,
  className,
}: {
  trade: TradeRow;
  now?: Date;
  className?: string;
}) {
  return (
    <li className={cn(FEED_ROW_CLASS, className)}>
      <FeedRowContent trade={trade} now={now} />
    </li>
  );
}
