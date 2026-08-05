"use client";

/**
 * Net insider flow as a treemap.
 *
 * ENCODING (deliberate, and stated on the page):
 *  - AREA  = gross notional traded. Size is "how much money moved", which is
 *    the only quantity that is always non-negative and always comparable.
 *  - COLOUR = net direction, as a diverging teal→violet ramp through a
 *    neutral midpoint. Buying and selling are opposite poles of one measure,
 *    which is exactly what a diverging scale is for; a rainbow here would
 *    invent ordering that does not exist.
 *  - The MSPR overlay is a corner mark, never part of the area or the fill —
 *    it is sparse, and letting it change a cell's size would misreport flow.
 *
 * Intensity is scaled against the SHARE of a cell's own gross flow that is
 * net, not against the largest cell on screen, so a filter that removes the
 * biggest company does not repaint everything that survives it.
 */
import { Group } from "@visx/group";
import { Treemap, stratify, treemapSquarify } from "@visx/hierarchy";
import { ParentSize } from "@visx/responsive";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

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

/**
 * Diverging ramp: violet (net selling) → neutral → teal (net buying).
 * Both poles are stepped from the brand ramps at matched lightness so neither
 * direction reads as louder than the other.
 */
function fillFor(netShare: number): string {
  const t = Math.max(-1, Math.min(1, netShare));
  const magnitude = Math.abs(t);
  if (magnitude < 0.08) return "oklch(0.30 0.012 260)"; // neutral midpoint
  // 0.34 → 0.62 lightness as intensity grows, so small cells stay legible.
  const lightness = (0.34 + magnitude * 0.2).toFixed(3);
  const chroma = (0.06 + magnitude * 0.1).toFixed(3);
  return t > 0
    ? `oklch(${lightness} ${chroma} 178)` // teal — net buying
    : `oklch(${lightness} ${chroma} 305)`; // violet — net selling
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
                  const showLabel = w > 54 && h > 30;

                  return (
                    <Group key={`${cell.key}-${i}`} left={node.x0} top={node.y0}>
                      <rect
                        width={w}
                        height={h}
                        // 2px surface gap so adjacent fills never touch.
                        rx={3}
                        fill={fillFor(netShare)}
                        stroke="var(--color-background)"
                        strokeWidth={2}
                        className="cursor-pointer transition-opacity hover:opacity-80"
                        tabIndex={0}
                        role="button"
                        aria-label={`${cell.label}: net ${compactUsd(cell.netValueUsd)} across ${cell.trades} trades`}
                        onMouseEnter={() => setHovered(cell)}
                        onMouseLeave={() => setHovered(null)}
                        onFocus={() => setHovered(cell)}
                        onBlur={() => setHovered(null)}
                        onClick={() => drillDown(cell)}
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
                            x={7}
                            y={17}
                            className="pointer-events-none fill-white text-[11px] font-semibold"
                          >
                            {cell.label.length > 14 ? `${cell.label.slice(0, 13)}…` : cell.label}
                          </text>
                          <text
                            x={7}
                            y={31}
                            className="pointer-events-none fill-white/70 text-[10px] tabular-nums"
                          >
                            {compactUsd(cell.netValueUsd)}
                          </text>
                        </>
                      ) : null}
                      {/* MSPR overlay: a corner mark, never part of the area. */}
                      {cell.mspr !== null && w > 26 && h > 20 ? (
                        <circle
                          cx={w - 9}
                          cy={9}
                          r={4}
                          fill={cell.mspr >= 0 ? "oklch(0.78 0.15 178)" : "oklch(0.72 0.17 305)"}
                          stroke="var(--color-background)"
                          strokeWidth={2}
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
          className="glass pointer-events-none absolute left-3 top-3 max-w-xs rounded-lg border border-white/10 p-3 text-xs shadow-xl"
        >
          <p className="text-sm font-semibold">{hovered.label}</p>
          {hovered.name !== hovered.label ? (
            <p className="text-subtle-foreground">{hovered.name}</p>
          ) : null}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
            <dt className="text-muted-foreground">Bought</dt>
            <dd className="text-right">{compactUsd(hovered.buyValueUsd)}</dd>
            <dt className="text-muted-foreground">Sold</dt>
            <dd className="text-right">{compactUsd(hovered.sellValueUsd)}</dd>
            <dt className="text-muted-foreground">Net</dt>
            <dd
              className={cn(
                "text-right font-semibold",
                hovered.netValueUsd >= 0 ? "text-emerald-300" : "text-violet-300",
              )}
            >
              {compactUsd(hovered.netValueUsd)}
            </dd>
            <dt className="text-muted-foreground">Trades</dt>
            <dd className="text-right">{hovered.trades.toLocaleString("en-US")}</dd>
            {hovered.mspr !== null ? (
              <>
                <dt className="text-muted-foreground">MSPR</dt>
                <dd className="text-right">{hovered.mspr.toFixed(1)}</dd>
              </>
            ) : null}
          </dl>
          <p className="mt-2 text-2xs text-subtle-foreground">Click to open in the screener</p>
        </div>
      ) : null}
    </div>
  );
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export function HeatmapTreemap(props: HeatmapTreemapProps) {
  const height = props.height ?? 520;
  if (props.cells.length === 0) {
    return (
      <p className="glass rounded-lg px-4 py-16 text-center text-sm text-muted-foreground">
        No insider flow in this window. Widen the timeframe or clear a filter.
      </p>
    );
  }
  return (
    <div style={{ height }}>
      <ParentSize>
        {({ width }) => <TreemapCanvas {...props} width={width} height={height} />}
      </ParentSize>
    </div>
  );
}
