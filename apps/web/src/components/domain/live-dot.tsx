import { cn } from "@/lib/utils";

/**
 * Connection indicator. The pulse is pure CSS and disabled under
 * prefers-reduced-motion (see globals.css) — the color still communicates.
 */
export function LiveDot({
  status = "live",
  className,
}: {
  status?: "live" | "polling" | "connecting";
  className?: string;
}) {
  const label = status === "live" ? "Live" : status === "polling" ? "Polling" : "Connecting";
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-2xs text-muted-foreground", className)}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          status === "live" && "bg-buy live-pulse",
          status === "polling" && "bg-amber-400",
          status === "connecting" && "bg-flat",
        )}
      />
      <span className="uppercase tracking-widest">{label}</span>
    </span>
  );
}
