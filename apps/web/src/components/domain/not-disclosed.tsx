import { cn } from "@/lib/utils";

/**
 * Null-value treatment. Some rows legitimately carry no figure (NSE SAST
 * disclosures have no monetary value by design) — that is information,
 * not absence, so it gets a deliberate glyph instead of an empty cell.
 */
export function NotDisclosed({
  label = "Not disclosed in the filing",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span title={label} className={cn("cursor-help select-none text-subtle-foreground", className)}>
      —<span className="sr-only">{label}</span>
    </span>
  );
}
