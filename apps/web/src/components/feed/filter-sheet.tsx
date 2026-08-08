"use client";

/**
 * The full filter set, in a bottom sheet, below md.
 *
 * On /screener the bar carries sixteen controls. At 360px they wrap into
 * six rows — roughly 232px of chrome, and stacked with the heading, the
 * access banner and the preset list about 545px of a 640px screen is spent
 * before a single result row appears. The primary axis (market, side) stays
 * on the page as a scrolling row; everything else moves here.
 *
 * A sheet, not a dropdown: it comes from the bottom, where a thumb is, and
 * it is tall enough to hold the set without becoming its own scroll puzzle.
 *
 * Draft state, applied on a button. The bar itself writes to the URL on
 * every change, which is right for a single chip — one tap, one screen. It
 * is wrong for a form of eight controls, because each change is a history
 * entry and a server round trip, so tuning four filters would leave four
 * junk entries between you and the page you came from.
 */
import { SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Dialog, DialogClose, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { Dialog as DialogPrimitive } from "radix-ui";
import { cn } from "@/lib/utils";

import { CODE_OPTIONS, MIN_VALUES, ROLE_OPTIONS, SOURCE_OPTIONS, TOGGLES } from "./filter-options";

/** Which query keys this sheet owns; `preset` and paging are not filters. */
const IGNORED = new Set(["preset", "offset", "limit"]);

const SHEET_SELECT =
  "num h-11 w-full cursor-pointer rounded-md border border-border bg-surface px-2.5 text-sm text-ink [&>option]:bg-surface";

export function FilterSheet({ advanced = false }: { advanced?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});

  const activeCount = [...searchParams.keys()].filter((k) => !IGNORED.has(k)).length;

  // Re-read the URL every time it opens: the chips row outside the sheet
  // writes to the same query string, so a stale draft would silently undo
  // whatever was tapped since the sheet was last closed.
  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (!IGNORED.has(key)) next[key] = value;
    }
    setDraft(next);
  }, [open, searchParams]);

  const get = (key: string) => draft[key] ?? "";
  const set = (key: string, value: string) =>
    setDraft((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });

  const apply = () => {
    const params = new URLSearchParams();
    const preset = searchParams.get("preset");
    if (preset) params.set("preset", preset);
    for (const [key, value] of Object.entries(draft)) if (value) params.set(key, value);
    setOpen(false);
    router.push(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  };

  const clearAll = () => setDraft({});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        data-testid="filter-sheet-trigger"
        className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-xs text-ink-muted transition-colors hover:bg-fill hover:text-ink md:hidden"
      >
        <SlidersHorizontal className="size-3.5" aria-hidden />
        Filters
        {/* The count is the whole point of the badge: a collapsed filter set
            with three filters silently applied is a screen you cannot
            explain to yourself. */}
        {activeCount > 0 ? (
          <span
            data-testid="filter-count"
            className="num inline-flex min-w-5 items-center justify-center rounded-full bg-fill px-1.5 py-0.5 text-2xs font-semibold text-ink"
          >
            {activeCount}
          </span>
        ) : null}
      </DialogPrimitive.Trigger>

      <DialogPortal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          data-testid="filter-sheet"
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-border bg-bg outline-none data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom"
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
            <DialogTitle className="text-sm font-semibold text-ink">Filters</DialogTitle>
            <DialogClose
              aria-label="Close filters"
              className="-mr-2 inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-fill hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </DialogClose>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            {TOGGLES.filter((toggle) => advanced || !toggle.advanced).length > 0 ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-2xs font-semibold text-ink-faint">Refine</legend>
                <div className="flex flex-wrap gap-2">
                  {TOGGLES.filter((toggle) => advanced || !toggle.advanced).map((toggle) => {
                    const on = get(toggle.key) === toggle.value;
                    return (
                      <button
                        key={toggle.key + toggle.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set(toggle.key, on ? "" : toggle.value)}
                        className={cn(
                          "h-11 cursor-pointer rounded-full border px-4 text-sm transition-colors",
                          on
                            ? "border-border bg-fill font-semibold text-ink"
                            : "border-border text-ink-muted hover:bg-fill hover:text-ink",
                        )}
                      >
                        {toggle.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            <SheetField label="Transaction code" id="sheet-code">
              <select
                id="sheet-code"
                className={SHEET_SELECT}
                value={get("code")}
                onChange={(e) => set("code", e.target.value)}
              >
                {CODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SheetField>

            <SheetField label="Source" id="sheet-source">
              <select
                id="sheet-source"
                className={SHEET_SELECT}
                value={get("source")}
                onChange={(e) => set("source", e.target.value)}
              >
                {SOURCE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SheetField>

            <SheetField label="Minimum USD value" id="sheet-min-value">
              <select
                id="sheet-min-value"
                className={SHEET_SELECT}
                value={get("min_value_usd")}
                onChange={(e) => set("min_value_usd", e.target.value)}
              >
                {MIN_VALUES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </SheetField>

            {advanced ? (
              <>
                <SheetField label="Insider role" id="sheet-role">
                  <select
                    id="sheet-role"
                    className={SHEET_SELECT}
                    value={get("role")}
                    onChange={(e) => set("role", e.target.value)}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </SheetField>

                <SheetField label="Sector" id="sheet-sector">
                  <input
                    id="sheet-sector"
                    type="search"
                    value={get("sector")}
                    onChange={(e) => set("sector", e.target.value)}
                    placeholder="Any sector"
                    className="h-11 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-ink placeholder:text-ink-faint"
                  />
                </SheetField>
              </>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-border p-4">
            <button
              type="button"
              onClick={clearAll}
              data-testid="filter-sheet-clear"
              className="h-11 cursor-pointer rounded-md px-3 text-sm text-ink-muted transition-colors hover:text-ink"
            >
              Clear all
            </button>
            {/* The one accent on this sheet: it is the only thing that
                changes the screen behind it. */}
            <button
              type="button"
              onClick={apply}
              data-testid="filter-sheet-apply"
              className="h-11 flex-1 cursor-pointer rounded-md border border-accent-bright text-sm font-semibold text-accent-bright transition-colors hover:bg-accent-bright/10 light:border-transparent light:bg-accent light:text-accent-contrast light:hover:bg-accent-bright"
            >
              Apply
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function SheetField({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-2xs font-semibold text-ink-faint">
        {label}
      </label>
      {children}
    </div>
  );
}
