import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { IBM_Plex_Mono, Onest } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import { PendingWatchReplay } from "@/components/access/pending-watch-replay";
import { BreadcrumbProvider } from "@/components/shell/breadcrumb";
import { ShellChrome } from "@/components/shell/chrome";
import { Providers } from "@/components/shell/providers";
import { SessionProvider } from "@/components/shell/session-provider";
import { getSessionUser, isAuthConfigured } from "@/lib/auth/supabase-server";

import "./globals.css";

/**
 * Self-hosted by next/font — no request to a third-party font CDN, so
 * there is no render-blocking round trip and no external origin in the
 * critical path. Onest carries the interface; Plex Mono carries every
 * figure, ticker, and currency amount in the product.
 */
const onest = Onest({
  subsets: ["latin"],
  variable: "--font-onest",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "InsiderFlow — the real-time insider trading tape",
    template: "%s · InsiderFlow",
  },
  description:
    "Open-source, real-time, multi-market insider-trading tracker. Normalized, classified, free. Not investment advice.",
};

/**
 * The one place in the app allowed to name a colour literally.
 *
 * These become `<meta name="theme-color">`, which the browser reads
 * before any stylesheet has been parsed — so it cannot be a CSS custom
 * property. They must be kept in step with `--bg` in globals.css by hand.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F8FA" },
    { media: "(prefers-color-scheme: dark)", color: "#0C0F0E" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [user, locale, t, requestHeaders] = await Promise.all([
    getSessionUser(),
    getLocale(),
    getTranslations("nav"),
    headers(),
  ]);
  // Set by middleware.ts, and read here for the one inline script Next
  // does not stamp itself — see the note at ThemeProvider. Absent on any
  // response the CSP deliberately skips (prefetches, RSC payloads), where
  // there is no document policy for it to match.
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const session = {
    userId: user?.id ?? null,
    email: user?.email ?? null,
    authConfigured: isAuthConfigured(),
  };

  return (
    // suppressHydrationWarning: next-themes writes the class on <html>
    // before React hydrates, which is the whole point — it prevents a
    // flash of the wrong theme — but it means server and client markup
    // legitimately differ on this one attribute.
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${onest.variable} ${plexMono.variable}`}
    >
      <body className="screen-grain min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only z-100 rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-overlay focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          <Providers nonce={nonce}>
            <SessionProvider session={session}>
              {/* Wraps the bar AND the page: a breadcrumb's entity name is
                  known only to the page that rendered it, and the bar that
                  draws it is a sibling above. State has to live over both. */}
              <BreadcrumbProvider>
                <ShellChrome session={session} />
                {/* Mounted at the root, not in the tape: the auth callback
                    can land the reader on any page, and an intent that
                    expires because they came back somewhere else is the
                    same broken promise as sending them to /login. */}
                <PendingWatchReplay />
                {children}
              </BreadcrumbProvider>
            </SessionProvider>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
