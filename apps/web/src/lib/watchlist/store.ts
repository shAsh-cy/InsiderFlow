"use client";

/**
 * Watchlist behind a swappable store interface. Today: localStorage.
 * Phase 7 replaces getWatchlistStore()'s implementation with a Supabase-
 * backed store behind auth — the interface, hook, and UI stay untouched.
 */

export interface WatchlistItem {
  id: string;
  kind: "company" | "insider";
  /** Ticker for companies, insider UUID for insiders. */
  refId: string;
  label: string;
  market: string;
  addedAt: string;
}

export interface WatchlistStore {
  list(): WatchlistItem[];
  add(item: Omit<WatchlistItem, "id" | "addedAt">): void;
  remove(id: string): void;
  has(kind: WatchlistItem["kind"], refId: string): boolean;
  subscribe(listener: () => void): () => void;
}

const STORAGE_KEY = "insiderflow:watchlist:v1";

class LocalStorageWatchlistStore implements WatchlistStore {
  private items: WatchlistItem[];
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.items = this.read();
    if (typeof window !== "undefined") {
      // Cross-tab sync — another tab's change updates this one.
      window.addEventListener("storage", (event) => {
        if (event.key === STORAGE_KEY) {
          this.items = this.read();
          this.emit();
        }
      });
    }
  }

  private read(): WatchlistItem[] {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as WatchlistItem[]) : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.items));
    } catch {
      // Quota/private-mode failures degrade to in-memory only.
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  list(): WatchlistItem[] {
    return this.items;
  }

  has(kind: WatchlistItem["kind"], refId: string): boolean {
    return this.items.some((item) => item.kind === kind && item.refId === refId);
  }

  add(item: Omit<WatchlistItem, "id" | "addedAt">): void {
    if (this.has(item.kind, item.refId)) return;
    this.items = [
      { ...item, id: `${item.kind}:${item.refId}`, addedAt: new Date().toISOString() },
      ...this.items,
    ];
    this.write();
  }

  remove(id: string): void {
    this.items = this.items.filter((item) => item.id !== id);
    this.write();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let store: WatchlistStore | null = null;

/** Phase 7 swap point: return a Supabase-backed store here once auth exists. */
export function getWatchlistStore(): WatchlistStore {
  store ??= new LocalStorageWatchlistStore();
  return store;
}
