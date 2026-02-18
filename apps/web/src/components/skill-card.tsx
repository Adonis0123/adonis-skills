import Link from 'next/link'
import type { SkillIndexItem } from '@/lib/skills'

interface SkillCardProps {
  skill: SkillIndexItem
}

export function SkillCard({ skill }: SkillCardProps) {
  return (
    <Link
      href={`/skills/${skill.slug}`}
      className="group rounded-2xl border border-black/10 bg-[var(--card)] p-5 shadow-[0_8px_24px_rgba(0,0,0,0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_28px_rgba(0,0,0,0.12)]"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--ink)]">{skill.name}</h2>
        <span className="rounded-full border border-black/15 px-2 py-1 font-mono text-[11px] text-[var(--ink-soft)]">{skill.slug}</span>
      </div>
      <p className="mb-4 line-clamp-3 text-sm leading-6 text-[var(--ink-soft)]">{skill.description}</p>
      <div className="flex items-center gap-2 text-[11px]">
        <span className="rounded-full border border-black/15 px-2 py-1">{skill.files.hasReferences ? '含 references' : '无 references'}</span>
        <span className="rounded-full border border-black/15 px-2 py-1">{skill.files.hasSrc ? '含 src' : '无 src'}</span>
      </div>
    </Link>
  )
}
