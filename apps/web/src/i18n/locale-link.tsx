'use client'

import * as React from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { AppLocale } from './config'
import { resolveLocaleValue } from './config'
import { withLocalePath } from './href'

type NextLinkProps = React.ComponentProps<typeof Link>

export interface LocaleLinkProps extends Omit<NextLinkProps, 'href' | 'locale'> {
  href: NextLinkProps['href']
  locale?: AppLocale
}

export const LocaleLink = React.forwardRef<HTMLAnchorElement, LocaleLinkProps>(
  ({ href, locale, ...props }, ref) => {
    const params = useParams()
    const inferredLocale = resolveLocaleValue(params?.lang)
    const targetLocale = locale ?? inferredLocale

    const localizedHref = typeof href === 'string'
      ? withLocalePath(href, targetLocale)
      : href

    return <Link ref={ref} href={localizedHref} {...props} />
  },
)

LocaleLink.displayName = 'LocaleLink'
