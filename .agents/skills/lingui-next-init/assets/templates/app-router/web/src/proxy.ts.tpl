import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const locales = {{SUPPORTED_LOCALES_ARRAY}};
const defaultLocale = "{{DEFAULT_LOCALE}}";

function detectLocale(request: NextRequest): string {
	const acceptLanguage = request.headers.get("accept-language");
	if (!acceptLanguage) return defaultLocale;

	const tokens = acceptLanguage
		.split(",")
		.map((item) => item.trim().split(";")[0]?.toLowerCase() ?? "")
		.filter(Boolean);

	for (const token of tokens) {
		if (locales.includes(token)) return token;
		const match = locales.find((locale) => token.startsWith(`${locale}-`));
		if (match) return match;
	}

	return defaultLocale;
}

function extractLocaleFromPath(pathname: string): string | null {
	for (const locale of locales) {
		if (pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`) {
			return locale;
		}
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

	if (pathnameLocale) {
		return NextResponse.next();
	}

	const locale = detectLocale(request);

	if (locale !== defaultLocale) {
		request.nextUrl.pathname = `/${locale}${pathname}`;
		return NextResponse.redirect(request.nextUrl);
	}

	request.nextUrl.pathname = `/${defaultLocale}${pathname}`;
	return NextResponse.rewrite(request.nextUrl);
}

export const config = {
	matcher: ["/((?!_next|api|favicon\\.ico|.*\\..*).*)"],
};
