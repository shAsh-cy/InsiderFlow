import { cn } from "@/lib/utils";

/**
 * The one empty state in the product.
 *
 * Three empty screens had grown three different shapes — a centred card
 * here, a bare sentence there, a ruled panel on the third — which made
 * "there is nothing here" read as three different kinds of event. It is
 * one kind of event.
 *
 * Centring survives here on purpose, and it is the only place outside the
 * auth screens that it does: there is exactly one thing on the panel and
 * no column to scan down, so the left edge has nothing to align.
 *
 * Shape: an icon, ONE line explaining what would be here and why it is
 * worth having, and at most one action. Not a list of suggestions — an
 * empty state that offers four next steps is a menu, and a reader who
 * wanted a menu would not be looking at an empty list.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  tone = "surface",
  className,
  ...rest
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  /** One sentence. What would be here, and what it is for. */
  body?: React.ReactNode;
  /** At most one. */
  action?: React.ReactNode;
  /** `sunken` for a panel already sitting inside a card. */
  tone?: "surface" | "sunken";
  className?: string;
} & Omit<React.ComponentProps<"div">, "title">) {
  return (
    <div
      {...rest}
      data-empty-state
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg px-6 py-12 text-center",
        tone === "sunken" ? "surface-sunken" : "surface",
        className,
      )}
    >
      {Icon ? <Icon className="size-5 text-ink-faint" aria-hidden /> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {body ? <p className="max-w-[52ch] text-sm leading-relaxed text-ink-muted">{body}</p> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
