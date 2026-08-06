import Link from "next/link";

import type { FlowSpark } from "@/lib/api/landing-queries";
import { formatCompact } from "@/lib/format";

/**
 * One company's 30-day signed insider flow, drawn as bars around a zero
 * rule.
 *
 * Deliberately hand-drawn SVG rather than a charting library: this strip
 * is decorative context on the landing page, and pulling a chart runtime
 * onto the one route that has to score 100 would cost far more than it
 * returns. It is a server component — no JavaScript ships for it at all.
 *
 * Direction is carried by the bar's side of the baseline AND by the
 * triangle in the label, so it survives greyscale and colour-vision
 * deficiency. Colours are the Wong pair, never red–green.
 */
export function FlowSparkline({ spark }: { spark: FlowSpark }) {
  const { ticker, name, points, netUsd } = spark;

  const peak = Math.max(...points.map((p) => Math.abs(p)), 1);
  const width = 120;
  const height = 30;
  const mid = height / 2;
  const slot = width / Math.max(points.length, 1);
  const bar = Math.max(slot - 0.8, 0.8);

  const up = netUsd > 0;
  const flat = netUsd === 0;

  return (
    <Link
      href={`/stock/${ticker}`}
      className="surface group flex flex-col gap-2 rounded-lg p-3 transition-colors hover:bg-fill"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-xs font-semibold text-ink">{ticker}</span>
        <span
          className={`num text-2xs ${flat ? "text-ink-faint" : up ? "text-buy-ink" : "text-sell-ink"}`}
        >
          <span aria-hidden>{flat ? "▬" : up ? "▲" : "▼"}</span>{" "}
          {flat ? "$0" : `$${formatCompact(Math.abs(netUsd))}`}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-8 w-full"
        role="img"
        aria-label={`${name}: net insider flow over the last 30 days, ${
          flat ? "flat" : up ? "net buying" : "net selling"
        } of ${formatCompact(Math.abs(netUsd))} US dollars`}
      >
        {/* The zero rule — the thing every bar is read against. */}
        <line x1="0" y1={mid} x2={width} y2={mid} stroke="var(--border)" strokeWidth="1" />
        {points.map((point, i) => {
          if (point === 0) return null;
          const magnitude = (Math.abs(point) / peak) * (mid - 1);
          const positive = point > 0;
          return (
            <rect
              key={i}
              x={i * slot}
              y={positive ? mid - magnitude : mid}
              width={bar}
              height={Math.max(magnitude, 0.75)}
              fill={positive ? "var(--buy)" : "var(--sell)"}
            />
          );
        })}
      </svg>

      <span className="truncate text-2xs text-ink-faint">{name}</span>
    </Link>
  );
}
