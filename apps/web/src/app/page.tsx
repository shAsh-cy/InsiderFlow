import { ArrowRight, Braces, Filter, Globe2, Zap } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { StatCard } from "@/components/domain/stat-card";
import { SyntheticDataNotice } from "@/components/domain/synthetic-data-notice";
import { FlowSparkline } from "@/components/landing/flow-sparkline";
import { LiveFeedStrip } from "@/components/landing/live-feed-strip";
import { LineReveal, Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { queryFlowSparklines, queryLandingStats } from "@/lib/api/landing-queries";
import type { FlowSpark, LandingStats } from "@/lib/api/landing-queries";
import { queryTrades } from "@/lib/api/queries";
import { tradesQuerySchema } from "@/lib/api/schemas";
import type { TradeRow } from "@/lib/api/queries";
import { getDb } from "@/lib/db";

/**
 * Statically rendered and regenerated every 60s: the tape and the figures
 * are in the HTML (fast LCP, no layout shift), and the SSE stream keeps
 * the tape current from there. A DB hiccup degrades to an empty tape and
 * zeroed panel rather than a broken page.
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

async function landingStats(): Promise<LandingStats> {
  try {
    return await queryLandingStats(getDb());
  } catch {
    return { filingsToday: 0, notionalUsd: 0, clusterSignals: 0 };
  }
}

async function sparklines(): Promise<FlowSpark[]> {
  try {
    return await queryFlowSparklines(getDb(), 6, 30);
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
  const [initialTrades, stats, sparks, t] = await Promise.all([
    seedTrades(),
    landingStats(),
    sparklines(),
    getTranslations("landing"),
  ]);

  return (
    <main id="main" className="relative min-h-screen overflow-x-clip pt-14">
      {/* ── Hero ──────────────────────────────────────────────────────────
          Set against the left margin rule of a ledger sheet rather than
          centred in space. The whole page hangs off that one oxblood
          line. */}
      <section className="mx-auto max-w-5xl px-6 pb-16 pt-20 sm:pt-28">
        <div className="border-l-2 border-l-accent pl-6 sm:pl-8">
          <p className="num text-2xs uppercase tracking-[0.22em] text-ink-faint">{t("kicker")}</p>

          {/* The product name is a proper noun — never translated. No
              text-balance: this is the LCP element, and balanced line
              breaking measurably delays its paint. */}
          <h1 className="mt-5 text-5xl font-semibold tracking-tight text-ink">InsiderFlow</h1>

          {/* The one text reveal on the site. */}
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-muted">
            <LineReveal text={t("subhead")} />
          </p>

          <p className="mt-6 border-t border-border pt-4 text-2xs uppercase tracking-[0.18em] text-ink-faint">
            {t("badge")}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            {/* The single accent element on this view. */}
            <Button asChild size="lg">
              <Link href="/trades">
                {t("ctaPrimary")} <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/docs">{t("ctaSecondary")}</Link>
            </Button>
          </div>

          <p
            role="alert"
            className="mt-9 max-w-2xl border-l-2 border-l-border pl-4 text-xs leading-relaxed text-ink-muted"
          >
            <strong className="font-semibold text-ink">{t("disclaimerLead")}</strong>{" "}
            {t("disclaimerBody")}
          </p>
        </div>
      </section>

      {/* ── Signature panel: the product, running, on the marketing page ──
          Real figures from the live database, the real SSE tape, and real
          30-day flow. Nothing here is a mockup. */}
      <section
        aria-label={t("signatureLabel")}
        className="mx-auto max-w-5xl border-t border-border px-6 py-14"
      >
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight text-ink">{t("signatureLabel")}</h2>
          <p className="text-2xs text-ink-faint">{t("stats.hint")}</p>
        </div>

        <div className="mb-4">
          <SyntheticDataNotice />
        </div>

        <Reveal className="grid gap-3 sm:grid-cols-3">
          <StatCard label={t("stats.filings")} value={stats.filingsToday} preset="count" accent />
          <StatCard label={t("stats.notional")} value={stats.notionalUsd} preset="usd" />
          <StatCard label={t("stats.clusters")} value={stats.clusterSignals} preset="count" />
        </Reveal>

        <div className="mt-10 grid gap-10 lg:grid-cols-[1.15fr_1fr]">
          <LiveFeedStrip
            initialTrades={initialTrades}
            label={t("tapeLabel")}
            emptyMessage={t("tapeEmpty")}
          />

          {sparks.length > 0 ? (
            <div>
              <h3 className="mb-2 border-b border-border pb-2 text-2xs font-semibold uppercase tracking-[0.2em] text-ink-faint">
                {t("sparklinesLabel")}
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2">
                {sparks.map((spark) => (
                  <FlowSparkline key={spark.ticker} spark={spark} />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* ── Features, set as an index ─────────────────────────────────── */}
      <section
        aria-label={t("featuresLabel")}
        className="mx-auto max-w-5xl border-t border-border px-6 py-14"
      >
        <div className="grid gap-x-10 sm:grid-cols-2">
          {FEATURES.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <Reveal
                key={feature.key}
                as="div"
                delay={i * 0.05}
                className="flex gap-4 border-b border-border py-6"
              >
                <span className="num shrink-0 pt-0.5 text-2xs text-ink-faint">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="flex items-center gap-2 font-semibold tracking-tight text-ink">
                    <Icon className="size-4 text-ink-faint" aria-hidden />
                    {t(`features.${feature.key}.title`)}
                  </h2>
                  <p className="mt-2 max-w-[46ch] text-sm leading-relaxed text-ink-muted">
                    {t(`features.${feature.key}.body`)}
                  </p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className="border-t border-border px-6 py-10">
        {/* The testid spans both paragraphs: sources first, then the
            licence line that carries the "not investment advice" statement. */}
        <div
          data-testid="footer-disclaimer"
          className="mx-auto flex max-w-5xl flex-col gap-3 text-xs leading-relaxed text-ink-faint"
        >
          <p className="max-w-[80ch]">
            <strong className="text-ink-muted">{t("footer.sourcesLead")}</strong>{" "}
            {t("footer.sourcesBody")}
          </p>
          <p className="max-w-[80ch]">{t("footer.licence")}</p>
          <nav
            aria-label="Legal and reference"
            className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-3"
          >
            <Link href="/legal" className="transition-colors hover:text-ink">
              Legal &amp; data sources
            </Link>
            <Link href="/docs/methodology" className="transition-colors hover:text-ink">
              Methodology
            </Link>
            <Link href="/status" className="transition-colors hover:text-ink">
              Status
            </Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
