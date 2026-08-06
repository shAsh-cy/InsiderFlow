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

export function SourceBadge({ source, className }: { source: string; className?: string }) {
  const entry = SOURCES[source] ?? { label: source.toUpperCase(), title: source };
  return (
    <span
      title={entry.title}
      className={cn(
        "inline-flex items-center rounded-sm border border-border px-1.5 py-0.5 font-mono text-2xs uppercase tracking-wider text-ink-faint",
        className,
      )}
    >
      {entry.label}
    </span>
  );
}
