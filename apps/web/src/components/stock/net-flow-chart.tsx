"use client";

/**
 * Bipolar (diverging) monthly insider-flow chart: buys up in the buy token,
 * sells down in the sell token, one shared axis anchored at zero.
 * Palette validated with the dataviz skill's checker (CVD ΔE 9.2 deutan,
 * contrast ≥3:1 on the dark surface); polarity is double-encoded by bar
 * direction, so color is never the only channel.
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

const BUY = "#34E3B0";
const SELL = "#FB7185";
const GRID = "rgba(255,255,255,0.06)";
const INK_MUTED = "#96a0b5";

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
    <div className="glass-strong rounded-lg px-3 py-2 text-xs">
      <p className="mb-1 font-medium text-foreground">{label}</p>
      <p className="text-muted-foreground">Bought ${formatCompact(buy)}</p>
      <p className="text-muted-foreground">Sold ${formatCompact(Math.abs(sell))}</p>
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
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey="month"
            tick={{ fill: INK_MUTED, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(m: string) => m.slice(2)}
          />
          <YAxis
            tick={{ fill: INK_MUTED, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickFormatter={(v: number) => `$${formatCompact(v, 0)}`}
          />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" />
          <Tooltip content={<FlowTooltip />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="buyUsd" stackId="flow" fill={BUY} radius={[4, 4, 0, 0]} maxBarSize={28} />
          <Bar dataKey="sellNeg" stackId="flow" fill={SELL} radius={[0, 0, 4, 4]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
      {/* Legend in ink tokens; colored dots carry identity. */}
      <figcaption className="mt-1 flex items-center gap-4 text-2xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: BUY }} aria-hidden /> Bought
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: SELL }} aria-hidden /> Sold
        </span>
        <span className="ml-auto text-subtle-foreground">USD notional / month</span>
      </figcaption>
    </figure>
  );
}
