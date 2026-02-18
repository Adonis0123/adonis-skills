import Link from 'next/link'

export default function NotFoundPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 text-center">
      <p className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-[var(--ink-soft)]">404</p>
      <h1 className="mb-4 text-3xl font-semibold">Skill 未找到</h1>
      <p className="mb-6 text-sm text-[var(--ink-soft)]">请确认 slug 是否正确，或返回首页查看当前可用技能列表。</p>
      <Link href="/" className="rounded-xl border border-black/15 px-4 py-2 text-sm transition hover:bg-black/5">
        返回首页
      </Link>
    </main>
  )
}
