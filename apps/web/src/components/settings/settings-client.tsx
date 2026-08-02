"use client";

/**
 * Settings: alert rules, channel linking, quiet hours / digest time, and
 * the one-click import of a signed-out watchlist.
 */
import { BellRing, Loader2, Send, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

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
    <section aria-label={title} className="glass flex flex-col gap-4 rounded-xl p-5">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-subtle-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
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
      className="flex flex-wrap items-center gap-3 rounded-xl border border-teal/25 bg-teal/8 px-4 py-3"
    >
      <Upload className="size-4 text-teal" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-teal">
        You have {pending} watchlist {pending === 1 ? "item" : "items"} saved in this browser.
        Import them into your account?
      </p>
      <Button
        size="sm"
        onClick={() => void runImport()}
        disabled={busy}
        className="bg-gradient-accent border-0 text-[#06231f]"
      >
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
    <div className="flex flex-col gap-5">
      <ImportBanner />

      <Section
        title="Alert channels"
        description="Telegram is the primary channel — free, unlimited, and real-time. Email is reserved for digests and rules that explicitly opt into instant delivery."
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 px-4 py-3">
            <Send className="size-4 text-teal" aria-hidden />
            <span className="text-sm">Telegram</span>
            <span
              className={cn(
                "text-2xs rounded-full px-2 py-0.5 ring-1 ring-inset",
                telegram?.verified
                  ? "bg-buy-soft text-buy ring-buy/30"
                  : "bg-flat-soft text-flat ring-white/10",
              )}
            >
              {telegram?.verified ? "linked" : "not linked"}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="glass ml-auto border-white/10"
              onClick={() => void linkTelegram()}
              disabled={linking}
              data-testid="link-telegram"
            >
              {linking ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {telegram?.verified ? "Re-link" : "Link Telegram"}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 px-4 py-3">
            <BellRing className="size-4 text-muted-foreground" aria-hidden />
            <span className="text-sm">Email</span>
            <span className="text-2xs truncate text-subtle-foreground">
              {email?.destination ?? "—"}
            </span>
            <span
              className={cn(
                "text-2xs rounded-full px-2 py-0.5 ring-1 ring-inset",
                email?.verified
                  ? "bg-buy-soft text-buy ring-buy/30"
                  : "bg-flat-soft text-flat ring-white/10",
              )}
            >
              {email?.verified ? "subscribed" : "unsubscribed"}
            </span>
            <label className="text-2xs ml-auto flex items-center gap-2 text-subtle-foreground">
              Digest at
              <input
                type="time"
                value={email?.digestHour ?? "08:00"}
                onChange={(e) => void patchChannel("email", { digestHour: e.target.value })}
                className="glass h-8 rounded-lg px-2 text-xs"
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
          <p className="py-6 text-center text-sm text-muted-foreground">
            No rules yet. Open the screener, build a screen, and hit “Save as alert”.
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="alert-rules">
            {rules.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-white/8 px-4 py-3"
              >
                <button
                  type="button"
                  role="switch"
                  aria-checked={rule.enabled}
                  aria-label={`${rule.enabled ? "Disable" : "Enable"} ${rule.name}`}
                  onClick={() => void patchRule(rule.id, { enabled: !rule.enabled })}
                  className={cn(
                    "h-5 w-9 shrink-0 rounded-full transition-colors",
                    rule.enabled ? "bg-gradient-accent" : "bg-white/12",
                  )}
                >
                  <span
                    className={cn(
                      "block size-4 rounded-full bg-white transition-transform",
                      rule.enabled ? "translate-x-4" : "translate-x-0.5",
                    )}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{rule.name}</p>
                  <p className="text-2xs text-subtle-foreground">
                    {rule.trackedTicker ? `${rule.trackedTicker} · ` : ""}
                    {rule.channels.join(", ")}
                    {rule.quietHoursStart
                      ? ` · quiet ${rule.quietHoursStart}–${rule.quietHoursEnd}`
                      : ""}
                  </p>
                </div>
                <select
                  value={rule.mode}
                  aria-label={`Delivery mode for ${rule.name}`}
                  onChange={(e) =>
                    void patchRule(rule.id, { mode: e.target.value as "instant" | "digest" })
                  }
                  className="glass h-8 rounded-lg px-2 text-xs [&>option]:bg-surface-2"
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
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            From
            <input
              type="time"
              defaultValue={rules[0]?.quietHoursStart ?? "22:00"}
              onChange={(e) =>
                rules.forEach((r) => void patchRule(r.id, { quietHoursStart: e.target.value }))
              }
              className="glass h-8 rounded-lg px-2"
              aria-label="Quiet hours start"
            />
          </label>
          <label className="flex items-center gap-2">
            to
            <input
              type="time"
              defaultValue={rules[0]?.quietHoursEnd ?? "07:00"}
              onChange={(e) =>
                rules.forEach((r) => void patchRule(r.id, { quietHoursEnd: e.target.value }))
              }
              className="glass h-8 rounded-lg px-2"
              aria-label="Quiet hours end"
            />
          </label>
          <span className="text-subtle-foreground">
            Timezone: {telegram?.timezone ?? email?.timezone ?? "UTC"}
          </span>
        </div>
      </Section>

      <Section
        title="Watchlist"
        description="Synced to your account and used by watchlist alert rules."
      >
        <p className="text-sm text-muted-foreground">
          {watchlist.length} tracked {watchlist.length === 1 ? "item" : "items"}.
        </p>
      </Section>
    </div>
  );
}
