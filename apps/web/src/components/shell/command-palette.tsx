"use client";

/**
 * Palette body, loaded on demand. Splitting this out keeps cmdk + the
 * dialog primitives off the critical path — the top bar only needs a
 * button until someone actually presses ⌘K.
 */
import {
  Activity,
  BookOpen,
  Braces,
  ExternalLink,
  Flame,
  Landmark,
  LayoutGrid,
  Rss,
  Sigma,
  TerminalSquare,
  Trophy,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";

const GITHUB_URL = "https://github.com/insiderflow/insiderflow";
const CURL_EXAMPLE = `curl "https://your-deployment/api/trades?relevance=opportunistic&limit=10"`;

export default function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();

  const navigate = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };
  const external = (href: string) => {
    onOpenChange(false);
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    // Full-screen below sm. A centred 328px-wide sheet floating in the
    // middle of a phone leaves the results list ~300px tall with the
    // keyboard up — three visible rows out of twenty. Filling the screen
    // is not a flourish here, it is the difference between a usable
    // search and a peephole.
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      className="max-sm:inset-0 max-sm:top-0 max-sm:left-0 max-sm:h-dvh max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0"
    >
      <CommandInput placeholder="Jump to a page or run an action…" />
      <CommandList className="max-sm:max-h-[calc(100dvh-7rem)]">
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => navigate("/")}>
            <Activity aria-hidden /> Overview
          </CommandItem>
          <CommandItem onSelect={() => navigate("/trades")}>
            <Activity aria-hidden /> Live feed
            <CommandShortcut>/trades</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate("/screener")}>
            <LayoutGrid aria-hidden /> Screener
            <CommandShortcut>/screener</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate("/companies")}>
            <LayoutGrid aria-hidden /> Companies
          </CommandItem>
          <CommandItem onSelect={() => navigate("/watchlist")}>
            <LayoutGrid aria-hidden /> Watchlist
          </CommandItem>
          <CommandItem onSelect={() => navigate("/heatmap")}>
            <Flame aria-hidden /> Heatmap
            <CommandShortcut>/heatmap</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate("/leaderboard")}>
            <Trophy aria-hidden /> Insider leaderboard
            <CommandShortcut>/leaderboard</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate("/politicians")}>
            <Landmark aria-hidden /> Congressional trading
            <CommandShortcut>/politicians</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate("/docs/methodology")}>
            <Sigma aria-hidden /> Methodology
          </CommandItem>
          <CommandItem onSelect={() => navigate("/design")}>
            <LayoutGrid aria-hidden /> Design system
            <CommandShortcut>/design</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => navigate("/docs")}>
            <BookOpen aria-hidden /> API documentation
            <CommandShortcut>/docs</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="API">
          <CommandItem onSelect={() => external("/api/openapi.json")}>
            <Braces aria-hidden /> OpenAPI spec (JSON)
          </CommandItem>
          <CommandItem onSelect={() => external("/api/rss/latest")}>
            <Rss aria-hidden /> RSS · latest insider trades
          </CommandItem>
          <CommandItem onSelect={() => external("/api/rss/politicians")}>
            <Rss aria-hidden /> RSS · congressional disclosures
          </CommandItem>
          <CommandItem
            onSelect={() => {
              void navigator.clipboard.writeText(CURL_EXAMPLE);
              toast.success("Example request copied to clipboard");
              onOpenChange(false);
            }}
          >
            <TerminalSquare aria-hidden /> Copy example curl request
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Project">
          <CommandItem onSelect={() => external(GITHUB_URL)}>
            <ExternalLink aria-hidden /> GitHub repository
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
