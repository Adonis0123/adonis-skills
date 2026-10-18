import Link from "next/link";
import { Trans, useLingui } from "@lingui/react/macro";
import { siteLayoutConfig } from "@/config/site-layout";
import { HeaderScrollShadowObserver } from "@/components/layout/header-scroll-shadow-observer";
import { HeaderSearch } from "@/components/layout/header-search";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { MobileHeaderMenu } from "@/components/layout/mobile-header-menu";
import { SiteBrand } from "@/components/layout/site-brand";
import { SiteNavLabel } from "@/components/layout/site-nav-label";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LocaleLink } from "@/i18n/locale-link";

const navLinkClass =
  "clay-focus-ring inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground";

export function SiteHeader() {
  const { brand, headerNav } = siteLayoutConfig;
  const { t } = useLingui();

  return (
    <header data-site-header className="safe-area-top-edge sticky top-0 z-40">
      {/* Hidden until keyboard focus; each page puts id="main-content" on its <main>. */}
      {/* Skip links jump instantly; the smooth-scroll provider leaves this one alone. */}
      <a
        href="#main-content"
        data-no-smooth-scroll
        className="clay-focus-ring clay-button clay-button--primary clay-button--sm absolute top-2 left-[var(--site-gutter)] z-50 -translate-y-[200%] opacity-0 focus:translate-y-0 focus:opacity-100"
      >
        <Trans id="siteHeader.skipToContent">Skip to content</Trans>
      </a>
      <HeaderScrollShadowObserver />
      <div className="site-header-surface border-b border-border bg-background">
        <div className="site-header-inner flex h-16 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-7">
            <SiteBrand variant="header" brand={brand} priority />

            <nav
              aria-label={t({
                id: "siteHeader.nav.aria",
                message: "Main navigation",
              })}
              className="hidden items-center gap-1 md:flex"
            >
              {headerNav.map((item) =>
                item.external ? (
                  <Link
                    key={item.id}
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t({
                      id: "siteHeader.nav.github.aria",
                      message: "Open the adonis-skills repository on GitHub",
                    })}
                    className={navLinkClass}
                  >
                    <SiteNavLabel id={item.id} />
                    <span
                      className="icon-[lucide--arrow-up-right] size-3.5"
                      aria-hidden
                    />
                  </Link>
                ) : (
                  <LocaleLink
                    key={item.id}
                    href={item.href}
                    className={navLinkClass}
                  >
                    <SiteNavLabel id={item.id} />
                  </LocaleLink>
                ),
              )}
            </nav>
          </div>

          <div className="hidden items-center gap-2 md:flex">
            <div className="hidden lg:block">
              <HeaderSearch />
            </div>
            <LocaleSwitcher />
            <ThemeToggle />
          </div>

          <div className="md:hidden">
            <MobileHeaderMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
