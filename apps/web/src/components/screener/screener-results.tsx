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
import { defaultAlertMode } from "@/lib/alerts/policy";
import { fetchAllPages, fetchScreener, fetchTrades } from "@/lib/api/client";
import type { Paged, TradesParams } from "@/lib/api/client";
import type { PageMeta, TradeRow } from "@/lib/api/queries";
import { downloadBlob, downloadXlsx, toCsv, tradesToExportRows } from "@/lib/export";

export function ScreenerResults({
  initialPage,
  params,
  preset,
  canSaveAlert = false,
}: {
  initialPage: Paged<TradeRow>;
  params: TradesParams;
  preset: string | null;
  /** True when a signed-in session exists — enables "Save as alert". */
  canSaveAlert?: boolean;
}) {
  const [rows, setRows] = useState<TradeRow[]>(initialPage.data);
  const [meta, setMeta] = useState<PageMeta>(initialPage.meta);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Persists the CURRENT screen (preset params included) as an alert rule. */
  const saveAsAlert = async () => {
    setSaving(true);
    try {
      const { limit: _limit, offset: _offset, ...filters } = params;
      // Telegram-only → instant. Nothing here is rate-capped, so batching
      // would only add latency (see defaultAlertMode).
      const channels = ["telegram"];
      const mode = defaultAlertMode(channels);
      const response = await fetch("/api/me/alert-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: preset ? `Screen: ${preset}` : "Saved screen",
          filters,
          mode,
          channels,
        }),
      });
      if (response.ok) {
        toast.success("Saved as alert", {
          description:
            mode === "instant"
              ? "Fires instantly to Telegram. Tune delivery and quiet hours in Settings."
              : "Rolls into your daily digest. Tune delivery and quiet hours in Settings.",
        });
      } else if (response.status === 401) {
        toast.error("Sign in to save alerts");
      } else {
        toast.error("Could not save this screen");
      }
    } catch {
      toast.error("Could not save this screen");
    } finally {
      setSaving(false);
    }
  };

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
        <span className="num mr-auto text-xs text-ink-faint" data-testid="result-count">
          {rows.length}
          {meta.hasMore ? "+" : ""} rows
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void exportCsv()}
          disabled={exporting || rows.length === 0}
        >
          {exporting ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}{" "}
          CSV
        </Button>
        <Button
          variant="outline"
          size="sm"
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
        {canSaveAlert ? (
          <Button
            variant="outline"
            size="sm"
            data-testid="save-alert"
            onClick={() => void saveAsAlert()}
            disabled={saving}
          >
            {saving ? <Loader2 className="animate-spin" aria-hidden /> : <BellPlus aria-hidden />}
            Save as alert
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} data-testid="save-alert">
                <Button variant="outline" size="sm" className="glass border-white/10" disabled>
                  <BellPlus aria-hidden /> Save as alert
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Sign in to save this screen as an alert</TooltipContent>
          </Tooltip>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="surface rounded-lg px-4 py-10 text-center text-sm text-ink-muted">
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
                onClick={() => void loadMore()}
                disabled={loading}
              >
                {loading ? <Loader2 className="animate-spin" aria-hidden /> : null} Load more
              </Button>
            ) : (
              <span className="py-2 text-2xs uppercase tracking-widest text-ink-faint">
                End of results
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
