"use client";

/**
 * Net insider flow as a treemap.
 *
 * ENCODING (deliberate, and spelled out in the legend under the chart):
 *
 *  - AREA = gross notional traded. Size is "how much money moved" — the one
 *    quantity here that is always non-negative and always comparable.
 *
 *  - FILL = |net| ÷ gross: the share of a cell's own flow that survives
 *    netting, i.e. how one-sided the trading was. That is a magnitude, not a
 *    direction, so it takes a perceptually uniform SEQUENTIAL ramp (Viridis,
 *    --ramp-0 … --ramp-5). It is measured against the cell's own gross flow
 *    rather than against the largest cell on screen, so a filter that removes
 *    the biggest company does not repaint everything that survives it.
 *
 *  - DIRECTION is set in type, never in hue: a ▲/▼ glyph on the tile, the
 *    signed figure beside it, a written label in the tooltip, and the sign
 *    inside every aria-label. A reader who sees no colour loses nothing.
 *
 * Why direction is not the fill — which is what "heatmap" usually implies:
 * netting is signed, but the *strength* of the netting is not, and the
 * reflexive red→green diverging ramp would be wrong twice over. It invents a
 * meaningful midpoint the quantity does not have, and red–green is the exact
 * axis roughly 8% of men cannot resolve. Two channels each carrying one fact
 * beats one hue carrying both badly.
 *
 * The MSPR overlay is a corner mark, never part of the area or the fill — it
 * is sparse, and letting it change a cell's size would misreport flow.
 */
import { Group } from "@visx/group";
import { Treemap, stratify, treemapSquarify } from "@visx/hierarchy";
import { ParentSize } from "@visx/responsive";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import type { HeatmapCell } from "@/lib/api/queries";
import { cn } from "@/lib/utils";

export interface HeatmapTreemapProps {
  cells: HeatmapCell[];
  groupBy: "company" | "sector" | "country";
  /** Timeframe carried into the screener link so the drill-down matches. */
  days: number;
  market?: string;
  height?: number;
}

const compactUsd = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
};

/** The house direction glyphs, matching TrendBadge so ▲/▼/▬ mean one thing. */
const glyphFor = (n: number): string => (n > 0 ? "▲" : n < 0 ? "▼" : "▬");
const directionFor = (n: number): string =>
  n > 0 ? "Net buying" : n < 0 ? "Net selling" : "Balanced";

/**
 * Label ink for the two halves of the ramp.
 *
 * Both tones are theme-INVARIANT on purpose. The Viridis stops are identical
 * in light and dark (a perceptual ramp that flipped with the theme would no
 * longer be perceptual), so a label ink that flipped would fail on one of
 * them. `primary-foreground` is the single fixed paper tone in the token set;
 * --ramp-0 is the scale's own darkest stop, which is why deep-violet-on-yellow
 * reads as part of the same object rather than as a second colour.
 */
const INK_ON_DARK = { text: "fill-primary-foreground", edge: "stroke-primary-foreground" } as const;
const INK_ON_LIGHT = { text: "fill-[var(--ramp-0)]", edge: "stroke-[var(--ramp-0)]" } as const;

/**
 * The sequential scale, QUANTIZED to the six token stops rather than
 * interpolated between them. Two reasons: interpolating would mean copying
 * the stop hexes into JS to mix them, and the tokens are the source of truth,
 * not a duplicate of them; and a classed scale lets the legend print exact
 * breaks instead of a gradient the reader has to eyeball.
 *
 * `ink` is measured, not guessed — WCAG relative luminance of each stop, and
 * the contrast of each candidate ink against it:
 *
 *     stop      L      on paper   on --ramp-0
 *     ramp-0  0.019      14.6:1        —
 *     ramp-1  0.070       8.4:1       1.7:1
 *     ramp-2  0.159       4.8:1       3.0:1
 *     ramp-3  0.300       2.9:1       5.1:1
 *     ramp-4  0.503       1.8:1       8.0:1
 *     ramp-5  0.782       1.2:1      12.1:1
 *
 * Every chosen pairing clears 4.5:1; the flip lands between ramp-2 and
 * ramp-3, which is where Viridis crosses L≈0.18.
 */
const RAMP = [
  { fill: "var(--ramp-0)", ink: INK_ON_DARK },
  { fill: "var(--ramp-1)", ink: INK_ON_DARK },
  { fill: "var(--ramp-2)", ink: INK_ON_DARK },
  { fill: "var(--ramp-3)", ink: INK_ON_LIGHT },
  { fill: "var(--ramp-4)", ink: INK_ON_LIGHT },
  { fill: "var(--ramp-5)", ink: INK_ON_LIGHT },
] as const;

