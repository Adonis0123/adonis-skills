import assert from 'node:assert/strict'
import test from 'node:test'

import { collectNewSkillSlugsFromStatus } from '../finalize-new-skills.ts'

test('detects a new skill when SKILL.md is untracked', () => {
  const rawStatus = [
    '?? skills/new-skill/SKILL.md',
    '?? skills/new-skill/references/guide.md',
  ].join('\n')

  const slugs = collectNewSkillSlugsFromStatus(rawStatus)
  assert.deepEqual(slugs, ['new-skill'])
})

test('detects a new skill when SKILL.md is staged as added', () => {
  const rawStatus = [
    'A  skills/alpha-skill/SKILL.md',
    'A  skills/alpha-skill/references/examples.md',
  ].join('\n')

  const slugs = collectNewSkillSlugsFromStatus(rawStatus)
  assert.deepEqual(slugs, ['alpha-skill'])
})

test('does not treat existing skills as new when only non-SKILL.md files are added', () => {
  const rawStatus = [
    'A  skills/existing-skill/references/new-note.md',
    '?? skills/existing-skill/assets/demo.png',
  ].join('\n')

  const slugs = collectNewSkillSlugsFromStatus(rawStatus)
  assert.deepEqual(slugs, [])
})

test('returns unique sorted skill slugs', () => {
  const rawStatus = [
    '?? skills/zeta-skill/SKILL.md',
    'A  skills/alpha-skill/SKILL.md',
    '?? skills/zeta-skill/references/readme.md',
    'A  skills/alpha-skill/references/readme.md',
  ].join('\n')

  const slugs = collectNewSkillSlugsFromStatus(rawStatus)
  assert.deepEqual(slugs, ['alpha-skill', 'zeta-skill'])
})

test('does not infer slug from directory-only untracked status line', () => {
  const rawStatus = '?? skills/'

  const slugs = collectNewSkillSlugsFromStatus(rawStatus)
  assert.deepEqual(slugs, [])
})
