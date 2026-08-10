"use client";

/**
 * Bipolar (diverging) monthly insider-flow chart: buys up, sells down,
 * one shared axis anchored at zero.
 *
 * Colour is the Wong palette (`--buy` vermillion / `--sell` blue), never
 * red/green — that is the axis roughly 8% of men cannot separate, and it
 * is the axis every other finance chart insists on using. Polarity is
 * double-encoded by bar direction and named in the caption, so hue is
 * confirmation rather than the only channel.
 *
 * Every colour is read through a CSS variable rather than written as a
 * literal: the same markup then renders deliberately on paper and after
 * sundown, and flipping the theme needs no React re-render.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCompact } from "@/lib/format";
import type { NetFlowPoint } from "@/lib/api/page-queries";

const BUY = "var(--buy)";
const SELL = "var(--sell)";
/** Grid and axes get the product's one border weight, nothing heavier. */
const RULE = "var(--border)";
/** Zero is an anchor, not scaffolding, so it sits one step above the grid. */
const ZERO = "var(--ink-faint)";
/** Axis labels are scaffolding — a step below body ink, and mono so the
    tick column stays aligned as magnitudes change. */
const AXIS_INK = "var(--ink-faint)";
const MONO = "var(--font-mono)";

function FlowTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const buy = payload.find((p) => p.dataKey === "buyUsd")?.value ?? 0;
  const sell = payload.find((p) => p.dataKey === "sellNeg")?.value ?? 0;
  return (
    <div className="surface-raised rounded-md px-3 py-2 text-xs">
      <p className="num mb-1 font-medium text-ink">{label}</p>
      <p className="text-ink-muted">
        Bought <span className="num text-buy-ink">${formatCompact(buy)}</span>
      </p>
      <p className="text-ink-muted">
        Sold <span className="num text-sell-ink">${formatCompact(Math.abs(sell))}</span>
      </p>
    </div>
  );
}

export default function NetFlowChart({ data }: { data: NetFlowPoint[] }) {
  const chartData = data.map((d) => ({ ...d, sellNeg: -d.sellUsd }));
  return (
    <figure aria-label="Monthly insider buy and sell notional, USD">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={chartData}
          stackOffset="sign"
          barCategoryGap="28%"
          margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
        >
          <CartesianGrid vertical={false} stroke={RULE} />
          <XAxis
            dataKey="month"
            tick={{ fill: AXIS_INK, fontSize: 11, fontFamily: MONO }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(m: string) => m.slice(2)}
          />
          <YAxis
            tick={{ fill: AXIS_INK, fontSize: 11, fontFamily: MONO }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(v: number) => `$${formatCompact(v, 0)}`}
          />
          <ReferenceLine y={0} stroke={ZERO} />
          {/* Declared before the bars on purpose: Recharts paints the hover
              band in child order, so an opaque fill lands behind the marks
              instead of blanking the bar you are pointing at. */}
          <Tooltip content={<FlowTooltip />} cursor={{ fill: "var(--fill)" }} />
          <Bar dataKey="buyUsd" stackId="flow" fill={BUY} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="sellNeg" stackId="flow" fill={SELL} radius={[0, 0, 4, 4]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
      {/* Written legend, always — the swatch is a second channel, not the
          first. Square swatches, because a round one in this product is a
          promise that the thing can be clicked. */}
      <figcaption className="text-2xs mt-1 flex items-center gap-4 text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 bg-buy" aria-hidden /> Bought
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 bg-sell" aria-hidden /> Sold
        </span>
        <span className="ml-auto text-ink-faint">USD notional / month</span>
      </figcaption>
    </figure>
  );
}
