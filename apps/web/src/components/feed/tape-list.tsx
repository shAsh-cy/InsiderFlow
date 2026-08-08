"use client";

/**
 * The tape as a keyboard-navigable list.
 *
 * A composite widget, not thirty tab stops: one Tab enters the tape, then
 * ↑/↓ walk it. Tabbing through every row of a feed that pages forever is
 * how a keyboard user gets trapped in a list they only wanted to pass, so
 * the list itself takes the tab stop and moves real DOM focus between
 * rows from there.
 *
 * Real focus, not `aria-activedescendant`: it means `:focus-visible`
 * draws the same ring here as everywhere else in the product, and the
 * hover-revealed row actions come into view via `:focus-within` without
 * a second code path.
 *
 * Everything it does is also reachable another way — the row's links and
 * buttons are ordinary controls. This is an accelerator, not the only
 * door.
 */
import { useCallback, useRef } from "react";

import { useSession } from "@/components/shell/session-provider";
import { useWatchlist } from "@/hooks/use-watchlist";
import { rememberPendingWatch } from "@/lib/access/pending-watch";
import { cn } from "@/lib/utils";

const ROW = "[data-tape-row]";

export function TapeList({
  children,
  className,
  style,
  label,
  testId,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  label: string;
  testId?: string;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const session = useSession();
  const { has, add, remove } = useWatchlist();

  const rows = useCallback(
    () => Array.from(listRef.current?.querySelectorAll<HTMLElement>(ROW) ?? []),
    [],
  );

  const focusRow = (index: number) => {
    const all = rows();
    if (all.length === 0) return;
    const clamped = Math.max(0, Math.min(index, all.length - 1));
    all[clamped]?.focus();
  };

  const indexOfFocused = () => {
    const active = document.activeElement;
    const row = active?.closest?.(ROW) as HTMLElement | null;
    return row ? rows().indexOf(row) : -1;
  };

  const toggleWatch = (row: HTMLElement) => {
    const ticker = row.dataset.tapeTicker;
    if (!ticker) return;
    const item = {
      refId: ticker,
      label: row.dataset.tapeLabel ?? ticker,
      market: row.dataset.tapeMarket ?? "US",
    };
    if (session.authConfigured && !session.userId) {
      // Same contract as the star: remember the intent, then let the row's
      // own control open the offer. Pressing `w` signed-out focuses that
      // control rather than opening a sheet from nowhere — a popover with
      // no visible anchor is a popover nobody can find their way out of.
      rememberPendingWatch(item);
      row.querySelector<HTMLElement>("[data-testid='row-watch']")?.click();
      return;
    }
    if (has("company", ticker)) remove(`company:${ticker}`);
    else add({ kind: "company", ...item });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    // Never steal a key from a field, and never fight a modifier
    // combination the browser or the OS owns.
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    const current = indexOfFocused();

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusRow(current + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusRow(current - 1);
        return;
      case "Home":
        event.preventDefault();
        focusRow(0);
        return;
      case "End":
        event.preventDefault();
        focusRow(rows().length - 1);
        return;
      case "Enter": {
        if (current < 0) return;
        // A button inside the row owns its own Enter.
        if (target.closest("a, button")) return;
        const href = rows()[current]?.dataset.tapeHref;
        if (!href) return;
        event.preventDefault();
        window.location.href = href;
        return;
      }
      case "w":
      case "W": {
        if (current < 0) return;
        if (target.closest("a, button")) return;
        event.preventDefault();
        const row = rows()[current];
        if (row) toggleWatch(row);
        return;
      }
      default:
    }
  };

  return (
    <ul
      ref={listRef}
      tabIndex={0}
      aria-label={label}
      data-testid={testId}
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        // Only when focus lands on the list itself — bubbling from a row
        // or a button inside one must not yank it back to the top.
        if (event.target === event.currentTarget) focusRow(0);
      }}
      className={cn("outline-none", className)}
      style={style}
    >
      {children}
    </ul>
  );
}
