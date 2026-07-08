import assert from 'node:assert/strict'
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { loadAvailableSkills, runWithPreservedSkillsLock, syncLlmSkills } from '../install-local-skills.ts'

async function withTempRepo(run: (repoRoot: string) => Promise<void>) {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), 'install-local-skills-'))
  try {
    await run(repoRoot)
  } finally {
    await rm(repoRoot, { recursive: true, force: true })
  }
}

async function writeSkill(repoRoot: string, slug: string) {
  const skillDir = path.join(repoRoot, 'skills', slug)
  await mkdir(skillDir, { recursive: true })
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    `---\nname: ${slug}\ndescription: Test skill\n---\n\n# ${slug}\n`,
    'utf8',
  )
}

test('loadAvailableSkills skips workspace directories without SKILL.md', async () => {
  await withTempRepo(async (repoRoot) => {
    await writeSkill(repoRoot, 'alpha-skill')
    await mkdir(path.join(repoRoot, 'skills', 'code-plugin-architecture-workspace', 'iteration-1'), {
      recursive: true,
    })

    const slugs = await loadAvailableSkills(repoRoot)

    assert.deepEqual(slugs, ['alpha-skill'])
  })
})

test('loadAvailableSkills still rejects malformed public skill directories', async () => {
  await withTempRepo(async (repoRoot) => {
    await writeSkill(repoRoot, 'alpha-skill')
    await mkdir(path.join(repoRoot, 'skills', 'broken-skill'), { recursive: true })

    await assert.rejects(
      () => loadAvailableSkills(repoRoot),
      /\[broken-skill\] Missing SKILL\.md/,
    )
  })
})

test('syncLlmSkills ensures .claude/skills symlink points to .agents/skills', async () => {
  await withTempRepo(async (repoRoot) => {
    await mkdir(path.join(repoRoot, '.agents', 'skills'), { recursive: true })

    await syncLlmSkills(repoRoot, false)

    const stats = await lstat(path.join(repoRoot, '.claude', 'skills'))
    assert.equal(stats.isSymbolicLink(), true)
    assert.equal(await readlink(path.join(repoRoot, '.claude', 'skills')), '../.agents/skills')
  })
})

test('runWithPreservedSkillsLock restores an existing skills-lock.json after local install side effects', async () => {
  await withTempRepo(async (repoRoot) => {
    const lockPath = path.join(repoRoot, 'skills-lock.json')
    const originalLock = '{"version":1,"skills":{"commit":{"source":"adonis0123/skills"}}}\n'
    await writeFile(lockPath, originalLock, 'utf8')

    await runWithPreservedSkillsLock(repoRoot, false, async () => {
      await writeFile(lockPath, '{"version":1,"skills":{"commit":{"source":"/tmp/local/skills"}}}\n', 'utf8')
    })

    assert.equal(await readFile(lockPath, 'utf8'), originalLock)
  })
})
