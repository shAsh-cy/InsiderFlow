"use client";

/**
 * Live trade feed hook over the /api/stream SSE contract. All stream
 * behavior (window-close resilience, Last-Event-ID resume, dedupe, poll
 * fallback) lives in TradeStreamCore; this wrapper just binds it to React.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

import { TradeStreamCore } from "@/lib/stream/trade-stream-core";
import type { StreamSnapshot, TradeStreamOptions } from "@/lib/stream/trade-stream-core";

const SERVER_SNAPSHOT: StreamSnapshot = { trades: [], status: "connecting", lastEventId: null };

export function useTradeStream(
  options: Pick<TradeStreamOptions, "url" | "maxItems"> & { enabled?: boolean } = {},
): StreamSnapshot {
  const { enabled = true, url, maxItems } = options;
  const coreRef = useRef<TradeStreamCore | null>(null);
  coreRef.current ??= new TradeStreamCore({ url, maxItems });
  const core = coreRef.current;

  useEffect(() => {
    if (!enabled) return;
    core.start();
    return () => core.stop();
  }, [core, enabled]);

  return useSyncExternalStore(core.subscribe, core.getSnapshot, () => SERVER_SNAPSHOT);
}
