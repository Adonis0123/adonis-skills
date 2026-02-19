import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type CliOptions = {
  dryRun: boolean
  help: boolean
  skillPath?: string
}

type FinalizeTarget = {
  absoluteSkillDir: string
  relativeSkillPath: string
  skillSlug: string
}

function printHelp() {
  console.log('Usage: node --experimental-strip-types ./scripts/finalize-skill.ts [options] <skill-path>')
  console.log('')
  console.log('Options:')
  console.log('  --dry-run              Print planned commands without executing')
  console.log('  --help                 Show help')
  console.log('')
  console.log('Examples:')
  console.log('  pnpm skills:finalize -- skills/code-inspector-init')
  console.log('  pnpm skills:finalize -- /Users/adonis/coding/adonis-skills2/skills/code-inspector-init/')
}

function parseArgs(argv: string[]): CliOptions {
  let dryRun = false
  let help = false
  let skillPath: string | undefined

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      continue
    }

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--help') {
      help = true
      continue
    }

    if (arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`)
    }

    if (skillPath) {
      throw new Error(`Unexpected extra positional argument: ${arg}`)
    }

    skillPath = arg
  }

  return {
    dryRun,
    help,
    skillPath,
  }
}

function stripWrappingQuotes(value: string): string {
  let result = value.trim()
  let changed = true

  while (changed && result.length >= 2) {
    changed = false

    if (
      (result.startsWith('"') && result.endsWith('"'))
      || (result.startsWith('\'') && result.endsWith('\''))
      || (result.startsWith('`') && result.endsWith('`'))
    ) {
      result = result.slice(1, -1).trim()
      changed = true
    }
  }

  return result
}

function normalizeInputPath(rawPath: string): string {
  const trimmed = stripWrappingQuotes(rawPath)
  if (!trimmed) {
    throw new Error('Skill path cannot be empty')
  }

  const withoutTrailingSlash = trimmed.replace(/[/\\]+$/g, '')
  return withoutTrailingSlash || trimmed
}

function resolveFinalizeTarget(repoRoot: string, inputPath: string): FinalizeTarget {
  const normalizedInput = normalizeInputPath(inputPath)
  const resolvedInput = path.isAbsolute(normalizedInput)
    ? path.resolve(normalizedInput)
    : path.resolve(repoRoot, normalizedInput)

  const skillsRoot = path.resolve(repoRoot, 'skills')
  const relativeFromSkillsRoot = path.relative(skillsRoot, resolvedInput)

  if (!relativeFromSkillsRoot || relativeFromSkillsRoot === '.') {
    throw new Error('Path must point to a specific skill directory: skills/<skill-slug>')
  }

  if (relativeFromSkillsRoot.startsWith('..') || path.isAbsolute(relativeFromSkillsRoot)) {
    throw new Error(`Path must be inside ${skillsRoot}`)
  }

  const segments = relativeFromSkillsRoot.split(path.sep).filter(Boolean)
  if (segments.length !== 1) {
    throw new Error('Path must be a direct child under skills/*')
  }

  const skillSlug = segments[0]
  return {
    absoluteSkillDir: path.join(skillsRoot, skillSlug),
    relativeSkillPath: `skills/${skillSlug}`,
    skillSlug,
  }
}

async function ensureValidSkillDirectory(absoluteSkillDir: string) {
  const skillDirStat = await stat(absoluteSkillDir).catch(() => null)
  if (!skillDirStat?.isDirectory()) {
    throw new Error(`Skill directory not found: ${absoluteSkillDir}`)
  }

  const skillMdPath = path.join(absoluteSkillDir, 'SKILL.md')
  const skillMdStat = await stat(skillMdPath).catch(() => null)
  if (!skillMdStat?.isFile()) {
    throw new Error(`SKILL.md not found: ${skillMdPath}`)
  }
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ')
}

async function runCommand(options: {
  args: string[]
  command: string
  cwd: string
  dryRun: boolean
}) {
  const { args, command, cwd, dryRun } = options
  const display = formatCommand(command, args)

  if (dryRun) {
    console.log(`[skills:finalize] Dry run: ${display}`)
    return
  }

  console.log(`[skills:finalize] Running: ${display}`)

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
      reject(new Error(`Command failed (${code ?? 'unknown'}): ${display}`))
    })
  })
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2))
  if (cliOptions.help) {
    printHelp()
    return
  }

  if (!cliOptions.skillPath) {
    throw new Error('Missing required argument: <skill-path>')
  }

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')

  const target = resolveFinalizeTarget(repoRoot, cliOptions.skillPath)
  await ensureValidSkillDirectory(target.absoluteSkillDir)

  console.log(`[skills:finalize] Finalizing ${target.relativeSkillPath} (${target.skillSlug})`)

  await runCommand({
    command: 'pnpm',
    args: ['skills:quick-validate', target.relativeSkillPath],
    cwd: repoRoot,
    dryRun: cliOptions.dryRun,
  })

  await runCommand({
    command: 'pnpm',
    args: ['skills:validate'],
    cwd: repoRoot,
    dryRun: cliOptions.dryRun,
  })

  await runCommand({
    command: 'pnpm',
    args: ['skills:index'],
    cwd: repoRoot,
    dryRun: cliOptions.dryRun,
  })

  console.log(`[skills:finalize] Done: ${target.relativeSkillPath}`)
}

main().catch((error: unknown) => {
  console.error('[skills:finalize] Failed')
  console.error(error)
  process.exit(1)
})
