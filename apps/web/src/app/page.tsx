import { ArrowRight, Braces, Filter, Globe2, Zap } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { SectionHeader } from "@/components/domain/section-header";
import { StatCard } from "@/components/domain/stat-card";
import { SyntheticDataNotice } from "@/components/domain/synthetic-data-notice";
import { FlowSparkline } from "@/components/landing/flow-sparkline";
import { LandingFooter } from "@/components/landing/landing-footer";
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
    <main id="main" tabIndex={-1} className="relative min-h-screen overflow-x-clip pt-14">
      {/* No sidebar here, so no chrome to pin against: the shell is fluid
          and its margin tracks the viewport through `clamp(24px, 6vw,
          120px)` rather than stepping at a breakpoint. The 120px ceiling is
          what stops a 2560px screen turning the page into a letterbox. */}
      <div className="shell-fluid">
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

              {/* The one honesty note the hero keeps: it names the licence
                  and the funding model in a line, which is a fact about
                  what this is rather than a caveat about what it is not.
                  "Not investment advice" moved to the footer — as a
                  bordered `role="alert"` block under the primary call to
                  action it was announced on load by every screen reader
                  and stood between the headline and the product. */}
              <p className="mt-6 text-2xs text-ink-faint">{t("badge")}</p>
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
            {/* The same header pattern as every panel in the product —
                label left, provenance right — at the page tone. */}
            <SectionHeader
              tone="page"
              label={t("signatureLabel")}
              className="mb-6"
              meta={
                <p>
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
              }
            />

            <div className="mb-4">
              <SyntheticDataNotice />
            </div>

            {/* `auto-rows-fr`: the three figures differ in length, and without it
                the card with the shortest label sat visibly shorter than its
                neighbours — a row of instruments that is not a row. */}
            <Reveal className="grid auto-rows-fr gap-3 sm:grid-cols-3">
              {/* Each card says what window it covers. A bare "0" under
                  "Filings today" is ambiguous between a quiet day and a dead
                  pipeline, and the honest answer belongs ON the card rather
                  than only in the section's provenance line: when nothing
                  has ever been ingested the hint says so outright, so the
                  zero reads as a stated fact instead of a broken panel. */}
              <StatCard
                label={t("stats.filings")}
                value={stats.filingsToday}
                preset="count"
                hint={stats.latestIngestAt === null ? t("stats.quiet") : t("stats.window")}
                accent
              />
              <StatCard
                label={t("stats.notional")}
                value={stats.notionalUsd}
                preset="usd"
                hint={t("stats.window")}
              />
              <StatCard
                label={t("stats.clusters")}
                value={stats.clusterSignals}
                preset="count"
                hint={t("stats.clusterWindow")}
              />
            </Reveal>

            {sparks.length > 0 ? (
              <div className="mt-10">
                <SectionHeader
                  label={t("sparklinesLabel")}
                  className="mb-2 border-b border-border pb-2"
                />
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

          {/* ── Footer ────────────────────────────────────────────────────
              Landing-only. App routes keep `SiteFooter`, whose whole job is
              that the disclaimer appears on every page; this one says what
              the project is, under whose licence, and where the source
              lives — which AGPL-3.0 §13 requires the interface to offer. */}
          <LandingFooter />
        </div>
      </div>
    </main>
  );
}
