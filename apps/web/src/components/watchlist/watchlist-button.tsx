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
      className="glass border-white/10"
      aria-pressed={active}
      onClick={() => (active ? remove(`${kind}:${refId}`) : add({ kind, refId, label, market }))}
    >
      <Star className={cn("size-3.5", active && "fill-amber-300 text-amber-300")} aria-hidden />
      {active ? "Watching" : "Watch"}
    </Button>
  );
}
