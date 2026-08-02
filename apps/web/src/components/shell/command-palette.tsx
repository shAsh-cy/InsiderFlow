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
  LayoutGrid,
  Rss,
  TerminalSquare,
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
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Command palette">
      <CommandInput placeholder="Jump to a page or run an action…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Navigate">
          <CommandItem onSelect={() => navigate("/")}>
            <Activity aria-hidden /> Overview
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
