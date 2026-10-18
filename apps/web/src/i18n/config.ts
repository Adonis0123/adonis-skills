import {
  defaultLocale,
  supportedLocales,
} from "@adonis-skills/i18n/next-config";

export const SUPPORTED_LOCALES = supportedLocales;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE = defaultLocale as AppLocale;

export function isSupportedLocale(value: string): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function resolveLocaleValue(
  value: string | string[] | undefined,
): AppLocale {
  const normalized = Array.isArray(value) ? value[0] : value;

  if (!normalized) return DEFAULT_LOCALE;

  return isSupportedLocale(normalized) ? normalized : DEFAULT_LOCALE;
}

/** Remembers an explicit language choice so the proxy stops re-detecting from Accept-Language. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
