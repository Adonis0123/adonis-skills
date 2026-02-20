import { spawn } from 'node:child_process'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkbox, confirm, input } from '@inquirer/prompts'

const DEFAULT_OUTPUT_PATH = 'skills'
const ALLOWED_RESOURCES = new Set(['scripts', 'references', 'assets'])
const NON_ASCII_REGEX = /[^\x20-\x7E]/u

type CliOptions = {
  description?: string
  examples: boolean
  examplesSpecified: boolean
  name?: string
  nonInteractive: boolean
  path: string
  resources: string[]
  skipIndex: boolean
}

function printHelp() {
  console.log('Usage: node --experimental-strip-types ./scripts/create-skill.ts [options]')
  console.log('')
  console.log('Options:')
  console.log('  --name <slug>              Skill name (hyphen-case)')
  console.log('  --description <text>       English skill description for frontmatter')
  console.log('  --resources <list>         Comma-separated: scripts,references,assets')
  console.log('  --examples                 Create example files for selected resources')
  console.log(`  --path <dir>               Output directory (default: ${DEFAULT_OUTPUT_PATH})`)
  console.log('  --non-interactive          Disable prompts; require --name and --description')
  console.log('  --skip-index               Skip running skills:index after creation')
  console.log('  --help                     Show help')
}

function getOptionValue(args: string[], index: number, key: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${key}`)
  }
  return value
}

function normalizeSkillName(skillName: string): string {
  return skillName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function parseResources(raw: string): string[] {
  const resources = raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

  const deduped = [...new Set(resources)]
  const invalid = deduped.filter(resource => !ALLOWED_RESOURCES.has(resource))
  if (invalid.length > 0) {
    throw new Error(
      `Unknown resource type(s): ${invalid.join(', ')}. Allowed: ${[...ALLOWED_RESOURCES].join(', ')}`,
    )
  }
  return deduped
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    examples: false,
    examplesSpecified: false,
    nonInteractive: false,
    path: DEFAULT_OUTPUT_PATH,
    resources: [],
    skipIndex: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      continue
    }

    if (arg === '--examples') {
      options.examples = true
      options.examplesSpecified = true
      continue
    }

    if (arg === '--non-interactive') {
      options.nonInteractive = true
      continue
    }

    if (arg === '--skip-index') {
      options.skipIndex = true
      continue
    }

    if (arg.startsWith('--name=')) {
      options.name = arg.slice('--name='.length).trim()
      continue
    }

    if (arg === '--name') {
      options.name = getOptionValue(argv, index, '--name').trim()
      index += 1
      continue
    }

    if (arg.startsWith('--description=')) {
      options.description = arg.slice('--description='.length).trim()
      continue
    }

    if (arg === '--description') {
      options.description = getOptionValue(argv, index, '--description').trim()
      index += 1
      continue
    }

    if (arg.startsWith('--resources=')) {
      options.resources = parseResources(arg.slice('--resources='.length))
      continue
    }

    if (arg === '--resources') {
      options.resources = parseResources(getOptionValue(argv, index, '--resources'))
      index += 1
      continue
    }

    if (arg.startsWith('--path=')) {
      options.path = arg.slice('--path='.length).trim() || DEFAULT_OUTPUT_PATH
      continue
    }

    if (arg === '--path') {
      options.path = getOptionValue(argv, index, '--path').trim() || DEFAULT_OUTPUT_PATH
      index += 1
      continue
    }

    if (arg === '--help') {
      printHelp()
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (options.examples && options.resources.length === 0) {
    throw new Error('--examples requires --resources to be set')
  }

  if (options.nonInteractive) {
    if (!options.name) {
      throw new Error('--name is required when using --non-interactive')
    }
    if (!options.description) {
      throw new Error('--description is required when using --non-interactive')
    }
  }

  return options
}

function hasNonAsciiChars(value: string): boolean {
  return NON_ASCII_REGEX.test(value)
}

async function runCommand(options: {
  args: string[]
  command: string
  cwd: string
}) {
  const { args, command, cwd } = options
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'inherit',
    })

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Command failed (${code ?? 'unknown'}): ${command} ${args.join(' ')}`))
    })
  })
}

function escapeYamlSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

async function ensureSkillDoesNotExist(skillDir: string) {
  const existing = await stat(skillDir).catch(() => null)
  if (existing) {
    throw new Error(`Skill directory already exists: ${skillDir}`)
  }
}

