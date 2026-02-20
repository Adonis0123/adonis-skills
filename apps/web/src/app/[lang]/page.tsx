import Link from 'next/link'
import { Trans } from '@lingui/react/macro'
import { exampleSkillHref } from '@/config/site-layout'
import { SectionReveal } from '@/components/motion/section-reveal'
import { SkillsGridMotion } from '@/components/motion/skills-grid-motion'
import { SkillCard } from '@/components/skill-card'
import { ClayBadge, ClayButton, ClaySurface } from '@/components/ui'
import { initPageLingui } from '@/i18n/initLingui'
import { LocaleLink } from '@/i18n/locale-link'
import { getAllSkills, skillsRepo } from '@/lib/skills'

interface HomePageProps {
  params: Promise<{ lang: string }>
}

export default async function HomePage({ params }: HomePageProps) {
  await initPageLingui(params)
  const skills = getAllSkills()
  const skillsCount = skills.length

  return (
    <main className="site-page-shell site-frame site-frame--main relative flex w-full flex-col">
      <SectionReveal delay={20}>
        <section className="clay-surface clay-tone-cream clay-elevation-floating relative overflow-hidden rounded-[1.35rem] p-5 sm:p-6 md:rounded-[1.6rem] md:p-10">
          <div className="clay-hero-mesh pointer-events-none absolute inset-0 opacity-90" aria-hidden />

          <div className="relative z-10 grid gap-6 md:gap-8 lg:grid-cols-[1.24fr_0.76fr]">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-clay-muted">
                <span className="icon-[lucide--command] size-3.5" aria-hidden />
                adonis-skills
              </p>

              <h1 className="max-w-3xl text-3xl leading-[1.16] text-balance sm:text-4xl md:text-6xl">
                <Trans id="home.hero.title">Install production-ready skills for your AI agents.</Trans>
              </h1>

              <p className="mt-4 max-w-4xl text-sm leading-6 text-clay-muted sm:mt-5 md:text-base md:leading-7">
                <Trans id="home.hero.description">
                  Browse practical skills, pick a slug, and install with one command. Each skill is reusable in real
                  workflows.
                </Trans>
              </p>

              <div className="mt-6 grid w-full max-w-[30rem] grid-cols-1 gap-3 sm:mt-6 sm:max-w-none sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2.5">
                <ClayBadge
                  tone="blue"
                  withDot
                  className="w-full justify-start text-left text-[11px] leading-5 [overflow-wrap:anywhere] sm:w-auto sm:text-xs"
                >
                  <Trans id="home.badge.repo">Repo: {skillsRepo}</Trans>
                </ClayBadge>
                <ClayBadge tone="neutral" withDot className="w-full justify-start px-3.5 py-1 text-[11px] sm:w-auto sm:text-xs">
                  <Trans id="home.badge.skills">Skills: {skillsCount}</Trans>
                </ClayBadge>
              </div>

              <div className="mt-6 flex flex-col gap-2.5 sm:mt-7 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                <ClayButton asChild>
                  <Link
                    href={`https://github.com/${skillsRepo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full justify-center sm:w-auto"
                  >
                    <span className="icon-[lucide--github] size-4" aria-hidden />
                    <Trans id="home.cta.github">Open GitHub</Trans>
                  </Link>
                </ClayButton>

                <ClayButton asChild variant="ghost">
                  <LocaleLink href={exampleSkillHref} className="w-full justify-center sm:w-auto">
                    <span className="icon-[lucide--arrow-up-right] size-4" aria-hidden />
                    <Trans id="home.cta.example">View Example Skill</Trans>
                  </LocaleLink>
                </ClayButton>
              </div>
            </div>

            <ClaySurface tone="base" elevation="inset" className="rounded-[1.08rem] p-4 sm:p-5 md:rounded-[1.2rem] md:p-6">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.17em] text-clay-muted">
                <Trans id="home.install.title">Install Pattern</Trans>
              </p>
              <code className="block overflow-x-auto rounded-xl border border-border/60 bg-background/55 px-3 py-3 text-[11px] leading-5 text-foreground sm:text-xs sm:leading-6 md:text-[13px]">
                npx skills add {skillsRepo} --skill &lt;slug&gt;
              </code>

              <div className="mt-3.5 space-y-1.5 text-xs leading-6 text-clay-muted md:mt-4 md:space-y-2 md:text-sm">
                <p><Trans id="home.install.step1">1. Choose a skill slug.</Trans></p>
                <p><Trans id="home.install.step2">2. Run the install command.</Trans></p>
                <p><Trans id="home.install.step3">3. Use the skill in your agent workflow.</Trans></p>
              </div>
            </ClaySurface>
          </div>
        </section>
      </SectionReveal>

      <SectionReveal delay={130} className="mt-8 md:mt-10">
        <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-1.5 font-mono text-xs uppercase tracking-[0.16em] text-clay-muted">
                <Trans id="home.library.kicker">Library</Trans>
              </p>
              <h2 className="text-3xl md:text-4xl"><Trans id="home.library.title">Skill Library</Trans></h2>
            </div>

            <ClaySurface tone="base" elevation="inset" className="rounded-[1rem] px-4 py-2.5">
              <p className="font-mono text-[11px] text-clay-muted md:text-xs">npx skills add {skillsRepo} --skill &lt;slug&gt;</p>
            </ClaySurface>
          </div>

          <SkillsGridMotion>
            {skills.map(skill => (
              <SkillCard key={skill.slug} skill={skill} />
            ))}
          </SkillsGridMotion>
        </section>
      </SectionReveal>
    </main>
  )
}
