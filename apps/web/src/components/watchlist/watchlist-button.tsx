"use client";

import { Star } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useWatchlist } from "@/hooks/use-watchlist";
import type { WatchlistItem } from "@/lib/watchlist/store";
import { cn } from "@/lib/utils";

/** Add/remove a company or insider from the watchlist (localStorage today). */
export function WatchlistButton({
  kind,
  refId,
  label,
  market,
}: Omit<WatchlistItem, "id" | "addedAt">) {
  const { has, add, remove } = useWatchlist();
  const active = has(kind, refId);
  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={active}
      onClick={() => (active ? remove(`${kind}:${refId}`) : add({ kind, refId, label, market }))}
    >
      {/* Filled vs hollow is the state, not a colour change — the label
          says "Watching" either way, so the glyph is confirmation. */}
      <Star className={cn("size-3.5", active && "fill-ink text-ink")} aria-hidden />
      {active ? "Watching" : "Watch"}
    </Button>
  );
}
