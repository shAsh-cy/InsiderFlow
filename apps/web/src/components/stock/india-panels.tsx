/**
 * India disclosure panels (server components — plain semantic tables).
 * SAST rows carry value=NULL by design: quantity, % stake, and mode are
 * shown; value renders the NotDisclosed treatment. Never fabricated.
 *
 * Figures carry `num` per cell rather than the table carrying it wholesale:
 * acquirer, client and promoter names are prose and belong in the text
 * face, while every quantity, percentage, price and date has to align
 * digit-for-digit down its column.
 */
import { CurrencyValue } from "@/components/domain/currency-value";
import { NotDisclosed } from "@/components/domain/not-disclosed";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BulkBlockRow, PledgeRow, SastRow } from "@/lib/api/page-queries";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  // No overflow here — the Table primitive scrolls inside its own well, so a
  // wide disclosure never drags the page sideways or clips the card padding.
  return (
    <section aria-label={title} className="surface rounded-lg p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-ink-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

const empty = (what: string) => (
  <p className="py-6 text-center text-xs text-ink-faint">
    No {what} on record — the optional India ingestion may not be running for this operator.
  </p>
);

/** Zebra at 55% of the fill keeps the band under the hover state rather
    than competing with it, and costs one paint per row — no shadow, no
    blur, nothing that would show up in a scroll frame budget. */
const ROW = "even:bg-fill/55";

export function SastPanel({ rows }: { rows: SastRow[] }) {
  return (
    <Panel title="SAST disclosures (Reg. 29/31)">
      {rows.length === 0 ? (
        empty("SAST disclosures")
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Acquirer</TableHead>
              <TableHead>Reg.</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">% after</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={ROW}>
                <TableCell className="num text-ink-muted">
                  {row.txnDate ?? <NotDisclosed />}
                </TableCell>
                <TableCell className="max-w-52 truncate">{row.acquirerName}</TableCell>
                {/* A regulation reference is a label, not a figure — an absent
                    one is a bare dash, not the NotDisclosed value treatment. */}
                <TableCell className="num text-xs">{row.regulation ?? "—"}</TableCell>
                <TableCell>
                  {/* The word is the signal; the colour only agrees with it. */}
                  <span
                    className={
                      row.side === "disposal"
                        ? "text-sell-ink"
                        : row.side
                          ? "text-buy-ink"
                          : "text-ink-faint"
                    }
                  >
                    {row.side ?? "—"}
                  </span>
                </TableCell>
                <TableCell className="num text-right">
                  {row.shares === null ? <NotDisclosed /> : row.shares.toLocaleString("en-IN")}
                </TableCell>
                <TableCell className="num text-right">
                  {row.sharesPctAfter === null ? <NotDisclosed /> : `${row.sharesPctAfter}%`}
                </TableCell>
                <TableCell className="max-w-40 truncate text-ink-muted">
                  {row.acquisitionMode ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {/* The NSE SAST feed reports no monetary value — shown honestly. */}
                  <CurrencyValue
                    value={row.value}
                    currency={row.currency}
                    valueUsd={row.valueUsd}
                    className="text-xs"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

export function BulkBlockPanel({ rows }: { rows: BulkBlockRow[] }) {
  return (
    <Panel title="Bulk & block deals">
      {rows.length === 0 ? (
        empty("bulk/block deals")
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Side</TableHead>
              <TableHead className="text-right">Quantity</TableHead>
              <TableHead className="text-right">WAP</TableHead>
              <TableHead className="text-right">Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={ROW}>
                <TableCell className="num text-ink-muted">{row.dealDate}</TableCell>
                <TableCell className="num text-xs uppercase">{row.dealType}</TableCell>
                <TableCell className="max-w-52 truncate">{row.clientName}</TableCell>
                <TableCell>
                  <span className={row.side === "sell" ? "text-sell-ink" : "text-buy-ink"}>
                    {row.side}
                  </span>
                </TableCell>
                <TableCell className="num text-right">
                  {row.quantity.toLocaleString("en-IN")}
                </TableCell>
                <TableCell className="num text-right">
                  {row.wap === null ? <NotDisclosed /> : `₹${row.wap}`}
                </TableCell>
                <TableCell className="text-right">
                  <CurrencyValue
                    value={row.value}
                    currency={row.currency}
                    valueUsd={row.valueUsd}
                    className="text-xs"
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}

export function PledgePanel({ rows }: { rows: PledgeRow[] }) {
  return (
    <Panel title="Promoter pledges">
      {rows.length === 0 ? (
        empty("pledge events")
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Promoter</TableHead>
              <TableHead>Event</TableHead>
              <TableHead className="text-right">Shares</TableHead>
              <TableHead className="text-right">% of capital</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} className={ROW}>
                <TableCell className="num text-ink-muted">
                  {row.eventDate ?? <NotDisclosed />}
                </TableCell>
                <TableCell className="max-w-52 truncate">{row.promoterName}</TableCell>
                <TableCell>
                  {/* An invocation is the lender taking the shares; a revocation
                      returns them. Same up/down language as everywhere else. */}
                  <span
                    className={
                      row.eventType === "invoke"
                        ? "text-sell-ink"
                        : row.eventType === "revoke"
                          ? "text-buy-ink"
                          : row.eventType
                            ? "text-ink-muted"
                            : "text-ink-faint"
                    }
                  >
                    {row.eventType ?? "—"}
                  </span>
                </TableCell>
                <TableCell className="num text-right">
                  {row.shares === null ? <NotDisclosed /> : row.shares.toLocaleString("en-IN")}
                </TableCell>
                <TableCell className="num text-right">
                  {row.sharesPct === null ? <NotDisclosed /> : `${row.sharesPct}%`}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Panel>
  );
}
