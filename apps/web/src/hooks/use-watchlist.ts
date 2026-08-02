"use client";

import { useSyncExternalStore } from "react";

import { getWatchlistStore } from "@/lib/watchlist/store";
import type { WatchlistItem } from "@/lib/watchlist/store";

const EMPTY: WatchlistItem[] = [];

export function useWatchlist() {
  const store = getWatchlistStore();
  const items = useSyncExternalStore(
    (cb) => store.subscribe(cb),
    () => store.list(),
    () => EMPTY,
  );
  return {
    items,
    add: store.add.bind(store),
    remove: store.remove.bind(store),
    has: store.has.bind(store),
  };
}
