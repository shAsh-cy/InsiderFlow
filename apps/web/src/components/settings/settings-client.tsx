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
      <div className="px-5 py-2">{children}</div>
    </section>
  );
}

/**
 * One setting: its name on the left, its control on the right.
 *
 * A definition grid rather than a flex row per setting. Flex rows put
 * every control wherever its own label happened to end, so the digest
 * time floated to the far right while the quiet-hours pair sat inline
 * next to their words — three settings, three different left edges for
 * the thing you actually operate. A shared column means you scan the
 * names down one edge and the controls down another.
 *
 * `min-h-11` (44px) on every row: the same rhythm whether the control is
 * a time input, a switch or a sentence, and comfortably past the 24px
 * minimum target size in WCAG 2.2 §2.5.8.
 *
 * `<label>` when the row drives a single control and `<div role=group>`
 * when it drives several, so a label never claims to name two inputs.
 */
function Field({
  label,
  hint,
  htmlFor,
  children,
  asGroup = false,
}: {
  label: React.ReactNode;
  hint?: string;
  htmlFor?: string;
  children: React.ReactNode;
  asGroup?: boolean;
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2.5 text-sm text-ink">
        {label}
        {hint ? <span className="text-2xs text-ink-faint">{hint}</span> : null}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-2.5">{children}</span>
    </>
  );
  const className =
    "grid min-h-11 grid-cols-1 items-center gap-x-4 gap-y-1.5 border-b border-border py-2.5 last:border-b-0 sm:grid-cols-[minmax(7rem,12rem)_1fr]";

  return asGroup ? (
    <div
      role="group"
      aria-label={typeof label === "string" ? label : undefined}
      className={className}
    >
      {body}
    </div>
  ) : (
    <label htmlFor={htmlFor} className={className}>
      {body}
    </label>
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
        {/* Ruled rows on a shared column, not boxed cards: two channels on
            one sheet are a list, and a list is ruled, not framed. */}
        <Field
          asGroup
          label={
            <>
              <Send className="size-4 shrink-0 text-ink-muted" aria-hidden />
              Telegram
            </>
          }
        >
          <StateTag on={Boolean(telegram?.verified)}>
            {telegram?.verified ? "linked" : "not linked"}
          </StateTag>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void linkTelegram()}
            disabled={linking}
            data-testid="link-telegram"
          >
            {linking ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {telegram?.verified ? "Re-link" : "Link Telegram"}
          </Button>
        </Field>

        <Field
          asGroup
          label={
            <>
              <BellRing className="size-4 shrink-0 text-ink-muted" aria-hidden />
              Email
            </>
          }
        >
          <StateTag on={Boolean(email?.verified)}>
            {email?.verified ? "subscribed" : "unsubscribed"}
          </StateTag>
          {/* An unset destination is an em dash, never a blank cell — the
              same rule the tables follow. */}
          <span className="min-w-0 truncate font-mono text-2xs text-ink-faint">
            {email?.destination ?? "—"}
          </span>
        </Field>

        {/* Its own row rather than a control floated to the right of the
            Email line: the digest time is a setting, and it belongs on the
            same column as every other control on this sheet. */}
        <Field label="Daily digest" htmlFor="digest-hour" hint="email only">
          <input
            id="digest-hour"
            type="time"
            value={email?.digestHour ?? "08:00"}
            onChange={(e) => void patchChannel("email", { digestHour: e.target.value })}
            className={TIME_INPUT_CLASS}
          />
        </Field>
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
          <ul className="flex flex-col" data-testid="alert-rules">
            {rules.map((rule) => (
              <li
                key={rule.id}
                // Same 44px rhythm as the definition rows in every other
                // section, so the sheet reads as one column of settings
                // rather than a form with a table dropped into the middle.
                className="flex min-h-11 flex-wrap items-center gap-3 border-b border-border py-2.5 last:border-b-0"
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
        {/* Both times on one baseline, in one row, on the same column as
            the digest time above — a window is one setting with two ends,
            not two settings that happen to sit near each other. */}
        <Field asGroup label="Window">
          <input
            type="time"
            defaultValue={rules[0]?.quietHoursStart ?? "22:00"}
            onChange={(e) =>
              rules.forEach((r) => void patchRule(r.id, { quietHoursStart: e.target.value }))
            }
            className={TIME_INPUT_CLASS}
            aria-label="Quiet hours start"
          />
          <span className="text-xs text-ink-faint">to</span>
          <input
            type="time"
            defaultValue={rules[0]?.quietHoursEnd ?? "07:00"}
            onChange={(e) =>
              rules.forEach((r) => void patchRule(r.id, { quietHoursEnd: e.target.value }))
            }
            className={TIME_INPUT_CLASS}
            aria-label="Quiet hours end"
          />
        </Field>

        <Field asGroup label="Timezone">
          <span className="num text-xs text-ink-muted">
            {telegram?.timezone ?? email?.timezone ?? "UTC"}
          </span>
        </Field>
      </Section>

      <Section
        title="Watchlist"
        description="Synced to your account and used by watchlist alert rules."
      >
        <Field asGroup label="Tracked">
          <span className="text-sm text-ink-muted">
            <span className="num text-ink">{watchlist.length}</span>{" "}
            {watchlist.length === 1 ? "item" : "items"}
          </span>
        </Field>
      </Section>

      {/* An honest placeholder. The public API is already open and needs no
          key; what does not exist yet is self-serve key issuance, so this
          card says exactly that and offers no control that would pretend
          otherwise. A disabled "Generate key" button here would be a
          promise the backend cannot keep. */}
      <Section
        title="API"
        description="The public API is already open — 60 requests/min per IP, no key required. A key only raises that ceiling."
      >
        <Field asGroup label="Personal keys">
          <StateTag on={false}>not yet available</StateTag>
          <span className="text-xs text-ink-muted">
            Self-serve key issuance is not built. Until it is, higher limits are arranged by opening
            an issue — see the{" "}
            <Link
              href="/docs"
              className="text-accent-ink underline decoration-border underline-offset-4 transition-colors hover:decoration-current"
            >
              API docs
            </Link>
            .
          </span>
        </Field>
      </Section>
    </div>
  );
}
