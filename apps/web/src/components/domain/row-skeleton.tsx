import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder rows for a tape or a results table.
 *
 * A spinner says "something is happening". A row skeleton says "rows are
 * coming, and here is the shape of one" — which is the difference between
 * waiting and reading a page that is still arriving. It also holds the
 * space the rows will occupy, so the content that lands does not shove
 * everything below it down the page.
 *
 * The bar widths match the real columns in `FeedRowContent`: code, flag,
 * ticker, name, shares, value. A skeleton whose geometry does not match
 * the thing it stands in for is a layout shift with extra steps.
 *
 * `aria-hidden` and no live region: a screen reader is told the list is
 * busy by the container's `aria-busy`, and reading out a dozen empty rows
 * would be worse than silence.
 */
export function RowSkeleton({
  rows = 6,
  height = 40,
  className,
}: {
  rows?: number;
  /** Match the real row height exactly, or this creates the shift it exists to prevent. */
  height?: number;
  className?: string;
}) {
  return (
    <div aria-hidden data-testid="row-skeleton" className={cn("flex flex-col", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{ height }}
          className="flex items-center gap-2.5 border-b border-border px-3 last:border-b-0"
        >
          <Skeleton className="h-3.5 w-5 rounded-sm" />
          <Skeleton className="h-3 w-3 rounded-sm" />
          <Skeleton className="h-3 w-[4.5rem] rounded-sm" />
          {/* The name column is the ragged one in real rows too, so the
              placeholder varies with it rather than drawing a suspiciously
              even stack of identical bars. */}
          <Skeleton
            className="h-3 flex-1 rounded-sm"
            style={{ maxWidth: `${45 + ((i * 13) % 30)}%` }}
          />
          <Skeleton className="hidden h-3 w-24 rounded-sm @md:block" />
          <Skeleton className="h-3 w-32 rounded-sm" />
        </div>
      ))}
    </div>
  );
}
