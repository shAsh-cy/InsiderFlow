"use client";

/**
 * MSPR insider-sentiment sparkline: one 2px series against a zero rule,
 * with a crosshair tooltip.
 *
 * No legend here, deliberately. The rule that colour may not carry meaning
 * alone exists to keep two series apart; with a single series there is
 * nothing to tell apart, and the panel heading plus the caption directly
 * beneath already name it twice. A third label would be noise.
 *
 * The line takes `--series-3` rather than buy/sell: MSPR crosses zero, so
 * no single hue could honestly stand for its polarity, and borrowing the
 * buy colour would imply one.
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

const LINE = "var(--series-3)";
const RULE = "var(--border)";
/** The active dot punches out of whatever paper it lands on. */
const GROUND = "var(--surface)";

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
    <div className="surface-raised rounded-md px-2.5 py-1.5 text-xs">
      <span className="num text-ink-muted">{point.label}</span>{" "}
      <span className="num font-medium text-ink">
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
          <ReferenceLine y={0} stroke={RULE} />
          <Tooltip content={<SparkTooltip />} cursor={{ stroke: RULE }} />
          <Line
            type="monotone"
            dataKey="mspr"
            stroke={LINE}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: LINE, stroke: GROUND, strokeWidth: 2 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </figure>
  );
}
