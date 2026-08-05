"use client";

import { KeyRound, Loader2, Mail } from "lucide-react";
import Link from "next/link";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient, isAuthConfiguredClient } from "@/lib/auth/supabase-browser";
import { safeRedirectPath } from "@/lib/auth/redirect";

import { CallbackNotice } from "./callback-notice";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
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
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setStatus("sending");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: callbackUrl() },
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
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo: callbackUrl() },
    });
  };

  return (
    <main
      id="main"
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-24"
    >
      <div className="glass rounded-2xl p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Sign in to <span className="text-gradient">InsiderFlow</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Accounts sync your watchlist across devices and power alerts. Browsing stays free and
          anonymous — you never need one to read the data.
        </p>

        {/* useSearchParams needs a boundary; a failed sign-in must still render. */}
        <Suspense fallback={null}>
          <CallbackNotice />
        </Suspense>

        {!configured ? (
          <p className="mt-6 rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-xs leading-relaxed text-amber-200/90">
            Auth is not configured on this deployment. Set{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
            <code className="font-mono">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable sign-in — see{" "}
            <code className="font-mono">docs/auth.md</code>.
          </p>
        ) : status === "sent" ? (
          <p
            role="status"
            className="mt-6 rounded-lg border border-teal/25 bg-teal/8 px-4 py-3 text-sm text-teal"
          >
            Check your inbox — we sent a magic link to <strong>{email}</strong>.
          </p>
        ) : (
          <>
            <form onSubmit={sendMagicLink} className="mt-6 flex flex-col gap-3">
              <label
                htmlFor="email"
                className="text-2xs uppercase tracking-widest text-subtle-foreground"
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="glass h-10 rounded-lg px-3 text-sm outline-none placeholder:text-subtle-foreground"
              />
              <Button
                type="submit"
                disabled={status === "sending"}
                className="bg-gradient-accent border-0 text-[#06231f]"
              >
                {status === "sending" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Mail aria-hidden />
                )}
                Send magic link
              </Button>
            </form>

            <div className="my-5 flex items-center gap-3 text-2xs uppercase tracking-widest text-subtle-foreground">
              <span className="h-px flex-1 bg-white/10" /> or{" "}
              <span className="h-px flex-1 bg-white/10" />
            </div>

            <Button
              variant="outline"
              className="glass w-full border-white/10"
              onClick={() => void signInWithGithub()}
            >
              <KeyRound aria-hidden /> Continue with GitHub
            </Button>
          </>
        )}

        {message ? <p className="mt-4 text-xs text-sell">{message}</p> : null}

        <p className="mt-6 text-xs text-subtle-foreground">
          <Link href="/" className="underline underline-offset-4 hover:text-foreground">
            Back to InsiderFlow
          </Link>
        </p>
      </div>
    </main>
  );
}
