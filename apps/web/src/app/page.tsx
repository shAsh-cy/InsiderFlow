import { ArrowRight, Braces, Filter, Globe2, Zap } from "lucide-react";
import Link from "next/link";

import { LiveFeedStrip } from "@/components/landing/live-feed-strip";
import { Button } from "@/components/ui/button";
import { queryTrades } from "@/lib/api/queries";
import { tradesQuerySchema } from "@/lib/api/schemas";
import type { TradeRow } from "@/lib/api/queries";
import { getDb } from "@/lib/db";

/**
 * Statically rendered and regenerated every 60s: the tape is in the HTML
 * (fast LCP, no layout shift), and the SSE stream keeps it current from
 * there. A DB hiccup degrades to an empty tape rather than a broken page.
 */
export const revalidate = 60;

async function seedTrades(): Promise<TradeRow[]> {
  try {
    const query = tradesQuerySchema.parse({});
    const { data } = await queryTrades(getDb(), {
      ...query,
      sort: "created_at",
      order: "desc",
      limit: 6,
    });
    return data;
  } catch {
    return [];
  }
}

const FEATURES = [
  {
    icon: Zap,
    title: "Real-time EDGAR tape",
    body: "A 1-minute cron watches SEC filings; a Form 4 lands in the database — and on this page — within about a minute of hitting EDGAR.",
  },
  {
    icon: Globe2,
    title: "Multi-market, one schema",
    body: "US and India today, adapter-ready for more. Every market normalizes into one taxonomy with native currency and USD side by side.",
  },
  {
    icon: Filter,
    title: "Signal over noise",
    body: "Every trade is classified routine (grants, 10b5-1 plans, tax withholding) or opportunistic — the discretionary trades worth watching.",
  },
  {
    icon: Braces,
    title: "Free public API",
    body: "Typed JSON, RSS feeds, and a live SSE stream. Rate-limited, cached, documented with OpenAPI. No key required to start.",
  },
];

export default async function Home() {
  const initialTrades = await seedTrades();

  return (
    <main id="main" className="relative min-h-screen overflow-x-clip pt-14">
      {/* Ambient gradient field — pure CSS, paused under reduced motion */}
      <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
        <div className="ambient-a -left-52 -top-56 h-[44rem] w-[44rem]" />
        <div className="ambient-b -right-40 top-24 h-[38rem] w-[38rem]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      </div>

      {/* Hero */}
      <section className="mx-auto flex max-w-4xl flex-col items-center px-6 pb-20 pt-24 text-center">
        <p className="glass mb-8 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="bg-gradient-accent size-1.5 rounded-full" />
          Open source · AGPL-3.0 · Runs entirely on free tiers
        </p>
        <h1 className="text-6xl font-semibold tracking-tighter sm:text-7xl">
          <span className="text-gradient">InsiderFlow</span>
        </h1>
        {/* No text-balance here: it is the LCP element and balanced
            line-breaking measurably delays its paint. */}
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
          The real-time insider-trading tape. When executives trade their own stock, it shows up
          here — normalized across markets, classified for signal, and free to query.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="bg-gradient-accent border-0 text-[#06231f] shadow-glow hover:opacity-90"
          >
            <Link href="/trades">
              Watch the live tape <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="glass border-white/10">
            <Link href="/docs">Explore the API</Link>
          </Button>
        </div>
        <p
          role="alert"
          className="mt-10 max-w-xl rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-2.5 text-xs leading-relaxed text-amber-200/90"
        >
          <strong className="font-semibold">Not investment advice.</strong> Public regulatory
          filings, republished for research and education. Filings can be late, amended, or wrong.
        </p>
      </section>

      {/* Live tape — the one data-connected element on this page */}
      <LiveFeedStrip initialTrades={initialTrades} />

      {/* Features */}
      <section aria-label="Features" className="mx-auto max-w-5xl px-6 py-24">
        <div className="grid gap-5 sm:grid-cols-2">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.title}
                className="glass group rounded-2xl p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lift"
              >
                <div className="bg-gradient-accent mb-4 inline-flex size-9 items-center justify-center rounded-lg text-[#06231f]">
                  <Icon className="size-4.5" aria-hidden />
                </div>
                <h2 className="mb-2 font-semibold tracking-tight">{feature.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">{feature.body}</p>
              </article>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/6 px-6 py-10">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 text-xs leading-relaxed text-subtle-foreground">
          <p>
            <strong className="text-muted-foreground">Data sources:</strong> US data comes from SEC
            EDGAR, a US-government service whose filings are in the public domain; access follows
            the SEC fair-access policy. NSE/BSE (India) data is subject to restrictive exchange
            terms and is not redistributed by this project.
          </p>
          <p>
            InsiderFlow is free software licensed under AGPL-3.0. Nothing on this site is investment
            advice or a recommendation to buy or sell any security.
          </p>
        </div>
      </footer>
    </main>
  );
}
