"use client";

import { motion, useReducedMotion } from "motion/react";

import type { TradeRow } from "@/lib/api/queries";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

import { FEED_ROW_CLASS, FeedRowContent, tapeRowProps } from "./feed-row-content";

/**
 * One live-feed entry, struck onto the tape with `springs.feedRow`.
 *
 * Transform-only (opacity + translate) so nothing reflows; neighbours are
 * displaced by the layout animation, which runs on the compositor.
 * Reduced motion renders it statically — the row still appears, it just
 * does not travel.
 */
export function LiveFeedRow({
  trade,
  now,
  className,
}: {
  trade: TradeRow;
  /** Injectable clock so showcases/tests render deterministically. */
  now?: Date;
  className?: string;
}) {
  const reduced = useReducedMotion();

  return (
    <motion.li
      {...tapeRowProps(trade)}
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.feedRow}
      // `tape-arrival` is what distinguishes a row that just streamed in
      // from one that was there already: only this component renders for
      // an SSE arrival, so the flash needs no extra state to know.
      className={cn(FEED_ROW_CLASS, "tape-arrival", className)}
    >
      <FeedRowContent trade={trade} now={now} />
    </motion.li>
  );
}
