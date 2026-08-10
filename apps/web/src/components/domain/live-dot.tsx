import { cn } from "@/lib/utils";

/**
 * Connection indicator. The pulse is pure CSS and disabled under
 * prefers-reduced-motion (see globals.css); the written label — not the
 * dot — is what actually carries the state, so the meaning survives both
 * reduced motion and colour-vision deficiency.
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
    <span className={cn("inline-flex items-center gap-1.5 text-2xs text-ink-muted", className)}>
      <span
        aria-hidden
        // The dot itself, not the labelled wrapper: the reduced-motion
        // spec has to read `animationName` off the element the animation
        // is actually on. `data-live-status` rather than the `live-pulse`
        // class, so the test names the STATE and the stylesheet keeps the
        // class to itself.
        data-testid="live-dot"
        data-live-status={status}
        className={cn(
          "size-1.5 rounded-full",
          status === "live" && "bg-accent-2 live-pulse",
          status === "polling" && "bg-ink-muted",
          status === "connecting" && "border border-ink-faint bg-transparent",
        )}
      />
      <span className="tracking-widest">{label}</span>
    </span>
  );
}
