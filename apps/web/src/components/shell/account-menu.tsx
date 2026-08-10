"use client";

import { LogOut, Settings2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import { AccountChip } from "./account-chip";

const ITEM =
  "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-sm text-ink-muted transition-colors hover:bg-fill hover:text-ink md:min-h-9";

/**
 * What the chip's chevron has been promising.
 *
 * Code-split and mounted on the first hover, focus or press of the chip:
 * the overlay primitive behind it is the only reason Radix would be in a
 * signed-out reader's first-load graph, and a menu nobody has opened is a
 * menu nobody needs the bytes for. Until then the masthead renders the
 * chip alone, from the same component this uses as its trigger, so the
 * upgrade is invisible.
 *
 * Sign out is a POST to `/auth/signout`, not a link. Signing out is a
 * state change on the server; a GET that mutates a session is the kind of
 * thing a link prefetcher or a crawler triggers by accident.
 */
export default function AccountMenu({
  email,
  open,
  onOpenChange,
}: {
  email: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("nav");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <AccountChip email={email} label={t("account")} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2" data-testid="account-menu">
        {email ? (
          <p className="truncate px-2.5 pb-2 text-2xs text-ink-faint" title={email}>
            {email}
          </p>
        ) : null}
        <Link href="/settings" className={ITEM} onClick={() => onOpenChange(false)}>
          <Settings2 className="size-4 shrink-0" aria-hidden />
          {t("settings")}
        </Link>
        <form action="/auth/signout" method="post">
          <button type="submit" className={ITEM} data-testid="sign-out">
            <LogOut className="size-4 shrink-0" aria-hidden />
            {t("signOut")}
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
