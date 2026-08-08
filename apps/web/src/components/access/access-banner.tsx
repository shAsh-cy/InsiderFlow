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
import { useEffect, useState } from "react";

const COOKIE = "if-access-notice";

function alreadyDismissed(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c.startsWith(`${COOKIE}=`));
}

export function AccessBanner({ signedIn }: { signedIn: boolean }) {
  const t = useTranslations("access");
  // Starts hidden and appears after mount. The alternative — render it
  // server-side and hide it on the client — flashes a banner at every
  // reader who already dismissed it.
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!signedIn && !alreadyDismissed()) setShow(true);
  }, [signedIn]);

  if (!show) return null;

  const dismiss = () => {
    // A year: the promise does not change, so neither should the answer.
    document.cookie = `${COOKIE}=1; path=/; max-age=31536000; samesite=lax`;
    setShow(false);
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
