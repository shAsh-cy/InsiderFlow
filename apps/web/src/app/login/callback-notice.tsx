"use client";

import { useSearchParams } from "next/navigation";

/**
 * Explains why the user is back on /login instead of signed in.
 *
 * /auth/callback used to redirect here with a bare `?error=auth` for every
 * failure, which told the user nothing and told an operator less. Each reason
 * below has a different remedy, so each gets its own sentence.
 */
const REASONS: Record<string, string> = {
  denied: "Sign-in was cancelled at the provider. Nothing was shared, and you can try again.",
  expired:
    "That sign-in link has expired or was already used. Magic links are single-use — request a new one below.",
  missing_code:
    "That link was incomplete. It usually means the URL was copied without its query string, or opened a second time.",
  exchange_failed:
    "The provider rejected the sign-in. If this repeats, the deployment's OAuth callback URL is probably not registered.",
  unconfigured: "This deployment has no Supabase project configured, so sign-in is unavailable.",
  unexpected: "Something failed while completing sign-in. Please try again.",
  // Kept so links minted by the previous version still read sensibly.
  auth: "Sign-in could not be completed. Please try again.",
};

export function CallbackNotice() {
  const reason = useSearchParams().get("error");
  if (!reason) return null;
  const message = REASONS[reason] ?? REASONS.unexpected!;
  return (
    <p
      role="alert"
      data-testid="login-error"
      className="mt-6 rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm leading-relaxed text-amber-200/90"
    >
      {message}
    </p>
  );
}