async function updateFrontmatterDescription(skillFilePath: string, description: string) {
  const raw = await readFile(skillFilePath, 'utf8')
  const frontmatterMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!frontmatterMatch) {
    throw new Error(`Invalid frontmatter in ${skillFilePath}`)
  }

  const frontmatterBody = frontmatterMatch[1]
  const descriptionLine = `description: '${escapeYamlSingleQuoted(description)}'`
  const nextFrontmatter = /^description:\s.*$/m.test(frontmatterBody)
    ? frontmatterBody.replace(/^description:\s.*$/m, descriptionLine)
    : /^name:\s.*$/m.test(frontmatterBody)
      ? frontmatterBody.replace(/^name:\s.*$/m, `$&\n${descriptionLine}`)
      : `${frontmatterBody}\n${descriptionLine}`

  const nextRaw = raw.replace(/^---\r?\n[\s\S]*?\r?\n---/, `---\n${nextFrontmatter}\n---`)
  await writeFile(skillFilePath, nextRaw, 'utf8')
}

async function resolveInputs(cliOptions: CliOptions): Promise<{
  description: string
  examples: boolean
  name: string
  resources: string[]
}> {
  let name = cliOptions.name ?? ''
  let description = cliOptions.description ?? ''
  let resources = [...cliOptions.resources]
  let examples = cliOptions.examples

  if (!cliOptions.nonInteractive) {
    if (!name) {
      name = await input({
        message: 'Skill name (hyphen-case)',
        required: true,
      })
    }

    if (!description) {
      description = await input({
        message: 'Skill description in English (ASCII only, frontmatter.description)',
        required: true,
      })
    }

    if (resources.length === 0) {
      resources = await checkbox({
        message: 'Select optional resource directories',
        choices: [
          { name: 'scripts/', value: 'scripts' },
          { name: 'references/', value: 'references' },
          { name: 'assets/', value: 'assets' },
        ],
        loop: false,
      })
    }

    if (resources.length > 0 && !cliOptions.examplesSpecified) {
      examples = await confirm({
        message: 'Create example files in selected resources?',
        default: false,
      })
    }
  }

  const normalizedName = normalizeSkillName(name)
  if (!normalizedName) {
    throw new Error('Skill name must contain at least one letter or digit')
  }

  const normalizedDescription = description.trim()

  if (!normalizedDescription) {
    throw new Error('Description cannot be empty')
  }

  if (hasNonAsciiChars(normalizedDescription)) {
    throw new Error('Description must be English-only (ASCII characters only)')
  }

  if (resources.length === 0) {
    examples = false
  }

  return {
    description: normalizedDescription,
    examples,
    name: normalizedName,
    resources,
  }
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2))
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')
  const initScriptPath = path.resolve(
    repoRoot,
    '.agents/skills/repo-skill-creator/scripts/init_skill.py',
  )
  const quickValidatePath = path.resolve(
    repoRoot,
    '.agents/skills/repo-skill-creator/scripts/quick_validate.py',
  )

  await stat(initScriptPath).catch(() => {
    throw new Error(`Missing initializer script: ${initScriptPath}`)
  })
  await stat(quickValidatePath).catch(() => {
    throw new Error(`Missing validator script: ${quickValidatePath}`)
  })

  const inputs = await resolveInputs(cliOptions)
  const outputPath = cliOptions.path || DEFAULT_OUTPUT_PATH
  const skillDir = path.resolve(repoRoot, outputPath, inputs.name)
  const skillFilePath = path.join(skillDir, 'SKILL.md')

  if (cliOptions.name && cliOptions.name !== inputs.name) {
    console.log(`[skills:new] Normalized skill name from "${cliOptions.name}" to "${inputs.name}"`)
  }

  await ensureSkillDoesNotExist(skillDir)

  const initArgs = [initScriptPath, inputs.name, '--path', outputPath]
  if (inputs.resources.length > 0) {
    initArgs.push('--resources', inputs.resources.join(','))
  }
  if (inputs.examples) {
    initArgs.push('--examples')
  }

  console.log(`[skills:new] Initializing skill at ${skillDir}`)
  await runCommand({
    command: 'python3',
    args: initArgs,
    cwd: repoRoot,
  })

  await updateFrontmatterDescription(skillFilePath, inputs.description)
  console.log('[skills:new] Updated SKILL.md frontmatter description')

  await runCommand({
    command: 'python3',
    args: [quickValidatePath, skillDir],
    cwd: repoRoot,
  })

  await runCommand({
    command: 'pnpm',
    args: ['skills:validate'],
    cwd: repoRoot,
  })

  if (!cliOptions.skipIndex) {
    await runCommand({
      command: 'pnpm',
      args: ['skills:index'],
      cwd: repoRoot,
    })
  } else {
    console.log('[skills:new] Skipped skills:index (--skip-index)')
  }

  console.log(`[skills:new] Done. Created ${path.relative(repoRoot, skillDir)}`)
}

main().catch((error: unknown) => {
  console.error('[skills:new] Failed')
  console.error(error)
  process.exit(1)
})
