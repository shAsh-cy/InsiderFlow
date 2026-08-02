"use client";

/**
 * MSPR insider-sentiment sparkline: single 2px series (no legend — the
 * title names it), zero reference line, crosshair tooltip. #7C5CFF is
 * validated in-band against the dark surface.
 */
import {
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { SentimentPoint } from "@/lib/api/queries";

const LINE = "#7C5CFF";

function SparkTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: { label: string; mspr: number | null } }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="glass-strong rounded-lg px-2.5 py-1.5 text-xs">
      <span className="text-muted-foreground">{point.label}</span>{" "}
      <span className="tnum font-medium text-foreground">
        {point.mspr === null ? "—" : point.mspr.toFixed(1)}
      </span>
    </div>
  );
}

export default function SentimentSpark({ points }: { points: SentimentPoint[] }) {
  const data = points.map((p) => ({
    label: `${p.year}-${String(p.month).padStart(2, "0")}`,
    mspr: p.mspr,
  }));
  return (
    <figure aria-label="Monthly share purchase ratio (MSPR), −100 to 100">
      <ResponsiveContainer width="100%" height={88}>
        <LineChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <XAxis dataKey="label" hide />
          <YAxis domain={[-100, 100]} hide />
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
          <Tooltip content={<SparkTooltip />} cursor={{ stroke: "rgba(255,255,255,0.2)" }} />
          <Line
            type="monotone"
            dataKey="mspr"
            stroke={LINE}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: LINE, stroke: "#101218", strokeWidth: 2 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}
