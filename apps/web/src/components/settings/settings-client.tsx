"use client";

/**
 * Settings: alert rules, channel linking, quiet hours / digest time, and
 * the one-click import of a signed-out watchlist.
 */
import { BellRing, Loader2, Send, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/domain/empty-state";
import { Button } from "@/components/ui/button";
import { useWatchlist } from "@/hooks/use-watchlist";
import { getLocalWatchlistStore } from "@/lib/watchlist/store";
import { SupabaseWatchlistStore } from "@/lib/watchlist/remote-store";
import { cn } from "@/lib/utils";

export interface RuleView {
  id: string;
  name: string;
  enabled: boolean;
  mode: "instant" | "digest";
  channels: string[];
  trackedTicker: string | null;
  filters: Record<string, unknown> | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
}

export interface ChannelView {
  channel: string;
  destination: string | null;
  verified: boolean;
  digestHour: string;
  timezone: string;
}

/** Time and date inputs are figures, so they take the mono face like every
 *  other figure in the product — a digit must not change width as it ticks. */
const TIME_INPUT_CLASS =
  "num h-8 cursor-pointer rounded-md border border-border bg-surface px-2 text-xs text-ink";

/**
 * A settings group: a titled sheet with its heading ruled off from its
 * controls. The rule is the grouping — no tinted header bar, no shadow
 * stack, just the hairline that separates a caption from its column.
 */
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="surface flex flex-col rounded-lg">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-2xs font-semibold text-ink-muted">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-[68ch] text-xs leading-relaxed text-ink-faint">
            {description}
          </p>
        ) : null}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

/**
 * A linked / not-linked marker. Rectangular, because it is not clickable —
 * the pill shape is reserved for things you can press. State is carried by
 * ink weight plus the word itself, never by colour alone.
 */
function StateTag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-sm border border-border px-1.5 py-0.5 text-2xs",
        on ? "bg-fill font-semibold text-ink" : "text-ink-faint",
      )}
    >
      {children}
    </span>
  );
}

/** Offers to migrate a signed-out watchlist into the account, once. */
function ImportBanner() {
  const [pending, setPending] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setPending(getLocalWatchlistStore().list().length);
  }, []);

  if (done || pending === 0) return null;

  const runImport = async () => {
    setBusy(true);
    try {
      const items = getLocalWatchlistStore().list();
      const imported = await new SupabaseWatchlistStore().importItems(items);
      toast.success(`Imported ${imported} watchlist ${imported === 1 ? "item" : "items"}`);
      setDone(true);
    } catch {
      toast.error("Import failed — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="watchlist-import"
      className="surface-sunken flex flex-wrap items-center gap-3 rounded-lg px-4 py-3"
    >
      <Upload className="size-4 shrink-0 text-ink-muted" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-ink">
        You have <span className="num">{pending}</span> watchlist {pending === 1 ? "item" : "items"}{" "}
        saved in this browser. Import them into your account?
      </p>
      {/* The single accent on this screen: a one-time offer that disappears
          once taken, so nothing else on the page has to compete with it. */}
      <Button size="sm" onClick={() => void runImport()} disabled={busy}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : null} Import
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setDone(true)}>
        Dismiss
      </Button>
    </div>
  );
}

