"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

/**
 * Count-up on rAF with an ease-out curve. Deliberately dependency-free —
 * pulling the motion runtime in for a number tween would cost more than
 * the effect is worth. Renders the final value immediately when the user
 * prefers reduced motion.
 */
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced) {
      node.textContent = format(value);
      return;
    }
    const duration = 1100;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutExpo — fast start, gentle settle
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      node.textContent = format(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, format, reduced]);

  return (
    <span ref={ref} className="tnum">
      {format(reduced ? value : 0)}
    </span>
  );
}

export function StatCard({
  label,
  value,
  format = (n) => Math.round(n).toLocaleString("en-US"),
  hint,
  accent = false,
  className,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
  hint?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "glass rounded-xl p-4 transition-transform duration-200 hover:-translate-y-0.5",
        accent && "border-gradient",
        className,
      )}
    >
      <p className="text-2xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1.5 text-2xl font-semibold", accent && "text-gradient")}>
        <CountUp value={value} format={format} />
      </p>
      {hint ? <p className="mt-1 text-xs text-subtle-foreground">{hint}</p> : null}
    </div>
  );
}
