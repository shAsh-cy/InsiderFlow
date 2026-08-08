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
import { X } from "lucide-react";
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
 * Selects are inputs, so they take the 8px input radius — not the pill.
 *
 * `min-w-0 max-w-full`: a <select> is a replaced element whose automatic
 * minimum size is its widest option, so without these it refuses to shrink
 * inside a flex line and takes the page sideways with it.
 */
const SELECT_CLASS =
  "h-8 min-w-0 max-w-full cursor-pointer rounded-md border border-border bg-surface px-2 text-xs text-ink-muted transition-colors hover:bg-fill focus:text-ink [&>option]:bg-surface";

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
      className="flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center md:gap-2"
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

        <label className="sr-only" htmlFor="filter-code">
          Transaction code
        </label>
        <select
          id="filter-code"
          className={SELECT_CLASS}
          value={get("code")}
          onChange={(e) => setParam({ code: e.target.value || null })}
        >
          {CODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-source">
          Source
        </label>
        <select
          id="filter-source"
          className={SELECT_CLASS}
          value={get("source")}
          onChange={(e) => setParam({ source: e.target.value || null })}
        >
          {SOURCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="filter-min-value">
          Minimum USD value
        </label>
        <select
          id="filter-min-value"
          className={SELECT_CLASS}
          value={get("min_value_usd")}
          onChange={(e) => setParam({ min_value_usd: e.target.value || null })}
        >
          {MIN_VALUES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {advanced ? (
          <>
            <label className="sr-only" htmlFor="filter-role">
              Insider role
            </label>
            <select
              id="filter-role"
              className={SELECT_CLASS}
              value={get("role")}
              onChange={(e) => setParam({ role: e.target.value || null })}
            >
              {ROLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="Sector…"
              aria-label="Sector"
              defaultValue={get("sector")}
              onKeyDown={(e) => {
                if (e.key === "Enter") setParam({ sector: e.currentTarget.value || null });
              }}
              className="h-8 w-28 min-w-0 rounded-md border border-border bg-surface px-2 text-xs text-ink placeholder:text-ink-faint"
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
            className="inline-flex h-11 cursor-pointer items-center gap-1 rounded-full px-2 text-2xs text-ink-faint transition-colors hover:text-ink md:h-8"
          >
            <X className="size-3" aria-hidden /> Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
