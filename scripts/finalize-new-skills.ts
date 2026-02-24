import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type CliOptions = {
  dryRun: boolean
  help: boolean
}

type CommandLog = {
  args: string[]
  command: string
  mode: 'executed' | 'planned'
}

type GitStatusEntry = {
  path: string
  statusCode: string
}

const SKILLS_INDEX_PATH = 'apps/web/src/generated/skills-index.json'

function printHelp() {
  console.log('Usage: node --experimental-strip-types ./scripts/finalize-new-skills.ts [options]')
  console.log('')
  console.log('Options:')
  console.log('  --dry-run              Print planned commands without executing')
  console.log('  --help                 Show help')
  console.log('')
  console.log('Behavior:')
  console.log('  1) Discover newly added skills from git status --short --untracked-files=all (A + ?? on skills/<slug>/SKILL.md)')
  console.log('  2) Run finalize for each discovered skill')
  console.log('  3) Stage related files (skills/<slug> + skills-index when changed)')
  console.log('  4) If no new skill is found, run pnpm skills:new, then rescan')
}

function parseArgs(argv: string[]): CliOptions {
  let dryRun = false
  let help = false

  for (const arg of argv) {
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

    throw new Error(`Unknown argument: ${arg}`)
  }

  return { dryRun, help }
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(' ')
}

async function runCommand(options: {
  args: string[]
  command: string
  commandLogs: CommandLog[]
  cwd: string
  dryRun: boolean
  stdio?: 'inherit' | 'pipe'
}) {
  const {
    args,
    command,
    commandLogs,
    cwd,
    dryRun,
    stdio = 'inherit',
  } = options
  const display = formatCommand(command, args)

  if (dryRun) {
    commandLogs.push({ args, command, mode: 'planned' })
    console.log(`[skills:finalize:new] Planned: ${display}`)
    return
  }

  commandLogs.push({ args, command, mode: 'executed' })
  console.log(`[skills:finalize:new] Running: ${display}`)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio,
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

async function runCommandCapture(options: {
  args: string[]
  command: string
  cwd: string
}) {
  const { args, command, cwd } = options
  const display = formatCommand(command, args)

  return await new Promise<string>((resolve, reject) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    child.stdout.on('data', chunk => stdoutChunks.push(chunk))
    child.stderr.on('data', chunk => stderrChunks.push(chunk))

    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString('utf8'))
        return
      }

      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim()
      reject(new Error(`Command failed (${code ?? 'unknown'}): ${display}${stderr ? `\n${stderr}` : ''}`))
    })
  })
}

function parseGitStatusEntries(rawStatus: string): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []
  const lines = rawStatus.split('\n').map(line => line.trimEnd()).filter(Boolean)

  for (const line of lines) {
    if (line.length < 4) {
      continue
    }

    const statusCode = line.slice(0, 2)
    const rawPath = line.slice(3).trim()
    const normalizedPath = rawPath.includes(' -> ')
      ? rawPath.split(' -> ').at(-1) ?? rawPath
      : rawPath

    entries.push({ statusCode, path: normalizedPath })
  }

  return entries
}

function isNewStatus(statusCode: string) {
  return statusCode === '??' || statusCode[0] === 'A'
}

function parseSkillSlugFromSkillMdPath(filePath: string) {
  const match = filePath.match(/^skills\/([^/]+)\/SKILL\.md$/)
  return match ? match[1] : null
}

export function collectNewSkillSlugsFromStatus(rawStatus: string) {
  const entries = parseGitStatusEntries(rawStatus)
  const slugs = new Set<string>()

  for (const entry of entries) {
    if (!isNewStatus(entry.statusCode)) {
      continue
    }

    const slug = parseSkillSlugFromSkillMdPath(entry.path)
    if (!slug) {
      continue
    }

    slugs.add(slug)
  }

  return [...slugs].sort((a, b) => a.localeCompare(b))
}

async function isValidSkillDirectory(repoRoot: string, slug: string) {
  const skillMdPath = path.join(repoRoot, 'skills', slug, 'SKILL.md')
  const target = await stat(skillMdPath).catch(() => null)
  return target?.isFile() ?? false
}

async function discoverNewSkillSlugs(repoRoot: string) {
  const rawStatus = await runCommandCapture({
    command: 'git',
    args: ['status', '--short', '--untracked-files=all'],
    cwd: repoRoot,
  })

  const sortedSlugs = collectNewSkillSlugsFromStatus(rawStatus)
  const verifiedSlugs: string[] = []

  for (const slug of sortedSlugs) {
    if (await isValidSkillDirectory(repoRoot, slug)) {
      verifiedSlugs.push(slug)
      continue
    }
    console.log(`[skills:finalize:new] Skipped candidate without SKILL.md: skills/${slug}`)
  }

  return verifiedSlugs
}

