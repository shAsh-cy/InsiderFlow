"use client";

import { KeyRound, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient, isAuthConfiguredClient } from "@/lib/auth/supabase-browser";
import { captchaOption, isTurnstileEnabled } from "@/lib/auth/turnstile";
import { TurnstileWidget } from "@/components/auth/turnstile-widget";
import { safeRedirectPath } from "@/lib/auth/redirect";

import { CallbackNotice } from "./callback-notice";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  // null until the widget solves. `captchaOption` treats that as "send no
  // token", which is also the permanent state when Turnstile is off.
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const configured = isAuthConfiguredClient();

  /**
   * Where to land after sign-in. Validated on the way out as well as on the
   * way back in: the callback re-checks it, but a link the app itself hands to
   * an OAuth provider should never contain a hostile value in the first place.
   */
  const callbackUrl = (): string => {
    const next = safeRedirectPath(new URLSearchParams(window.location.search).get("next"));
    const url = new URL("/auth/callback", window.location.origin);
    if (next !== "/settings") url.searchParams.set("next", next);
    return url.toString();
  };

  const sendMagicLink = async (event: React.FormEvent) => {
    event.preventDefault();
    const supabase = await getSupabaseBrowserClient();
    if (!supabase) return;
    setStatus("sending");
    // `captchaOption` is `{}` unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set
    // AND the widget has solved, so this spread is a no-op on a deployment
    // that has not enabled Turnstile — which is every fresh clone and the
    // e2e suite. See lib/auth/turnstile.ts.
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl(), ...captchaOption(captchaToken) },
    });
    if (error) {
      setStatus("error");
      setMessage(error.message);
    } else {
      setStatus("sent");
      setMessage(null);
    }
  };

  const signInWithGithub = async () => {
    const supabase = await getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: callbackUrl() },
    });
  };

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-24"
    >
      {/* One card on the page ground — the whole view is this card, which is
          why the accent can be spent on its primary button. */}
      <div className="surface rounded-lg p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Sign in to InsiderFlow</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Accounts sync your watchlist across devices and power alerts. Browsing stays free and
          anonymous — you never need one to read the data.
        </p>

        {/* useSearchParams needs a boundary; a failed sign-in must still render. */}
        <Suspense fallback={null}>
          <CallbackNotice />
        </Suspense>

        {!configured ? (
          /* A deployment fact, not a failure — so it is a quiet well rather
             than an alarm. The operator reading it needs the variable names
             legible, hence mono for every identifier. */
          <p className="surface-sunken mt-6 rounded-md px-4 py-3 text-xs leading-relaxed text-ink-muted">
            Auth is not configured on this deployment. Set{" "}
            <code className="font-mono text-ink">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="font-mono text-ink">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable
            sign-in — see <code className="font-mono text-ink">docs/auth.md</code>.
          </p>
        ) : status === "sent" ? (
          <p role="status" className="surface-sunken mt-6 rounded-md px-4 py-3 text-sm text-ink">
            Check your inbox — we sent a magic link to{" "}
            <strong className="font-mono font-semibold">{email}</strong>.
          </p>
        ) : (
          <>
            <form onSubmit={sendMagicLink} className="mt-6 flex flex-col gap-3">
              <label htmlFor="email" className="text-2xs text-ink-faint">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 rounded-md border border-border bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-faint md:h-10"
              />
              {/* The one oxblood fill on the page. */}
              <TurnstileWidget onToken={setCaptchaToken} />
              <Button
                type="submit"
                disabled={status === "sending" || (isTurnstileEnabled() && !captchaToken)}
              >
                {status === "sending" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Mail aria-hidden />
                )}
                Send magic link
              </Button>
            </form>

            <div className="my-5 flex items-center gap-3 text-2xs text-ink-faint">
              <span className="h-px flex-1 bg-border" /> or{" "}
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button
              variant="outline"
              className="w-full cursor-pointer"
              onClick={() => void signInWithGithub()}
            >
              <KeyRound aria-hidden /> Continue with GitHub
            </Button>
          </>
        )}

        {/* The provider's own words, stated plainly. A red panel would shout
            about something the reader usually just needs to re-read. */}
        {message ? <p className="mt-4 text-xs text-accent-ink">{message}</p> : null}

        <p className="mt-6 text-xs text-ink-faint">
          <Link
            href="/"
            className="inline-flex min-h-11 cursor-pointer items-center underline decoration-border underline-offset-4 transition-colors hover:text-ink hover:decoration-ink md:min-h-0"
          >
            Back to InsiderFlow
          </Link>
        </p>
      </div>
    </main>
  );
}
