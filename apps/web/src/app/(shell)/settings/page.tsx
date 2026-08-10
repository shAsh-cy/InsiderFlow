import Link from "next/link";

import { SettingsClient } from "@/components/settings/settings-client";
import type { ChannelView, RuleView } from "@/components/settings/settings-client";
import { Button } from "@/components/ui/button";
import { listAlertRules, listChannels } from "@/lib/api/user-queries";
import { getSessionUser, isAuthConfigured } from "@/lib/auth/supabase-server";
import { getDb } from "@/lib/db";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const authConfigured = isAuthConfigured();
  const user = await getSessionUser();

  if (!authConfigured) {
    return (
      <div className="flex flex-col gap-6 pb-24">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Settings</h1>
        <p className="surface max-w-[68ch] rounded-lg px-5 py-8 text-sm leading-relaxed text-ink-muted">
          Accounts and alerts are not configured on this deployment. Set{" "}
          <code className="font-mono text-xs text-ink">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono text-xs text-ink">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to
          enable them — see <code className="font-mono text-xs text-ink">docs/auth.md</code>.
          Everything else on InsiderFlow works without an account.
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-6 pb-24">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">Settings</h1>
        <div className="surface flex max-w-[68ch] flex-col items-start gap-5 rounded-lg px-5 py-8">
          <p className="text-sm leading-relaxed text-ink-muted">
            Sign in to sync your watchlist across devices and receive alerts.
          </p>
          {/* The only thing to do on this screen, so it takes the accent. */}
          <Button asChild>
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  const db = getDb();
  const [rules, channels] = await Promise.all([
    listAlertRules(db, user.id).catch(() => []),
    listChannels(db, user.id).catch(() => []),
  ]);

  const ruleViews: RuleView[] = rules.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    mode: r.mode,
    channels: r.channels,
    trackedTicker: r.trackedTicker,
    filters: r.filters,
    quietHoursStart: r.quietHoursStart,
    quietHoursEnd: r.quietHoursEnd,
  }));
  // Tokens never cross to the client.
  const channelViews: ChannelView[] = channels.map((c) => ({
    channel: c.channel,
    destination: c.destination,
    verified: c.verified,
    digestHour: c.digestHour,
    timezone: c.timezone,
  }));

  return (
    <div className="flex flex-col gap-8 pb-24">
      {/* Masthead: who you are, and the one way out. Ruled off from the form
          groups below so the page reads as sections on a sheet. */}
      <header className="rail-bleed flex flex-wrap items-center gap-3 border-b border-border pb-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Settings</h1>
          <p className="mt-1 truncate font-mono text-sm text-ink-muted">{user.email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </header>

      <SettingsClient initialRules={ruleViews} initialChannels={channelViews} />
    </div>
  );
}
