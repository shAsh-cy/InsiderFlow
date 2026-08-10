"use client";

/**
 * Ledger — design-system showcase and acceptance harness.
 *
 * Two jobs: document the language (tokens, scale, semantics, motion), and
 * exercise it (every domain primitive with representative data, a 10,000
 * row virtualized DataTable, and a live-feed insert simulator). If a
 * primitive is not on this page it is not part of the system.
 */
import { SEC_TRANSACTION_CODES } from "@insiderflow/core";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Star } from "lucide-react";

import {
  CountryFlag,
  CurrencyValue,
  DataTable,
  EmptyState,
  LiveDot,
  LiveFeedRow,
  NotDisclosed,
  RelevanceBadge,
  RowSkeleton,
  SourceBadge,
  StatCard,
  TransactionCodeBadge,
  TrendBadge,
} from "@/components/domain";
import { Badge } from "@/components/ui/badge";
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
    cell: ({ row }) => <span className="num text-ink-muted">{row.original.txnDate}</span>,
  },
  {
    accessorKey: "ticker",
    header: "Company",
    size: 130,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2">
        <CountryFlag country={row.original.market} />
        <span className="num text-xs font-semibold text-ink">{row.original.ticker}</span>
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
    cell: ({ row }) => <span className="num">{row.original.shares.toLocaleString("en-US")}</span>,
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

/**
 * The showcase's demo filing, and its clock.
 *
 * Both are fixed constants, and that is the whole point. This fixture used
 * to call `Math.random()` for its id and `new Date()` for its arrival time,
 * and it incremented a module-level counter that decided the row's
 * DIRECTION — so the server and the browser rendered different text and
 * React tore the tree down and rebuilt it on hydration. It cost this route
 * a console error, ~0.16 of layout shift and about eight points of
 * performance, and it did it silently for six revisions.
 *
 * `LiveFeedRow` has carried an injectable `now` since r1 for exactly this
 * reason. The showcase simply never used it.
 *
 * Named on the ZZ* convention like every other fabricated row in this
 * project: a page demonstrating a design system should not put a real
 * company's ticker next to an invented trade.
 */
// Not exported: a route module may only export the handful of names Next
// recognises, and a stray `export const` here is a build-time type error.
const DEMO_FILED_AT = "2026-07-30T13:47:00.000Z";
const DEMO_NOW = new Date("2026-07-30T14:05:00.000Z");

function fakeTrade(seq: number): TradeRow {
  const buy = seq % 2 === 0;
  return {
    // Deterministic, and stable across the server/client boundary: the
    // sequence number is the only input.
    id: `ZZDEMO-${String(seq).padStart(3, "0")}`,
    source: buy ? "edgar" : "nse-bse",
    market: buy ? "US" : "IN",
    txnDate: "2026-07-30",
    code: buy ? "P" : "S",
    rawCode: buy ? "P" : "Market Sale",
    direction: buy ? "buy" : "sell",
    relevance: "opportunistic",
    signalWeight: buy ? 1 : -1,
    shares: 2500 + seq * 111,
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
    createdAt: DEMO_FILED_AT,
    company: buy
      ? { id: "zz-demo-us", ticker: "ZZNOVA", name: "ZZ Nova Robotics Inc." }
      : { id: "zz-demo-in", ticker: "ZZBHARAT", name: "ZZ Bharat Industries Ltd." },
    insider: {
      id: "zz-demo-insider",
      name: buy ? "ZZ AVERY STONE" : "ZZ PRIYA RAMANATHAN",
      title: buy ? "Chief Financial Officer" : "Promoter",
      isDirector: true,
      isOfficer: buy,
      isTenPctOwner: !buy,
    },
    filing: null,
  };
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="border-b border-border pb-2">
        <h2 className="text-2xs font-semibold text-ink-faint">{title}</h2>
        {note ? <p className="mt-1.5 max-w-[68ch] text-xs text-ink-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A colour token, shown with its name and its role. */
function Swatch({ name, className, role }: { name: string; className: string; role: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        aria-hidden
        className={`size-9 shrink-0 rounded-md border border-border ${className}`}
      />
      <span className="min-w-0">
        <span className="num block text-2xs font-semibold text-ink">{name}</span>
        <span className="block truncate text-2xs text-ink-faint">{role}</span>
      </span>
    </div>
  );
}

const TYPE_SCALE = [
  { cls: "text-2xs", rem: "0.6875" },
  { cls: "text-xs", rem: "0.75" },
  { cls: "text-sm", rem: "0.8125" },
  { cls: "text-base", rem: "0.875" },
  { cls: "text-md", rem: "1" },
  { cls: "text-lg", rem: "1.125" },
  { cls: "text-xl", rem: "1.375" },
  { cls: "text-2xl", rem: "1.75" },
  { cls: "text-3xl", rem: "2.5" },
  { cls: "text-4xl", rem: "3.5" },
];

/** 4 / 6 / 8 / 12 / full — terminal corners are tight. */
const RADII = [
  { cls: "rounded-sm", px: "4", role: "Badges, code chips, microtags" },
  { cls: "rounded-md", px: "6", role: "Inputs, buttons" },
  { cls: "rounded-lg", px: "8", role: "Cards, tables, panels" },
  { cls: "rounded-xl", px: "12", role: "The largest thing on any page" },
  { cls: "rounded-full", px: "full", role: "Pills — and a pill is clickable" },
];

/** The 4px grid. Every gap and pad in the product is one of these. */
const SPACING = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];

/**
 * The tertiary-ink ratification (r3).
 *
 * The r2 spec named a darker tone in both themes. Measured against the
 * grounds it actually sits on, both failed WCAG AA for small text — so
 * the values below are canonical and the spec values are recorded as
 * what they were: a near miss. Ratios are 1dp-rounded relative-luminance
 * contrast per WCAG 2.1 §1.4.3.
 */
const MUTED_INK = [
  {
    theme: "Terminal (dark)",
    value: "#808881",
    spec: "#6E7873",
    grounds: [
      ["--bg", "5.28", "4.22"],
      ["--surface", "5.00", "4.00"],
      ["--surface-raised", "4.73", "3.78"],
      ["--surface-sunken", "5.35", "4.27"],
    ],
  },
  {
    theme: "Graphite (light)",
    value: "#626E7A",
    spec: "#6B7885",
    grounds: [
      ["--bg", "4.89", "4.24"],
      ["--surface", "5.21", "4.52"],
      ["--surface-raised", "5.21", "4.52"],
      ["--surface-sunken", "4.60", "3.98"],
    ],
  },
];

const MOTION_PRESETS = [
  ["snappy", "400 / 17 / 1", "Hover lift — a small, deliberate overshoot"],
  ["press", "400 / 30", "Press. Critically damped: never bounces under a finger"],
  ["layout", "500 / 30", "The layout prop — reflow, reorder, size change"],
  ["feedRow", "350 / 30 / 1", "Live SSE row insertion"],
  ["reveal", "100 / 20 / 1", "Scroll-triggered section reveal"],
  ["counter", "75 / 15 / 0.8", "Number count-up"],
];

/**
 * The layout frame, published so the next contributor does not have to
 * infer the model from four `calc()` expressions.
 */
const SHELL_TOKENS = [
  {
    name: "--shell-gutter",
    value: "clamp(24px, 6.25vw - 56px, 64px)",
    role: "ONE gutter, shared by the landing shell, the app shell's content well and the masthead's inner container. 24px at 1280, 34 at 1440, 64 at 1920 \u2014 at its floor where width is scarce, opening only once the screen has surplus.",
  },
  {
    name: "--shell-sidebar",
    value: "0 / 14rem \u22651024",
    role: "Added back by bands outside the sidebar row, so the footer lands on the content edge.",
  },
  {
    name: "--shell-nav-inset",
    value: "0 / 1.5rem \u22651024",
    role: "Sidebar edge to a sidebar item CONTENT (12 + 2 + 10). The sidebar brand header takes it, so the mark and the eleven glyphs beneath it stand on one line.",
  },
  {
    name: "--masthead-bar-bg",
    value: "surface at 82%",
    role: "The masthead's own ground, always drawn, derived from --surface so it follows the palette in both themes. r6 drew nothing until something scrolled under the bar, which left the brand sitting on the page with nothing containing it.",
  },
  {
    name: "--masthead-hairline",
    value: "var(--border)",
    role: "The bar's bottom edge, always drawn. It had been transparent at rest, which on an app route meant the line across the top of the window stopped dead at the sidebar's right edge.",
  },
  {
    name: "--shell-rail-inset",
    value: "1rem / 1.25rem \u22651024",
    role: "How far the hanging rail reaches back out of the column. Always leaves air inside the gutter: 4px at the gutter's 24px floor, more as it opens.",
  },
  {
    name: "--shell-measure",
    value: "72ch",
    role: "The reading measure. Applied per BLOCK, never by the shell: a table wants the region, a paragraph wants 72ch.",
  },
  {
    name: ".shell-fluid",
    value: "padding: var(--shell-gutter)",
    role: "The no-sidebar shell (landing, auth, legal). Since r7 it takes the same gutter as everything else, rather than a second clamp kept in step by hand.",
  },
] as const;

/** The four rules of the layout contract, stated once so they can be quoted. */
const LAYOUT_RULES = [
  {
    title: "One left edge per shell",
    body: "The chrome shares the content's edges. On the landing the masthead's inner container is the hero's own shell, so the logo and the H1 start on one x. On an app route the SIDEBAR owns identity and the masthead is an action bar running from the sidebar's right edge to the content's right edge.",
  },
  {
    title: "Chrome pins to the viewport",
    body: "The sidebar left edge IS the screen left edge, and it runs the full height of the window. Neither the sidebar nor the bar is ever centred, because a window frame that floats is not a frame.",
  },
  {
    title: "Content is fluid",
    body: "The region runs from (sidebar + gutter) to (viewport minus gutter), with no cap. A tape, a table and a stat strip all get better with width; capping them buys nothing.",
  },
  {
    title: "Prose is the one exception",
    body: "A long-form reading block caps at ~72ch keyed to the region LEFT edge. There the right-hand whitespace is the point: a 150-character line is unreadable.",
  },
] as const;

/**
 * The contract, drawn.
 *
 * Deliberately schematic and deliberately labelled: the failure this
 * replaces was two rounds reading the same sentence and picturing different
 * boxes. One `aria-label` on the figure carries the whole claim; the
 * internals are not separately announced, because a screen reader should
 * get this once rather than as fourteen stray words.
 */
function LayoutDiagram() {
  return (
    <figure className="surface flex flex-col gap-3 rounded-lg p-4">
      <svg
        viewBox="0 0 640 176"
        className="w-full"
        role="img"
        aria-label="The app shell. The sidebar's left edge is the screen's left edge and it runs the full height of the window, carrying the brand in its header. The masthead begins at the sidebar's right edge and holds only actions. Its contents and the content region below start on the same left edge, and both end on the same right edge. A prose block inside the region stops at about 72 characters, keyed to the region's left edge."
      >
        <rect
          x="1"
          y="1"
          width="638"
          height="174"
          rx="4"
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth="1.5"
        />
        {/* The sidebar runs the full height, from y=0, and carries the mark. */}
        <rect x="1" y="1" width="96" height="174" fill="var(--surface)" />
        <line x1="97" y1="1" x2="97" y2="175" stroke="var(--border)" />
        <rect x="1" y="1" width="96" height="26" fill="var(--surface-raised)" />
        <line x1="1" y1="27" x2="97" y2="27" stroke="var(--border-strong)" strokeWidth="1.5" />
        <text x="12" y="18" className="num fill-[var(--text)] text-[9px]">
          brand
        </text>
        <text x="12" y="48" className="num fill-[var(--text-muted)] text-[9px]">
          sidebar
        </text>
        <text x="12" y="60" className="num fill-[var(--text-muted)] text-[9px]">
          x = 0
        </text>
        {/* The bar begins where the sidebar ends: actions only. */}
        <rect x="97" y="1" width="542" height="26" fill="var(--surface-raised)" />
        <line x1="97" y1="27" x2="639" y2="27" stroke="var(--border-strong)" strokeWidth="1.5" />
        <text x="123" y="18" className="num fill-[var(--text-muted)] text-[9px]">
          action bar — no brand edge of its own
        </text>
        {/* The shared left edge, drawn: bar contents and content region. */}
        <line
          x1="123"
          y1="1"
          x2="123"
          y2="175"
          stroke="var(--accent-bright)"
          strokeDasharray="2 3"
        />
        <rect x="97" y="27" width="26" height="148" fill="var(--accent-bright)" opacity="0.14" />
        <rect x="613" y="27" width="26" height="148" fill="var(--accent-bright)" opacity="0.14" />
        <rect
          x="123"
          y="39"
          width="490"
          height="124"
          rx="3"
          fill="none"
          stroke="var(--accent-bright)"
          strokeDasharray="3 3"
        />
        <text x="133" y="56" className="num fill-[var(--text)] text-[9px]">
          content region, fluid, no cap
        </text>
        <rect
          x="133"
          y="66"
          width="240"
          height="86"
          rx="2"
          fill="var(--surface-sunken)"
          stroke="var(--border)"
        />
        <text x="141" y="82" className="num fill-[var(--text-muted)] text-[9px]">
          prose block
        </text>
        <text x="141" y="94" className="num fill-[var(--text-muted)] text-[9px]">
          72ch, left-keyed
        </text>
        <text x="100" y="171" className="num fill-[var(--text-muted)] text-[8px]">
          gutter
        </text>
        <text x="616" y="171" className="num fill-[var(--text-muted)] text-[8px]">
          gutter
        </text>
      </svg>
      <figcaption className="text-2xs text-ink-faint">
        The sidebar meets the bezel and holds the mark; the bar and the content share one left edge
        and one right edge; only prose stops short. On the landing there is no sidebar, so the bar
        takes the hero&rsquo;s own margin token instead and the logo stands directly above the H1.
      </figcaption>
    </figure>
  );
}

export default function DesignPage() {
  const rows = useMemo(() => makeRows(10_000), []);
  // Seq 0 is the row the server renders, so both sides start from the same
  // one. Everything after it is produced by a click, which only ever
  // happens on the client.
  const [feed, setFeed] = useState<TradeRow[]>(() => [fakeTrade(0)]);
  const nextSeq = useRef(1);

  return (
    <div className="flex flex-col gap-12 pb-24">
      <header className="rail-bleed">
        <p className="num text-2xs text-ink-faint">Design language</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink">Design — Terminal</h1>
        <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-ink-muted">
          A trading terminal, not a document. Cool near-black ground, hairline rules, racing-green
          accent, monospaced figures. Dark is the default; light (“Graphite”) is a cool grey, not
          warm paper. Toggle the theme in the masthead — everything below is drawn from the same
          tokens in both.
        </p>
        <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-ink-muted">
          <strong className="font-semibold text-ink">
            Dark is the default, and not the machine’s decision.
          </strong>{" "}
          The token layer is written dark-first — <span className="num">:root</span> IS the dark
          theme and <span className="num">.light</span> is the override — and the accent is tuned
          twice, because one green cannot be both a fill and a legible label on two grounds.
          Deferring that to <span className="num">prefers-color-scheme</span> handed roughly half of
          all first visits a theme the design does not lead with, and made the product’s identity a
          property of the visitor’s laptop. Light is one click away and a stored choice still wins:
          changing the default does not clear anyone’s preference.
        </p>
        <p className="mt-3 max-w-[68ch] text-sm leading-relaxed text-ink-muted">
          Mono is reserved for numbers, tickers, SEC codes and microtext. Headings and body are
          sentence-case Onest: a heading set in uppercase mono reads as a system message rather than
          a sentence, and this product has enough machine output already.
        </p>
      </header>

      <Section
        title="Colour tokens"
        note="No component may contain a raw colour value. The accent means “actionable” and never encodes direction — buy and sell own the only two data colours."
      >
        <div className="surface grid gap-4 rounded-lg p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Swatch name="--bg" className="bg-bg" role="Page ground" />
          <Swatch name="--surface" className="bg-surface" role="Cards, tables" />
          <Swatch name="--surface-raised" className="bg-surface-raised" role="Dialogs, popovers" />
          <Swatch name="--surface-sunken" className="bg-fill" role="Zebra, hover, wells" />
          <Swatch name="--border" className="bg-border" role="Every rule in the product" />
          <Swatch name="--border-strong" className="bg-border-strong" role="Raised-layer edges" />
          <Swatch name="--text" className="bg-ink" role="Primary type" />
          <Swatch name="--text-secondary" className="bg-ink-muted" role="Secondary type" />
          <Swatch name="--text-muted" className="bg-ink-faint" role="Tertiary type, null glyphs" />
          <Swatch name="--accent" className="bg-accent" role="Racing green — fills" />
          <Swatch
            name="--accent-bright"
            className="bg-accent-bright"
            role="Accent as type/border"
          />
          <Swatch name="--warning" className="bg-warning" role="Warning" />
          <Swatch name="--danger" className="bg-danger" role="Destructive" />
        </div>
        <p className="max-w-[76ch] text-xs leading-relaxed text-ink-muted">
          <strong className="font-semibold text-ink">Why the accent is two tokens.</strong> On the
          dark ground the accent is 3.6:1 — fine behind{" "}
          <code className="num">--accent-contrast</code>, too low for small text.{" "}
          <code className="num">--accent-bright</code> is 6.3:1 and is what type and borders use. On
          Graphite the relationship inverts. One green cannot be both a fill and a legible label, so
          it is not asked to be.
        </p>

        <div className="surface flex flex-col gap-4 rounded-lg p-4">
          <p className="max-w-[76ch] text-xs leading-relaxed text-ink-muted">
            <strong className="font-semibold text-ink">
              <code className="num">--text-muted</code> is ratified at the values below.
            </strong>{" "}
            It is the tertiary ink — the kicker, the tape label, the null glyph, every line of
            microtext — so it is small text, and small text owes 4.5:1. Measured against the four
            grounds it actually sits on, the tone originally specified cleared none of them
            reliably. These are the nearest tones of the same hue that clear all four.
          </p>
          {MUTED_INK.map((theme) => (
            <div key={theme.theme} className="min-w-0 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-2xs">
                <caption className="mb-2 text-left text-2xs text-ink-faint">
                  {theme.theme} — <span className="num text-ink">{theme.value}</span> ratified,{" "}
                  <span className="num">{theme.spec}</span> as originally specified
                </caption>
                <thead>
                  <tr className="border-b border-border text-ink-faint">
                    <th scope="col" className="py-1.5 text-left font-medium">
                      Ground
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Ratified
                    </th>
                    <th scope="col" className="py-1.5 text-right font-medium">
                      As specified
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {theme.grounds.map(([ground, ratified, spec]) => (
                    <tr key={ground} className="border-b border-border last:border-b-0">
                      <th scope="row" className="num py-1.5 text-left font-normal text-ink-muted">
                        {ground}
                      </th>
                      <td className="num py-1.5 text-right text-ink">{ratified}:1</td>
                      {/* Colour is not the signal — the word is. A ratio that
                          fails says so in text, for anyone who cannot see the
                          tint or is reading this printed. */}
                      <td className="num py-1.5 text-right text-ink-faint">
                        {spec}:1{" "}
                        <span className={Number(spec) >= 4.5 ? "text-ink-muted" : "text-buy-ink"}>
                          {Number(spec) >= 4.5 ? "pass" : "fail"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Chart & data semantics — Wong palette, colourblind-safe"
        note="From Wong, Nature Methods 8:441 (2011). Deliberately not red/green: roughly 8% of men have a colour-vision deficiency, and red–green is the axis most of them lose. It is also the axis the accent already occupies. Colour never carries meaning alone — every buy/sell distinction is also a glyph, a code letter, or a written label."
      >
        <div className="surface grid gap-4 rounded-lg p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Swatch name="--buy" className="bg-buy" role="BUY · always paired with ▲" />
          <Swatch name="--sell" className="bg-sell" role="SELL · always paired with ▼" />
          <Swatch name="--neutral" className="bg-flat" role="No direction" />
          <Swatch name="--series-3" className="bg-series-3" role="Third chart series" />
        </div>
        <div className="surface flex flex-wrap items-center gap-6 rounded-lg p-4">
          <span className="inline-flex items-center gap-1.5 text-sm text-buy-ink">
            <span aria-hidden>▲</span> Acquired
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm text-sell-ink">
            <span aria-hidden>▼</span> Disposed
          </span>
          <span className="text-xs text-ink-muted">
            The glyph is redundant with the colour on purpose. Remove the colour and the row still
            says which way the money went.
          </span>
        </div>
        <p className="max-w-[76ch] text-xs leading-relaxed text-ink-muted">
          <strong className="font-semibold text-ink">
            Ink is measured against the tint, not the page.
          </strong>{" "}
          A direction badge sits on <code className="num">--buy-soft</code> or{" "}
          <code className="num">--sell-soft</code> — the same hue as its own ink, at 10% — and on a
          zebra row that tint composites over <code className="num">--surface-sunken</code> as well.
          The tint lifts the ground toward the type and eats the margin, so an ink checked against
          white can read 5.5:1 there and 4.0:1 where it is actually used. Both light inks are tuned
          against that worst case. <code className="num">--buy</code> and{" "}
          <code className="num">--sell</code> themselves keep the canonical Wong values: a mark owes
          3:1, and the palette should not be distorted where identification happens.
        </p>
        <div className="surface rounded-lg p-4">
          <p className="mb-3 text-2xs text-ink-faint">
            Heatmap ramp — Viridis, perceptually uniform sequential
          </p>
          <div className="flex h-8 overflow-hidden rounded-md border border-border">
            <span className="flex-1 bg-[var(--ramp-0)]" />
            <span className="flex-1 bg-[var(--ramp-1)]" />
            <span className="flex-1 bg-[var(--ramp-2)]" />
            <span className="flex-1 bg-[var(--ramp-3)]" />
            <span className="flex-1 bg-[var(--ramp-4)]" />
            <span className="flex-1 bg-[var(--ramp-5)]" />
          </div>
          <p className="mt-2 text-2xs text-ink-faint">
            A sequential quantity gets a sequential ramp. A red–green diverging scale here would be
            wrong twice over.
          </p>
        </div>
      </Section>

      <Section
        title="Type — Onest for interface, IBM Plex Mono for every figure"
        note="Numbers are set in mono with tabular figures so a column of amounts aligns digit-for-digit, and so a ticking counter never changes width as it climbs. The scale has ten steps and nothing between them."
      >
        <div className="surface flex flex-col divide-y divide-border rounded-lg px-4">
          {TYPE_SCALE.map((step) => (
            <div key={step.cls} className="flex items-baseline gap-4 py-2.5">
              <span className="num w-24 shrink-0 text-2xs text-ink-faint">{step.rem}rem</span>
              <span className="num w-20 shrink-0 text-2xs text-ink-faint">{step.cls}</span>
              <span className={`${step.cls} truncate font-medium tracking-tight text-ink`}>
                Insider tape
              </span>
            </div>
          ))}
          <div className="flex items-baseline gap-4 py-3">
            <span className="num w-24 shrink-0 text-2xs text-ink-faint">.num</span>
            <span className="num w-20 shrink-0 text-2xs text-ink-faint">mono</span>
            <span className="num text-base text-ink">1,204,880 · 0.00 · $2.79M · ₹24.5 Cr</span>
          </div>
        </div>
      </Section>

      <Section
        title="Layout \u2014 one left edge per shell"
        note="The canonical layout contract. r3 pinned every page to the viewport left edge and left a dead strip of paper down the right of a wide screen. r4 corrected that by centring the whole frame, which centred the CHROME with it. r5 separated the two \u2014 chrome pins, content is fluid \u2014 and then let them argue: the brand sat at x=24 above a hero starting at 77 and a page heading starting at 256, which reads exactly as it was reported, an icon at the extreme left with gaps under it. r6 keeps the separation and removes the argument by making the chrome share the content's edges."
      >
        <LayoutDiagram />

        <div className="surface flex flex-col divide-y divide-border rounded-lg px-4">
          {SHELL_TOKENS.map((t) => (
            <div key={t.name} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
              <span className="num w-48 shrink-0 text-2xs text-ink">{t.name}</span>
              <span className="num w-52 shrink-0 text-2xs text-ink-faint">{t.value}</span>
              <span className="min-w-0 flex-1 text-sm text-ink-muted">{t.role}</span>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {LAYOUT_RULES.map((rule) => (
            <div key={rule.title} className="surface-sunken flex flex-col gap-2 rounded-lg p-4">
              <p className="text-sm font-semibold text-ink">{rule.title}</p>
              <p className="text-sm leading-relaxed text-ink-muted">{rule.body}</p>
            </div>
          ))}
        </div>

        <p className="max-w-[80ch] text-sm leading-relaxed text-ink-muted">
          Width is spent on information, not on stretch. At <span className="num">xl</span> a page
          with real secondary content becomes an asymmetric two-column grid across the whole region
          \u2014 the landing hero at <span className="num">7/12</span> beside the live tape at{" "}
          <span className="num">5/12</span>, <span className="num">/stock</span> as a panel rail
          beside the record, <span className="num">/settings</span> as two columns of cards. Inside
          the sidebar shell that split starts at <span className="num">xl</span> and not{" "}
          <span className="num">lg</span>, because <span className="num">lg</span> leaves ~736px of
          content region and dividing it again reproduces the same problem in miniature. Beyond
          that, rows earn their width by gaining COLUMNS rather than by stretching a void down their
          middle \u2014 see the tape at <span className="num">1440</span> and above.
        </p>
      </Section>

      <Section
        title="Shape, spacing and depth"
        note="Radius carries meaning: rectangular things are labels, pills are controls. Depth is not decoration — on the dark ground it is a border plus a 1px inset highlight along the top edge, the way a physical panel catches light; a drop shadow on near-black does nothing at all."
      >
        <div className="surface flex flex-col divide-y divide-border rounded-lg px-4">
          {RADII.map((r) => (
            <div key={r.cls} className="flex items-center gap-4 py-3">
              <span
                aria-hidden
                className={`size-9 shrink-0 border border-border-strong bg-fill ${r.cls}`}
              />
              <span className="num w-28 shrink-0 text-2xs text-ink-faint">{r.cls}</span>
              <span className="num w-12 shrink-0 text-2xs text-ink-faint">{r.px}</span>
              <span className="text-sm text-ink-muted">{r.role}</span>
            </div>
          ))}
        </div>

        <div className="surface rounded-lg p-4">
          <p className="mb-3 text-2xs text-ink-faint">Spacing — the 4px grid</p>
          <div className="flex flex-wrap items-end gap-3">
            {SPACING.map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <span
                  aria-hidden
                  className="block bg-accent-bright"
                  style={{ width: s * 4, height: s * 4 }}
                />
                <span className="num text-2xs text-ink-faint">{s * 4}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="surface rounded-lg p-6">
            <p className="num text-2xs text-ink-faint">--shadow-card</p>
            <p className="mt-1 text-sm text-ink-muted">Resting surfaces. This panel.</p>
          </div>
          <div className="surface-raised rounded-lg p-6">
            <p className="num text-2xs text-ink-faint">--shadow-overlay</p>
            <p className="mt-1 text-sm text-ink-muted">Dialogs, popovers, the palette.</p>
          </div>
        </div>
      </Section>

      <Section title="Transaction codes — all 20, colored by signal weight">
        <div className="surface flex flex-wrap gap-2 rounded-lg p-4">
          {Object.keys(SEC_TRANSACTION_CODES).map((code) => (
            <TransactionCodeBadge key={code} code={code} />
          ))}
        </div>
      </Section>

      <Section title="Currency values — native + USD, lakh/crore, not-disclosed">
        <div className="surface flex flex-col gap-2 rounded-lg p-4 text-sm">
          <CurrencyValue value={2_790_000} currency="USD" valueUsd={2_790_000} />
          <CurrencyValue value={245_000_000} currency="INR" valueUsd={2_793_000} />
          <CurrencyValue value={320_000} currency="INR" valueUsd={null} />
          <span className="inline-flex items-center gap-2">
            <CurrencyValue value={null} currency="INR" valueUsd={null} />
            <span className="text-xs text-ink-faint">(SAST rows carry no value by design)</span>
          </span>
        </div>
      </Section>

      <Section title="Badges, flags & status">
        <div className="surface flex flex-wrap items-center gap-3 rounded-lg p-4">
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

      <Section
        title="Controls — shape tells you what is clickable"
        note="Rectangular 6px badges are static labels. Pill-shaped chips are interactive. That one distinction is the only cue a reader gets, so it is never decorative."
      >
        <div className="surface flex flex-wrap items-center gap-3 rounded-lg p-4">
          <Button size="sm">Primary</Button>
          <Button size="sm" variant="outline">
            Outline
          </Button>
          <Button size="sm" variant="secondary">
            Secondary
          </Button>
          <Button size="sm" variant="ghost">
            Ghost
          </Button>
          <Button size="sm" variant="destructive">
            Destructive
          </Button>
          <Button size="sm" variant="link">
            Link
          </Button>
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
          <Badge variant="destructive">destructive</Badge>
        </div>
      </Section>

      <Section title="Stat cards — spring count-up (static under reduced motion)">
        <div className="grid gap-3 sm:grid-cols-3">
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

      <Section
        title="Motion presets"
        note="Springs, not durations: physical settling stays coherent when two animations of different distances run side by side. A component that hand-rolls its own spring is a bug. Everything honours prefers-reduced-motion — large transforms are dropped entirely, not merely shortened."
      >
        <div className="surface flex flex-col divide-y divide-border rounded-lg px-4">
          {MOTION_PRESETS.map(([name, spring, role]) => (
            <div key={name} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5">
              <span className="num w-24 shrink-0 text-xs font-semibold text-ink">{name}</span>
              <span className="num w-28 shrink-0 text-2xs text-ink-faint">{spring}</span>
              <span className="text-xs text-ink-muted">{role}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Live feed row — animated insert">
        <div className="flex flex-col gap-3">
          <div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setFeed((current) => [fakeTrade(nextSeq.current++), ...current].slice(0, 5))
              }
            >
              Inject demo trade
            </Button>
          </div>
          <div className="surface overflow-hidden rounded-lg">
            <ul data-testid="demo-feed">
              {feed.map((trade) => (
                // The injected clock is what makes "18m ago" the same
                // string on the server and in the browser. Without it the
                // row reads the wall clock twice, ~200ms apart, and the
                // showcase becomes the one page that cannot hydrate.
                <LiveFeedRow key={trade.id} trade={trade} now={DEMO_NOW} />
              ))}
            </ul>
          </div>
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
            <p className="surface rounded-lg p-4 text-sm text-ink-muted">
              TanStack Table drives the model, TanStack Virtual windows the rows — only the visible
              slice exists in the DOM, so 10k rows scroll at 60fps. Headers expose aria-sort and
              toggle on click. Rows carry a hairline and a hover ground and nothing else: a shadow
              or a blur per row is what turns a cheap scroll into a janky one.
            </p>
          </TabsContent>
        </Tabs>
      </Section>

      <Section
        title="Empty states — honest, never fabricated"
        note="A missing value is never a zero. When a source is unavailable the product says so plainly instead of drawing a flat line at nought, because a fabricated zero is indistinguishable from a real one."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="surface rounded-lg p-4">
            <p className="text-2xs text-ink-faint">Value not disclosed</p>
            <p className="mt-2 text-sm text-ink">
              <NotDisclosed />{" "}
              <span className="text-ink-muted">— the filing carried no figure</span>
            </p>
          </div>
          <div className="surface rounded-lg p-4">
            <p className="text-2xs text-ink-faint">No rows</p>
            <p className="mt-2 text-sm text-ink-muted">
              No insider transactions on record for this company.
            </p>
          </div>
        </div>

        <p className="max-w-[76ch] text-xs leading-relaxed text-ink-muted">
          <strong className="font-semibold text-ink">One shape for “there is nothing here”.</strong>{" "}
          Three empty screens had grown three different layouts, which made one kind of event read
          as three. <code className="num">EmptyState</code> is an icon, one sentence saying what
          would be here and what it is for, and at most one action — an empty state offering four
          next steps is a menu, and a reader who wanted a menu would not be looking at an empty
          list. It is also the only place outside the auth screens still allowed to centre: one
          object, no column to scan.
        </p>
        <EmptyState
          icon={Star}
          title="Nothing tracked yet"
          body="Every trade on this site is already yours to read. A watchlist just keeps the companies you care about in one place, and tells you when they file."
          action={
            <Button variant="outline" size="sm">
              Browse companies
            </Button>
          }
        />
      </Section>

      <Section
        title="Loading — skeleton rows, never a spinner"
        note="A spinner says “something is happening”. A row skeleton says “rows are coming, and this is the shape of one”, and holds the space they will occupy so nothing below jumps when they land. Bar widths track the real columns; the shimmer stops under prefers-reduced-motion."
      >
        <div className="surface @container overflow-hidden rounded-lg">
          <RowSkeleton rows={4} height={40} />
        </div>
      </Section>

      <Section title="Toasts">
        <div>
          <Button
            variant="outline"
            onClick={() => toast.success("Saved", { description: "This is the toast primitive." })}
          >
            Show toast
          </Button>
        </div>
      </Section>
    </div>
  );
}
