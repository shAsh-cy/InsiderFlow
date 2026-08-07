import { cn } from "@/lib/utils";

/**
 * Routine = scheduled compensation plumbing (grants, withholding, 10b5-1).
 * Opportunistic = a discretionary trade — the ones worth watching.
 *
 * Rendered as a DOT, not a word.
 *
 * This appears on every row of every table, and a label that repeats on
 * every row carries no information — it is pure ink cost, and it crowds
 * out the figures the row exists to show. The distinction is real and
 * worth keeping, so it survives as a mark that can be scanned down a
 * column: filled = discretionary, hollow = routine.
 *
 * The word itself is not lost — it is in the tooltip and in the
 * screen-reader text, so nothing is hidden from anyone; and relevance
 * remains a first-class FILTER, which is where the distinction actually
 * does work. (When the reader has filtered to one relevance, a per-row
 * label is doubly redundant: every visible row shares it.)
 *
 * Encoded by fill and border, never by hue: the accent means "actionable"
 * in this system, and buy/sell own the only two data colours.
 */
export function RelevanceBadge({
  relevance,
  className,
}: {
  relevance: string;
  className?: string;
}) {
  const opportunistic = relevance === "opportunistic";
  return (
    <span
      title={opportunistic ? "Discretionary trade" : "Routine — scheduled compensation"}
      className={cn("inline-flex items-center justify-center", className)}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 rounded-full border",
          opportunistic ? "border-ink-muted bg-ink-muted" : "border-ink-faint bg-transparent",
        )}
      />
      <span className="sr-only">{opportunistic ? "opportunistic" : "routine"}</span>
    </span>
  );
}
