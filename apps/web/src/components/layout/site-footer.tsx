import Link from 'next/link'
import { Trans } from '@lingui/react/macro'
import { siteLayoutConfig } from '@/config/site-layout'
import { SiteBrand } from '@/components/layout/site-brand'
import { ClaySurface } from '@/components/ui'
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

export function SiteFooter() {
  const { brand, repo, footerGroups } = siteLayoutConfig
  const year = new Date().getFullYear()
  const brandName = brand.name

  const getGroupTitle = (groupId: (typeof footerGroups)[number]['id']) => {
    if (groupId === 'quick-links') {
      return <Trans id="siteFooter.group.quickLinks">Quick Links</Trans>
    }
    return <Trans id="siteFooter.group.resources">Resources</Trans>
  }

  const getLinkLabel = (linkId: (typeof footerGroups)[number]['links'][number]['id']) => {
    switch (linkId) {
      case 'skill-library':
        return <Trans id="siteFooter.link.skillLibrary">Skill Library</Trans>
      case 'example-skill':
        return <Trans id="siteFooter.link.exampleSkill">Example Skill</Trans>
      case 'github-repository':
        return <Trans id="siteFooter.link.githubRepository">GitHub Repository</Trans>
      case 'readme':
        return <Trans id="siteFooter.link.readme">README</Trans>
      default:
        return null
    }
  }

  return (
    <footer className="safe-area-bottom mt-10 md:mt-12">
      <div className="site-frame site-frame--wide">
        <ClaySurface tone="base" elevation="raised" className="rounded-[1.3rem] p-5 md:p-7">
          <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr]">
            <section>
              <SiteBrand variant="footer" brand={brand} />

              <p className="mt-4 max-w-xl text-sm leading-7 text-clay-muted">
                <Trans id="siteFooter.brand.tagline">
                  Discover practical agent skills and install them in seconds.
                </Trans>
              </p>
              <p className="mt-3 font-mono text-[11px] text-clay-muted">npx skills add {repo} --skill &lt;slug&gt;</p>
            </section>

            <section className="grid gap-6 sm:grid-cols-2">
              {footerGroups.map(group => (
                <div key={group.id}>
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-clay-muted">
                    {getGroupTitle(group.id)}
                  </h2>
                  <ul className="mt-3 space-y-2">
                    {group.links.map(link => (
                      <li key={`${group.id}-${link.id}`}>
                        {link.external ? (
                          <Link
                            href={link.href}
                            className="clay-focus-ring inline-flex items-center gap-1.5 rounded-md text-sm text-clay-muted transition hover:text-foreground"
                            {...getLinkProps(link.external)}
                          >
                            <span>{getLinkLabel(link.id)}</span>
                            <span className="icon-[lucide--external-link] size-3.5" aria-hidden />
                          </Link>
                        ) : (
                          <LocaleLink
                            href={link.href}
                            className="clay-focus-ring inline-flex items-center gap-1.5 rounded-md text-sm text-clay-muted transition hover:text-foreground"
                          >
                            <span>{getLinkLabel(link.id)}</span>
                          </LocaleLink>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/72 pt-4 text-xs text-clay-muted md:text-sm">
            <p>
              <Trans id="siteFooter.copyright">
                © {year} {brandName}. All rights reserved.
              </Trans>
            </p>
            <p><Trans id="siteFooter.builtFor">Built for discovering and installing agent skills.</Trans></p>
          </div>
        </ClaySurface>
      </div>
    </footer>
  )
}
