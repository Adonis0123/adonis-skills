import type { Metadata } from "next";
import { siteUrl } from "@/config/site-layout";
import {
  type AppLocale,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
} from "@/i18n/config";
import { withLocalePath } from "@/i18n/href";

/** Canonical URL plus hreflang alternates for a locale-agnostic path such as `/skills/commit`. */
export function localeAlternates(
  path: string,
  locale: AppLocale,
): Metadata["alternates"] {
  const languages: Record<string, string> = Object.fromEntries(
    SUPPORTED_LOCALES.map((lang) => [lang, withLocalePath(path, lang)]),
  );
  languages["x-default"] = withLocalePath(path, DEFAULT_LOCALE);
  return { canonical: withLocalePath(path, locale), languages };
}

export function absoluteUrl(path: string): string {
  return `${siteUrl}${path === "/" ? "" : path}`;
}
