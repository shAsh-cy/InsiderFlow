"use client";

import { useEffect, useRef } from "react";

import { TURNSTILE_SCRIPT_ORIGIN, turnstileSiteKey } from "@/lib/auth/turnstile";

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          theme?: "auto" | "light" | "dark";
        },
      ) => string;
      remove: (id: string) => void;
    };
  }
}

/**
 * The Turnstile challenge, or nothing at all.
 *
 * ── RENDERS NOTHING WHEN UNCONFIGURED, ON PURPOSE ─────────────────────
 *
 * With no `NEXT_PUBLIC_TURNSTILE_SITE_KEY` this returns null and loads no
 * script. That is the state of every fresh clone, of CI, and of the e2e
 * suite — so "off" has to be a first-class path rather than a degraded
 * one, or enabling bot protection in production would mean discovering a
 * broken sign-in form everywhere else.
 *
 * ── EXPLICIT RENDER, NOT THE AUTO-RENDER ATTRIBUTE ────────────────────
 *
 * Cloudflare's `cf-turnstile` class auto-renders on script load, which
 * races React: the div may not be mounted yet, and on a client navigation
 * the script is already loaded so the callback never fires again. The
 * explicit API is called from an effect, which is the lifecycle React
 * actually guarantees.
 *
 * The script is loaded by this component, which means it is loaded by
 * code the CSP nonce already trusts — `'strict-dynamic'` propagates that
 * trust, so `script-src` needs no Cloudflare origin. `frame-src` DOES,
 * because the challenge itself is an iframe, and that directive has no
 * fallback to `default-src`. `lib/security/csp.ts` adds it only when a
 * site key exists.
 */
export function TurnstileWidget({ onToken }: { onToken: (token: string | null) => void }) {
  const container = useRef<HTMLDivElement | null>(null);
  const siteKey = turnstileSiteKey();

  useEffect(() => {
    if (!siteKey || !container.current) return;
    let widgetId: string | undefined;
    let cancelled = false;

    const render = () => {
      if (cancelled || !container.current || !window.turnstile) return;
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: "auto",
        callback: (token) => onToken(token),
        // A solved token is single-use and expires. Clearing it disables
        // submit again rather than letting the form send a stale one and
        // fail with an error the visitor cannot act on.
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
      const script = existing ?? document.createElement("script");
      if (!existing) {
        script.src = `${TURNSTILE_SCRIPT_ORIGIN}/turnstile/v0/api.js?render=explicit`;
        script.async = true;
        script.defer = true;
        script.dataset.turnstile = "true";
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
    }

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div ref={container} data-testid="turnstile" className="min-h-[65px]" />;
}
