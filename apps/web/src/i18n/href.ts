import { type AppLocale, DEFAULT_LOCALE, SUPPORTED_LOCALES } from './config'

const externalHrefPattern = /^(?:[a-z][a-z\d+\-.]*:)?\/\//i

function hasLocalePrefix(pathname: string): boolean {
  return SUPPORTED_LOCALES.some(
    locale => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  )
}

export function withLocalePath(href: string, locale: AppLocale): string {
  if (!href || externalHrefPattern.test(href) || href.startsWith('#')) {
    return href
  }

  const [pathnameWithQuery, hashFragment] = href.split('#', 2)
  const [pathname, query] = pathnameWithQuery.split('?', 2)

  if (!pathname.startsWith('/')) {
    return href
  }

  if (hasLocalePrefix(pathname)) {
    return href
  }

  const localizedPathname = locale === DEFAULT_LOCALE
    ? pathname
    : (pathname === '/' ? `/${locale}` : `/${locale}${pathname}`)

  const queryPart = query ? `?${query}` : ''
  const hashPart = hashFragment ? `#${hashFragment}` : ''

  return `${localizedPathname}${queryPart}${hashPart}`
}

function stripLocalePrefix(pathname: string): string {
  for (const locale of SUPPORTED_LOCALES) {
    if (pathname === `/${locale}`) {
      return '/'
    }

    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.slice(locale.length + 1)
    }
  }

  return pathname
}

export function replaceLocalePath(href: string, locale: AppLocale): string {
  if (!href || externalHrefPattern.test(href) || href.startsWith('#')) {
    return href
  }

  const [pathnameWithQuery, hashFragment] = href.split('#', 2)
  const [pathname, query] = pathnameWithQuery.split('?', 2)

  if (!pathname.startsWith('/')) {
    return href
  }

  const unlocalizedPathname = stripLocalePrefix(pathname)
  const localizedPathname = locale === DEFAULT_LOCALE
    ? unlocalizedPathname
    : (unlocalizedPathname === '/' ? `/${locale}` : `/${locale}${unlocalizedPathname}`)

  const queryPart = query ? `?${query}` : ''
  const hashPart = hashFragment ? `#${hashFragment}` : ''

  return `${localizedPathname}${queryPart}${hashPart}`
}
