import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The mark, and the link that carries it.
 *
 * Extracted in r6 because the brand now has three mount points instead of
 * one — the sidebar header on an app shell, the masthead on the landing,
 * and the drawer header on a phone — and three copies of a logo is three
 * chances for them to drift apart.
 *
 * It used to be a 4px vertical accent rule beside the wordmark: visually
 * identical to the rule the sidebar draws down the left of the CURRENT
 * page, which made the brand read as a permanently-active nav item. People
 * reported it as a stuck highlight, and they were right to.
 *
 * A logo has to be shaped like nothing else in the system. This one is a
 * bordered square holding a tape line: enclosed and horizontally
 * symmetric, where every state marker in the product is an open vertical
 * rule or an underline. It is decorative — the wordmark beside it is the
 * accessible name — and it is never given `aria-current`.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-5 shrink-0 place-items-center rounded-sm border border-accent-bright/55 text-accent-bright",
        className,
      )}
    >
      <svg viewBox="0 0 12 12" className="size-3" fill="none" aria-hidden focusable="false">
        <path
          d="M1 8.5 L4 5.5 L6.5 7.5 L11 2.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * The brand as a link home. Never a nav state: it carries no `aria-current`
 * under any route, including "/".
 *
 * `wordmark="responsive"` keeps the word `sr-only` below 640 and shows it
 * from there. `sr-only`, not `hidden`: the wordmark IS this link's
 * accessible name, and hiding it on a phone would leave a link to the home
 * page with no name at all.
 */
export function BrandLink({
  className,
  wordmark = "always",
}: {
  className?: string;
  wordmark?: "always" | "responsive";
}) {
  return (
    <Link
      href="/"
      data-brand
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-sm text-sm font-semibold tracking-tight text-ink",
        className,
      )}
    >
      <BrandMark />
      <span className={wordmark === "responsive" ? "sr-only sm:not-sr-only" : undefined}>
        InsiderFlow
      </span>
    </Link>
  );
}
