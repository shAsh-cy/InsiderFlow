import { formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Signed percentage with a direction arrow.
 *
 * The arrow is not decoration: colour alone would fail for the ~8% of men
 * with a colour-vision deficiency, so direction is always carried by the
 * glyph too. Colours are the Wong pair (vermillion / blue), never
 * red–green.
 */
export function TrendBadge({
  value,
  digits = 1,
  className,
}: {
  /** Percent, signed: +4.2 → "▲ +4.2%". */
  value: number;
  digits?: number;
  className?: string;
}) {
  const flat = Math.abs(value) < 0.005;
  return (
    <span
      className={cn(
        "num inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs font-medium",
        flat
          ? "border-border bg-fill text-ink-muted"
          : value > 0
            ? "border-buy/40 bg-buy-soft text-buy-ink"
            : "border-sell/40 bg-sell-soft text-sell-ink",
        className,
      )}
    >
      <span aria-hidden>{flat ? "▬" : value > 0 ? "▲" : "▼"}</span>
      {formatPct(value, digits)}
    </span>
  );
}
