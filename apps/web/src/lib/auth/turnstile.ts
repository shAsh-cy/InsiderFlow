/**
 * Cloudflare Turnstile — bot protection for the auth forms.
 *
 * ── WHY A CAPTCHA AND NOT JUST A RATE LIMIT ───────────────────────────
 *
 * The magic-link form takes an email address and causes an email to be
 * sent. That is an abusable primitive whoever owns it: a script can point
 * it at other people's inboxes and use this project's sending reputation
 * to deliver them, which costs the deployment its Resend quota and,
 * eventually, its domain reputation.
 *
 * Supabase Auth has its own rate limits and they are the obvious answer.
 * They are not a sufficient one: through 2025 and into 2026 those limits
 * have been reported repeatedly as inconsistently enforced across
 * projects, and a control you cannot verify from outside is a control you
 * should not be relying on alone. Turnstile is checked by Supabase on the
 * server for every auth call once enabled, which makes it the part of this
 * that can actually be verified — send a request without a token and it is
 * refused.
 *
 * ── HOW THE TWO HALVES FIT ────────────────────────────────────────────
 *
 * The SITE key is public and belongs in the client bundle; that is what
 * `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is. The SECRET key is never in this
 * repository or in any environment this app reads — it goes into the
 * Supabase dashboard, and Supabase does the verification. There is
 * deliberately no `TURNSTILE_SECRET_KEY` in `.env.example`: a variable
 * that exists invites somebody to fill it in, and the only correct place
 * for that value is a field in someone else's UI.
 *
 * ── OFF IS A SUPPORTED STATE ──────────────────────────────────────────
 *
 * With no site key configured, `isTurnstileEnabled()` is false, the widget
 * does not render, and the auth calls pass no token. That is exactly what
 * a fresh clone and the e2e suite need, and it is why this ships ahead of
 * the dashboard being configured. It is also the risk: until the dashboard
 * half is done, the protection is not on. That is recorded in
 * SECURITY_CHECKLIST.md rather than implied by the presence of this file.
 */

/** The public site key, or null when Turnstile is not configured. */
export function turnstileSiteKey(): string | null {
  const key = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  return key && key.trim().length > 0 ? key : null;
}

export const isTurnstileEnabled = (): boolean => turnstileSiteKey() !== null;

/**
 * The `options` fragment for a Supabase auth call.
 *
 * Returns `{}` when Turnstile is off, so a call site can spread it
 * unconditionally rather than branching. `captchaToken: undefined` would
 * NOT be equivalent — @supabase/supabase-js serialises the key either way,
 * and a project with captcha enforcement on rejects an explicit null token
 * with a different error than a missing one, which is a confusing failure
 * to debug from a log line.
 */
export function captchaOption(token: string | null): { captchaToken?: string } {
  if (!isTurnstileEnabled() || !token) return {};
  return { captchaToken: token };
}

/** Where the widget script comes from. Referenced by the CSP note below. */
export const TURNSTILE_SCRIPT_ORIGIN = "https://challenges.cloudflare.com";
