/**
 * Client-side trade export. CSV is dependency-free; XLSX lazy-loads the
 * sheet library only when the user actually clicks (keeps it out of every
 * bundle on the render path).
 */
import type { TradeRow } from "./api/queries";

export type ExportRow = Record<string, string | number | boolean | null>;

export function tradesToExportRows(trades: TradeRow[]): ExportRow[] {
  return trades.map((t) => ({
    date: t.txnDate,
    market: t.market,
    ticker: t.company.ticker,
    company: t.company.name,
    insider: t.insider.name,
    title: t.insider.title,
    code: t.code,
    direction: t.direction,
    relevance: t.relevance,
    source: t.source,
    shares: t.shares,
    price: t.price,
    value: t.value,
    currency: t.currency,
    price_usd: t.priceUsd,
    value_usd: t.valueUsd,
    rule_10b5_1: t.is10b51,
    derivative: t.isDerivative,
    accession_no: t.filing?.accessionNo ?? null,
  }));
}

const escapeCsv = (value: string | number | boolean | null): string => {
  if (value === null) return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function toCsv(rows: ExportRow[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [
    headers.join(","),
    ...rows.map((row) => headers.map((h) => escapeCsv(row[h] ?? null)).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export function downloadBlob(content: BlobPart, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** XLSX via lazy-loaded SheetJS — only ever downloaded on click. */
export async function downloadXlsx(rows: ExportRow[], filename: string): Promise<void> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "trades");
  XLSX.writeFile(book, filename);
}
