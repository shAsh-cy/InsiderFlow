"use client";

/**
 * Finishes the click that sign-in interrupted.
 *
 * Mounted once in the root layout rather than in the tape, because the
 * auth callback can land the reader on any page — and an intent that
 * silently expires because they came back somewhere else is the same
 * broken promise as redirecting them to /login in the first place.
 *
 * `?pending=watch` says an action is owed; sessionStorage says which row.
 * Both are cleared before the action runs, so a refresh cannot replay it
 * twice.
 */
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useSession } from "@/components/shell/session-provider";
import { takePendingWatch } from "@/lib/access/pending-watch";
import { trackTicker } from "@/lib/access/track-ticker";
import { useWatchlist } from "@/hooks/use-watchlist";

export function PendingWatchReplay() {
  const session = useSession();
  const { add, has } = useWatchlist();
  const t = useTranslations("access");
  // The watchlist store swaps to the account-backed one on sign-in, which
  // re-renders this. Once per mount is the contract.
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !session.userId) return;

    const url = new URL(window.location.href);
    if (url.searchParams.get("pending") !== "watch") return;

    const intent = takePendingWatch();
    // Clear the marker before doing anything, so a reload of the replayed
    // URL is just a page load.
    url.searchParams.delete("pending");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    done.current = true;
    if (!intent) return;

    if (!has("company", intent.refId)) {
      add({ kind: "company", refId: intent.refId, label: intent.label, market: intent.market });
    }

    if (intent.alert) {
      void trackTicker(intent.refId).then((ok) => {
        if (ok) toast.success(t("rowAlertSaved", { ticker: intent.refId }));
        else toast.error(t("rowAlertFailed"));
      });
    } else {
      toast.success(t("rowWatchSaved", { ticker: intent.refId }));
    }
  }, [session.userId, add, has, t]);

  return null;
}
