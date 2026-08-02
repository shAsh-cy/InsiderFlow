import Link from "next/link";
import { Suspense } from "react";

import { FilterBar } from "@/components/feed/filter-bar";
import { ScreenerResults } from "@/components/screener/screener-results";
import { queryTrades } from "@/lib/api/queries";
import {
  flattenSearchParams,
  parseTradeSearchParams,
  toClientParams,
} from "@/lib/api/search-params";
import type { NextSearchParams } from "@/lib/api/search-params";
import { isScreenerPreset, SCREENER_PRESETS } from "@/lib/api/schemas";
import { getDb } from "@/lib/db";
import { cn } from "@/lib/utils";

export const metadata = { title: "Screener" };

/**
 * Screener: presets + composable filters, all state in the URL so every
 * screen is a shareable link. First page server-rendered via the shared
 * query layer; pagination/export go through the typed API client.
 */
export default async function ScreenerPage({ searchParams }: { searchParams: NextSearchParams }) {
  const raw = flattenSearchParams(await searchParams);
  const presetName = raw.preset && isScreenerPreset(raw.preset) ? raw.preset : null;
  const preset = presetName ? SCREENER_PRESETS[presetName] : null;

  const parsed = await parseTradeSearchParams(searchParams);
  // The preset's canned params win over URL filters (same rule as the API).
  const merged = { ...parsed, ...(preset?.params ?? {}), limit: 50 };

  const initial = await queryTrades(getDb(), merged).catch(() => null);
  const clientParams = { ...toClientParams(parsed), ...(preset?.params ?? {}), limit: 50 };

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Screener</h1>
        <p className="text-sm text-muted-foreground">
          Slice the tape. Every screen is a shareable URL
          {presetName ? "" : " — or start from a preset"}.
        </p>
      </header>

      <nav aria-label="Screen presets" className="flex flex-wrap gap-2">
        {Object.entries(SCREENER_PRESETS).map(([name, def]) => (
          <Link
            key={name}
            href={presetName === name ? "/screener" : `/screener?preset=${name}`}
            title={def.description}
            aria-current={presetName === name ? "page" : undefined}
            className={cn(
              "h-8 rounded-lg px-3 text-xs leading-8 transition-colors",
              presetName === name
                ? "bg-gradient-accent font-medium text-[#06231f]"
                : "glass text-muted-foreground hover:text-foreground",
            )}
          >
            {name}
          </Link>
        ))}
      </nav>

      <Suspense>
        <FilterBar advanced />
      </Suspense>

      {initial ? (
        <ScreenerResults
          key={JSON.stringify({ clientParams, presetName })}
          initialPage={initial}
          params={clientParams}
          preset={presetName}
        />
      ) : (
        <p className="glass rounded-lg px-4 py-10 text-center text-sm text-muted-foreground">
          The screener is unavailable right now — try again shortly.
        </p>
      )}
    </div>
  );
}
