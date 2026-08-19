"use client";

/**
 * One line, on the data pages, for signed-out readers.
 *
 * The competitor this product exists to answer gates alerts, exports and
 * tracked-stock capacity behind paid tiers, so a visitor arrives already
 * expecting a wall and reads "Sign in" as "pay up". They will not discover
 * otherwise by exploring — they will leave. So it is said outright, once,
 * where the data actually is.
 *
 * It is dismissible and the dismissal persists: a message that is right
 * the first time becomes noise the fifth, and a banner that cannot be
 * killed is its own kind of paywall. Stored in a cookie rather than
 * localStorage so a dismissal made before hydration is still respected on
 * the next server render.
 */
import { X } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { ACCESS_NOTICE_COOKIE } from "@/lib/access-notice";

/**
 * `dismissed` is read from the cookie ON THE SERVER and passed in, so the
 * first paint already has the right answer.
 *
 * This used to start hidden and appear in a `useEffect`, and the comment
 * above defended that against the only other option it considered —
 * server-rendering unconditionally and hiding on the client, which does
 * flash the banner at everyone who already dismissed it. There is a third
 * option, and the dismissal was already stored in a COOKIE precisely
 * because a cookie is the thing a server can read. It just was not being
 * read there.
 *
 * The cost of appearing after mount was measured in r18: the banner is
 * 62px and the gap below it 24px, so every reader who had not dismissed it
 * got 86px of content inserted above the fold once hydration finished. On
 * `/screener` that landed AFTER first paint and counted as layout shift.
 * See docs/performance.md.
 */
export function AccessBanner({ signedIn, dismissed }: { signedIn: boolean; dismissed: boolean }) {
  const t = useTranslations("access");
  // Only ever set by the dismiss button below. The initial answer comes
  // from the server, so there is no mount-time transition to shift the page.
  const [dismissedHere, setDismissedHere] = useState(false);

  if (signedIn || dismissed || dismissedHere) return null;

  const dismiss = () => {
    // A year: the promise does not change, so neither should the answer.
    document.cookie = `${ACCESS_NOTICE_COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
    setDismissedHere(true);
  };

  return (
    <div
      data-testid="access-banner"
      className="flex items-center gap-3 rounded-md border border-border bg-fill px-3 py-2 text-xs text-ink-muted"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent-bright" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold text-ink">{t("bannerText")}</span>{" "}
        <Link
          href="/login"
          className="text-accent-ink underline decoration-border underline-offset-4 transition-colors hover:decoration-current"
        >
          {t("bannerCta")}
        </Link>
      </p>
      <button
        type="button"
        onClick={dismiss}
        data-testid="access-banner-dismiss"
        aria-label={t("bannerDismiss")}
        className="inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-faint md:size-auto md:p-1 transition-colors hover:bg-surface hover:text-ink"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
