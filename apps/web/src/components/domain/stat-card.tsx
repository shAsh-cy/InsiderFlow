"use client";

import { motion, useInView, useReducedMotion, useSpring, useTransform } from "motion/react";
import { useEffect, useRef } from "react";

import { formatCompact } from "@/lib/format";
import { springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Serializable formatter presets — server components pass `preset` (a
 * string survives the RSC boundary); client callers may still pass a
 * custom `format` function.
 */
const FORMAT_PRESETS = {
  count: (n: number) => Math.round(n).toLocaleString("en-US"),
  usd: (n: number) => `$${formatCompact(n)}`,
  "signed-usd": (n: number) => `${n < 0 ? "−" : ""}$${formatCompact(Math.abs(n))}`,
} satisfies Record<string, (n: number) => string>;

export type StatFormatPreset = keyof typeof FORMAT_PRESETS;

/**
 * Spring count-up, started when the card scrolls into view.
 *
 * A spring rather than a fixed-duration tween: two counters showing very
 * different magnitudes settle together instead of one racing ahead, which
 * is what makes a row of them read as a single instrument panel.
 *
 * Two deliberate refusals to animate:
 *
 *  1. The server renders the *real* figure, not a placeholder zero. This
 *     is a product about honest numbers; shipping HTML that says 0 and
 *     corrects itself once JavaScript arrives is the wrong default, and
 *     it would make the largest text on the page a lie until hydration.
 *  2. If the card is already on screen when it mounts, it stays at its
 *     final value. Resetting a number the reader is currently looking at
 *     back to zero so it can climb again is a magic trick, not feedback.
 *
 * Reduced motion skips the tick entirely.
 */
function CountUp({
  value,
  format,
  inView,
}: {
  value: number;
  format: (n: number) => string;
  inView: boolean;
}) {
  const reduced = useReducedMotion();
  const spring = useSpring(value, springs.counter);
  const text = useTransform(spring, (n) => format(n));
  /** Null until we know whether the card started off screen. */
  const armed = useRef<boolean | null>(null);

  useEffect(() => {
    if (reduced) {
      spring.jump(value);
      return;
    }
    if (armed.current === null) {
      // First effect after mount: only arm the tick if the reader has
      // not seen this number yet.
      armed.current = !inView;
      if (armed.current) spring.jump(0);
      else return;
    }
    if (inView) spring.set(value);
  }, [spring, value, inView, reduced]);

  return <motion.span className="num">{text}</motion.span>;
}

export function StatCard({
  label,
  value,
  format,
  preset = "count",
  hint,
  accent = false,
  className,
}: {
  label: string;
  value: number;
  /** Client callers only — functions cannot cross the RSC boundary. */
  format?: (n: number) => string;
  /** Server-safe formatter choice. */
  preset?: StatFormatPreset;
  hint?: string;
  accent?: boolean;
  className?: string;
}) {
  const formatFn = format ?? FORMAT_PRESETS[preset];
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });

  return (
    <div
      ref={ref}
      className={cn(
        "surface rounded-lg p-4",
        // The accent card is the one figure on the page that matters
        // most; it earns a 2px oxblood rule down its left edge.
        accent && "rail",
        className,
      )}
    >
      <p className="text-2xs font-medium text-ink-muted">{label}</p>
      <p
        className={cn(
          "mt-2 text-xl font-semibold tracking-tight",
          accent ? "text-accent-ink" : "text-ink",
        )}
      >
        <CountUp value={value} format={formatFn} inView={inView} />
      </p>
      {hint ? <p className="mt-1 text-2xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}
