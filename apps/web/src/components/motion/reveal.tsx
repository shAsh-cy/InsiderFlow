"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { STAGGER, springs } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Editorial section reveal.
 *
 * Two rules, both learned the hard way:
 *
 *  1. **The server renders it visible.** The obvious implementation
 *     (`initial={{opacity: 0}}` + `whileInView`) ships HTML whose text is
 *     invisible; if hydration fails or the IntersectionObserver never
 *     fires, the page is silently blank. A decorative entrance is not
 *     worth that.
 *  2. **Only content that is off screen at mount ever hides.** Otherwise
 *     hydration would blank out a section the reader is already looking
 *     at, just to fade it back in — a flash of disappearing content,
 *     which is worse than no animation at all.
 *
 * Under reduced motion nothing hides and nothing moves.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  as = "div",
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  as?: "div" | "section" | "li" | "p";
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  /** null until the first effect decides whether this one may animate. */
  const eligible = useRef<boolean | null>(null);
  const [hidden, setHidden] = useState(false);
  // The polymorphic lookup widens `ref` to an intersection of every
  // element type in the union, which nothing can satisfy. The runtime
  // component is still the right tag; only the ref's element type is
  // narrowed for TypeScript's benefit.
  const Component = motion[as] as typeof motion.div;

  useEffect(() => {
    if (reduced) return;
    if (eligible.current === null) {
      eligible.current = !inView;
      if (eligible.current) setHidden(true);
      return;
    }
    if (inView) setHidden(false);
  }, [inView, reduced]);

  return (
    <Component
      ref={ref}
      animate={hidden ? { opacity: 0, y: 14 } : { opacity: 1, y: 0 }}
      transition={{ ...springs.reveal, delay }}
      className={className}
    >
      {children}
    </Component>
  );
}

/**
 * The one text reveal on the site: words rise and resolve in sequence, so
 * the sentence reads as type being set rather than a box fading in.
 *
 * Per-word `inline-block` and NO clipping container. The tempting version
 * wraps the whole paragraph in `overflow-clip` and slides each word up
 * from below — but that technique only works line by line, and applied to
 * a paragraph it clips the wrapped lines and mangles the layout. Rising a
 * few pixels while fading gives the same cadence and wraps correctly at
 * every width.
 *
 * Like Reveal, it renders as plain text until mounted, so the sentence is
 * always in the HTML.
 */
export function LineReveal({
  text,
  className,
  delay = 0,
}: {
  text: string;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  const [armed, setArmed] = useState(false);

  useEffect(() => setArmed(true), []);

  if (!armed || reduced) return <span className={className}>{text}</span>;

  const words = text.split(" ");

  return (
    <motion.span
      className={cn(className)}
      initial="hidden"
      animate="shown"
      transition={{ delayChildren: delay, staggerChildren: STAGGER / 4 }}
    >
      {words.map((word, i) => (
        <motion.span
          key={`${word}-${i}`}
          variants={{ hidden: { opacity: 0, y: "0.35em" }, shown: { opacity: 1, y: "0em" } }}
          transition={springs.reveal}
          className="inline-block whitespace-pre"
        >
          {word}
          {i < words.length - 1 ? " " : ""}
        </motion.span>
      ))}
    </motion.span>
  );
}
