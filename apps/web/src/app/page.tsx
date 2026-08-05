import { ArrowRight, Braces, Filter, Globe2, Zap } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

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

/** Icons stay in code; every string comes from the message catalogue. */
const FEATURES = [
  { key: "realtime", icon: Zap },
  { key: "multiMarket", icon: Globe2 },
  { key: "signal", icon: Filter },
  { key: "api", icon: Braces },
] as const;

export default async function Home() {
  const [initialTrades, t] = await Promise.all([seedTrades(), getTranslations("landing")]);

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
          {t("badge")}
        </p>
        {/* The product name is a proper noun — never translated. */}
        <h1 className="text-6xl font-semibold tracking-tighter sm:text-7xl">
          <span className="text-gradient">InsiderFlow</span>
        </h1>
        {/* No text-balance here: it is the LCP element and balanced
            line-breaking measurably delays its paint. */}
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
          {t("subhead")}
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="bg-gradient-accent border-0 text-[#06231f] shadow-glow hover:opacity-90"
          >
            <Link href="/trades">
              {t("ctaPrimary")} <ArrowRight aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="glass border-white/10">
            <Link href="/docs">{t("ctaSecondary")}</Link>
          </Button>
        </div>
        <p
          role="alert"
          className="mt-10 max-w-xl rounded-lg border border-amber-500/25 bg-amber-500/8 px-4 py-2.5 text-xs leading-relaxed text-amber-200/90"
        >
          <strong className="font-semibold">{t("disclaimerLead")}</strong> {t("disclaimerBody")}
        </p>
      </section>

      {/* Live tape — the one data-connected element on this page */}
      <LiveFeedStrip initialTrades={initialTrades} />

      {/* Features */}
      <section aria-label={t("featuresLabel")} className="mx-auto max-w-5xl px-6 py-24">
        <div className="grid gap-5 sm:grid-cols-2">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <article
                key={feature.key}
                className="glass group rounded-2xl p-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-lift"
              >
                <div className="bg-gradient-accent mb-4 inline-flex size-9 items-center justify-center rounded-lg text-[#06231f]">
                  <Icon className="size-4.5" aria-hidden />
                </div>
                <h2 className="mb-2 font-semibold tracking-tight">
                  {t(`features.${feature.key}.title`)}
                </h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {t(`features.${feature.key}.body`)}
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/6 px-6 py-10">
        {/* The testid spans both paragraphs: sources first, then the
            licence line that carries the "not investment advice" statement. */}
        <div
          data-testid="footer-disclaimer"
          className="mx-auto flex max-w-5xl flex-col gap-3 text-xs leading-relaxed text-subtle-foreground"
        >
          <p>
            <strong className="text-muted-foreground">{t("footer.sourcesLead")}</strong>{" "}
            {t("footer.sourcesBody")}
          </p>
          <p>{t("footer.licence")}</p>
          <nav aria-label="Legal and reference" className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
            <Link href="/legal" className="hover:text-foreground">
              Legal &amp; data sources
            </Link>
            <Link href="/docs/methodology" className="hover:text-foreground">
              Methodology
            </Link>
            <Link href="/status" className="hover:text-foreground">
              Status
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
