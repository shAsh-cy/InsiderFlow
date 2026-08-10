"use client";

/**
 * Contextual sign-in, offered at the moment of value.
 *
 * A signed-out reader who clicks "Save as alert" has just told us exactly
 * what they want. Redirecting them to /login answers that by throwing the
 * intent away: they authenticate, land somewhere else, and have to
 * reconstruct the screen they were looking at. This keeps them on the
 * page, and — critically — REPLAYS the original action once the session
 * exists, so the click they made is the click that happens.
 *
 * The copy never says "unlock" or "upgrade". Nothing here is gated: the
 * data was already free to read, and this only attaches a saved thing to
 * an account.
 */
import { KeyRound, Loader2, Mail } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getSupabaseBrowserClient } from "@/lib/auth/supabase-browser";

export type PendingAction = "alert" | "watch";

export function SignInPopover({
  open,
  onOpenChange,
  action,
  asAnchor = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which sentence to show; also what gets replayed after sign-in. */
  action: PendingAction;
  /**
   * Position against `children` without making them a trigger.
   *
   * A tape row's star and bell already decide for themselves whether an
   * offer is needed — the same click both toggles a watch when signed in
   * and opens this when signed out. A Radix trigger wrapped round them
   * would toggle the sheet underneath that logic, so those callers anchor
   * instead.
   */
  asAnchor?: boolean;
  /** The control that triggered this — the popover positions against it. */
  children: React.ReactNode;
}) {
  const t = useTranslations("access");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Focus the email field when the sheet opens: the GitHub button is
  // first in the DOM because it is the faster path, but a keyboard user
  // who opened this deliberately should land on something typeable.
  useEffect(() => {
    if (open) window.setTimeout(() => emailRef.current?.focus(), 60);
  }, [open]);

  /**
   * `next` carries the exact URL the reader was on, plus the intent. The
   * callback returns them here and the pending action replays — see
   * usePendingAction below.
   */
  const returnTo = () => {
    if (typeof window === "undefined") return "/";
    const url = new URL(window.location.href);
    url.searchParams.set("pending", action);
    return `${url.pathname}${url.search}`;
  };

  const withGithub = async () => {
    const supabase = await getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo())}`,
      },
    });
  };

  const withEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = await getSupabaseBrowserClient();
    if (!supabase || !email.trim()) return;
    setSending(true);
    setError(null);
    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(returnTo())}`,
        },
      });
      if (sendError) setError(t("emailFailed"));
      else setSent(true);
    } catch {
      setError(t("emailFailed"));
    } finally {
      setSending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {asAnchor ? (
        <PopoverAnchor asChild>{children}</PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>{children}</PopoverTrigger>
      )}
      <PopoverContent align="end" className="w-80" data-testid="sign-in-offer">
        <h3 className="text-sm font-semibold text-ink">
          {action === "alert" ? t("signInPopoverTitle") : t("signInPopoverTitleWatch")}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-muted">{t("signInPopoverBody")}</p>

        {sent ? (
          <p className="mt-4 rounded-md border border-border bg-fill px-3 py-2 text-xs text-ink">
            {t("emailSent")}
          </p>
        ) : (
          <>
            <Button className="mt-4 w-full" onClick={() => void withGithub()}>
              <KeyRound aria-hidden /> {t("continueGithub")}
            </Button>

            <form onSubmit={(e) => void withEmail(e)} className="mt-3 flex flex-col gap-2">
              <input
                ref={emailRef}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("emailPlaceholder")}
                aria-label={t("emailPlaceholder")}
                className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-ink outline-none placeholder:text-ink-faint"
              />
              <Button type="submit" variant="outline" disabled={sending}>
                {sending ? <Loader2 className="animate-spin" aria-hidden /> : <Mail aria-hidden />}
                {t("continueEmail")}
              </Button>
            </form>

            {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
