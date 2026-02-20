import Link from 'next/link'
import { Trans, useLingui } from '@lingui/react/macro'
import { type SiteNavItem, siteLayoutConfig } from '@/config/site-layout'
import { HeaderScrollShadowObserver } from '@/components/layout/header-scroll-shadow-observer'
import { LocaleSwitcher } from '@/components/layout/locale-switcher'
import { MobileHeaderMenu } from '@/components/layout/mobile-header-menu'
import { SiteBrand } from '@/components/layout/site-brand'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { ClaySurface } from '@/components/ui'
import { cx } from '@/components/ui/utils'
import { LocaleLink } from '@/i18n/locale-link'

function getLinkProps(external?: boolean) {
  if (!external) {
    return {}
  }

  return {
    target: '_blank',
    rel: 'noreferrer',
  }
}

function getNavItemLabel(item: SiteNavItem) {
  switch (item.id) {
    case 'github':
      return <Trans id="siteHeader.nav.github.label">GitHub</Trans>
    default:
      return item.id
  }
}

function getNavItemAria(item: SiteNavItem, t: ReturnType<typeof useLingui>['t']) {
  switch (item.id) {
    case 'github':
      return t({
        id: 'siteHeader.nav.github.aria',
        message: 'Open the adonis-skills repository on GitHub',
      })
    default:
      return t`Open navigation item: ${item.id}`
  }
}

export function SiteHeader() {
  const { brand, headerNav } = siteLayoutConfig
  const { t } = useLingui()

  return (
    <header className="safe-area-top-edge sticky top-0 z-40">
      <HeaderScrollShadowObserver />
      <ClaySurface
        tone="base"
        elevation="floating"
        className="site-header-surface rounded-none border-x-0 border-t-0 border-white/40 bg-background/80 py-3.5 supports-[backdrop-filter]:bg-background/62 supports-[backdrop-filter]:backdrop-blur-sm"
      >
        <div className="site-header-inner flex items-center justify-between gap-3 md:gap-4">
          <SiteBrand
            variant="header"
            brand={brand}
            subtitle={<Trans id="siteHeader.brand.subtitle">skill library</Trans>}
            priority
          />

          <div className="md:hidden">
            <MobileHeaderMenu />
          </div>

          <nav
            aria-label={t({
              id: 'siteHeader.nav.aria',
              message: 'Main navigation',
            })}
            className="hidden items-center justify-end gap-2 md:flex"
          >
            {headerNav.map(item => {
              const label = getNavItemLabel(item)
              const navAria = getNavItemAria(item, t)
              const className = cx(
                'clay-focus-ring clay-button clay-button--secondary clay-button--sm gap-1.5 px-3.5 text-xs md:text-sm',
                item.external && 'pr-3',
              )

              if (item.external) {
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-label={navAria}
                    className={className}
                    {...getLinkProps(item.external)}
                  >
                    <span>{label}</span>
                    <span className="icon-[lucide--external-link] size-3.5" aria-hidden />
                  </Link>
                )
              }

              return (
                <LocaleLink
                  key={item.id}
                  href={item.href}
                  aria-label={navAria}
                  className={className}
                >
                  <span>{label}</span>
                </LocaleLink>
              )
            })}

            <LocaleSwitcher
              ariaLabel={t({
                id: 'siteHeader.locale.aria',
                message: 'Switch site language',
              })}
              title={t({
                id: 'siteHeader.locale.title',
                message: 'Language',
              })}
            />

            <ThemeToggle />
          </nav>
        </div>
      </ClaySurface>
    </header>
  )
}
