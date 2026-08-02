"use client";

/**
 * Screener results: virtualized table, load-more pagination via
 * meta.nextOffset, CSV/XLSX export, per-preset RSS link, and the disabled
 * "save as alert" slot (auth lands in Phase 7).
 */
import { BellPlus, Download, FileSpreadsheet, Loader2, Rss } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { TradeTable } from "@/components/trades/trade-table";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fetchAllPages, fetchScreener, fetchTrades } from "@/lib/api/client";
import type { Paged, TradesParams } from "@/lib/api/client";
import type { PageMeta, TradeRow } from "@/lib/api/queries";
import { downloadBlob, downloadXlsx, toCsv, tradesToExportRows } from "@/lib/export";

export function ScreenerResults({
  initialPage,
  params,
  preset,
}: {
  initialPage: Paged<TradeRow>;
  params: TradesParams;
  preset: string | null;
}) {
  const [rows, setRows] = useState<TradeRow[]>(initialPage.data);
  const [meta, setMeta] = useState<PageMeta>(initialPage.meta);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetcher = (p: TradesParams) => (preset ? fetchScreener(preset, { ...p }) : fetchTrades(p));

  const loadMore = async () => {
    if (meta.nextOffset === null) return;
    setLoading(true);
    try {
      const page = await fetcher({ ...params, offset: meta.nextOffset });
      setRows((current) => {
        const seen = new Set(current.map((r) => r.id));
        return [...current, ...page.data.filter((r) => !seen.has(r.id))];
      });
      setMeta(page.meta);
    } catch {
      toast.error("Could not load more rows");
    } finally {
      setLoading(false);
    }
  };

  const collectForExport = async (): Promise<TradeRow[]> => {
    // Up to 500 rows (10 pages) — bounded so export can't hammer the API.
    return fetchAllPages(fetcher, { ...params, limit: 50, offset: 0 }, 10);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const all = await collectForExport();
      downloadBlob(
        toCsv(tradesToExportRows(all)),
        "insiderflow-screen.csv",
        "text/csv;charset=utf-8",
      );
      toast.success(`Exported ${all.length} rows to CSV`);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const all = await collectForExport();
      await downloadXlsx(tradesToExportRows(all), "insiderflow-screen.xlsx");
      toast.success(`Exported ${all.length} rows to XLSX`);
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="tnum mr-auto text-xs text-subtle-foreground" data-testid="result-count">
          {rows.length}
          {meta.hasMore ? "+" : ""} rows
        </span>
        <Button
          variant="outline"
          size="sm"
          className="glass border-white/10"
          onClick={() => void exportCsv()}
          disabled={exporting || rows.length === 0}
        >
          {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}{" "}
          CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="glass border-white/10"
          onClick={() => void exportXlsx()}
          disabled={exporting || rows.length === 0}
        >
          <FileSpreadsheet aria-hidden /> XLSX
        </Button>
        {preset ? (
          <Button asChild variant="outline" size="sm" className="glass border-white/10">
            <a href={`/api/rss/${preset}`} target="_blank" rel="noreferrer">
              <Rss aria-hidden /> RSS
            </a>
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0}>
                <Button variant="outline" size="sm" className="glass border-white/10" disabled>
                  <Rss aria-hidden /> RSS
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>RSS feeds are available for presets</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span tabIndex={0} data-testid="save-alert">
              <Button variant="outline" size="sm" className="glass border-white/10" disabled>
                <BellPlus aria-hidden /> Save as alert
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Sign-in and alerts arrive in Phase 7</TooltipContent>
        </Tooltip>
      </div>

      {rows.length === 0 ? (
        <p className="glass rounded-lg px-4 py-10 text-center text-sm text-muted-foreground">
          Nothing matches this screen. Loosen a filter or pick another preset.
        </p>
      ) : (
        <>
          <TradeTable rows={rows} showCompany height={560} aria-label="Screener results" />
          <div className="flex justify-center">
            {meta.hasMore ? (
              <Button
                variant="outline"
                size="sm"
                className="glass border-white/10"
                onClick={() => void loadMore()}
                disabled={loading}
              >
                {loading ? <Loader2 className="animate-spin" aria-hidden /> : null} Load more
              </Button>
            ) : (
              <span className="text-2xs py-2 uppercase tracking-widest text-subtle-foreground">
                End of results
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
