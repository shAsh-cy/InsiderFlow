"use client";

/**
 * The two things worth doing to a row you have just read: track the
 * company, or be told the next time it files.
 *
 * Both are personalization, which is the only thing an account buys here
 * — the trade itself was already free to read, and the copy says "track"
 * and "alert", never "unlock". Signed out, the click is not refused: it
 * opens the contextual sign-in and REPLAYS once the session exists, so
 * the click you made is the click that happens.
 *
 * Revealed on hover where hover exists, always present where it does not
 * (see `.tape-actions` in globals.css). Nothing here is hover-only
 * functionality: the controls are in the DOM, focusable, and reachable by
 * keyboard whether or not a pointer ever touches the row.
 */
import { Bell, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { SignInPopover } from "@/components/auth/sign-in-popover";
import { useSession } from "@/components/shell/session-provider";
import { useWatchlist } from "@/hooks/use-watchlist";
import { rememberPendingWatch } from "@/lib/access/pending-watch";
import { trackTicker } from "@/lib/access/track-ticker";
import { cn } from "@/lib/utils";

const ACTION_CLASS =
  "inline-flex size-6 cursor-pointer items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-border/60 hover:text-ink";

export function RowActions({
  ticker,
  label,
  market,
}: {
  ticker: string | null;
  label: string;
  market: string;
}) {
  const t = useTranslations("access");
  const session = useSession();
  const { has, add, remove } = useWatchlist();
  const [offering, setOffering] = useState(false);

  // A row with no ticker cannot be tracked or alerted on — there is
  // nothing stable to attach the rule to. Render nothing rather than a
  // control that would quietly fail.
  if (!ticker) return null;

  const watching = has("company", ticker);
  const item = { refId: ticker, label, market };
  const signedOut = session.authConfigured && !session.userId;

  const watchLabel = `${watching ? t("rowUnwatch") : t("rowWatch")} ${ticker}`;
  const alertLabel = `${t("rowAlert")} ${ticker}`;

  const onWatch = () => {
    if (signedOut) {
      rememberPendingWatch(item);
      setOffering(true);
      return;
    }
    if (watching) remove(`company:${ticker}`);
    else add({ kind: "company", refId: ticker, label, market });
  };

  const onAlert = () => {
    if (signedOut) {
      rememberPendingWatch({ ...item, alert: true });
      setOffering(true);
      return;
    }
    if (!watching) add({ kind: "company", refId: ticker, label, market });
    void trackTicker(ticker).then((ok) => {
      if (ok) toast.success(t("rowAlertSaved", { ticker }));
      else toast.error(t("rowAlertFailed"));
    });
  };

  const actions = (
    <span className="tape-actions ml-1 hidden shrink-0 items-center gap-0.5 @lg:inline-flex">
      <button
        type="button"
        onClick={onWatch}
        aria-pressed={watching}
        aria-label={watchLabel}
        title={watchLabel}
        className={ACTION_CLASS}
        data-testid="row-watch"
      >
        {/* Filled vs hollow is the state — the accessible name already
            says which it is, so the glyph confirms rather than carries. */}
        <Star className={cn("size-3.5", watching && "fill-ink text-ink")} aria-hidden />
      </button>
      <button
        type="button"
        onClick={onAlert}
        aria-label={alertLabel}
        title={alertLabel}
        className={ACTION_CLASS}
        data-testid="row-alert"
      >
        <Bell className="size-3.5" aria-hidden />
      </button>
    </span>
  );

  if (!signedOut) return actions;

  // Anchored, not triggered: the buttons already have click handlers that
  // decide whether an offer is even needed, and a Radix trigger would
  // toggle the sheet underneath them.
  return (
    <SignInPopover open={offering} onOpenChange={setOffering} action="watch" asAnchor>
      {actions}
    </SignInPopover>
  );
}
