import { formatAmountBracket } from "@insiderflow/core";
import Link from "next/link";

import { NotDisclosed } from "@/components/domain/not-disclosed";
import type { PoliticianTradeRow } from "@/lib/api/analytics-queries";
import { cn } from "@/lib/utils";

/**
 * Congressional disclosures.
 *
 * Amounts are always rendered as the DISCLOSED BRACKET, via the single
 * formatter in @insiderflow/core. There is no exact figure in a STOCK Act
 * filing, so no view may show one.
 */
export function formatBracket(
  min: number | null,
  max: number | null,
  label: string | null,
): string {
  // The verbatim label as filed wins when we have it; otherwise rebuild it
  // from the bounds.
  return label ?? formatAmountBracket(min, max, "not disclosed");
}

/** Entity links inside a dense table: ink at rest, a rule on hover. */
const LINK_CLASS =
  "cursor-pointer font-semibold text-ink underline-offset-4 transition-colors hover:underline";

/** Sticky, opaque header cell. Blur here would repaint every row on scroll. */
const HEAD_CLASS =
  "sticky top-0 z-10 bg-surface px-4 py-3 font-semibold shadow-[0_1px_0_var(--border)]";

export function PoliticianTradeTable({
  rows,
  showPolitician = true,
  caption,
}: {
  rows: PoliticianTradeRow[];
  showPolitician?: boolean;
  caption: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="surface-sunken rounded-lg px-4 py-10 text-center text-sm text-ink-muted">
        No disclosures on record.
      </p>
    );
  }

  return (
    <div className="surface overflow-x-auto rounded-lg">
      <table className="w-full min-w-[760px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-left text-2xs uppercase tracking-widest text-ink-muted">
            {showPolitician ? (
              <th scope="col" className={HEAD_CLASS}>
                Filer
              </th>
            ) : null}
            <th scope="col" className={HEAD_CLASS}>
              Asset
            </th>
            <th scope="col" className={HEAD_CLASS}>
              Type
            </th>
            <th scope="col" className={HEAD_CLASS}>
              Amount (range)
            </th>
            <th scope="col" className={HEAD_CLASS}>
              Traded
            </th>
            <th scope="col" className={HEAD_CLASS}>
              Disclosed
            </th>
            <th scope="col" className={HEAD_CLASS}>
              Filing
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id}
              // Zebra bands rather than a rule per row: over a long filing
              // history the banding stays readable where a hairline grid
              // turns into texture. No shadow, blur or gradient per row.
              className={cn(
                "border-b border-border transition-colors last:border-0 hover:bg-fill",
                i % 2 === 1 && "bg-fill/55",
              )}
            >
              {showPolitician ? (
                <td className="px-4 py-2.5">
                  <Link href={`/politicians/${row.politician.id}`} className={LINK_CLASS}>
                    {row.politician.name}
                  </Link>
                  <span className="ml-2 text-2xs uppercase text-ink-faint">
                    {row.politician.chamber}
                    {row.politician.party ? `-${row.politician.party}` : ""}
                    {row.politician.state ? ` · ${row.politician.state}` : ""}
                  </span>
                </td>
              ) : null}
              <td className="px-4 py-2.5">
                {row.ticker ? (
                  <Link href={`/stock/${row.ticker}`} className={cn("num", LINK_CLASS)}>
                    {row.ticker}
                  </Link>
                ) : (
                  // A PTR line with no ticker is a real filing about a
                  // non-listed asset, not a gap — it gets the null glyph and
                  // its screen-reader label, never a blank cell.
                  <NotDisclosed label="No ticker on this filing" />
                )}
                <span className="ml-2 text-2xs text-ink-faint">
                  {row.assetDescription.length > 44
                    ? `${row.assetDescription.slice(0, 43)}…`
                    : row.assetDescription}
                </span>
              </td>
              <td className="px-4 py-2.5">
                {/* A static badge, so it is rectangular — the pills in this
                    product are the things you can click. The glyph is
                    redundant with the word beside it on purpose: colour is
                    never the only carrier of direction. */}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-2xs font-medium uppercase",
                    row.direction === "buy"
                      ? "border-buy/40 bg-buy-soft text-buy-ink"
                      : row.direction === "sell"
                        ? "border-sell/40 bg-sell-soft text-sell-ink"
                        : "border-border bg-fill text-ink-muted",
                  )}
                >
                  <span aria-hidden>
                    {row.direction === "buy" ? "▲" : row.direction === "sell" ? "▼" : "▬"}
                  </span>
                  {row.txnType.replace("_", " ")}
                </span>
              </td>
              <td className="num px-4 py-2.5 text-ink">
                {formatBracket(row.amountMin, row.amountMax, row.amountRange)}
              </td>
              <td className="num px-4 py-2.5 text-ink-muted">{row.txnDate}</td>
              <td className="px-4 py-2.5">
                {row.disclosedAt ? (
                  <span className="num text-ink-muted">{row.disclosedAt}</span>
                ) : (
                  <NotDisclosed label="No disclosure date on this filing" />
                )}
                {row.disclosureLagDays !== null ? (
                  // Lateness is a fact on the filing, not a verdict, so it is
                  // marked by weight rather than by an alarm colour.
                  <span
                    className={cn(
                      "num ml-2 text-2xs",
                      row.late ? "font-semibold text-ink" : "text-ink-faint",
                    )}
                    title={
                      row.late
                        ? "Filed past the 45-day STOCK Act deadline"
                        : "Days between the trade and its disclosure"
                    }
                  >
                    +{row.disclosureLagDays}d{row.late ? " late" : ""}
                  </span>
                ) : null}
              </td>
              <td className="px-4 py-2.5">
                {row.sourceUrl ? (
                  <a
                    href={row.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="cursor-pointer text-2xs text-ink-muted underline underline-offset-2 transition-colors hover:text-ink"
                  >
                    PTR
                  </a>
                ) : (
                  <NotDisclosed label="No source document linked" className="text-2xs" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
