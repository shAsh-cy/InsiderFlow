"use client";

/**
 * Virtualized, sortable data table: TanStack Table for the model,
 * TanStack Virtual for row windowing. Renders only the visible slice
 * (10k rows stay at 60fps because ~20 <tr> exist at any time), keeps a
 * semantic <table> with a sticky header, and exposes sort state via
 * aria-sort. Data-agnostic: rows in via props, no fetching here.
 */
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type { ColumnDef, RowData, SortingState } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * Column alignment and priority ride on TanStack's own `meta`, which is
 * part of the ColumnDef the caller already passes. That keeps both a
 * property of the column (where they belong — a column is right-aligned
 * because it holds numbers, and secondary because of what it says) without
 * adding a prop to this component's signature, which is part of the design
 * system's contract.
 *
 * `priority` is what a narrow screen drops:
 *   1  always shown — the row's identity and its figure
 *   2  shown from 768px
 *   3  shown from 1024px
 * Unset behaves as 1, so a caller that has not thought about it loses
 * nothing.
 */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    priority?: 1 | 2 | 3;
  }
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  /** Scroll viewport height. */
  height?: number;
  estimateRowHeight?: number;
  initialSorting?: SortingState;
  "aria-label"?: string;
  className?: string;
}

export function DataTable<TData>({
  columns,
  data,
  height = 520,
  // Dense by default. A trading table is read by scanning a column, and
  // every extra pixel of row height is one fewer row in the same glance.
  estimateRowHeight = 38,
  initialSorting = [],
  className,
  ...aria
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const scrollRef = useRef<HTMLDivElement>(null);
  /**
   * "Key columns" or "all columns", below 1024px.
   *
   * Dropping a column on a narrow screen is a reasonable default and a bad
   * final answer: the source of a filing and whether it has been superseded
   * are facts about the data, and hiding them with no way back would make
   * the phone a lesser view of the truth rather than a smaller one. So the
   * default is the key set and the whole set is one tap away.
   *
   * A per-TABLE toggle rather than the per-ROW expand the brief sketches:
   * these rows are virtualized at a fixed height, and a row that grows when
   * tapped invalidates every offset below it. The toggle gets the same
   * information back without lying to the virtualizer.
   */
  const [showAllColumns, setShowAllColumns] = useState(false);
  /** Which edges are still scrollable — drawn as fades, see globals.css. */
  const [scrollState, setScrollState] = useState<"none" | "start" | "middle" | "end">("none");

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const { rows } = table.getRowModel();
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 8,
  });

  // A horizontally scrollable region has to announce itself, or it is a
  // column of data nobody knows is there. The fade is the visible half; the
  // `tabindex` + `role="region"` below is the half a keyboard needs, because
  // a scroll container with no focusable child cannot otherwise be scrolled
  // without a mouse (WCAG 2.1.1).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1) return setScrollState("none");
      if (el.scrollLeft <= 1) return setScrollState("start");
      if (el.scrollLeft >= max - 1) return setScrollState("end");
      return setScrollState("middle");
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [columns.length, showAllColumns]);

  const virtualRows = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]!.start : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - virtualRows[virtualRows.length - 1]!.end : 0;

  const hiddenBelow = columns.filter((c) => (c.meta?.priority ?? 1) > 1).length;

  return (
    <div className="flex flex-col gap-1.5">
      {hiddenBelow > 0 ? (
        <button
          type="button"
          onClick={() => setShowAllColumns((value) => !value)}
          data-testid="table-columns-toggle"
          // Only where columns are actually being withheld. On a wide
          // screen every column is on the page and a control offering to
          // show them would be describing something that has not happened.
          className="inline-flex min-h-9 cursor-pointer items-center self-start rounded-full border border-border px-3 text-2xs text-ink-muted transition-colors hover:bg-fill hover:text-ink lg:hidden"
        >
          {showAllColumns ? "Key columns" : `All columns (+${hiddenBelow})`}
        </button>
      ) : null}
      {/* The fades live on a wrapper that does not scroll: painted on the
          scroller itself they would travel with the columns. */}
      <div className="table-frame">
        <div
          ref={scrollRef}
          data-testid="data-table-scroll"
          data-table-columns={showAllColumns ? "all" : "key"}
          data-scroll={scrollState}
          // Focusable and named, so the region can be scrolled from the
          // keyboard and announced as one thing rather than as a run of
          // unexplained cells.
          tabIndex={0}
          role="region"
          aria-label={aria["aria-label"]}
          className={cn(
            "surface table-scroll relative overflow-auto rounded-lg",
            // The height was an inline pixel value, which no class or media
            // query could override: a 560px well on a 640px-tall phone is
            // 96% of the screen below the masthead, and every vertical drag
            // inside it is captured by the nested scroller, so the page
            // cannot be scrolled past the table by touch at all.
            "max-h-[var(--table-h)] min-h-40 sm:max-h-none sm:h-[var(--table-h)]",
            className,
          )}
          style={{ "--table-h": `min(${height}px, 70svh)` } as React.CSSProperties}
        >
          <Table bare aria-label={aria["aria-label"]} className="tnum">
            {/* Opaque, not translucent: a blurred sticky header repaints the
            rows beneath it on every scroll frame, which is the single
            most expensive thing a virtualized table can do. */}
            <TableHeader className="sticky top-0 z-10 bg-surface shadow-[0_1px_0_var(--border)]">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent">
                  {headerGroup.headers.map((header) => {
                    const sortDir = header.column.getIsSorted();
                    const canSort = header.column.getCanSort();
                    // A numeric column's header sits over its digits, so it
                    // right-aligns with them; anything else would put the
                    // label and the column it names on different edges.
                    const right = header.column.columnDef.meta?.align === "right";
                    return (
                      <TableHead
                        key={header.id}
                        data-priority={header.column.columnDef.meta?.priority ?? 1}
                        aria-sort={
                          sortDir === "asc"
                            ? "ascending"
                            : sortDir === "desc"
                              ? "descending"
                              : canSort
                                ? "none"
                                : undefined
                        }
                        className={right ? "text-right" : undefined}
                        style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className={cn(
                              "inline-flex cursor-pointer items-center gap-1 rounded-sm transition-colors hover:text-ink",
                              right && "flex-row-reverse",
                            )}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sortDir === "asc" ? (
                              <ArrowUp className="size-3" aria-hidden />
                            ) : sortDir === "desc" ? (
                              <ArrowDown className="size-3" aria-hidden />
                            ) : (
                              <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {paddingTop > 0 ? (
                <tr aria-hidden style={{ height: paddingTop }}>
                  <td colSpan={columns.length} />
                </tr>
              ) : null}
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index]!;
                return (
                  <TableRow
                    key={row.id}
                    data-index={virtualRow.index}
                    // Zebra keys off the data index, not DOM parity: the
                    // virtualizer's spacer rows would otherwise flip the
                    // banding every time the window moves.
                    className={cn(virtualRow.index % 2 === 1 && "bg-fill/55")}
                    style={{ height: virtualRow.size }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        data-priority={cell.column.columnDef.meta?.priority ?? 1}
                        className={cn(
                          "whitespace-nowrap",
                          cell.column.columnDef.meta?.align === "right" && "text-right",
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
              {paddingBottom > 0 ? (
                <tr aria-hidden style={{ height: paddingBottom }}>
                  <td colSpan={columns.length} />
                </tr>
              ) : null}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-24 text-center text-ink-muted">
                    No rows.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
