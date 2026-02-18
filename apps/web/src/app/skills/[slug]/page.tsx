import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CopyInstallCommandButton } from '@/components/copy-install-command'
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
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-10 md:px-10">
      <Link href="/" className="mb-5 inline-flex text-sm text-[var(--ink-soft)] transition hover:text-[var(--ink)]">
        ← 返回列表
      </Link>

      <section className="rounded-3xl border border-black/10 bg-[var(--card)] p-7 shadow-[0_16px_40px_rgba(0,0,0,0.07)] md:p-10">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-black/15 px-3 py-1 font-mono text-xs">{skill.slug}</span>
          {skill.metadata?.version && <span className="rounded-full border border-black/15 px-3 py-1 text-xs">版本 {skill.metadata.version}</span>}
          {skill.metadata?.author && <span className="rounded-full border border-black/15 px-3 py-1 text-xs">作者 {skill.metadata.author}</span>}
        </div>

        <h1 className="mb-4 text-3xl font-semibold leading-tight md:text-4xl">{skill.name}</h1>
        <p className="mb-6 text-sm leading-7 text-[var(--ink-soft)] md:text-base">{skill.description}</p>

        <div className="mb-6 rounded-2xl border border-black/10 bg-black p-4 text-amber-100">
          <p className="mb-2 font-mono text-xs uppercase tracking-[0.18em] text-amber-200">Install</p>
          <code className="block overflow-x-auto font-mono text-sm">{skill.installCommand}</code>
          <div className="mt-4">
            <CopyInstallCommandButton command={skill.installCommand} />
          </div>
        </div>

        <div className="grid gap-3 text-sm md:grid-cols-2">
          <div className="rounded-xl border border-black/10 p-4">
            <p className="mb-1 font-medium">目录结构</p>
            <p className="text-[var(--ink-soft)]">references: {skill.files.hasReferences ? '有' : '无'}</p>
            <p className="text-[var(--ink-soft)]">src: {skill.files.hasSrc ? '有' : '无'}</p>
          </div>
          <div className="rounded-xl border border-black/10 p-4">
            <p className="mb-1 font-medium">源码位置</p>
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--ink-soft)] underline underline-offset-3 transition hover:text-[var(--ink)]"
            >
              {sourceUrl}
            </a>
          </div>
        </div>
      </section>
    </main>
  )
}
