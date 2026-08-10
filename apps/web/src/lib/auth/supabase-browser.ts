"use client";

type BrowserClient = Awaited<ReturnType<typeof loadClient>>;

let cached: BrowserClient | null = null;

export function isAuthConfiguredClient(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/**
 * The auth SDK, fetched at the moment somebody signs in and not before.
 *
 * This import used to be static, and it was the single largest thing in
 * every route's first-load graph: 187 kB of uncompressed JavaScript,
 * downloaded and parsed on a marketing page whose only auth affordance is
 * a link to /login. It got there because a tape row's sign-in offer
 * imports this module, the landing page renders tape rows, and a static
 * import is transitive.
 *
 * `await import()` moves it into its own chunk. Every caller was already
 * inside an async function, so nothing about the sign-in flows changes
 * except when the bytes arrive — and they arrive during a click that is
 * about to hit the network anyway.
 *
 * `isAuthConfiguredClient` stays synchronous and stays here: it reads two
 * inlined env strings, it is what components use to decide whether to
 * render an auth affordance at all, and making it async would drag every
 * one of those decisions into an effect.
 */
async function loadClient(url: string, anonKey: string) {
  const { createBrowserClient } = await import("@supabase/ssr");
  return createBrowserClient(url, anonKey);
}

/** Browser Supabase client (auth only). Null when auth is not configured. */
export async function getSupabaseBrowserClient(): Promise<BrowserClient | null> {
  if (!isAuthConfiguredClient()) return null;
  cached ??= await loadClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return cached;
}
