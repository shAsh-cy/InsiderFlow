"use client";

/**
 * URL-driven filter bar shared by /trades and /screener. The URL is the
 * single source of truth: every change pushes a new query string, the
 * server re-renders through the shared query layer, and the state is
 * shareable / back-forward navigable by construction.
 *
 * Below md it splits in two. The primary axis — market and side — stays on
 * the page as a single non-wrapping row that scrolls sideways, because
 * those are the taps a reader makes constantly. Everything else moves into
 * a bottom sheet behind a counted trigger. Laid out flat at 360px the
 * screener's sixteen controls wrap into six rows and, stacked with the
 * heading, banner and preset list, spend about 545px of a 640px screen
 * before the first result.
 */
import { ChevronDown, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { cn } from "@/lib/utils";

import {
  CODE_OPTIONS,
  MARKETS,
  MIN_VALUES,
  ROLE_OPTIONS,
  SOURCE_OPTIONS,
  TOGGLES,
} from "./filter-options";
import { FilterSheet } from "./filter-sheet";

/**
 * ONE control family.
 *
 * The bar used to mix 32px pill chips with raw native `<select>`s, which
 * are a different height, a different radius, carry the platform's own
 * dropdown arrow and get the platform's focus treatment rather than the
 * product's. Side by side they read as two toolbars that happened to land
 * on one line.
 *
 * The select stays a real `<select>` — a native picker on a phone is worth
 * more than a matching arrow — but loses its platform chrome to
 * `appearance-none` and gets the house one back from `FilterSelect`. Same
 * height, same radius, same hover, same focus ring as the chips.
 *
 * `min-w-0 max-w-full`: a <select> is a replaced element whose automatic
 * minimum size is its widest option, so without these it refuses to shrink
 * inside a flex line and takes the page sideways with it.
 */
const SELECT_CLASS =
  "h-11 min-w-0 max-w-full cursor-pointer appearance-none rounded-full border border-border bg-surface ps-3.5 pe-8 text-xs text-ink-muted transition-colors hover:bg-fill focus:text-ink md:h-8 md:ps-3 md:pe-7 [&>option]:bg-surface [&>option]:text-ink";

/**
 * A select wearing the chip's shape. The chevron is `pointer-events-none`
 * so the whole control still opens the native menu, and `aria-hidden`
 * because the select already announces itself as one.
 */
function FilterSelect({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <span className="relative inline-flex shrink-0 items-center">
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className={SELECT_CLASS}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute end-3 size-3 text-ink-faint md:end-2.5"
      />
    </span>
  );
}

/**
 * A filter chip. Pill-shaped because it is interactive — the rectangular
 * badges elsewhere in the product are not, and that shape difference is
 * the only signal a reader has.
 *
 * An active chip is weight and ground, never colour: the accent is spent
 * once per view, and a row of oxblood chips would spend it a dozen times.
 *
 * 44px tall below md, 32px above. On a phone this is the control a reader
 * touches most and it was the smallest thing on the screen.
 */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-11 shrink-0 cursor-pointer rounded-full border px-3.5 text-xs transition-colors md:h-8 md:px-3",
        active
          ? "border-border bg-fill font-semibold text-ink"
          : "border-transparent text-ink-muted hover:bg-fill hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function FilterBar({ advanced = false }: { advanced?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("offset"); // filters reset pagination
      // push (not replace): every filter state is a history entry, so
      // back/forward walks through screens and any URL is shareable.
      router.push(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const get = (key: string) => searchParams.get(key) ?? "";
  const toggle = (key: string, value: string) =>
    setParam({ [key]: get(key) === value ? null : value });
  const hasAny = [...searchParams.keys()].some((k) => k !== "preset");

  const secondaryToggles = TOGGLES.filter((t) => !t.primary && (advanced || !t.advanced));

  return (
    <div
      className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-x-2 md:gap-y-2"
      role="group"
      aria-label="Trade filters"
    >
      {/*
       * The primary row. Below md it is one line that scrolls sideways and
       * bleeds to the frame edges, so the scroll reads as "more, that way"
       * rather than as a clipped block. At md it becomes `contents` and its
       * chips join the parent's wrap layout — the same chips, not a copy.
       */}
      <div
        data-testid="filter-primary"
        className="-mx-[var(--shell-pad)] flex gap-2 overflow-x-auto px-[var(--shell-pad)] pb-1 [scrollbar-width:none] md:mx-0 md:contents md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden"
      >
        {MARKETS.map((market) => (
          <Chip
            key={market.value || "all"}
            active={get("market") === market.value}
            onClick={() => setParam({ market: market.value || null })}
          >
            {market.label}
          </Chip>
        ))}
        {TOGGLES.filter((t) => t.primary).map((t) => (
          <Chip
            key={t.key + t.value}
            active={get(t.key) === t.value}
            onClick={() => toggle(t.key, t.value)}
          >
            {t.label}
          </Chip>
        ))}
      </div>

      {/* Everything else: inline from md, in the sheet below it. */}
      <div className="hidden md:contents">
        {secondaryToggles.map((t) => (
          <Chip
            key={t.key + t.value}
            active={get(t.key) === t.value}
            onClick={() => toggle(t.key, t.value)}
          >
            {t.label}
          </Chip>
        ))}

        <FilterSelect
          id="filter-code"
          label="Transaction code"
          value={get("code")}
          onChange={(value) => setParam({ code: value || null })}
          options={CODE_OPTIONS}
        />

        <FilterSelect
          id="filter-source"
          label="Source"
          value={get("source")}
          onChange={(value) => setParam({ source: value || null })}
          options={SOURCE_OPTIONS}
        />

        <FilterSelect
          id="filter-min-value"
          label="Minimum USD value"
          value={get("min_value_usd")}
          onChange={(value) => setParam({ min_value_usd: value || null })}
          options={MIN_VALUES}
        />

        {advanced ? (
          <>
            <FilterSelect
              id="filter-role"
              label="Insider role"
              value={get("role")}
              onChange={(value) => setParam({ role: value || null })}
              options={ROLE_OPTIONS}
            />
            <input
              type="search"
              placeholder="Sector…"
              aria-label="Sector"
              defaultValue={get("sector")}
              onKeyDown={(e) => {
                if (e.key === "Enter") setParam({ sector: e.currentTarget.value || null });
              }}
              className="h-11 w-32 min-w-0 shrink-0 rounded-full border border-border bg-surface px-3.5 text-xs text-ink transition-colors placeholder:text-ink-faint md:h-8 md:w-28 md:px-3"
            />
          </>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <FilterSheet advanced={advanced} />

        {hasAny ? (
          <button
            type="button"
            onClick={() => router.push(pathname, { scroll: false })}
            className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-transparent px-3 text-2xs text-ink-faint transition-colors hover:border-border hover:bg-fill hover:text-ink md:h-8"
          >
            <X className="size-3" aria-hidden /> Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The space `FilterBar` will occupy, held open until it arrives.
 *
 * WHY THIS IS NEEDED AT ALL. `FilterBar` calls `useSearchParams`, so it sits
 * behind a `<Suspense>`. Under streaming SSR the browser paints the shell
 * with the boundary's fallback first and patches the real content in when it
 * streams — so an EMPTY fallback means everything below the bar starts 124px
 * too high and drops when it lands. Measured on `/screener`: a layout shift
 * of 0.071, every run, at 1.2s to 6.4s depending on how the stream went.
 * (`curl` shows the bar in the HTML, which is misleading: a complete response
 * contains the streamed-in content, while a browser painted the shell before
 * it arrived.)
 *
 * THE HEIGHTS ARE MEASURED, NOT ESTIMATED. Sampled across eighteen viewport
 * widths against the running build:
 *
 *   360-767   100px      one scrolling chip row + the Filters trigger
 *   768-800   112px      chips wrap to two lines
 *   900-1023   72px      wide enough for one line again
 *   1024      112px      the `lg` sidebar appears and re-narrows the content
 *   1100-1536  72px
 *   1920       32px      everything on one row
 *
 * So the real height is not constant WITHIN a breakpoint band, and no single
 * reserve is exact everywhere. `100px` below `md` is exact across the whole
 * mobile range, which is where the shift was measured and where it costs
 * most; `72px` from `md` up is the common case and cuts the worst residual
 * from 124px to 40px rather than pretending to eliminate it.
 *
 * `aria-hidden`, and no skeleton shimmer: this is empty space standing in for
 * a control group that is about to exist, and announcing it would put a
 * meaningless node in the accessibility tree for the length of a stream.
 */
export function FilterBarFallback() {
  return <div aria-hidden className="min-h-[100px] md:min-h-[72px]" />;
}
