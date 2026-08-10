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
import { Bell, MoreVertical, Star } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { SignInPopover } from "@/components/auth/sign-in-popover";
import { useSession } from "@/components/shell/session-provider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWatchlist } from "@/hooks/use-watchlist";
import { rememberPendingWatch } from "@/lib/access/pending-watch";
import { trackTicker } from "@/lib/access/track-ticker";
import { cn } from "@/lib/utils";

const ACTION_CLASS =
  "inline-flex size-6 cursor-pointer items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-border/60 hover:text-ink";

/** A menu row on the phone: full width, 44px, name on the left. */
const MENU_ITEM_CLASS =
  "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-sm text-ink transition-colors hover:bg-fill";

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
  const [menuOpen, setMenuOpen] = useState(false);

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
    // One root element with a real box, because the signed-out path anchors
    // the sign-in sheet to it with `asChild` — a fragment gives Radix's Slot
    // two children, and a `display: contents` wrapper gives it a zero-size
    // rect to position against.
    <span className="col-start-4 row-span-2 row-start-1 flex shrink-0 items-center justify-end">
      {/*
       * Two shapes, one set of actions.
       *
       * Above 640px: the hover-revealed pair, unchanged from r3 except that
       * the `@lg` container gate is gone. That gate meant any container
       * narrower than 512px — which is EVERY phone, and the landing strip
       * too — rendered `display: none`, so the feature did not merely
       * become hard to reach on a touchscreen, it was absent from the page.
       *
       * Below 640px: one 44px menu. Two 24px buttons cannot be laid out on
       * a 60px two-line row at a tappable size without overlapping hit
       * areas, and a menu is what the row press was always meant to open.
       */}
      <span className="tape-actions ml-1 hidden shrink-0 items-center gap-0.5 sm:inline-flex">
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

      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger
          aria-label={t("rowActions", { ticker })}
          data-testid="row-menu"
          className="col-start-4 row-span-2 row-start-1 -mr-1.5 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-fill hover:text-ink sm:hidden"
        >
          <MoreVertical className="size-4" aria-hidden />
        </PopoverTrigger>
        <PopoverContent align="end" className="w-56 p-1.5" data-testid="row-menu-content">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onWatch();
            }}
            aria-pressed={watching}
            className={MENU_ITEM_CLASS}
            data-testid="row-menu-watch"
          >
            <Star className={cn("size-4 shrink-0", watching && "fill-ink text-ink")} aria-hidden />
            {watchLabel}
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onAlert();
            }}
            className={MENU_ITEM_CLASS}
            data-testid="row-menu-alert"
          >
            <Bell className="size-4 shrink-0" aria-hidden />
            {alertLabel}
          </button>
        </PopoverContent>
      </Popover>
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
