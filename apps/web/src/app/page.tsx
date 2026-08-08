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
import { utcClock } from "@/lib/format";

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
    return { filingsToday: 0, notionalUsd: 0, clusterSignals: 0, latestIngestAt: null };
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
      {/* One frame around the whole page, centred and capped, with every
          section keyed to its start edge. r3 had four separately-padded
          full-bleed bands here; that works while the frame begins at x=0
          and stops working the moment it does not, so the frame is now a
          single object and the sections are blocks inside it. */}
      <div data-shell-frame className="shell-frame">
        <div data-content-region>
          {/* ── Hero ──────────────────────────────────────────────────────
          Editorial-left, not centred. Every block on this page — headline,
          figures, tape, feature index — starts on the same left edge, and
          the asymmetry is carried by what sits to the RIGHT of it: here,
          the live tape. Centring a marketing hero puts the most valuable
          words where the eye arrives last; an F-pattern reader takes the
          top-left first (Nielsen Norman Group), so that is where the
          product name and the one primary action go.

          The 7/5 split is unchanged from r3 — what changed is that it now
          spans the whole frame instead of stopping at 72rem, so at 1920
          the tape is a column of the page rather than a postscript with
          400px of dead paper beside it. */}
          <section className="grid gap-10 pt-20 pb-16 lg:grid-cols-12 lg:gap-12 lg:pt-24">
            <div className="rail-bleed lg:col-span-7">
              <p className="num text-2xs text-ink-faint">{t("kicker")}</p>

              {/* The product name is a proper noun — never translated. No
              text-balance: this is the LCP element, and balanced line
              breaking measurably delays its paint. */}
              <h1 className="mt-5 text-4xl font-semibold tracking-tight text-ink">InsiderFlow</h1>

              {/* The one text reveal on the site. */}
              <p className="mt-5 max-w-[54ch] text-lg leading-relaxed text-ink-muted">
                <LineReveal text={t("subhead")} />
              </p>

              {/* The access promise, stated where it cannot be missed: this is
              the product's whole wedge, and a reader who assumes the data
              is gated never gets as far as the tape. */}
              <p className="mt-6 max-w-[54ch] border-t border-border pt-4 text-sm text-ink-muted">
                <strong className="font-semibold text-ink">{t("accessLead")}</strong>{" "}
                {t("accessBody")}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                {/* The single accent element on this view. */}
                <Button asChild size="lg" data-magnetic>
                  <Link href="/trades">
                    {t("ctaPrimary")} <ArrowRight aria-hidden />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <Link href="/docs">{t("ctaSecondary")}</Link>
                </Button>
              </div>

              <p className="mt-6 text-2xs text-ink-faint">{t("badge")}</p>

              <p
                role="alert"
                className="rail-quiet mt-8 max-w-[62ch] pl-4 text-xs leading-relaxed text-ink-muted"
              >
                <strong className="font-semibold text-ink">{t("disclaimerLead")}</strong>{" "}
                {t("disclaimerBody")}
              </p>
            </div>

            {/* The right side is the live product, not decoration. */}
            <div className="lg:col-span-5">
              <LiveFeedStrip
                initialTrades={initialTrades}
                label={t("tapeLabel")}
                emptyMessage={t("tapeEmpty")}
              />
            </div>
          </section>

          {/* ── Signature panel: real figures from the live database. ──────── */}
          <section aria-label={t("signatureLabel")} className="border-t border-border py-14">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-ink">
                {t("signatureLabel")}
              </h2>
              <p className="text-2xs text-ink-faint">
                {t("stats.hint")}
                {/* The window these figures cover is 24 hours, so a zero is
                ambiguous on its own: it could be a quiet day or a dead
                pipeline. This says which. It is max(created_at), not the
                request time — if the last row landed three days ago, the
                page says three days ago. */}
                {stats.latestIngestAt ? (
                  <>
                    {" · "}
                    <span className="num" title={new Date(stats.latestIngestAt).toUTCString()}>
                      {t("stats.asOf", { time: utcClock(stats.latestIngestAt) })}
                    </span>
                  </>
                ) : (
                  <> · {t("stats.neverIngested")}</>
                )}
              </p>
            </div>

            <div className="mb-4">
              <SyntheticDataNotice />
            </div>

            <Reveal className="grid gap-3 sm:grid-cols-3">
              <StatCard
                label={t("stats.filings")}
                value={stats.filingsToday}
                preset="count"
                accent
              />
              <StatCard label={t("stats.notional")} value={stats.notionalUsd} preset="usd" />
              <StatCard label={t("stats.clusters")} value={stats.clusterSignals} preset="count" />
            </Reveal>

            {sparks.length > 0 ? (
              <div className="mt-10">
                <h3 className="mb-2 border-b border-border pb-2 text-2xs font-semibold text-ink-faint">
                  {t("sparklinesLabel")}
                </h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                  {sparks.map((spark) => (
                    <FlowSparkline key={spark.ticker} spark={spark} />
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {/* ── Features, set as an index ─────────────────────────────────── */}
          <section aria-label={t("featuresLabel")} className="border-t border-border py-14">
            <div className="grid gap-x-10 sm:grid-cols-2 xl:grid-cols-4">
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
          <footer className="border-t border-border py-10">
            {/* The testid spans both paragraphs: sources first, then the
            licence line that carries the "not investment advice" statement. */}
            <div
              data-testid="footer-disclaimer"
              className="flex flex-col gap-3 text-xs leading-relaxed text-ink-faint"
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
                <Link
                  href="/legal"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:justify-start"
                >
                  Legal &amp; data sources
                </Link>
                <Link
                  href="/docs/methodology"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:justify-start"
                >
                  Methodology
                </Link>
                <Link
                  href="/status"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center transition-colors hover:text-ink md:min-h-0 md:min-w-0 md:justify-start"
                >
                  Status
                </Link>
              </nav>
            </div>
          </footer>
        </div>
      </div>
    </main>
  );
}
