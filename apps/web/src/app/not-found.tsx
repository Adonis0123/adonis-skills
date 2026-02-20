import Link from 'next/link'
import { exampleSkillHref } from '@/config/site-layout'
import { SectionReveal } from '@/components/motion/section-reveal'
import { ClayBadge, ClayButton, ClaySurface } from '@/components/ui'

export default function NotFoundPage() {
  return (
    <main className="site-page-shell site-frame site-frame--narrow flex min-h-[52vh] w-full items-center">
      <SectionReveal className="w-full" delay={20}>
        <ClaySurface tone="peach" elevation="floating" className="w-full rounded-[1.6rem] p-8 text-center md:p-12">
          <ClayBadge tone="neutral" className="mb-4 font-mono">404</ClayBadge>
          <h1 className="text-4xl md:text-5xl">Skill Not Found</h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-clay-muted md:text-base">
            Check the slug and browse available skills from the library.
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <ClayButton asChild>
              <Link href="/">
                <span className="icon-[lucide--house] size-4" aria-hidden />
                Back to Home
              </Link>
            </ClayButton>
            <ClayButton asChild variant="ghost">
              <Link href={exampleSkillHref}>
                <span className="icon-[lucide--eye] size-4" aria-hidden />
                View Example Skill
              </Link>
            </ClayButton>
          </div>
        </ClaySurface>
      </SectionReveal>
    </main>
  )
}
