import Link from "next/link";
import { Suspense } from "react";

import { AccessBanner } from "@/components/access/access-banner";
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
import { getSessionUser } from "@/lib/auth/supabase-server";
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

  const [initial, user] = await Promise.all([
    queryTrades(getDb(), merged).catch(() => null),
    getSessionUser(),
  ]);
  const clientParams = { ...toClientParams(parsed), ...(preset?.params ?? {}), limit: 50 };

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="rail-bleed flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Screener</h1>
        <p className="max-w-[68ch] text-sm text-ink-muted">
          Slice the tape. Every screen is a shareable URL
          {presetName ? "" : " — or start from a preset"}.
        </p>
      </header>

      <AccessBanner signedIn={Boolean(user)} />

      {/* Pill-shaped because they are interactive; the active one is marked
          by weight and ground, not by colour. Seven oxblood chips would
          spend the page's one accent seven times over. */}
      <nav aria-label="Screen presets" className="flex flex-wrap gap-1.5">
        {Object.entries(SCREENER_PRESETS).map(([name, def]) => (
          <Link
            key={name}
            href={presetName === name ? "/screener" : `/screener?preset=${name}`}
            title={def.description}
            aria-current={presetName === name ? "page" : undefined}
            className={cn(
              "inline-flex h-11 cursor-pointer items-center rounded-full border px-3.5 text-xs transition-colors md:h-8 md:px-3",
              presetName === name
                ? "border-border bg-fill font-semibold text-ink"
                : "border-transparent text-ink-muted hover:bg-fill hover:text-ink",
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
          canSaveAlert={Boolean(user)}
        />
      ) : (
        <p className="surface rounded-lg px-4 py-10 text-center text-sm text-ink-muted">
          The screener is unavailable right now — try again shortly.
        </p>
      )}
    </div>
  );
}
