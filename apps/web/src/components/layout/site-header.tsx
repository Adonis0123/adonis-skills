import Link from 'next/link'
import { siteLayoutConfig } from '@/config/site-layout'
import { HeaderScrollShadowObserver } from '@/components/layout/header-scroll-shadow-observer'
import { SiteBrand } from '@/components/layout/site-brand'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { ClaySurface } from '@/components/ui'
import { cx } from '@/components/ui/utils'

function getLinkProps(external?: boolean) {
  if (!external) {
    return {}
  }

  return {
    target: '_blank',
    rel: 'noreferrer',
  }
}

export function SiteHeader() {
  const { brand, headerNav } = siteLayoutConfig

  return (
    <header className="safe-area-top-edge sticky top-0 z-40">
      <HeaderScrollShadowObserver />
      <ClaySurface
        tone="base"
        elevation="floating"
        className="site-header-surface rounded-none border-x-0 border-t-0 border-white/40 bg-background/80 py-3.5 supports-[backdrop-filter]:bg-background/62 supports-[backdrop-filter]:backdrop-blur-sm"
      >
        <div className="site-frame site-frame--wide flex flex-wrap items-center justify-between gap-3 md:gap-4">
          <SiteBrand variant="header" brand={brand} subtitle="skills catalog" priority />

          <nav aria-label="主导航" className="flex flex-wrap items-center justify-end gap-2">
            {headerNav.map(item => (
              <Link
                key={item.label}
                href={item.href}
                aria-label={item.ariaLabel}
                className={cx(
                  'clay-focus-ring inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/68 px-3 py-1.5 text-xs font-medium text-clay-muted transition hover:text-foreground md:text-sm',
                  item.external && 'pr-2.5'
                )}
                {...getLinkProps(item.external)}
              >
                <span>{item.label}</span>
                {item.external && <span className="icon-[lucide--external-link] size-3.5" aria-hidden />}
              </Link>
            ))}

            <ThemeToggle />
          </nav>
        </div>
      </ClaySurface>
    </header>
  )
}
