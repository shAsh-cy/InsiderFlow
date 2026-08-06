"use client";

/**
 * URL-driven filter bar shared by /trades and /screener. The URL is the
 * single source of truth: every change pushes a new query string, the
 * server re-renders through the shared query layer, and the state is
 * shareable / back-forward navigable by construction.
 */
import { SEC_TRANSACTION_CODES } from "@insiderflow/core";
import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { cn } from "@/lib/utils";

/** Selects are inputs, so they take the 8px input radius — not the pill. */
const SELECT_CLASS =
  "h-8 cursor-pointer rounded-md border border-border bg-surface px-2 text-xs text-ink-muted transition-colors hover:bg-fill focus:text-ink [&>option]:bg-surface";

/**
 * A filter chip. Pill-shaped because it is interactive — the rectangular
 * badges elsewhere in the product are not, and that shape difference is
 * the only signal a reader has.
 *
 * An active chip is weight and ground, never colour: the accent is spent
 * once per view, and a row of oxblood chips would spend it a dozen times.
 */
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 cursor-pointer rounded-full border px-3 text-xs transition-colors",
        active
          ? "border-border bg-fill font-semibold text-ink"
          : "border-transparent text-ink-muted hover:bg-fill hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

const MIN_VALUES = [
  { label: "Any value", value: "" },
  { label: "$100K+", value: "100000" },
  { label: "$250K+", value: "250000" },
  { label: "$1M+", value: "1000000" },
  { label: "$5M+", value: "5000000" },
];

export function FilterBar({ advanced = false }: { advanced?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("offset"); // filters reset pagination
      // push (not replace): every filter state is a history entry, so
      // back/forward walks through screens and any URL is shareable.
      router.push(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const get = (key: string) => searchParams.get(key) ?? "";
  const toggle = (key: string) => setParam({ [key]: get(key) === "true" ? null : "true" });
  const hasAny = [...searchParams.keys()].some((k) => k !== "preset");

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Trade filters">
      {/* Market */}
      {["", "US", "IN"].map((market) => (
        <Chip
          key={market || "all"}
          active={get("market") === market}
          onClick={() => setParam({ market: market || null })}
        >
          {market === "" ? "All markets" : market === "US" ? "🇺🇸 US" : "🇮🇳 India"}
        </Chip>
      ))}

      {/* Side */}
      <Chip
        active={get("side") === "buy"}
        onClick={() => setParam({ side: get("side") === "buy" ? null : "buy" })}
      >
        Buys
      </Chip>
      <Chip
        active={get("side") === "sell"}
        onClick={() => setParam({ side: get("side") === "sell" ? null : "sell" })}
      >
        Sells
      </Chip>

      {/* Relevance */}
      <Chip
        active={get("relevance") === "opportunistic"}
        onClick={() =>
          setParam({ relevance: get("relevance") === "opportunistic" ? null : "opportunistic" })
        }
      >
        Opportunistic
      </Chip>

      <Chip active={get("exec_only") === "true"} onClick={() => toggle("exec_only")}>
        Executives only
      </Chip>

      {/* Code */}
      <label className="sr-only" htmlFor="filter-code">
        Transaction code
      </label>
      <select
        id="filter-code"
        className={SELECT_CLASS}
        value={get("code")}
        onChange={(e) => setParam({ code: e.target.value || null })}
      >
        <option value="">Any code</option>
        {Object.keys(SEC_TRANSACTION_CODES).map((code) => (
          <option key={code} value={code}>
            {code} —{" "}
            {SEC_TRANSACTION_CODES[code as keyof typeof SEC_TRANSACTION_CODES].slice(0, 40)}
          </option>
        ))}
      </select>

      {/* Source */}
      <label className="sr-only" htmlFor="filter-source">
        Source
      </label>
      <select
        id="filter-source"
        className={SELECT_CLASS}
        value={get("source")}
        onChange={(e) => setParam({ source: e.target.value || null })}
      >
        <option value="">Any source</option>
        <option value="edgar">EDGAR</option>
        <option value="finnhub">Finnhub</option>
        <option value="fmp">FMP</option>
        <option value="nse-bse">NSE/BSE</option>
      </select>

      {/* Min USD value */}
      <label className="sr-only" htmlFor="filter-min-value">
        Minimum USD value
      </label>
      <select
        id="filter-min-value"
        className={SELECT_CLASS}
        value={get("min_value_usd")}
        onChange={(e) => setParam({ min_value_usd: e.target.value || null })}
      >
        {MIN_VALUES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {advanced ? (
        <>
          <label className="sr-only" htmlFor="filter-role">
            Insider role
          </label>
          <select
            id="filter-role"
            className={SELECT_CLASS}
            value={get("role")}
            onChange={(e) => setParam({ role: e.target.value || null })}
          >
            <option value="">Any role</option>
            <option value="officer">Officers</option>
            <option value="director">Directors</option>
            <option value="ten_pct">10% owners</option>
          </select>
          <Chip active={get("cluster") === "true"} onClick={() => toggle("cluster")}>
            Cluster buys
          </Chip>
          <Chip active={get("dip") === "true"} onClick={() => toggle("dip")}>
            Dip buys
          </Chip>
          <Chip active={get("near_low") === "true"} onClick={() => toggle("near_low")}>
            Near 52-wk low
          </Chip>
          <input
            type="search"
            placeholder="Sector…"
            aria-label="Sector"
            defaultValue={get("sector")}
            onKeyDown={(e) => {
              if (e.key === "Enter") setParam({ sector: e.currentTarget.value || null });
            }}
            className="h-8 w-28 rounded-md border border-border bg-surface px-2 text-xs text-ink placeholder:text-ink-faint"
          />
        </>
      ) : null}

      {hasAny ? (
        <button
          type="button"
          onClick={() => router.push(pathname, { scroll: false })}
          className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-full px-2 text-2xs uppercase tracking-widest text-ink-faint transition-colors hover:text-ink"
        >
          <X className="size-3" aria-hidden /> Clear
        </button>
      ) : null}
    </div>
  );
}
