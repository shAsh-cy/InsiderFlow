"use client";

/**
 * Account-backed watchlist. Implements the SAME synchronous
 * WatchlistStore interface as the localStorage version — a local cache
 * answers reads immediately while writes replicate to the server
 * optimistically, so no page component changes.
 */
import type { WatchlistItem, WatchlistStore } from "./store";

interface ApiItem {
  id: string;
  kind: "company" | "insider";
  refId: string;
  label: string;
  market: string;
  createdAt: string;
}

export class SupabaseWatchlistStore implements WatchlistStore {
  private items: WatchlistItem[] = [];
  private readonly listeners = new Set<() => void>();
  private loaded = false;

  constructor() {
    void this.refresh();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  async refresh(): Promise<void> {
    try {
      const response = await fetch("/api/me/watchlist", {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;
      const body = (await response.json()) as { data?: ApiItem[] };
      this.items = (body.data ?? []).map((row) => ({
        id: `${row.kind}:${row.refId}`,
        kind: row.kind,
        refId: row.refId,
        label: row.label,
        market: row.market,
        addedAt: row.createdAt,
      }));
      this.loaded = true;
      this.emit();
    } catch {
      // Offline / auth blip: keep serving the cache.
    }
  }

  list(): WatchlistItem[] {
    return this.items;
  }

  has(kind: WatchlistItem["kind"], refId: string): boolean {
    return this.items.some((item) => item.kind === kind && item.refId === refId);
  }

  add(item: Omit<WatchlistItem, "id" | "addedAt">): void {
    if (this.has(item.kind, item.refId)) return;
    // Optimistic: the UI updates now, the server catches up.
    this.items = [
      { ...item, id: `${item.kind}:${item.refId}`, addedAt: new Date().toISOString() },
      ...this.items,
    ];
    this.emit();
    void fetch("/api/me/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item),
    })
      .then((r) => {
        if (!r.ok) return this.refresh();
      })
      .catch(() => this.refresh());
  }

  remove(id: string): void {
    const target = this.items.find((item) => item.id === id);
    this.items = this.items.filter((item) => item.id !== id);
    this.emit();
    if (!target) return;
    void fetch(
      `/api/me/watchlist?kind=${encodeURIComponent(target.kind)}&refId=${encodeURIComponent(target.refId)}`,
      { method: "DELETE" },
    )
      .then((r) => {
        if (!r.ok) return this.refresh();
      })
      .catch(() => this.refresh());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /** One-click import of a signed-out (localStorage) watchlist. */
  async importItems(items: WatchlistItem[]): Promise<number> {
    if (items.length === 0) return 0;
    const response = await fetch("/api/me/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map(({ kind, refId, label, market }) => ({ kind, refId, label, market })),
      }),
    });
    if (!response.ok) return 0;
    const body = (await response.json()) as { data?: { imported?: number } };
    await this.refresh();
    return body.data?.imported ?? 0;
  }
}
