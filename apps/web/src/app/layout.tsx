import type { Metadata, Viewport } from "next";

import { ShellChrome } from "@/components/shell/chrome";
import { Providers } from "@/components/shell/providers";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "InsiderFlow — the real-time insider trading tape",
    template: "%s · InsiderFlow",
  },
  description:
    "Open-source, real-time, multi-market insider-trading tracker. Normalized, classified, free. Not investment advice.",
};

export const viewport: Viewport = {
  themeColor: "#0A0B0F",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="grain min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only z-[100] rounded-md bg-surface-2 px-3 py-2 text-sm focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <Providers>
          <ShellChrome />
          {children}
        </Providers>
      </body>
    </html>
  );
}
