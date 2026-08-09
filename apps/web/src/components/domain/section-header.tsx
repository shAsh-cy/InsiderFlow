import { cn } from "@/lib/utils";

/**
 * One header pattern for every section in the product: label left, meta
 * right, on a shared baseline.
 *
 * Before this there were three. "Live" was `text-2xs text-ink-faint` with
 * its status pinned to the right; "History" was `text-sm text-ink-muted`
 * with nothing beside it and its own bottom margin; "Today on the tape"
 * was `text-xl` with an as-of line. Three sizes, three colours and two
 * spacing systems for the same object, which makes a page read as several
 * pages stacked rather than as one.
 *
 * The eyebrow size is the default because most of these label a panel
 * rather than open a chapter; `tone="page"` is the exception for a
 * section that genuinely is one.
 *
 * `meta` is right-aligned and quiet on purpose. Everything that goes
 * there is provenance — an as-of time, a row count, a live indicator —
 * and provenance belongs at the end of the line the label starts.
 */
export function SectionHeader({
  label,
  meta,
  id,
  tone = "panel",
  className,
}: {
  label: React.ReactNode;
  meta?: React.ReactNode;
  id?: string;
  /**
   * Three steps, and they are a scale rather than an accident: `panel`
   * labels a run of rows, `card` titles a bordered panel, `page` opens a
   * section of the page. What r5 removed was two spellings of the SAME
   * step — "Live" as an eyebrow and "History" as a panel title, on one
   * page, for one kind of object.
   */
  tone?: "panel" | "card" | "page";
  className?: string;
}) {
  return (
    <div
      data-section-header
      className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", className)}
    >
      <h2
        id={id}
        className={cn(
          tone === "page" && "text-xl font-semibold tracking-tight text-ink",
          tone === "card" && "text-sm font-semibold text-ink-muted",
          tone === "panel" && "text-2xs font-semibold text-ink-faint",
        )}
      >
        {label}
      </h2>
      {meta ? <div className="flex items-center gap-2 text-2xs text-ink-faint">{meta}</div> : null}
    </div>
  );
}
