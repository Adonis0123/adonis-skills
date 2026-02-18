import { cp, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type TargetName = 'claude'

type CliOptions = {
  source: string
  targets: TargetName[]
  dryRun: boolean
}

const TARGET_DIRECTORY_MAP: Record<TargetName, string> = {
  claude: '.claude/skills',
}

const DEFAULT_SOURCE = '.agents/skills'
const DEFAULT_TARGETS = 'claude'

function getOptionValue(args: string[], index: number, key: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${key}`)
  }
  return value
}

function parseTargets(rawTargets: string): TargetName[] {
  const parts = rawTargets
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  if (parts.length === 0) {
    throw new Error('At least one target is required')
  }

  const normalized: TargetName[] = []
  for (const item of parts) {
    if (item !== 'claude') {
      throw new Error(`Unknown target "${item}". Only "claude" is supported`)
    }

    if (!normalized.includes(item)) {
      normalized.push(item)
    }
  }

  return normalized
}

function parseArgs(argv: string[]): CliOptions {
  let source = DEFAULT_SOURCE
  let targets = DEFAULT_TARGETS
  let dryRun = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      continue
    }

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg.startsWith('--source=')) {
      source = arg.slice('--source='.length)
      continue
    }

    if (arg === '--source') {
      source = getOptionValue(argv, index, '--source')
      index += 1
      continue
    }

    if (arg.startsWith('--targets=')) {
      targets = arg.slice('--targets='.length)
      continue
    }

    if (arg === '--targets') {
      targets = getOptionValue(argv, index, '--targets')
      index += 1
      continue
    }

    if (arg === '--help') {
      printHelp()
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  return {
    source,
    targets: parseTargets(targets),
    dryRun,
  }
}

function printHelp() {
  console.log('Usage: node --experimental-strip-types ./scripts/sync-llm-skills.ts [options]')
  console.log('')
  console.log('Options:')
  console.log('  --source <path>       Source skills directory (default: .agents/skills)')
  console.log('  --targets <list>      Targets: claude (default: claude)')
  console.log('  --dry-run             Print planned actions without copying files')
  console.log('  --help                Show help')
}

async function ensureDirectoryExists(directoryPath: string, label: string) {
  const directoryStats = await stat(directoryPath).catch(() => null)
  if (!directoryStats?.isDirectory()) {
    throw new Error(`${label} directory not found: ${directoryPath}`)
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  const targetStats = await stat(targetPath).catch(() => null)
  return Boolean(targetStats)
}

async function atomicSyncDirectory(sourceDir: string, targetDir: string): Promise<void> {
  const parentDir = path.dirname(targetDir)
  const tempDir = `${targetDir}.__tmp__`
  const backupDir = `${targetDir}.__bak__`

  await mkdir(parentDir, { recursive: true })
  await rm(tempDir, { recursive: true, force: true })
  await rm(backupDir, { recursive: true, force: true })

  // Stage new content first so a copy failure never destroys existing target files.
  await cp(sourceDir, tempDir, { recursive: true, force: true })

  const hadTarget = await pathExists(targetDir)

  try {
    if (hadTarget) {
      await rename(targetDir, backupDir)
    }

    await rename(tempDir, targetDir)

    if (hadTarget) {
      await rm(backupDir, { recursive: true, force: true })
    }
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => null)

    const hasTargetNow = await pathExists(targetDir)
    const hasBackupNow = await pathExists(backupDir)
    if (!hasTargetNow && hasBackupNow) {
      await rename(backupDir, targetDir).catch(() => null)
    }

    throw error
  }
}

async function countSkills(sourceDir: string): Promise<number> {
  const entries = await readdir(sourceDir, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).length
}

async function syncTarget(options: {
  sourceDir: string
  targetDir: string
  targetName: TargetName
  dryRun: boolean
  skillCount: number
}) {
  const { sourceDir, targetDir, targetName, dryRun, skillCount } = options

  if (dryRun) {
    console.log(
      `[skills:sync:llm] Dry run: would sync ${skillCount} skills to ${targetName} (${sourceDir} -> ${targetDir})`,
    )
    return
  }

  console.log(`[skills:sync:llm] Preparing atomic switch for ${targetName}`)
  await atomicSyncDirectory(sourceDir, targetDir)

  console.log(
    `[skills:sync:llm] Synced ${skillCount} skills to ${targetName} (${sourceDir} -> ${targetDir})`,
  )
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2))

  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const repoRoot = path.resolve(__dirname, '..')

  const sourceDir = path.resolve(repoRoot, cliOptions.source)
  await ensureDirectoryExists(sourceDir, 'Source')

  const skillCount = await countSkills(sourceDir)

  for (const targetName of cliOptions.targets) {
    const targetDir = path.resolve(repoRoot, TARGET_DIRECTORY_MAP[targetName])
    await syncTarget({
      sourceDir,
      targetDir,
      targetName,
      dryRun: cliOptions.dryRun,
      skillCount,
    })
  }
}

main().catch((error: unknown) => {
  console.error('[skills:sync:llm] Failed to sync skills')
  console.error(error)
  process.exit(1)
})
