/**
 * i18n scaffolding — English and Hindi.
 *
 * ROUTING MODEL: locale lives in a cookie, not in the URL. next-intl supports
 * both; the cookie form is chosen deliberately for the first pass:
 *
 *  - No `/[locale]/…` segment, so every existing route, deep link, RSS URL,
 *    and OpenAPI path keeps working unchanged.
 *  - The API is not localized at all. It serves data, and a machine-readable
 *    endpoint whose field names or values shift by Accept-Language would be a
 *    breaking change dressed up as a feature.
 *
 * The trade-off is that a translated page is not separately addressable or
 * indexable. When translation coverage justifies it, moving to path-based
 * routing is a contained change: this file's LOCALES stays as-is, the request
 * config reads the segment instead of the cookie, and the pages are already
 * reading their strings from the message catalogue.
 *
 * COVERAGE: the shell and the landing page are translated. Everything else
 * falls back to English via the `en` catalogue rather than rendering a key.
 * Numbers, dates, tickers, and transaction codes are never translated.
 */
export const LOCALES = ["en", "hi"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
};

/** Cookie the switcher writes and the request config reads. */
export const LOCALE_COOKIE = "insiderflow-locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (LOCALES as readonly string[]).includes(value);
}
