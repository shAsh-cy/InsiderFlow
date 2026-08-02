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
      <div className="flex flex-col gap-4 pb-24">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="glass rounded-xl px-5 py-8 text-sm leading-relaxed text-muted-foreground">
          Accounts and alerts are not configured on this deployment. Set{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to enable them —
          see <code className="font-mono text-xs">docs/auth.md</code>. Everything else on
          InsiderFlow works without an account.
        </p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-5 pb-24">
        <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
        <div className="glass flex flex-col items-start gap-4 rounded-xl px-5 py-8">
          <p className="text-sm text-muted-foreground">
            Sign in to sync your watchlist across devices and receive alerts.
          </p>
          <Button asChild className="bg-gradient-accent border-0 text-[#06231f]">
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
    <div className="flex flex-col gap-6 pb-24">
      <header className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold tracking-tight">Settings</h1>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline" size="sm" className="glass border-white/10">
            Sign out
          </Button>
        </form>
      </header>

      <SettingsClient initialRules={ruleViews} initialChannels={channelViews} />
    </div>
  );
}
