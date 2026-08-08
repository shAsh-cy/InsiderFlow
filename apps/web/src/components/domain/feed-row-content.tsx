import type { TradeRow } from "@/lib/api/queries";
import { formatShares, timeAgo } from "@/lib/format";

import { cn } from "@/lib/utils";

import { RowActions } from "@/components/feed/row-actions";

import { CountryFlag } from "./country-flag";
import { CurrencyValue } from "./currency-value";
import { RelevanceBadge } from "./relevance-badge";
import { SourceBadge } from "./source-badge";
import { TransactionCodeBadge } from "./transaction-code-badge";

/**
 * Acquired/disposed as a mark. Wong orange up / blue in down — never
 * red–green, and never the racing-green accent, which in this system
 * means "actionable" and must not be read as a direction.
 */
function DirectionGlyph({ direction }: { direction: string | null }) {
  if (direction !== "A" && direction !== "D") return null;
  const buy = direction === "A";
  return (
    <span
      aria-hidden
      title={buy ? "Acquired" : "Disposed"}
      className={cn("text-2xs leading-none", buy ? "text-buy-ink" : "text-sell-ink")}
    >
      {buy ? "▲" : "▼"}
    </span>
  );
}

/**
 * Shared inner markup for the animated and static feed rows.
 *
 * Columnar, on one left edge: code · flag · ticker · insider — then the
 * numerics on their own right edge, then provenance and time. The two
 * figures are fixed-width and right-aligned so that scrolling the tape
 * scans a column of digits rather than a ragged edge.
 */
export function FeedRowContent({ trade, now }: { trade: TradeRow; now?: Date }) {
  const shares = formatShares(trade.shares);
  return (
    <>
      <TransactionCodeBadge code={trade.code} />
      <CountryFlag country={trade.market} className="text-2xs" />
      <span className="num w-[4.5rem] shrink-0 truncate text-xs font-semibold text-ink">
        {trade.company.ticker ?? trade.company.name}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink-muted">{trade.insider.name}</span>

      {/* Shares and value are the two things a reader compares between
          rows, so they get their own fixed columns rather than trailing
          the insider's name at whatever width it leaves.

          The breakpoints are CONTAINER queries, not viewport ones. This
          row renders both full-width on /trades and inside a narrow hero
          column on the landing page; keyed to the viewport, the narrow
          case shows every column on a wide screen and clips them. */}
      <span className="num hidden w-24 shrink-0 text-right text-2xs text-ink-faint @md:block">
        {shares ? `${shares} sh` : ""}
      </span>
      {/* Direction gets its own glyph beside the money, not just the
          colour and not just the code letter. Whether a figure is cash
          coming in or going out is the first thing a reader needs, and
          ~8% of men cannot take it from hue. */}
      {/* `data-cell`/`data-direction` are the hooks the arrival flash
          targets — see `.tape-arrival` in globals.css. Doing it in CSS off
          the row's own class keeps the animation out of the render path:
          a streamed row already re-renders, and nothing here should also
          re-render to make a background fade. */}
      <span
        data-cell="value"
        data-direction={trade.acquiredDisposed ?? undefined}
        className="flex w-32 shrink-0 items-center justify-end gap-1 px-1"
      >
        <DirectionGlyph direction={trade.acquiredDisposed} />
        <CurrencyValue
          value={trade.value}
          currency={trade.currency}
          valueUsd={trade.valueUsd}
          className="text-right text-xs font-medium"
        />
      </span>

      {trade.is10b51 ? (
        <span
          title="Executed under a pre-scheduled Rule 10b5-1 trading plan"
          className="num hidden shrink-0 text-2xs text-ink-faint @2xl:inline"
        >
          10b5-1
        </span>
      ) : null}
      <RelevanceBadge relevance={trade.relevance} className="hidden shrink-0 @lg:inline-flex" />
      <SourceBadge source={trade.source} className="hidden shrink-0 @2xl:inline" />
      <span className="num hidden w-16 shrink-0 text-right text-2xs text-ink-faint @3xl:block">
        {timeAgo(trade.createdAt, now)}
      </span>
      <RowActions ticker={trade.company.ticker} label={trade.company.name} market={trade.market} />
    </>
  );
}

/**
 * A tape line, not a card. Rows are separated by a single hairline and
 * share one surrounding surface — stacking individual cards would put a
 * border and a shadow between every filing and destroy the sense of a
 * continuous tape.
 *
 * Deliberately cheap to paint: no shadow, no blur, no gradient. The
 * virtualized table holds this to a median frame under 20ms while
 * scrolling ten thousand rows.
 */
export const FEED_ROW_CLASS =
  "flex h-10 items-center gap-2.5 border-b border-border px-3 text-sm transition-colors last:border-b-0 hover:bg-fill";

/**
 * The attributes that make a row navigable from the keyboard.
 *
 * Attributes rather than props, deliberately: the row components' prop
 * signatures are part of the design system's contract and are not
 * changing to add an accelerator. TapeList reads these off the DOM, so a
 * row rendered anywhere — the landing strip, /trades, the virtualized
 * history — is navigable without any of them knowing about each other.
 *
 * `tabIndex: -1` because the LIST owns the tab stop; rows are reached
 * with the arrow keys once you are inside it.
 */
export function tapeRowProps(trade: TradeRow) {
  const ticker = trade.company.ticker;
  return {
    "data-tape-row": "",
    "data-tape-ticker": ticker ?? undefined,
    "data-tape-label": trade.company.name,
    "data-tape-market": trade.market,
    // Enter goes to the company page when there is one — the row's home
    // inside this product — and to the filing itself when there is not.
    "data-tape-href": ticker
      ? `/stock/${encodeURIComponent(ticker)}`
      : (trade.filing?.sourceUrl ?? undefined),
    tabIndex: -1,
  } as const;
}
