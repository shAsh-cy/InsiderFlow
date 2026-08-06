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
                className="num text-xs font-semibold text-ink transition-colors hover:text-accent-ink"
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
        cell: ({ row }) => (
          <Link
            href={`/insider/${row.original.insider.id}`}
            className="inline-flex max-w-full items-center gap-1.5 transition-colors hover:text-accent-ink"
          >
            <span className="truncate">{row.original.insider.name}</span>
            {row.original.insider.title ? (
              <span className="truncate text-2xs text-ink-faint">{row.original.insider.title}</span>
            ) : null}
          </Link>
        ),
      });
    }
    cols.push(
      {
        accessorKey: "shares",
        header: "Shares",
        size: 100,
        cell: ({ row }) =>
          row.original.shares === null ? (
            <NotDisclosed />
          ) : (
            <span className="num">{row.original.shares.toLocaleString("en-US")}</span>
          ),
      },
      {
        accessorKey: "valueUsd",
        header: "Value",
        size: 160,
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
        cell: ({ row }) => {
          const point = priceByDate.get(row.original.txnDate);
          if (!point || row.original.price === null) {
            return <NotDisclosed label="No cached price context for this date" />;
          }
          return <TrendBadge value={point.diffPct} />;
        },
      },
      {
        accessorKey: "relevance",
        header: "Relevance",
        size: 120,
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
        size: 90,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5">
            <SourceBadge source={row.original.source} />
            {row.original.filing?.superseded ? (
              <span
                className="rounded-sm border border-border px-1 text-2xs uppercase text-ink-faint"
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
