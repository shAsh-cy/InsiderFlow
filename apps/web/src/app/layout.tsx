import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "InsiderFlow — real-time insider trading tracker",
  description:
    "Open-source, real-time, multi-market insider-trading tracker. Data for research and education only — not investment advice.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
