import { formatAmountBracket } from "@insiderflow/core";
import Link from "next/link";

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
      <p className="glass rounded-lg px-4 py-10 text-center text-sm text-muted-foreground">
        No disclosures on record.
      </p>
    );
  }

  return (
    <div className="glass overflow-x-auto rounded-xl">
      <table className="w-full min-w-[760px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-white/8 text-left text-2xs uppercase tracking-widest text-subtle-foreground">
            {showPolitician ? (
              <th scope="col" className="px-4 py-3 font-medium">
                Filer
              </th>
            ) : null}
            <th scope="col" className="px-4 py-3 font-medium">
              Asset
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Type
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Amount (range)
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Traded
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Disclosed
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Filing
            </th>
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-white/4 last:border-0">
              {showPolitician ? (
                <td className="px-4 py-2.5">
                  <Link
                    href={`/politicians/${row.politician.id}`}
                    className="font-medium hover:text-brand-teal"
                  >
                    {row.politician.name}
                  </Link>
                  <span className="ml-2 text-2xs uppercase text-subtle-foreground">
                    {row.politician.chamber}
                    {row.politician.party ? `-${row.politician.party}` : ""}
                    {row.politician.state ? ` · ${row.politician.state}` : ""}
                  </span>
                </td>
              ) : null}
              <td className="px-4 py-2.5">
                {row.ticker ? (
                  <Link href={`/stock/${row.ticker}`} className="font-medium hover:text-brand-teal">
                    {row.ticker}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
                <span className="ml-2 text-2xs text-subtle-foreground">
                  {row.assetDescription.length > 44
                    ? `${row.assetDescription.slice(0, 43)}…`
                    : row.assetDescription}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-2xs font-medium uppercase",
                    row.direction === "buy"
                      ? "bg-emerald-400/10 text-emerald-300"
                      : row.direction === "sell"
                        ? "bg-violet-400/10 text-violet-300"
                        : "bg-white/6 text-muted-foreground",
                  )}
                >
                  {row.txnType.replace("_", " ")}
                </span>
              </td>
              <td className="px-4 py-2.5">
                {formatBracket(row.amountMin, row.amountMax, row.amountRange)}
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">{row.txnDate}</td>
              <td className="px-4 py-2.5">
                <span className="text-muted-foreground">{row.disclosedAt ?? "—"}</span>
                {row.disclosureLagDays !== null ? (
                  <span
                    className={cn(
                      "ml-2 text-2xs",
                      row.late ? "text-amber-300" : "text-subtle-foreground",
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
                    className="text-2xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    PTR
                  </a>
                ) : (
                  <span className="text-2xs text-subtle-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
