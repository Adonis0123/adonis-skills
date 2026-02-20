import type { Metadata } from 'next'
import { Trans } from '@lingui/react/macro'
import { notFound } from 'next/navigation'
import { SectionReveal } from '@/components/motion/section-reveal'
import { CopyInstallCommandButton } from '@/components/copy-install-command'
import { ClayBadge, ClayCard, ClayCardContent, ClayCardHeader, ClaySurface } from '@/components/ui'
import { SUPPORTED_LOCALES } from '@/i18n/config'
import { withLocalePath } from '@/i18n/href'
import { initLingui, initPageLingui } from '@/i18n/initLingui'
import { LocaleLink } from '@/i18n/locale-link'
import { getAllSkills, getSkillBySlug, getSkillSourceUrl } from '@/lib/skills'

interface SkillPageProps {
  params: Promise<{ lang: string, slug: string }>
}

export async function generateStaticParams() {
  const skills = getAllSkills()
  return SUPPORTED_LOCALES.flatMap(lang => skills.map(skill => ({ lang, slug: skill.slug })))
}

export async function generateMetadata({ params }: SkillPageProps): Promise<Metadata> {
  const locale = await initPageLingui(params)
  const i18n = initLingui(locale)
  const { slug } = await params
  const skill = getSkillBySlug(slug)

  if (!skill)
    return {
      title: i18n._({
        id: 'skillDetail.meta.notFoundTitle',
        message: 'Skill Not Found',
      }),
    }

  return {
    title: skill.name,
    description: skill.description,
  }
}

export default async function SkillDetailPage({ params }: SkillPageProps) {
  const locale = await initPageLingui(params)
  const i18n = initLingui(locale)
  const { slug } = await params
  const skill = getSkillBySlug(slug)
  const yesText = i18n._({
    id: 'common.yes',
    message: 'yes',
  })
  const noText = i18n._({
    id: 'common.no',
    message: 'no',
  })

  if (!skill)
    notFound()

  const sourceUrl = getSkillSourceUrl(skill.slug)

  return (
    <main className="site-page-shell site-frame site-frame--detail w-full">
      <SectionReveal delay={20}>
        <div className="mb-5 inline-flex w-full max-w-full flex-col gap-2.5 rounded-[1.05rem] border border-border/65 bg-background/45 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-3.5">
          <LocaleLink
            href="/"
            className="clay-focus-ring inline-flex items-center gap-1.5 rounded-full px-1.5 py-1 text-sm font-semibold text-[#6d88ba] transition-colors hover:text-[#5875ad]"
          >
            <span className="icon-[lucide--arrow-left] size-3.5" aria-hidden />
            <Trans id="skillDetail.cta.back">Back to Skills</Trans>
          </LocaleLink>

          <ClayBadge tone="neutral" className="max-w-full self-start px-3.5 py-1.5 font-mono text-[12px] tracking-[0.01em] text-[#506995]">
            {withLocalePath(`/skills/${skill.slug}`, locale)}
          </ClayBadge>
        </div>
      </SectionReveal>

      <SectionReveal delay={110}>
        <ClayCard tone="base" elevation="floating" className="gap-6 rounded-[1.6rem] p-6 md:p-9">
          <ClayCardHeader className="gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <ClayBadge tone="peach" className="font-mono">{skill.slug}</ClayBadge>
              {skill.metadata?.version && (
                <ClayBadge tone="peach">
                  <Trans id="skillDetail.badge.version">Version {skill.metadata.version}</Trans>
                </ClayBadge>
              )}
              {skill.metadata?.author && (
                <ClayBadge tone="cream">
                  <Trans id="skillDetail.badge.author">Author {skill.metadata.author}</Trans>
                </ClayBadge>
              )}
            </div>

            <h1 className="font-heading text-4xl leading-tight text-foreground md:text-5xl">{skill.name}</h1>
            <p className="max-w-4xl text-sm leading-7 text-clay-muted md:text-base">{skill.description}</p>
          </ClayCardHeader>

          <ClayCardContent className="grid gap-4">
            <ClaySurface tone="base" elevation="inset" className="rounded-[1.1rem] p-5 md:p-6">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-clay-muted">
                <Trans id="skillDetail.install.title">Install</Trans>
              </p>
              <code className="block overflow-x-auto rounded-xl border border-border/60 bg-background/55 px-3 py-3 text-xs leading-6 text-foreground md:text-sm">
                {skill.installCommand}
              </code>

              <div className="mt-4">
                <CopyInstallCommandButton command={skill.installCommand} />
              </div>
            </ClaySurface>

            <div className="grid gap-4 md:grid-cols-2">
              <ClaySurface tone="base" elevation="inset" className="rounded-[1rem] p-4">
                <p className="mb-1.5 font-medium"><Trans id="skillDetail.package.title">Package Structure</Trans></p>
                <p className="text-sm text-clay-muted">
                  <Trans id="skillDetail.package.references">
                    references: {skill.files.hasReferences ? yesText : noText}
                  </Trans>
                </p>
                <p className="text-sm text-clay-muted">
                  <Trans id="skillDetail.package.src">
                    src: {skill.files.hasSrc ? yesText : noText}
                  </Trans>
                </p>
              </ClaySurface>

              <ClaySurface tone="base" elevation="inset" className="rounded-[1rem] p-4">
                <p className="mb-1.5 font-medium"><Trans id="skillDetail.source.title">Source</Trans></p>
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-clay-muted underline underline-offset-4 transition hover:text-foreground"
                >
                  {sourceUrl}
                  <span className="icon-[lucide--external-link] size-3.5" aria-hidden />
                </a>
              </ClaySurface>
            </div>
          </ClayCardContent>
        </ClayCard>
      </SectionReveal>
    </main>
  )
}
