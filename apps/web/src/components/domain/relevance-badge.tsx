import { cn } from "@/lib/utils";

/**
 * Routine = scheduled compensation plumbing (grants, withholding, 10b5-1).
 * Opportunistic = a discretionary trade — the ones worth watching.
 *
 * Encoded by weight and contrast rather than hue. This badge repeats on
 * every row of every table, so giving it a colour would spend the one
 * accent hundreds of times per view and leave nothing to draw the eye.
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
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs uppercase tracking-wide",
        opportunistic
          ? "border-border bg-fill font-semibold text-ink"
          : "border-transparent font-medium text-ink-faint",
        className,
      )}
    >
      {opportunistic ? "opportunistic" : "routine"}
    </span>
  );
}
