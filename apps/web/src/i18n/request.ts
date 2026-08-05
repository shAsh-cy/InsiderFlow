import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE } from "./config";

/**
 * Resolve the active locale per request from the locale cookie.
 *
 * English messages are merged UNDER the active locale, so a key that has not
 * been translated yet renders the English string rather than the raw key. A
 * partially translated UI is fine; a UI showing `nav.heatmap` is not.
 */
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE;

  const en = (await import("../../messages/en.json")).default;
  const messages =
    locale === DEFAULT_LOCALE
      ? en
      : { ...en, ...(await import(`../../messages/${locale}.json`)).default };

  return { locale, messages };
});
