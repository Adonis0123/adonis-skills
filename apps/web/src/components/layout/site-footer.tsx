import Link from 'next/link'
import { siteLayoutConfig } from '@/config/site-layout'
import { SiteBrand } from '@/components/layout/site-brand'
import { ClaySurface } from '@/components/ui'

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

  return (
    <footer className="safe-area-bottom mt-10 md:mt-12">
      <div className="site-frame site-frame--wide">
        <ClaySurface tone="base" elevation="raised" className="rounded-[1.3rem] p-5 md:p-7">
          <div className="grid gap-8 md:grid-cols-[1.2fr_0.8fr]">
            <section>
              <SiteBrand variant="footer" brand={brand} />

              <p className="mt-4 max-w-xl text-sm leading-7 text-clay-muted">{brand.tagline}</p>
              <p className="mt-3 font-mono text-[11px] text-clay-muted">npx skills add {repo} --skill &lt;slug&gt;</p>
            </section>

            <section className="grid gap-6 sm:grid-cols-2">
              {footerGroups.map(group => (
                <div key={group.title}>
                  <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-clay-muted">{group.title}</h2>
                  <ul className="mt-3 space-y-2">
                    {group.links.map(link => (
                      <li key={`${group.title}-${link.label}`}>
                        <Link
                          href={link.href}
                          className="clay-focus-ring inline-flex items-center gap-1.5 rounded-md text-sm text-clay-muted transition hover:text-foreground"
                          {...getLinkProps(link.external)}
                        >
                          <span>{link.label}</span>
                          {link.external && <span className="icon-[lucide--external-link] size-3.5" aria-hidden />}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border/72 pt-4 text-xs text-clay-muted md:text-sm">
            <p>© {year} {brand.name}. All rights reserved.</p>
            <p>Built with Next.js and Soft 3D Claymorphism.</p>
          </div>
        </ClaySurface>
      </div>
    </footer>
  )
}
