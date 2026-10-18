import Link from "next/link";
import { Trans, useLingui } from "@lingui/react/macro";
import { type SiteNavItem, siteLayoutConfig } from "@/config/site-layout";
import { HeaderScrollShadowObserver } from "@/components/layout/header-scroll-shadow-observer";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { MobileHeaderMenu } from "@/components/layout/mobile-header-menu";
import { SiteBrand } from "@/components/layout/site-brand";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ClaySurface } from "@/components/ui";
import { cx } from "@/components/ui/utils";
import { LocaleLink } from "@/i18n/locale-link";

function getLinkProps(external?: boolean) {
  if (!external) {
    return {};
  }

  return {
    target: "_blank",
    rel: "noreferrer",
  };
}

function getNavItemLabel(item: SiteNavItem) {
  switch (item.id) {
    case "github":
      return <Trans id="siteHeader.nav.github.label">GitHub</Trans>;
    default:
      return item.id;
  }
}

export function SiteHeader() {
  const { brand, headerNav } = siteLayoutConfig;
  const { t } = useLingui();
  const navAria: Record<SiteNavItem["id"], string> = {
    github: t({
      id: "siteHeader.nav.github.aria",
      message: "Open the adonis-skills repository on GitHub",
    }),
  };

  return (
    <header className="safe-area-top-edge sticky top-0 z-40">
      {/* Hidden until keyboard focus; each page puts id="main-content" on its <main>. */}
      <a
        href="#main-content"
        className="clay-focus-ring clay-button clay-button--primary clay-button--sm absolute top-2 left-[var(--site-gutter)] z-50 -translate-y-[200%] opacity-0 focus:translate-y-0 focus:opacity-100"
      >
        <Trans id="siteHeader.skipToContent">Skip to content</Trans>
      </a>
      <HeaderScrollShadowObserver />
      <ClaySurface
        tone="base"
        elevation="floating"
        className="site-header-surface rounded-none border-x-0 border-t-0 border-border bg-background py-3.5"
      >
        <div className="site-header-inner flex items-center justify-between gap-3 md:gap-4">
          <SiteBrand
            variant="header"
            brand={brand}
            subtitle={
              <Trans id="siteHeader.brand.subtitle">skill library</Trans>
            }
            priority
          />

          <div className="md:hidden">
            <MobileHeaderMenu />
          </div>

          <nav
            aria-label={t({
              id: "siteHeader.nav.aria",
              message: "Main navigation",
            })}
            className="hidden items-center justify-end gap-2 md:flex"
          >
            {headerNav.map((item) => {
              const label = getNavItemLabel(item);
              const itemAria = navAria[item.id];
              const className = cx(
                "clay-focus-ring clay-button clay-button--secondary clay-button--sm gap-1.5 px-3.5 text-xs md:text-sm",
                item.external && "pr-3",
              );

              if (item.external) {
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-label={itemAria}
                    className={className}
                    {...getLinkProps(item.external)}
                  >
                    <span>{label}</span>
                    <span
                      className="icon-[lucide--external-link] size-3.5"
                      aria-hidden
                    />
                  </Link>
                );
              }

              return (
                <LocaleLink
                  key={item.id}
                  href={item.href}
                  aria-label={itemAria}
                  className={className}
                >
                  <span>{label}</span>
                </LocaleLink>
              );
            })}

            <LocaleSwitcher />

            <ThemeToggle />
          </nav>
        </div>
      </ClaySurface>
    </header>
  );
}
