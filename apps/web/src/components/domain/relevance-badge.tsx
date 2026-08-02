import { cn } from "@/lib/utils";

/**
 * Routine = scheduled compensation plumbing (grants, withholding, 10b5-1).
 * Opportunistic = a discretionary trade — the ones worth watching.
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
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium uppercase tracking-wide ring-1 ring-inset",
        opportunistic
          ? "bg-violet/15 text-[#b9a5ff] ring-violet/40"
          : "bg-flat-soft text-flat ring-white/10",
        className,
      )}
    >
      {opportunistic ? "opportunistic" : "routine"}
    </span>
  );
}
