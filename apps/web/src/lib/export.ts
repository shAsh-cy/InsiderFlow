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

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * One export cell.
 *
 * `null` stays `null`, which `write-excel-file` renders as an EMPTY cell.
 * That is the same honesty rule the CSV path follows and the reason this
 * function exists rather than a `String(value)`: a price that was not
 * disclosed must not arrive in a spreadsheet as a 0 that AVERAGE() will
 * happily fold into a mean.
 */
function toCell(value: string | number | boolean | null) {
  if (value === null) return null;
  if (typeof value === "number") return { value, type: Number as NumberConstructor };
  if (typeof value === "boolean") return { value, type: Boolean as BooleanConstructor };
  return { value, type: String as StringConstructor };
}

/**
 * XLSX via a lazy-loaded writer — only ever downloaded on click.
 *
 * The writer is `write-excel-file` and not SheetJS. SheetJS's own advisory
 * for CVE-2023-30533 says "workflows that do not read arbitrary files (for
 * example, exporting data to spreadsheet files) are unaffected", so this
 * path was never exposed to it — but the patched SheetJS build is only
 * published to the vendor's own CDN and not to npm, and an off-registry
 * tarball is invisible to `pnpm audit` and osv-scanner. Trading a
 * reachable-by-nobody CVE for a permanent hole in the scanners is the
 * wrong way round in a project whose supply chain is the thing being
 * hardened. This library writes and cannot read, so the entire class of
 * parser CVEs is absent rather than merely unreachable.
 *
 * The blob goes through `downloadBlob`, the same synthetic-anchor path the
 * CSV export uses, rather than the library's own `toFile` — one download
 * mechanism in this file, already covered by tests.
 */
export async function downloadXlsx(rows: ExportRow[], filename: string): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const headers = Object.keys(rows[0] ?? {});
  const data = [
    headers.map((header) => ({ value: header, type: String as StringConstructor })),
    ...rows.map((row) => headers.map((header) => toCell(row[header] ?? null))),
  ];
  const blob = await writeXlsxFile(data, { sheet: "trades" }).toBlob();
  downloadBlob(blob, filename, XLSX_MIME);
}
