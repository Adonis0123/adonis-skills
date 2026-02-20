import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SectionReveal } from '@/components/motion/section-reveal'
import { CopyInstallCommandButton } from '@/components/copy-install-command'
import { ClayBadge, ClayButton, ClayCard, ClayCardContent, ClayCardHeader, ClaySurface } from '@/components/ui'
import { getAllSkills, getSkillBySlug, getSkillSourceUrl } from '@/lib/skills'

interface SkillPageProps {
  params: Promise<{ slug: string }>
}

export async function generateStaticParams() {
  return getAllSkills().map(skill => ({ slug: skill.slug }))
}

export async function generateMetadata({ params }: SkillPageProps): Promise<Metadata> {
  const { slug } = await params
  const skill = getSkillBySlug(slug)

  if (!skill)
    return { title: 'Skill Not Found' }

  return {
    title: skill.name,
    description: skill.description,
  }
}

export default async function SkillDetailPage({ params }: SkillPageProps) {
  const { slug } = await params
  const skill = getSkillBySlug(slug)

  if (!skill)
    notFound()

  const sourceUrl = getSkillSourceUrl(skill.slug)

  return (
    <main className="site-page-shell site-frame site-frame--detail w-full">
      <SectionReveal delay={20}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <ClayButton asChild variant="ghost" size="sm">
            <Link href="/">
              <span className="icon-[lucide--arrow-left] size-4" aria-hidden />
              Back to Skills
            </Link>
          </ClayButton>

          <ClayBadge tone="neutral" className="font-mono">
            /skills/{skill.slug}
          </ClayBadge>
        </div>
      </SectionReveal>

      <SectionReveal delay={110}>
        <ClayCard tone="base" elevation="floating" className="gap-6 rounded-[1.6rem] p-6 md:p-9">
          <ClayCardHeader className="gap-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <ClayBadge tone="peach" className="font-mono">{skill.slug}</ClayBadge>
              {skill.metadata?.version && <ClayBadge tone="peach">Version {skill.metadata.version}</ClayBadge>}
              {skill.metadata?.author && <ClayBadge tone="cream">Author {skill.metadata.author}</ClayBadge>}
            </div>

            <h1 className="font-heading text-4xl leading-tight text-foreground md:text-5xl">{skill.name}</h1>
            <p className="max-w-4xl text-sm leading-7 text-clay-muted md:text-base">{skill.description}</p>
          </ClayCardHeader>

          <ClayCardContent className="grid gap-4">
            <ClaySurface tone="base" elevation="inset" className="rounded-[1.1rem] p-5 md:p-6">
              <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-clay-muted">Install</p>
              <code className="block overflow-x-auto rounded-xl border border-border/60 bg-background/55 px-3 py-3 text-xs leading-6 text-foreground md:text-sm">
                {skill.installCommand}
              </code>

              <div className="mt-4">
                <CopyInstallCommandButton command={skill.installCommand} />
              </div>
            </ClaySurface>

            <div className="grid gap-4 md:grid-cols-2">
              <ClaySurface tone="base" elevation="inset" className="rounded-[1rem] p-4">
                <p className="mb-1.5 font-medium">Package Structure</p>
                <p className="text-sm text-clay-muted">references: {skill.files.hasReferences ? 'yes' : 'no'}</p>
                <p className="text-sm text-clay-muted">src: {skill.files.hasSrc ? 'yes' : 'no'}</p>
              </ClaySurface>

              <ClaySurface tone="base" elevation="inset" className="rounded-[1rem] p-4">
                <p className="mb-1.5 font-medium">Source</p>
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