async function hasIndexFileChanges(repoRoot: string) {
  const output = await runCommandCapture({
    command: 'git',
    args: ['status', '--short', '--', SKILLS_INDEX_PATH],
    cwd: repoRoot,
  })

  return output.trim().length > 0
}

async function stageRelatedFiles(options: {
  commandLogs: CommandLog[]
  dryRun: boolean
  repoRoot: string
  slugs: string[]
}) {
  const { commandLogs, dryRun, repoRoot, slugs } = options
  const stagedPaths: string[] = []

  for (const slug of slugs) {
    const skillPath = `skills/${slug}`
    await runCommand({
      command: 'git',
      args: ['add', skillPath],
      cwd: repoRoot,
      dryRun,
      commandLogs,
    })
    stagedPaths.push(skillPath)
  }

  const indexChanged = await hasIndexFileChanges(repoRoot)
  if (indexChanged) {
    await runCommand({
      command: 'git',
      args: ['add', SKILLS_INDEX_PATH],
      cwd: repoRoot,
      dryRun,
      commandLogs,
    })
    stagedPaths.push(SKILLS_INDEX_PATH)
  } else if (dryRun) {
    console.log(`[skills:finalize:new] Planned conditionally: git add ${SKILLS_INDEX_PATH} (if changed)`)
  }

  return stagedPaths
}

function printSummary(options: {
  commandLogs: CommandLog[]
  mode: 'executed' | 'planned'
  slugs: string[]
  stagedPaths: string[]
}) {
  const { commandLogs, mode, slugs, stagedPaths } = options
  console.log('')
  console.log('=== skills:finalize:new summary ===')
  console.log(`Status: ${mode === 'planned' ? 'PLANNED' : 'SUCCESS'}`)
  console.log(`Detected skills: ${slugs.length > 0 ? slugs.join(', ') : '(none)'}`)
  console.log(`Commands ${mode}:`)
  for (const commandLog of commandLogs) {
    console.log(`- ${formatCommand(commandLog.command, commandLog.args)}`)
  }
  console.log(`Staged paths: ${stagedPaths.length > 0 ? stagedPaths.join(', ') : '(none)'}`)
}

async function runCreateFlow(options: {
  commandLogs: CommandLog[]
  dryRun: boolean
  repoRoot: string
}) {
  const { commandLogs, dryRun, repoRoot } = options
  console.log('[skills:finalize:new] No new skills found from git status.')

  await runCommand({
    command: 'pnpm',
    args: ['skills:new'],
    cwd: repoRoot,
    dryRun,
    commandLogs,
  })

  if (dryRun) {
    console.log('[skills:finalize:new] Dry run stops before post-create rescan.')
    return []
  }

  const rescanned = await discoverNewSkillSlugs(repoRoot)
  if (rescanned.length === 0) {
    throw new Error('No new skills found after running pnpm skills:new.')
  }

  return rescanned
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2))
  if (cliOptions.help) {
    printHelp()
    return
  }

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')
  const commandLogs: CommandLog[] = []

  let skillSlugs = await discoverNewSkillSlugs(repoRoot)
  if (skillSlugs.length === 0) {
    skillSlugs = await runCreateFlow({
      repoRoot,
      dryRun: cliOptions.dryRun,
      commandLogs,
    })
  }

  if (skillSlugs.length > 0) {
    console.log(`[skills:finalize:new] Target skills: ${skillSlugs.join(', ')}`)
  }

  for (const slug of skillSlugs) {
    await runCommand({
      command: 'pnpm',
      args: ['skills:finalize', '--', `skills/${slug}`],
      cwd: repoRoot,
      dryRun: cliOptions.dryRun,
      commandLogs,
    })
  }

  const stagedPaths = await stageRelatedFiles({
    repoRoot,
    slugs: skillSlugs,
    dryRun: cliOptions.dryRun,
    commandLogs,
  })

  printSummary({
    mode: cliOptions.dryRun ? 'planned' : 'executed',
    commandLogs,
    slugs: skillSlugs,
    stagedPaths,
  })
}

function isDirectExecution() {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }

  return import.meta.url === pathToFileURL(path.resolve(entry)).href
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    console.error('[skills:finalize:new] Failed')
    console.error(error)
    process.exit(1)
  })
}
