import Link from 'next/link'
import { exampleSkillHref } from '@/config/site-layout'
import { SectionReveal } from '@/components/motion/section-reveal'
import { SkillsGridMotion } from '@/components/motion/skills-grid-motion'
import { SkillCard } from '@/components/skill-card'
import { ClayBadge, ClayButton, ClaySurface } from '@/components/ui'
import { getAllSkills, skillsRepo } from '@/lib/skills'

export default function HomePage() {
  const skills = getAllSkills()

  return (
    <main className="site-page-shell site-frame site-frame--main relative flex w-full flex-col">
      <SectionReveal delay={20}>
        <section className="clay-surface clay-tone-cream clay-elevation-floating relative overflow-hidden rounded-[1.6rem] p-6 md:p-10">
          <div className="clay-hero-mesh pointer-events-none absolute inset-0 opacity-90" aria-hidden />

          <div className="relative z-10 grid gap-8 lg:grid-cols-[1.24fr_0.76fr]">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.2em] text-clay-muted">
                <span className="icon-[lucide--command] size-3.5" aria-hidden />
                adonis-skills
              </p>

              <h1 className="max-w-3xl text-4xl leading-[1.14] text-balance md:text-6xl">
                Install production-ready skills for your AI agents.
              </h1>

              <p className="mt-5 max-w-4xl text-sm leading-7 text-clay-muted md:text-base">
                Browse practical skills, pick a slug, and install with one command. Each skill is reusable in real
                workflows.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-2.5">
                <ClayBadge tone="peach" withDot>
                  Repo: {skillsRepo}
                </ClayBadge>
                <ClayBadge tone="cream" withDot>
                  Skills: {skills.length}
                </ClayBadge>
              </div>

              <div className="mt-7 flex flex-wrap items-center gap-3">
                <ClayButton asChild>
                  <Link href={`https://github.com/${skillsRepo}`} target="_blank" rel="noreferrer">
                    <span className="icon-[lucide--github] size-4" aria-hidden />
                    Open GitHub
                  </Link>
                </ClayButton>

                <ClayButton asChild variant="ghost">
                  <Link href={exampleSkillHref}>
                    <span className="icon-[lucide--arrow-up-right] size-4" aria-hidden />
                    View Example Skill
                  </Link>
                </ClayButton>
              </div>
            </div>

            <ClaySurface tone="base" elevation="inset" className="rounded-[1.2rem] p-5 md:p-6">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.17em] text-clay-muted">Install Pattern</p>
              <code className="block overflow-x-auto rounded-xl border border-border/60 bg-background/55 px-3 py-3 text-xs leading-6 text-foreground md:text-[13px]">
                npx skills add {skillsRepo} --skill &lt;slug&gt;
              </code>

              <div className="mt-4 space-y-2 text-xs leading-6 text-clay-muted md:text-sm">
                <p>1. Choose a skill slug.</p>
                <p>2. Run the install command.</p>
                <p>3. Use the skill in your agent workflow.</p>
              </div>
            </ClaySurface>
          </div>
        </section>
      </SectionReveal>

      <SectionReveal delay={130} className="mt-8 md:mt-10">
        <section>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="mb-1.5 font-mono text-xs uppercase tracking-[0.16em] text-clay-muted">Library</p>
              <h2 className="text-3xl md:text-4xl">Skill Library</h2>
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
