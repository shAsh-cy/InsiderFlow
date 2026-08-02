import { formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Signed percentage with direction arrow, colored by market semantics. */
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
        "tnum inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        flat
          ? "bg-flat-soft text-flat ring-white/10"
          : value > 0
            ? "bg-buy-soft text-buy ring-buy/30"
            : "bg-sell-soft text-sell ring-sell/30",
        className,
      )}
    >
      <span aria-hidden>{flat ? "▬" : value > 0 ? "▲" : "▼"}</span>
      {formatPct(value, digits)}
    </span>
  );
}
