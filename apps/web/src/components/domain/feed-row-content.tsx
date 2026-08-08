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
      {/* The `col-start`/`row-start` pairs are the two-line phone layout and
          are inert above 640px, where the row switches back to flex and grid
          placement stops meaning anything. See FEED_ROW_CLASS for why the row
          has to fold at all: on a 360px screen the insider's name — the
          SUBJECT of the row — was resolving to twelve pixels and rendering as
          a single ellipsis, squeezed out by two fixed columns that never
          relaxed. Nothing overflowed and nothing scrolled sideways, so no
          amount of scrollWidth checking would ever have found it. */}
      {/* No placement class: this one's grid item is the tooltip's <button>
          wrapper, and `className` reaches the badge inside it. Auto-placement
          puts the first DOM child in the first free cell, which is the cell
          it wants. */}
      <TransactionCodeBadge code={trade.code} />
      <CountryFlag country={trade.market} className="col-start-1 row-start-2 text-2xs" />
      {/* `data-cell` on each column, matching the hook the arrival flash
          already uses. Attributes rather than props: the row components'
          signatures are part of the design system's contract, and a test
          that has to find "the span with more than three characters in it"
          is a test that will one day measure the wrong thing and say so
          confidently. */}
      <span
        data-cell="ticker"
        className="num col-start-2 row-start-1 w-auto max-w-[7rem] shrink-0 truncate text-xs font-semibold text-ink sm:w-[4.5rem] sm:max-w-none"
      >
        {trade.company.ticker ?? trade.company.name}
      </span>
      <span
        data-cell="insider"
        className="col-start-2 row-start-2 min-w-0 flex-1 truncate text-2xs text-ink-muted sm:text-sm"
      >
        {trade.insider.name}
      </span>
      {/* Line two's timestamp. A second element rather than a responsive
          rewrite of the one below, because that one is gated on the
          CONTAINER (`@3xl`) and this one on the VIEWPORT — mixing the two
          conditions on a single element gives a cascade whose winner depends
          on which of a wide screen and a narrow column you are looking at. */}
      <span className="num col-start-3 row-start-2 shrink-0 text-right text-2xs text-ink-faint sm:hidden">
        {timeAgo(trade.createdAt, now)}
      </span>

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
      {/* `min-w-32`, not `w-32`. The child is `whitespace-nowrap`, and a dual
          INR/USD figure ("₹1,234.5 Cr · $148.2M") is ~145px of mono at 12px —
          so a fixed 128px box with `justify-end` spilled the figure LEFT over
          the insider's name at every viewport, not just narrow ones. It only
          went unnoticed because the surrounding `.surface` clips. A floor
          lets the column grow for the rows that need it and `overflow-hidden`
          bounds the worst case. */}
      <span
        data-cell="value"
        data-direction={trade.acquiredDisposed ?? undefined}
        className="col-start-3 row-start-1 flex min-w-24 shrink-0 items-center justify-end gap-1 overflow-hidden px-1 sm:min-w-32"
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
export const FEED_ROW_CLASS = [
  // Below 640px the row is a four-column grid over two lines: code · ticker ·
  // value on the first, country · insider · time on the second, and the
  // actions menu spanning both on the right. Above it, the flex tape r3
  // designed, unchanged.
  //
  // The fold is on the VIEWPORT, not the container, even though every
  // optional column here is container-gated. The two rules are asking
  // different questions: "which columns fit" is about the column's width, and
  // the container query answers it correctly in a narrow landing strip on a
  // wide screen. "Is this a phone" is not — and a container query cannot
  // answer it anyway, because the container is 607px at a 639px viewport and
  // 592px at 640px, so it moves the wrong way across the boundary.
  "grid h-[var(--tape-row-h)] grid-cols-[auto_minmax(0,1fr)_auto_auto] grid-rows-[auto_auto]",
  "items-center gap-x-2 gap-y-0.5 px-3 text-sm",
  "sm:flex sm:h-10 sm:items-center sm:gap-2.5",
  "border-b border-border transition-colors last:border-b-0 hover:bg-fill",
].join(" ");

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
