"use client";

/**
 * Design-system showcase and acceptance harness: every domain primitive
 * rendered with representative data, plus a 10,000-row virtualized
 * DataTable and a live-feed insert simulator.
 */
import { SEC_TRANSACTION_CODES } from "@insiderflow/core";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  CountryFlag,
  CurrencyValue,
  DataTable,
  LiveDot,
  LiveFeedRow,
  NotDisclosed,
  RelevanceBadge,
  SourceBadge,
  StatCard,
  TransactionCodeBadge,
  TrendBadge,
} from "@/components/domain";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TradeRow } from "@/lib/api/queries";
import { formatCompact } from "@/lib/format";

/* Deterministic pseudo-random generator so the 10k-row demo is stable. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface DemoRow {
  id: number;
  ticker: string;
  code: string;
  insider: string;
  market: string;
  currency: string;
  shares: number;
  value: number | null;
  valueUsd: number | null;
  relevance: string;
  source: string;
  txnDate: string;
}

const CODES = Object.keys(SEC_TRANSACTION_CODES);
const TICKERS = ["AAPL", "MSFT", "NVDA", "UEC", "RELIANCE", "INFY", "AAL", "THC", "NP", "IDEA"];
const NAMES = [
  "DOE JANE A",
  "SMITH ROBERT",
  "KUMAR RAJESH",
  "HOOD AMY",
  "OWENS ANGELA",
  "SHARMA PRIYA",
];
const SOURCES = ["edgar", "finnhub", "fmp", "nse-bse"];

function makeRows(count: number): DemoRow[] {
  const rand = mulberry32(42);
  return Array.from({ length: count }, (_, i) => {
    const indian = rand() < 0.2;
    const disclosed = rand() > 0.08; // some rows are NotDisclosed by design
    const value = disclosed ? Math.round(rand() * 5_000_000_00) / 100 : null;
    return {
      id: i,
      ticker: TICKERS[Math.floor(rand() * TICKERS.length)]!,
      code: CODES[Math.floor(rand() * CODES.length)]!,
      insider: NAMES[Math.floor(rand() * NAMES.length)]!,
      market: indian ? "IN" : "US",
      currency: indian ? "INR" : "USD",
      shares: Math.round(rand() * 100_000),
      value: indian && value !== null ? value * 80 : value,
      valueUsd: value,
      relevance: rand() > 0.6 ? "opportunistic" : "routine",
      source: indian ? "nse-bse" : SOURCES[Math.floor(rand() * 3)]!,
      txnDate: `2026-07-${String(1 + Math.floor(rand() * 28)).padStart(2, "0")}`,
    };
  });
}

const DEMO_COLUMNS: ColumnDef<DemoRow, unknown>[] = [
  {
    accessorKey: "txnDate",
    header: "Date",
    size: 110,
    cell: ({ row }) => <span className="text-muted-foreground">{row.original.txnDate}</span>,
  },
  {
    accessorKey: "ticker",
    header: "Company",
    size: 130,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2">
        <CountryFlag country={row.original.market} />
        <span className="font-mono text-xs font-semibold">{row.original.ticker}</span>
      </span>
    ),
  },
  {
    accessorKey: "code",
    header: "Code",
    size: 70,
    cell: ({ row }) => <TransactionCodeBadge code={row.original.code} />,
  },
  { accessorKey: "insider", header: "Insider", size: 190 },
  {
    accessorKey: "shares",
    header: "Shares",
    size: 110,
    cell: ({ row }) => row.original.shares.toLocaleString("en-US"),
  },
  {
    accessorKey: "valueUsd",
    header: "Value",
    size: 170,
    cell: ({ row }) => (
      <CurrencyValue
        value={row.original.value}
        currency={row.original.currency}
        valueUsd={row.original.valueUsd}
        className="text-xs"
      />
    ),
  },
  {
    accessorKey: "relevance",
    header: "Relevance",
    size: 130,
    cell: ({ row }) => <RelevanceBadge relevance={row.original.relevance} />,
  },
  {
    accessorKey: "source",
    header: "Source",
    size: 100,
    cell: ({ row }) => <SourceBadge source={row.original.source} />,
  },
];

let demoId = 0;
function fakeTrade(): TradeRow {
  demoId++;
  const buy = demoId % 2 === 0;
  return {
    id: `demo-${demoId}-${Math.random().toString(36).slice(2, 8)}`,
    source: buy ? "edgar" : "nse-bse",
    market: buy ? "US" : "IN",
    txnDate: "2026-07-30",
    code: buy ? "P" : "S",
    rawCode: buy ? "P" : "Market Sale",
    direction: buy ? "buy" : "sell",
    relevance: "opportunistic",
    signalWeight: buy ? 1 : -1,
    shares: 2500 + demoId * 111,
    price: buy ? 226.1 : 2450,
    value: buy ? 565_250 : 245_000_000,
    currency: buy ? "USD" : "INR",
    priceUsd: buy ? 226.1 : 27.93,
    valueUsd: buy ? 565_250 : 2_793_000,
    acquiredDisposed: buy ? "A" : "D",
    sharesOwnedAfter: 42_500,
    is10b51: false,
    isDerivative: false,
    footnote: null,
    createdAt: new Date().toISOString(),
    company: buy
      ? { id: "c1", ticker: "AAPL", name: "Apple Inc." }
      : { id: "c2", ticker: "RELIANCE", name: "Reliance Industries" },
    insider: {
      id: "i1",
      name: buy ? "DOE JANE A" : "KUMAR RAJESH",
      title: buy ? "CFO" : "Promoter",
      isDirector: true,
      isOfficer: buy,
      isTenPctOwner: !buy,
    },
    filing: null,
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DesignPage() {
  const rows = useMemo(() => makeRows(10_000), []);
  const [feed, setFeed] = useState<TradeRow[]>(() => [fakeTrade()]);

  return (
    <div className="flex flex-col gap-12 pb-24">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">
          Design <span className="text-gradient">system</span>
        </h1>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          Every domain primitive with representative data. Dark-only, data-dense, one gradient
          accent, motion that respects your OS settings.
        </p>
      </header>

      <Section title="Transaction codes — all 20, colored by signal weight">
        <div className="glass flex flex-wrap gap-2 rounded-xl p-4">
          {Object.keys(SEC_TRANSACTION_CODES).map((code) => (
            <TransactionCodeBadge key={code} code={code} />
          ))}
        </div>
      </Section>

      <Section title="Currency values — native + USD, lakh/crore, not-disclosed">
        <div className="glass flex flex-col gap-2 rounded-xl p-4 text-sm">
          <CurrencyValue value={2_790_000} currency="USD" valueUsd={2_790_000} />
          <CurrencyValue value={245_000_000} currency="INR" valueUsd={2_793_000} />
          <CurrencyValue value={320_000} currency="INR" valueUsd={null} />
          <span className="inline-flex items-center gap-2">
            <CurrencyValue value={null} currency="INR" valueUsd={null} />
            <span className="text-xs text-subtle-foreground">
              (SAST rows carry no value by design)
            </span>
          </span>
        </div>
      </Section>

      <Section title="Badges, flags & status">
        <div className="glass flex flex-wrap items-center gap-3 rounded-xl p-4">
          <CountryFlag country="US" />
          <CountryFlag country="IN" />
          <CountryFlag country="BR" />
          <RelevanceBadge relevance="opportunistic" />
          <RelevanceBadge relevance="routine" />
          <SourceBadge source="edgar" />
          <SourceBadge source="finnhub" />
          <SourceBadge source="fmp" />
          <SourceBadge source="nse-bse" />
          <TrendBadge value={4.2} />
          <TrendBadge value={-2.8} />
          <TrendBadge value={0} />
          <LiveDot status="live" />
          <LiveDot status="polling" />
          <LiveDot status="connecting" />
          <NotDisclosed />
        </div>
      </Section>

      <Section title="Stat cards — spring count-up (static under reduced motion)">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Filings ingested" value={12_847} hint="last 30 days" accent />
          <StatCard
            label="Opportunistic buys"
            value={4_231_000}
            format={(n) => `$${formatCompact(n)}`}
            hint="notional, 7 days"
          />
          <StatCard label="Markets" value={2} hint="US · IN — adapters ready for more" />
        </div>
      </Section>

      <Section title="Live feed row — animated insert">
        <div className="flex flex-col gap-3">
          <div>
            <Button
              size="sm"
              variant="outline"
              className="glass border-white/10"
              onClick={() => setFeed((current) => [fakeTrade(), ...current].slice(0, 5))}
            >
              Inject demo trade
            </Button>
          </div>
          <ul className="flex flex-col gap-2" data-testid="demo-feed">
            {feed.map((trade) => (
              <LiveFeedRow key={trade.id} trade={trade} />
            ))}
          </ul>
        </div>
      </Section>

      <Section title="Data table — 10,000 virtualized rows, sticky header, sortable">
        <Tabs defaultValue="table">
          <TabsList>
            <TabsTrigger value="table">Table</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
          </TabsList>
          <TabsContent value="table">
            <DataTable
              columns={DEMO_COLUMNS}
              data={rows}
              height={520}
              aria-label="Demo insider trades (10,000 rows)"
            />
          </TabsContent>
          <TabsContent value="notes">
            <p className="glass rounded-xl p-4 text-sm text-muted-foreground">
              TanStack Table drives the model, TanStack Virtual windows the rows — only the visible
              slice exists in the DOM, so 10k rows scroll at 60fps. Headers expose aria-sort and
              toggle on click.
            </p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section title="Toasts">
        <div>
          <Button
            variant="outline"
            className="glass border-white/10"
            onClick={() => toast.success("Saved", { description: "This is the toast primitive." })}
          >
            Show toast
          </Button>
        </div>
      </Section>
    </div>
  );
}
