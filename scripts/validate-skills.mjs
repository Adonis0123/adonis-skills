import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const skillsDir = path.join(root, 'skills')

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match)
    return null

  return YAML.parse(match[1]) || {}
}

async function main() {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true })
  const errors = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.'))
      continue

    const skillPath = path.join(skillsDir, entry.name)
    const skillFile = path.join(skillPath, 'SKILL.md')

    let content
    try {
      content = await fs.readFile(skillFile, 'utf8')
    }
    catch {
      errors.push(`[${entry.name}] 缺少 SKILL.md`)
      continue
    }

    const frontmatter = parseFrontmatter(content)
    if (!frontmatter) {
      errors.push(`[${entry.name}] SKILL.md 缺少 frontmatter`)
      continue
    }

    if (typeof frontmatter.name !== 'string' || !frontmatter.name.trim())
      errors.push(`[${entry.name}] frontmatter.name 不能为空`)

    if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim())
      errors.push(`[${entry.name}] frontmatter.description 不能为空`)
  }

  if (errors.length > 0) {
    console.error('Skills 校验失败:')
    for (const error of errors)
      console.error(`- ${error}`)
    process.exit(1)
  }

  console.log('Skills 校验通过')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
