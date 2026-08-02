/**
 * India disclosure panels (server components — plain semantic tables).
 * SAST rows carry value=NULL by design: quantity, % stake, and mode are
 * shown; value renders the NotDisclosed treatment. Never fabricated.
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
  return (
    <section aria-label={title} className="glass overflow-x-auto rounded-xl p-4">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

const empty = (what: string) => (
  <p className="py-6 text-center text-xs text-subtle-foreground">
    No {what} on record — the optional India ingestion may not be running for this operator.
  </p>
);

export function SastPanel({ rows }: { rows: SastRow[] }) {
  return (
    <Panel title="SAST disclosures (Reg. 29/31)">
      {rows.length === 0 ? (
        empty("SAST disclosures")
      ) : (
        <Table className="tnum">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Acquirer</TableHead>
              <TableHead>Reg.</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Shares</TableHead>
              <TableHead>% after</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">
                  {row.txnDate ?? <NotDisclosed />}
                </TableCell>
                <TableCell className="max-w-52 truncate">{row.acquirerName}</TableCell>
                <TableCell className="font-mono text-xs">{row.regulation ?? "—"}</TableCell>
                <TableCell>
                  <span className={row.side === "disposal" ? "text-sell" : "text-buy"}>
                    {row.side ?? "—"}
                  </span>
                </TableCell>
                <TableCell>
                  {row.shares === null ? <NotDisclosed /> : row.shares.toLocaleString("en-IN")}
                </TableCell>
                <TableCell>
                  {row.sharesPctAfter === null ? <NotDisclosed /> : `${row.sharesPctAfter}%`}
                </TableCell>
                <TableCell className="max-w-40 truncate text-muted-foreground">
                  {row.acquisitionMode ?? "—"}
                </TableCell>
                <TableCell>
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
        <Table className="tnum">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Side</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead>WAP</TableHead>
              <TableHead>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">{row.dealDate}</TableCell>
                <TableCell className="font-mono text-xs uppercase">{row.dealType}</TableCell>
                <TableCell className="max-w-52 truncate">{row.clientName}</TableCell>
                <TableCell>
                  <span className={row.side === "sell" ? "text-sell" : "text-buy"}>{row.side}</span>
                </TableCell>
                <TableCell>{row.quantity.toLocaleString("en-IN")}</TableCell>
                <TableCell>{row.wap === null ? <NotDisclosed /> : `₹${row.wap}`}</TableCell>
                <TableCell>
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
        <Table className="tnum">
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Promoter</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Shares</TableHead>
              <TableHead>% of capital</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="text-muted-foreground">
                  {row.eventDate ?? <NotDisclosed />}
                </TableCell>
                <TableCell className="max-w-52 truncate">{row.promoterName}</TableCell>
                <TableCell>
                  <span
                    className={
                      row.eventType === "invoke"
                        ? "text-sell"
                        : row.eventType === "revoke"
                          ? "text-buy"
                          : "text-muted-foreground"
                    }
                  >
                    {row.eventType ?? "—"}
                  </span>
                </TableCell>
                <TableCell>
                  {row.shares === null ? <NotDisclosed /> : row.shares.toLocaleString("en-IN")}
                </TableCell>
                <TableCell>
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
