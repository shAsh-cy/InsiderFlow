"use client";

import { motion, useReducedMotion } from "motion/react";

import type { TradeRow } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

import { FEED_ROW_CLASS, FeedRowContent } from "./feed-row-content";

/**
 * One live-feed entry with a spring insert (fade + slide, transform-only —
 * no layout thrash; neighbors shift via layout animation on the
 * compositor). Reduced motion renders it statically.
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
      layout={!reduced}
      initial={reduced ? false : { opacity: 0, y: -10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.7 }}
      className={cn(FEED_ROW_CLASS, className)}
    >
      <FeedRowContent trade={trade} now={now} />
    </motion.li>
  );
}
