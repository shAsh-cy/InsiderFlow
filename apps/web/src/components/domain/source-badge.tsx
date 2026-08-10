import { cn } from "@/lib/utils";

/** Display metadata per ingestion source; extensible with new adapters. */
const SOURCES: Record<string, { label: string; title: string }> = {
  edgar: { label: "EDGAR", title: "SEC EDGAR (primary, filing-based)" },
  finnhub: { label: "Finnhub", title: "Finnhub aggregation" },
  fmp: { label: "FMP", title: "Financial Modeling Prep aggregation" },
  "nse-bse": { label: "NSE/BSE", title: "Indian exchanges (operator-supplied)" },
  "eu-mar": { label: "EU MAR", title: "EU market-abuse-regulation filings" },
  sedi: { label: "SEDI", title: "Canadian SEDI filings" },
};

/**
 * Provenance, as quiet mono microtext — not a chip.
 *
 * Which feed a filing arrived on matters when you are auditing a row, and
 * almost never while you are reading the tape. A bordered badge gave it
 * the same visual weight as the trade itself; microtext keeps it
 * available without letting it compete with the figures.
 */
export function SourceBadge({ source, className }: { source: string; className?: string }) {
  const entry = SOURCES[source] ?? { label: source.toUpperCase(), title: source };
  return (
    <span title={entry.title} className={cn("num text-2xs text-ink-faint", className)}>
      {entry.label}
    </span>
  );
}
