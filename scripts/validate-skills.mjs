import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import YAML from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const skillsDir = path.join(root, 'skills')
const agentsSkillsDir = path.join(root, '.agents/skills')

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match)
    return null

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

async function main() {
  const entries = await fs.readdir(skillsDir, { withFileTypes: true })
  const errors = []

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.endsWith('-workspace'))
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

    if (typeof frontmatter.name !== 'string' || !frontmatter.name.trim()) {
      errors.push(`[${entry.name}] frontmatter.name 不能为空`)
    }
    else if (frontmatter.name !== entry.name) {
      // Directory slug is the public skill id; name must match for install/index.
      errors.push(
        `[${entry.name}] frontmatter.name (${frontmatter.name}) 必须与目录名一致`,
      )
    }
    else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name)) {
      errors.push(`[${entry.name}] frontmatter.name 必须是 lowercase hyphen-case`)
    }

    if (typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) {
      errors.push(`[${entry.name}] frontmatter.description 不能为空`)
    }
    else {
      const description = frontmatter.description.trim()
      if (description.length < 20) {
        errors.push(`[${entry.name}] frontmatter.description 过短（至少 20 字符，供工具选择器展示）`)
      }
    }

    if (typeof frontmatter.metadata !== 'object' || frontmatter.metadata === null || Array.isArray(frontmatter.metadata))
      errors.push(`[${entry.name}] frontmatter.metadata 必须是一个对象`)
    else if (typeof frontmatter.metadata.author !== 'string' || !frontmatter.metadata.author.trim())
      errors.push(`[${entry.name}] frontmatter.metadata.author 不能为空`)

    // Mirror guard scope is intentionally narrow:
    // only enforce the reserved pages-router placeholder that is required by SKILL.md.
    // This is not a full directory diff between skills/ and .agents/skills.
    const reservedTemplateFile = path.join(skillPath, 'assets/templates/pages-router/_reserved.tpl')
    const agentSkillPath = path.join(agentsSkillsDir, entry.name)
    const agentReservedTemplateFile = path.join(agentSkillPath, 'assets/templates/pages-router/_reserved.tpl')

    if (
      await exists(reservedTemplateFile)
      && await exists(agentSkillPath)
      && !await exists(agentReservedTemplateFile)
    ) {
      errors.push(`[${entry.name}] .agents 镜像缺少文件: ${agentReservedTemplateFile}`)
    }
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
