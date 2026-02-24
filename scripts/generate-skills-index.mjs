import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const skillsDir = path.join(root, 'skills')
const listOutputPath = path.join(root, 'apps/web/src/generated/skills-index-lite.json')
const detailOutputPath = path.join(root, 'apps/web/src/generated/skills-detail-index.json')

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match)
    return {}
  return YAML.parse(match[1]) || {}
}

function parseSections(content) {
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/)
  const body = bodyMatch ? bodyMatch[1].trim() : ''
  if (!body)
    return []

  const lines = body.split('\n')
  const sections = []
  let currentHeading = undefined
  let currentLevel = undefined
  let currentLines = []

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (headingMatch) {
      const raw = currentLines.join('\n').trim()
      if (raw) {
        const section = { raw }
        if (currentHeading !== undefined) {
          section.heading = currentHeading
          section.level = currentLevel
        }
        sections.push(section)
      }
      currentHeading = headingMatch[2].trim()
      currentLevel = headingMatch[1].length
      currentLines = []
    }
    else {
      currentLines.push(line)
    }
  }

  const raw = currentLines.join('\n').trim()
  if (raw) {
    const section = { raw }
    if (currentHeading !== undefined) {
      section.heading = currentHeading
      section.level = currentLevel
    }
    sections.push(section)
  }

  return sections
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
  const listItems = []
  const detailItems = []

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

    let updatedAt
    try {
      const gitOut = execFileSync(
        'git',
        ['log', '-1', '--format=%ci', '--', `skills/${slug}/`],
        { cwd: root, encoding: 'utf8' },
      ).trim()
      updatedAt = gitOut ? new Date(gitOut).toISOString() : undefined
    }
    catch {
      updatedAt = undefined
    }

    const allowedToolsRaw = frontmatter['allowed-tools']
    const allowedTools = typeof allowedToolsRaw === 'string'
      ? allowedToolsRaw.split(',').map(t => t.trim()).filter(Boolean)
      : undefined

    const sections = parseSections(raw)

    listItems.push({
      slug,
      name: frontmatter.name || slug,
      description: frontmatter.description || '',
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
      files: {
        hasReferences: await exists(path.join(skillRoot, 'references')),
        hasSrc: await exists(path.join(skillRoot, 'src')),
      },
      ...(updatedAt ? { updatedAt } : {}),
      ...(allowedTools?.length ? { allowedTools } : {}),
    })

    detailItems.push({
      slug,
      ...(sections.length > 0 ? { sections } : {}),
    })
  }

  return {
    listItems: listItems.sort((a, b) => a.slug.localeCompare(b.slug)),
    detailItems: detailItems.sort((a, b) => a.slug.localeCompare(b.slug)),
  }
}

async function main() {
  const { listItems, detailItems } = await loadSkills()
  await fs.mkdir(path.dirname(listOutputPath), { recursive: true })
  await fs.writeFile(listOutputPath, `${JSON.stringify(listItems, null, 2)}\n`, 'utf8')
  await fs.writeFile(detailOutputPath, `${JSON.stringify(detailItems, null, 2)}\n`, 'utf8')
  console.log(`Generated ${listItems.length} skills -> ${listOutputPath}, ${detailOutputPath}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
