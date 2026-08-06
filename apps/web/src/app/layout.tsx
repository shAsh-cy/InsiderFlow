import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Onest } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FBFAF7" },
    { media: "(prefers-color-scheme: dark)", color: "#0E0D0B" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [user, locale, t] = await Promise.all([
    getSessionUser(),
    getLocale(),
    getTranslations("nav"),
  ]);
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
      <body className="paper-grain min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only z-100 rounded-md border border-border bg-surface px-3 py-2 text-sm shadow-overlay focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider>
          <Providers>
            <SessionProvider session={session}>
              <ShellChrome session={session} />
              {children}
            </SessionProvider>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