/** Lower bound of each class, in percent — printed under the legend bar. */
const RAMP_BREAKS = [0, 17, 33, 50, 67, 83] as const;

/** Which class a cell falls into. Equal sixths, so no binning judgement hides here. */
function rampStop(netShare: number) {
  const magnitude = Math.min(1, Math.abs(netShare));
  return RAMP[Math.min(RAMP.length - 1, Math.floor(magnitude * RAMP.length))]!;
}

interface TreemapNode {
  id: string;
  parent: string | null;
  size: number;
  cell?: HeatmapCell;
}

function TreemapCanvas({
  cells,
  groupBy,
  days,
  market,
  width,
  height,
}: HeatmapTreemapProps & { width: number; height: number }) {
  const router = useRouter();
  const [hovered, setHovered] = useState<HeatmapCell | null>(null);
  /**
   * Whether the last press came from something that cannot hover.
   *
   * The tooltip is the only place Bought / Sold / Direction / Net share /
   * Trades / MSPR can be read, and it was bound solely to `mouseenter` and
   * `focus`. On a touch device the first tap fired `onClick` and navigated
   * to the screener, so the figures behind every tile were unreachable —
   * not hard to reach, unreachable. A coarse pointer now inspects on the
   * first tap and opens on the second, and the tooltip says so.
   */
  const coarse = useRef(false);

  const root = useMemo(() => {
    const nodes: TreemapNode[] = [
      { id: "root", parent: null, size: 0 },
      ...cells
        .map((cell) => ({
          id: cell.key,
          parent: "root",
          // Gross flow: always positive, and comparable across cells.
          size: cell.buyValueUsd + cell.sellValueUsd,
          cell,
        }))
        .filter((n) => n.size > 0),
    ];
    if (nodes.length === 1) return null;
    return stratify<TreemapNode>()
      .id((d) => d.id)
      .parentId((d) => d.parent)(nodes)
      .sum((d) => d.size)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  }, [cells]);

  if (!root || width < 10) return null;

  const drillDown = (cell: HeatmapCell) => {
    // Straight into the screener with the SAME filters the cell represents,
    // so the number on the tile and the rows behind it always agree.
    const params = new URLSearchParams({ from: isoDaysAgo(days) });
    if (groupBy === "company" && cell.ticker) params.set("ticker", cell.ticker);
    if (groupBy === "sector" && cell.label !== "Unclassified") params.set("sector", cell.label);
    if (groupBy === "country") params.set("market", cell.key);
    else if (market) params.set("market", market);
    router.push(`/screener?${params.toString()}`);
  };

  const hoveredGross = hovered ? hovered.buyValueUsd + hovered.sellValueUsd : 0;
  const hoveredShare =
    hovered && hoveredGross > 0 ? Math.abs(hovered.netValueUsd) / hoveredGross : 0;

  return (
    <div className="relative">
      {/*
        role="group", NOT role="img". An `img` role makes its subtree
        presentational, which would drop every cell out of the accessibility
        tree — and the cells are the whole interaction here, not decoration.
      */}
      <svg width={width} height={height} role="group" aria-label="Net insider flow treemap">
        <Treemap<TreemapNode> root={root} size={[width, height]} tile={treemapSquarify} round>
          {(treemap) => (
            <Group>
              {treemap
                .descendants()
                .filter((node) => node.depth > 0)
                .map((node, i) => {
                  const cell = node.data.cell!;
                  const w = node.x1 - node.x0;
                  const h = node.y1 - node.y0;
                  if (w < 2 || h < 2) return null;
                  const gross = cell.buyValueUsd + cell.sellValueUsd;
                  const netShare = gross > 0 ? cell.netValueUsd / gross : 0;
                  const stop = rampStop(netShare);
                  const glyph = glyphFor(cell.netValueUsd);
                  // Two lines of 12px type need real room; below that the
                  // tile still carries its direction, just not its name.
                  const showLabel = w > 72 && h > 40;
                  const showGlyph = w > 20 && h > 18;

                  return (
                    <Group key={`${cell.key}-${i}`} left={node.x0} top={node.y0}>
                      <rect
                        width={w}
                        height={h}
                        fill={stop.fill}
                        // Hairline in the page ground, so tiles are divided the
                        // way everything else in Ledger is divided. Square
                        // corners and crispEdges keep that rule one pixel wide
                        // at every tile size — a rounded, anti-aliased gap
                        // reads as a soft glow once there are 120 of them.
                        stroke="var(--bg)"
                        strokeWidth={1}
                        shapeRendering="crispEdges"
                        className="cursor-pointer transition-opacity hover:opacity-85"
                        tabIndex={0}
                        role="button"
                        aria-label={`${cell.label}: net ${compactUsd(cell.netValueUsd)} across ${cell.trades} trades`}
                        onPointerDown={(e) => {
                          coarse.current = e.pointerType !== "mouse";
                        }}
                        onMouseEnter={() => setHovered(cell)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(cell)}
                        onBlur={() => setHovered(null)}
                        onClick={() => {
                          // Tap to inspect, tap again to open. A single tap
                          // that navigates makes the tile's own figures
                          // unreadable on every touch device there is.
                          if (coarse.current && hovered?.key !== cell.key) {
                            setHovered(cell);
                            return;
                          }
                          drillDown(cell);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            drillDown(cell);
                          }
                        }}
                      />
                      {showLabel ? (
                        <>
                          <text
                            x={8}
                            y={18}
                            className={cn(
                              "pointer-events-none text-2xs font-semibold",
                              // Mono only when the label is a ticker; sector
                              // and country names are words, not codes.
                              cell.ticker && "num",
                              stop.ink.text,
                            )}
                          >
                            {cell.label.length > 14 ? `${cell.label.slice(0, 13)}…` : cell.label}
                          </text>
                          {/* Glyph first, then the signed figure: direction is
                              legible before the eye reaches the digits. */}
                          <text
                            x={8}
                            y={34}
                            className={cn("num pointer-events-none text-2xs", stop.ink.text)}
                          >
                            {glyph} {compactUsd(Math.abs(cell.netValueUsd))}
                          </text>
                        </>
                      ) : showGlyph ? (
                        <text
                          aria-hidden
                          x={w / 2}
                          y={h / 2 + 4}
                          textAnchor="middle"
                          className={cn("pointer-events-none text-2xs", stop.ink.text)}
                        >
                          {glyph}
                        </text>
                      ) : null}
                      {/* MSPR overlay: a corner mark, never part of the area.
                          Shape carries the sign as well as colour does, and the
                          ink halo keeps it separable on any stop of the ramp. */}
                      {cell.mspr !== null && w > 26 && h > 20 ? (
                        <path
                          d={
                            cell.mspr >= 0
                              ? `M ${w - 13} 13 L ${w - 8} 5 L ${w - 3} 13 Z`
                              : `M ${w - 13} 5 L ${w - 8} 13 L ${w - 3} 5 Z`
                          }
                          fill={cell.mspr >= 0 ? "var(--buy)" : "var(--sell)"}
                          strokeWidth={1}
                          strokeLinejoin="round"
                          className={cn("pointer-events-none", stop.ink.edge)}
                        />
                      ) : null}
                    </Group>
                  );
                })}
            </Group>
          )}
        </Treemap>
      </svg>

      {hovered ? (
        <div
          role="status"
          className="surface-raised pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg p-3 text-xs"
        >
          {/* Mono only when the label really is a ticker — "Health Care" set
              in the figure face would be claiming to be a code. */}
          <p className={cn("text-sm font-semibold text-ink", hovered.ticker && "num")}>
            {hovered.label}
          </p>
          {hovered.name !== hovered.label ? <p className="text-ink-faint">{hovered.name}</p> : null}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-ink-muted">Bought</dt>
            <dd className="num text-right text-ink">{compactUsd(hovered.buyValueUsd)}</dd>
            <dt className="text-ink-muted">Sold</dt>
            <dd className="num text-right text-ink">{compactUsd(hovered.sellValueUsd)}</dd>
            {/* The direction spelled out, so the tooltip never depends on the
                glyph or on the reader distinguishing vermillion from blue. */}
            <dt className="text-ink-muted">Direction</dt>
            <dd
              className={cn(
                "text-right font-semibold",
                hovered.netValueUsd > 0
                  ? "text-buy-ink"
                  : hovered.netValueUsd < 0
                    ? "text-sell-ink"
                    : "text-ink-muted",
              )}
            >
              <span aria-hidden>{glyphFor(hovered.netValueUsd)} </span>
              {directionFor(hovered.netValueUsd)}
            </dd>
            <dt className="text-ink-muted">Net</dt>
            <dd className="num text-right font-semibold text-ink">
              {compactUsd(hovered.netValueUsd)}
            </dd>
            {/* The number the fill is drawn from, so the tile can be checked. */}
            <dt className="text-ink-muted">Net share</dt>
            <dd className="num text-right text-ink">{(hoveredShare * 100).toFixed(0)}%</dd>
            <dt className="text-ink-muted">Trades</dt>
            <dd className="num text-right text-ink">{hovered.trades.toLocaleString("en-US")}</dd>
            {hovered.mspr !== null ? (
              <>
                <dt className="text-ink-muted">MSPR</dt>
                <dd className="num text-right text-ink">{hovered.mspr.toFixed(1)}</dd>
              </>
            ) : null}
          </dl>
          <p className="mt-2 text-2xs text-ink-faint">
            <span className="hidden [@media(hover:hover)_and_(pointer:fine)]:inline">
              Click to open in the screener
            </span>
            <span className="[@media(hover:hover)_and_(pointer:fine)]:hidden">
              Tap again to open in the screener
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The legend lives here rather than on the page so it cannot drift from the
 * scale: both read the same RAMP constant, so a stop can never be recoloured
 * without the key following it.
 */
function TreemapLegend() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5 border-t border-border px-2 pt-4">
      <div className="flex flex-col gap-1.5">
        <p className="text-2xs font-semibold text-ink-muted">
          Fill — share of gross flow that is net
        </p>
        <div aria-hidden className="flex w-max overflow-hidden rounded-sm border border-border">
          {RAMP.map((stop) => (
            <span key={stop.fill} className="h-3 w-10" style={{ background: stop.fill }} />
          ))}
        </div>
        <div className="flex w-max">
          {RAMP_BREAKS.map((lower) => (
            <span key={lower} className="num w-10 text-2xs text-ink-faint">
              {lower}%
            </span>
          ))}
        </div>
        <p className="max-w-sm text-2xs text-ink-muted">
          <span className="num">0%</span> — buying and selling cancelled out.{" "}
          <span className="num">100%</span> — every dollar moved the same way. Sequential, because
          the strength of a net position is one quantity and not two.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-2xs font-semibold text-ink-muted">
          Direction — read from the glyph, not the fill
        </p>
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-2xs">
          {/* The glyphs are inked neutrally here because that is exactly how
              they are inked on a tile: the ramp owns the colour, the glyph
              owns the sign, and the key must not promise otherwise. */}
          <div className="flex items-center gap-1.5">
            <dt aria-hidden className="num text-ink">
              ▲
            </dt>
            <dd className="text-ink-muted">Net buying</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt aria-hidden className="num text-ink">
              ▼
            </dt>
            <dd className="text-ink-muted">Net selling</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt aria-hidden className="num text-ink">
              ▬
            </dt>
            <dd className="text-ink-muted">Balanced</dd>
          </div>
        </dl>
        {/* The one place the Wong pair appears on this chart: the corner mark
            is small enough that shape alone would be hard work, so it carries
            both, and the tile fill stays out of the argument entirely. */}
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-2xs text-ink-muted">
          <span aria-hidden className="num text-buy-ink">
            ▲
          </span>
          <span aria-hidden className="num text-sell-ink">
            ▼
          </span>
          MSPR available (sparse — Finnhub coverage only)
        </p>
      </div>
    </div>
  );
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function HeatmapTreemap(props: HeatmapTreemapProps) {
  if (props.cells.length === 0) {
    return (
      <p className="surface-sunken rounded-lg px-4 py-16 text-center text-sm text-ink-muted">
        No insider flow in this window. Widen the timeframe or clear a filter.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      {/* The wrapper's height follows the canvas rather than pinning it, so
          `ParentSize` measures a width first and the height derives from it. */}
      {/*
        A DEFINITE height, stepped by breakpoint rather than fixed at 520.

        Definite because `ParentSize` renders a `height: 100%` child and
        measures THAT: inside an auto-height parent it resolves to zero, the
        observer never reports a usable box, and the canvas comes back blank.
        A `min-height` on the parent is not a height for this purpose.

        Stepped because area is the encoding. A canvas that keeps 520px while
        losing a third of its width does not shrink the picture, it stretches
        it — and the label gate (72x40px) then demands a larger share of total
        flow before a tile will say its own name.
      */}
      <div
        className="h-80 sm:h-96 lg:h-[32.5rem]"
        style={props.height === undefined ? undefined : { height: props.height }}
      >
        <ParentSize>
          {({ width, height }) => <TreemapCanvas {...props} width={width} height={height} />}
        </ParentSize>
      </div>
      <TreemapLegend />
    </div>
  );
}
