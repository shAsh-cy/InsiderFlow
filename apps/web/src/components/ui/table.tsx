"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Ledger tables. Hairline row rules, no vertical grid, tabular figures
 * everywhere. The container keeps `overflow-x-auto` so a wide table
 * scrolls inside its own well rather than pushing the page sideways.
 */
function Table({
  className,
  bare = false,
  ...props
}: React.ComponentProps<"table"> & {
  /**
   * Render the <table> without the scroll wrapper.
   *
   * The wrapper is right for a plain table on a page. It is wrong inside a
   * container that already scrolls, and quietly so: an element with
   * `overflow-x: auto` and unspecified `overflow-y` computes `overflow-y:
   * auto` too (CSS Overflow 3 §3.3), so the wrapper IS a scroll container,
   * and it becomes the nearest scrollport for anything inside it. That is
   * how DataTable's `sticky top-0` header ended up sticking to a box of
   * `height: auto` that can never scroll vertically, while the box that
   * actually scrolls was one level further out — a sticky header that has
   * never once stuck, at any viewport, since it was written.
   */
  bare?: boolean;
}) {
  const table = (
    <table
      data-slot="table"
      className={cn("w-full caption-bottom text-sm", className)}
      {...props}
    />
  );
  if (bare) return table;
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      {table}
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-border", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t border-border bg-fill font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border transition-colors hover:bg-fill has-aria-expanded:bg-fill data-[state=selected]:bg-fill",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-11 whitespace-nowrap px-2 text-left align-middle text-2xs font-semibold tracking-wider text-ink-muted md:h-9 [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "whitespace-nowrap p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-ink-muted", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
