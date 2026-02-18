import Link from 'next/link'
import { SkillCard } from '@/components/skill-card'
import { getAllSkills, skillsRepo } from '@/lib/skills'

export default function HomePage() {
  const skills = getAllSkills()

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-10 md:px-10">
      <section className="mb-10 rounded-3xl border border-black/10 bg-[var(--card)] p-7 shadow-[0_16px_40px_rgba(0,0,0,0.07)] md:p-10">
        <p className="mb-2 font-mono text-xs uppercase tracking-[0.22em] text-[var(--ink-soft)]">adonis-skills</p>
        <h1 className="mb-4 text-3xl font-semibold leading-tight md:text-5xl">我的 Agent Skills 仓库</h1>
        <p className="max-w-3xl text-sm leading-7 text-[var(--ink-soft)] md:text-base">
          这个仓库采用 monorepo 组织：`skills/` 存放技能定义，`apps/web` 提供展示站。当前优先目标是让技能可以被 `npx skills add` 直接安装，同时可视化展示每个技能的内容与来源。
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3 text-xs">
          <span className="rounded-full border border-black/15 px-3 py-1.5 font-mono">仓库: {skillsRepo}</span>
          <span className="rounded-full border border-black/15 px-3 py-1.5">技能数: {skills.length}</span>
          <Link
            href={`https://github.com/${skillsRepo}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-black/15 px-3 py-1.5 transition hover:bg-black/5"
          >
            打开 GitHub
          </Link>
        </div>
      </section>

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">Skills</h2>
          <p className="font-mono text-xs text-[var(--ink-soft)]">npx skills add {skillsRepo} --skill &lt;slug&gt;</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {skills.map(skill => (
            <SkillCard key={skill.slug} skill={skill} />
          ))}
        </div>
      </section>
    </main>
  )
}
