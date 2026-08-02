"use client";

import { useEffect, useSyncExternalStore } from "react";

import {
  getWatchlistStore,
  setRemoteWatchlistStore,
  subscribeToStoreSwap,
} from "@/lib/watchlist/store";
import type { WatchlistItem } from "@/lib/watchlist/store";
import { SupabaseWatchlistStore } from "@/lib/watchlist/remote-store";

const EMPTY: WatchlistItem[] = [];

/** Installs the account-backed store for a signed-in session, once. */
export function useWatchlistSession(userId: string | null): void {
  useEffect(() => {
    if (!userId) {
      setRemoteWatchlistStore(null);
      return;
    }
    setRemoteWatchlistStore(new SupabaseWatchlistStore());
  }, [userId]);
}

export function useWatchlist() {
  // Re-subscribe when the active store is swapped (sign-in / sign-out).
  const items = useSyncExternalStore(
    (cb) => {
      let unsubscribeStore = getWatchlistStore().subscribe(cb);
      const unsubscribeSwap = subscribeToStoreSwap(() => {
        unsubscribeStore();
        unsubscribeStore = getWatchlistStore().subscribe(cb);
        cb();
      });
      return () => {
        unsubscribeStore();
        unsubscribeSwap();
      };
    },
    () => getWatchlistStore().list(),
    () => EMPTY,
  );

  return {
    items,
    add: (item: Omit<WatchlistItem, "id" | "addedAt">) => getWatchlistStore().add(item),
    remove: (id: string) => getWatchlistStore().remove(id),
    has: (kind: WatchlistItem["kind"], refId: string) => getWatchlistStore().has(kind, refId),
  };
}