export function SettingsClient({
  initialRules,
  initialChannels,
}: {
  initialRules: RuleView[];
  initialChannels: ChannelView[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [channels, setChannels] = useState(initialChannels);
  const [linking, setLinking] = useState(false);
  const { items: watchlist } = useWatchlist();
  const t = useTranslations("access");

  const telegram = channels.find((c) => c.channel === "telegram");
  const email = channels.find((c) => c.channel === "email");

  const patchRule = async (id: string, patch: Partial<RuleView>) => {
    setRules((current) => current.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const response = await fetch("/api/me/alert-rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    if (!response.ok) toast.error("Could not save that change");
  };

  const removeRule = async (id: string) => {
    setRules((current) => current.filter((r) => r.id !== id));
    await fetch(`/api/me/alert-rules?id=${id}`, { method: "DELETE" });
    toast.success("Rule deleted");
  };

  const linkTelegram = async () => {
    setLinking(true);
    try {
      const response = await fetch("/api/me/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "link-telegram" }),
      });
      const body = (await response.json()) as {
        data?: { url?: string };
        error?: { message: string };
      };
      if (body.data?.url) window.open(body.data.url, "_blank", "noopener,noreferrer");
      else toast.error(body.error?.message ?? "Telegram is not configured on this deployment");
    } finally {
      setLinking(false);
    }
  };

  const patchChannel = async (channel: string, patch: Partial<ChannelView>) => {
    setChannels((current) => current.map((c) => (c.channel === channel ? { ...c, ...patch } : c)));
    await fetch("/api/me/channels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, ...patch }),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <ImportBanner />

      <Section
        title="Alert channels"
        description="Telegram is the primary channel — free, unlimited, and real-time. Email is reserved for digests and rules that explicitly opt into instant delivery."
      >
        {/* Hairline-separated rows rather than boxed cards: two channels on
            one sheet are a list, and a list is ruled, not framed. */}
        <div className="flex flex-col divide-y divide-border">
          <div className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <Send className="size-4 shrink-0 text-ink-muted" aria-hidden />
            <span className="text-sm text-ink">Telegram</span>
            <StateTag on={Boolean(telegram?.verified)}>
              {telegram?.verified ? "linked" : "not linked"}
            </StateTag>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => void linkTelegram()}
              disabled={linking}
              data-testid="link-telegram"
            >
              {linking ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {telegram?.verified ? "Re-link" : "Link Telegram"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <BellRing className="size-4 shrink-0 text-ink-muted" aria-hidden />
            <span className="text-sm text-ink">Email</span>
            {/* An unset destination is an em dash, never a blank cell — the
                same rule the tables follow. */}
            <span className="truncate font-mono text-2xs text-ink-faint">
              {email?.destination ?? "—"}
            </span>
            <StateTag on={Boolean(email?.verified)}>
              {email?.verified ? "subscribed" : "unsubscribed"}
            </StateTag>
            <label className="text-2xs ml-auto flex cursor-pointer items-center gap-2 text-ink-faint">
              Digest at
              <input
                type="time"
                value={email?.digestHour ?? "08:00"}
                onChange={(e) => void patchChannel("email", { digestHour: e.target.value })}
                className={TIME_INPUT_CLASS}
                aria-label="Daily digest time"
              />
            </label>
          </div>
        </div>
      </Section>

      <Section
        title="Alert rules"
        description="Saved screens and tracked tickers. Create one from the screener with “Save as alert”."
      >
        {rules.length === 0 ? (
          <EmptyState
            icon={BellRing}
            tone="sunken"
            title={t("alertsEmptyTitle")}
            body={t("alertsEmptyBody")}
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/screener">Open the screener</Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border" data-testid="alert-rules">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0"
              >
                {/* On is ink, off is a hairline ground. Oxblood is spent once
                    per view and a column of rules would spend it every row. */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.enabled}
                  aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                  onClick={() => void patchRule(rule.id, { enabled: !rule.enabled })}
                  className={cn(
                    "flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors",
                    rule.enabled ? "bg-ink" : "bg-border",
                  )}
                >
                  <span
                    className={cn(
                      "block size-4 rounded-full bg-surface shadow-card transition-transform",
                      rule.enabled ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{rule.name}</p>
                  <p className="text-2xs text-ink-faint">
                    {rule.trackedTicker ? (
                      <span className="num">{`${rule.trackedTicker} · `}</span>
                    ) : (
                      ""
                    )}
                    {rule.channels.join(", ")}
                    {rule.quietHoursStart ? (
                      <span className="num">{` · quiet ${rule.quietHoursStart}–${rule.quietHoursEnd}`}</span>
                    ) : (
                      ""
                    )}
                  </p>
                </div>
                <select
                  value={rule.mode}
                  aria-label={`Delivery mode for ${rule.name}`}
                  onChange={(e) =>
                    void patchRule(rule.id, { mode: e.target.value as "instant" | "digest" })
                  }
                  className="h-8 cursor-pointer rounded-md border border-border bg-surface px-2 text-xs text-ink transition-colors hover:bg-fill [&>option]:bg-surface"
                >
                  <option value="instant">Instant</option>
                  <option value="digest">Daily digest</option>
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Delete ${rule.name}`}
                  onClick={() => void removeRule(rule.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Quiet hours"
        description="Instant alerts inside this window roll into the next digest instead of waking you."
      >
        <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted">
          <label className="flex cursor-pointer items-center gap-2">
            From
            <input
              type="time"
              defaultValue={rules[0]?.quietHoursStart ?? "22:00"}
              onChange={(e) =>
                rules.forEach((r) => void patchRule(r.id, { quietHoursStart: e.target.value }))
              }
              className={TIME_INPUT_CLASS}
              aria-label="Quiet hours start"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            to
            <input
              type="time"
              defaultValue={rules[0]?.quietHoursEnd ?? "07:00"}
              onChange={(e) =>
                rules.forEach((r) => void patchRule(r.id, { quietHoursEnd: e.target.value }))
              }
              className={TIME_INPUT_CLASS}
              aria-label="Quiet hours end"
            />
          </label>
          <span className="text-ink-faint">
            Timezone: <span className="num">{telegram?.timezone ?? email?.timezone ?? "UTC"}</span>
          </span>
        </div>
      </Section>

      <Section
        title="Watchlist"
        description="Synced to your account and used by watchlist alert rules."
      >
        <p className="text-sm text-ink-muted">
          <span className="num text-ink">{watchlist.length}</span> tracked{" "}
          {watchlist.length === 1 ? "item" : "items"}.
        </p>
      </Section>
    </div>
  );
}
