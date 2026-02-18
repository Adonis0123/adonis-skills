import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const skillsDir = path.join(root, 'skills')
const outputPath = path.join(root, 'apps/web/src/generated/skills-index.json')
const repo = process.env.SKILLS_REPO || 'adonis0123/adonis-skills'

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match)
    return {}
  return YAML.parse(match[1]) || {}
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  }
  catch {
    return false
  }
}

async function loadSkills() {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true })
  const items = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.'))
      continue

    const slug = entry.name
    const skillRoot = path.join(skillsDir, slug)
    const skillFile = path.join(skillRoot, 'SKILL.md')
    const raw = await fs.readFile(skillFile, 'utf8')
    const frontmatter = parseFrontmatter(raw)
    const metadata = frontmatter.metadata && typeof frontmatter.metadata === 'object'
      ? {
          ...(typeof frontmatter.metadata.author === 'string' ? { author: frontmatter.metadata.author } : {}),
          ...(typeof frontmatter.metadata.version === 'string' ? { version: frontmatter.metadata.version } : {}),
        }
      : undefined

    items.push({
      slug,
      name: frontmatter.name || slug,
      description: frontmatter.description || '',
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      installCommand: `npx skills add ${repo} --skill ${slug}`,
      files: {
        hasReferences: await exists(path.join(skillRoot, 'references')),
        hasSrc: await exists(path.join(skillRoot, 'src')),
      },
    })
  }

  return items.sort((a, b) => a.slug.localeCompare(b.slug))
}

async function main() {
  const data = await loadSkills()
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  console.log(`Generated ${data.length} skills -> ${outputPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
