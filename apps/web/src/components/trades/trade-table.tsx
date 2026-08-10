"use client";

/**
 * Shared virtualized trade table over the Phase 5 DataTable. Column set
 * adapts per page: stock pages show insider + price-vs-close, insider
 * pages show company, screener shows both. No fetching here — rows in.
 */
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMemo } from "react";

import {
  CountryFlag,
  CurrencyValue,
  DataTable,
  NotDisclosed,
  RelevanceBadge,
  SourceBadge,
  TransactionCodeBadge,
  TrendBadge,
} from "@/components/domain";
import type { PriceContextPoint, TradeRow } from "@/lib/api/queries";
import { pricePerShare } from "@/lib/format";

export interface TradeTableProps {
  rows: TradeRow[];
  showCompany?: boolean;
  showInsider?: boolean;
  /** txnDate → price context, for the trade-vs-close column. */
  priceContext?: PriceContextPoint[];
  height?: number;
  "aria-label"?: string;
}

export function TradeTable({
  rows,
  showCompany = false,
  showInsider = true,
  priceContext,
  height = 480,
  ...aria
}: TradeTableProps) {
  const priceByDate = useMemo(() => {
    const map = new Map<string, PriceContextPoint>();
    for (const point of priceContext ?? []) map.set(point.txnDate, point);
    return map;
  }, [priceContext]);

  /*
   * Column priority — what a narrow screen keeps.
   *
   * 1 (always): Date, Company, Code, Value. Between them they say
   *   which filing this is and how big it was, which is the whole of
   *   what a tape row is for.
   * 2 (from 768): Insider.
   * 3 (from 1024): Shares, vs close, Type, Source.
   * 4 (from 1440): Role, Price. Progressive rather than withheld — they
   *   exist so a fluid row spends its width on information instead of
   *   stretching a void between the name and the figures.
   *
   * Nothing is lost: DataTable offers "All columns" below lg, and the
   * full record is a tap away on the stock page either way.
   */
  const columns = useMemo<ColumnDef<TradeRow, unknown>[]>(() => {
    const cols: ColumnDef<TradeRow, unknown>[] = [
      {
        accessorKey: "txnDate",
        header: "Date",
        size: 104,
        cell: ({ row }) => <span className="num text-ink-muted">{row.original.txnDate}</span>,
      },
    ];
    if (showCompany) {
      cols.push({
        id: "company",
        accessorFn: (r) => r.company.ticker ?? r.company.name,
        header: "Company",
        size: 130,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-2">
            <CountryFlag country={row.original.market} />
            {row.original.company.ticker ? (
              <Link
                href={`/stock/${row.original.company.ticker}`}
                className="num inline-flex h-full min-h-11 min-w-11 items-center text-xs font-semibold text-ink transition-colors hover:text-accent-ink md:min-h-0 md:min-w-0"
              >
                {row.original.company.ticker}
              </Link>
            ) : (
              <span className="truncate text-xs">{row.original.company.name}</span>
            )}
          </span>
        ),
      });
    }
    cols.push({
      accessorKey: "code",
      header: "Code",
      size: 64,
      cell: ({ row }) => <TransactionCodeBadge code={row.original.code} />,
    });
    if (showInsider) {
      cols.push({
        id: "insider",
        accessorFn: (r) => r.insider.name,
        header: "Insider",
        size: 200,
        // Priority 2: the name matters, but not before the row can be
        // identified and its figure read.
        meta: { priority: 2 },
        cell: ({ row }) => (
          <Link
            href={`/insider/${row.original.insider.id}`}
            className="inline-flex max-w-full items-center gap-1.5 transition-colors hover:text-accent-ink"
          >
            <span className="truncate">{row.original.insider.name}</span>
          </Link>
        ),
      });
      // The title moves OUT of the name cell and into its own column at
      // 1440. Trailing the name it was a second string competing for the
      // same truncation budget, so on a narrow screen it ate the name and
      // on a wide one it left the row looking empty either side of it.
      cols.push({
        id: "role",
        accessorFn: (r) => r.insider.title ?? "",
        header: "Role",
        size: 180,
        meta: { priority: 4 },
        cell: ({ row }) =>
          row.original.insider.title ? (
            <span className="truncate text-ink-muted">{row.original.insider.title}</span>
          ) : (
            <NotDisclosed label="No officer title on this filing" />
          ),
      });
    }
    cols.push(
      // Numerics right-align so the digits stack on their own edge and a
      // column can be compared by eye without reading any of it.
      {
        accessorKey: "shares",
        header: "Shares",
        size: 100,
        meta: { align: "right", priority: 3 },
        cell: ({ row }) =>
          row.original.shares === null ? (
            <NotDisclosed />
          ) : (
            <span className="num">{row.original.shares.toLocaleString("en-US")}</span>
          ),
      },
      {
        id: "unitPrice",
        accessorFn: (r) => pricePerShare(r)?.price ?? null,
        header: "Price",
        size: 120,
        meta: { align: "right", priority: 4 },
        cell: ({ row }) => {
          const unit = pricePerShare(row.original);
          if (unit === null) {
            return (
              <NotDisclosed label="No price per share on this filing, and no share count to derive one from" />
            );
          }
          return (
            <span className="inline-flex items-center justify-end gap-0.5">
              {/* A derived figure says so. `value ÷ shares` is an AVERAGE
                  across whatever the row aggregates, which is not the same
                  claim as a price the filing states. */}
              {unit.derived ? (
                <span
                  aria-hidden
                  className="text-ink-faint"
                  title="Derived: value ÷ shares, an average across this filing"
                >
                  ~
                </span>
              ) : null}
              <CurrencyValue
                value={unit.price}
                currency={row.original.currency}
                valueUsd={unit.priceUsd}
                className="text-xs"
              />
            </span>
          );
        },
      },
      {
        accessorKey: "valueUsd",
        header: "Value",
        size: 160,
        meta: { align: "right" },
        cell: ({ row }) => (
          <CurrencyValue
            value={row.original.value}
            currency={row.original.currency}
            valueUsd={row.original.valueUsd}
            className="text-xs"
          />
        ),
      },
      {
        id: "vsClose",
        header: "vs close",
        size: 92,
        enableSorting: false,
        meta: { align: "right", priority: 3 },
        cell: ({ row }) => {
          const point = priceByDate.get(row.original.txnDate);
          if (!point || row.original.price === null) {
            return <NotDisclosed label="No cached price context for this date" />;
          }
          return <TrendBadge value={point.diffPct} />;
        },
      },
      // Relevance is a dot now, so the column only needs to be as wide as
      // its own header. 10b5-1 rides alongside as microtext — it is a
      // fact about the filing, not a second classification.
      {
        accessorKey: "relevance",
        header: "Type",
        size: 72,
        meta: { priority: 3 },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <RelevanceBadge relevance={row.original.relevance} />
            {row.original.is10b51 ? (
              <span className="num text-2xs text-ink-faint" title="Rule 10b5-1 plan">
                10b5-1
              </span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: "source",
        header: "Source",
        size: 96,
        meta: { priority: 3 },
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <SourceBadge source={row.original.source} />
            {row.original.filing?.superseded ? (
              <span
                className="rounded-sm border border-border px-1 text-2xs text-ink-faint"
                title="Replaced by an amendment"
              >
                superseded
              </span>
            ) : null}
          </span>
        ),
      },
    );
    return cols;
  }, [showCompany, showInsider, priceByDate]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      height={height}
      initialSorting={[{ id: "txnDate", desc: true }]}
      aria-label={aria["aria-label"]}
    />
  );
}
