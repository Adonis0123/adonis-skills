import { Trans } from '@lingui/react/macro'
import { exampleSkillHref } from '@/config/site-layout'
import { SectionReveal } from '@/components/motion/section-reveal'
import { ClayBadge, ClayButton, ClaySurface } from '@/components/ui'
import { LocaleLink } from '@/i18n/locale-link'

export default function NotFoundPage() {
  return (
    <main className="site-page-shell site-frame site-frame--narrow flex min-h-[52vh] w-full items-center">
      <SectionReveal className="w-full" delay={20}>
        <ClaySurface tone="peach" elevation="floating" className="w-full rounded-[1.6rem] p-8 text-center md:p-12">
          <ClayBadge tone="neutral" className="mb-4 font-mono">404</ClayBadge>
          <h1 className="text-4xl md:text-5xl"><Trans id="notFound.title">Skill Not Found</Trans></h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-clay-muted md:text-base">
            <Trans id="notFound.description">Check the slug and browse available skills from the library.</Trans>
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <ClayButton asChild>
              <LocaleLink href="/">
                <span className="icon-[lucide--house] size-4" aria-hidden />
                <Trans id="notFound.cta.home">Back to Home</Trans>
              </LocaleLink>
            </ClayButton>
            <ClayButton asChild variant="ghost">
              <LocaleLink href={exampleSkillHref}>
                <span className="icon-[lucide--eye] size-4" aria-hidden />
                <Trans id="notFound.cta.example">View Example Skill</Trans>
              </LocaleLink>
            </ClayButton>
          </div>
        </ClaySurface>
      </SectionReveal>
    </main>
  )
}
