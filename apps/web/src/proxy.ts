import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  type AppLocale,
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  isSupportedLocale,
} from "@/i18n/config";

const defaultLocale = DEFAULT_LOCALE;

function localeFromCookie(request: NextRequest): AppLocale | null {
  const value = request.cookies.get(LOCALE_COOKIE_NAME)?.value;
  return value && isSupportedLocale(value) ? value : null;
}

function localeFromAcceptLanguage(request: NextRequest): AppLocale {
  const acceptLanguage = request.headers.get("accept-language");
  if (!acceptLanguage) return defaultLocale;

  const tokens = acceptLanguage
    .split(",")
    .map((item) => item.trim().split(";")[0]?.toLowerCase() ?? "")
    .filter(Boolean);

  for (const token of tokens) {
    if (isSupportedLocale(token)) return token;

    const match = SUPPORTED_LOCALES.find((locale) =>
      token.startsWith(`${locale}-`),
    );
    if (match) return match;
  }

  return defaultLocale;
}

function extractLocaleFromPath(pathname: string): AppLocale | null {
  for (const locale of SUPPORTED_LOCALES) {
    if (pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`)
      return locale;
  }
  return null;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const pathnameLocale = extractLocaleFromPath(pathname);

  if (pathnameLocale === defaultLocale) {
    const rest = pathname.slice(`/${defaultLocale}`.length) || "/";
    request.nextUrl.pathname = rest;
    return NextResponse.redirect(request.nextUrl, 301);
  }

  // An explicit /zh/... link wins over the saved cookie; no redirect.
  if (pathnameLocale) return NextResponse.next();

  // An explicit choice from the locale switcher beats browser language detection.
  const locale = localeFromCookie(request) ?? localeFromAcceptLanguage(request);

  if (locale !== defaultLocale) {
    request.nextUrl.pathname = `/${locale}${pathname}`;
    return NextResponse.redirect(request.nextUrl);
  }

  request.nextUrl.pathname = `/${defaultLocale}${pathname}`;
  return NextResponse.rewrite(request.nextUrl);
}

export const config = {
  // Metadata image routes stay out of locale redirects so crawlers get them in one request.
  matcher: ["/((?!_next|api|favicon\\.ico|.*opengraph-image|.*\\..*).*)"],
};
