import { constants } from 'node:fs'
import { access, copyFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkbox, confirm } from '@inquirer/prompts'

type CliOptions = {
  dryRun: boolean
  help: boolean
}

type TrashDestination = {
  directory: string
  kind: 'system' | 'fallback'
  warning?: string
}

const PROTECTED_FILES = new Set(['README.md', 'plan-template.md'])

function printHelp() {
  console.log('Usage: node --experimental-strip-types ./scripts/clean-docs.ts [options]')
  console.log('')
  console.log('Options:')
  console.log('  --dry-run              Preview files and destination without moving')
  console.log('  --help                 Show help')
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

  return {
    dryRun,
    help,
  }
}

function isPromptCanceled(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const errorRecord = error as { name?: unknown, message?: unknown }
  const name = typeof errorRecord.name === 'string' ? errorRecord.name : ''
  const message = typeof errorRecord.message === 'string' ? errorRecord.message : ''
  return name === 'ExitPromptError' || /SIGINT|canceled|cancelled/i.test(message)
}

async function isDirectory(filePath: string): Promise<boolean> {
  const result = await stat(filePath).catch(() => null)
  return Boolean(result?.isDirectory())
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = String(date.getFullYear())
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${year}${month}${day}-${hours}${minutes}${seconds}`
}

function randomSuffix(): string {
  return Math.random().toString(16).slice(2, 8)
}

async function resolveRepoRoot(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  return path.resolve(__dirname, '..')
}

async function loadCleanableFiles(docsDir: string): Promise<string[]> {
  const entries = await readdir(docsDir, { withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile() && !PROTECTED_FILES.has(entry.name))
    .map((entry) => entry.name)

  return files.sort((a, b) => a.localeCompare(b))
}

async function resolveTrashDestination(options: { docsDir: string, dryRun: boolean }): Promise<TrashDestination> {
  const { docsDir, dryRun } = options
  const stamp = formatTimestamp(new Date())
  const fallbackDirectory = path.join(docsDir, '.trash', stamp)
  const home = homedir().trim()

  if (process.platform === 'darwin' && home) {
    const systemDirectory = path.join(home, '.Trash')
    if (await isDirectory(systemDirectory)) {
      return {
        directory: systemDirectory,
        kind: 'system',
      }
    }

    return {
      directory: fallbackDirectory,
      kind: 'fallback',
      warning: `System Trash is unavailable (${systemDirectory}), falling back to ${fallbackDirectory}`,
    }
  }

  if (process.platform === 'linux' && home) {
    const systemDirectory = path.join(home, '.local', 'share', 'Trash', 'files')
    if (dryRun) {
      const existingIsDirectory = await isDirectory(systemDirectory)
      const existingPath = await pathExists(systemDirectory)
      if (existingIsDirectory || !existingPath) {
        return {
          directory: systemDirectory,
          kind: 'system',
        }
      }

      return {
        directory: fallbackDirectory,
        kind: 'fallback',
        warning: `System Trash path is not a directory (${systemDirectory}), falling back to ${fallbackDirectory}`,
      }
    }

    try {
      await mkdir(systemDirectory, { recursive: true })
      if (await isDirectory(systemDirectory)) {
        return {
          directory: systemDirectory,
          kind: 'system',
        }
      }
    } catch {
      return {
        directory: fallbackDirectory,
        kind: 'fallback',
        warning: `System Trash is unavailable (${systemDirectory}), falling back to ${fallbackDirectory}`,
      }
    }

    return {
      directory: fallbackDirectory,
      kind: 'fallback',
      warning: `System Trash is unavailable (${systemDirectory}), falling back to ${fallbackDirectory}`,
    }
  }

  return {
    directory: fallbackDirectory,
    kind: 'fallback',
    warning: `Unsupported platform (${process.platform}) for system Trash, falling back to ${fallbackDirectory}`,
  }
}

async function resolveUniqueDestination(targetDir: string, fileName: string): Promise<string> {
  const directPath = path.join(targetDir, fileName)
  if (!(await pathExists(directPath))) {
    return directPath
  }

  const parsed = path.parse(fileName)
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const candidateName = `${parsed.name}.${formatTimestamp(new Date())}-${randomSuffix()}${parsed.ext}`
    const candidatePath = path.join(targetDir, candidateName)
    if (!(await pathExists(candidatePath))) {
      return candidatePath
    }
  }

  throw new Error(`Could not find a unique trash filename for ${fileName}`)
}

async function moveFileWithExdevFallback(sourceFile: string, targetFile: string) {
  try {
    await rename(sourceFile, targetFile)
  } catch (error: unknown) {
    const code = (error as { code?: string }).code
    if (code !== 'EXDEV') {
      throw error
    }

    await copyFile(sourceFile, targetFile)
    await unlink(sourceFile)
  }
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2))
  if (cliOptions.help) {
    printHelp()
    return
  }

  const repoRoot = await resolveRepoRoot()
  const docsDir = path.resolve(repoRoot, '.docs')
  if (!(await isDirectory(docsDir))) {
    throw new Error(`Directory not found: ${docsDir}`)
  }

  const candidates = await loadCleanableFiles(docsDir)
  if (candidates.length === 0) {
    console.log('[docs:clean] No cleanable files found in .docs')
    return
  }

  const selected = await checkbox({
    message: 'Select .docs files to move to Trash (space to toggle, enter to confirm)',
    choices: candidates.map((name) => ({
      name,
      value: name,
    })),
    loop: false,
    required: true,
  })

  const firstConfirm = await confirm({
    message: `Ready to move ${selected.length} file(s) to Trash. Continue?`,
    default: false,
  })
  if (!firstConfirm) {
    console.log('[docs:clean] Canceled by user')
    return
  }

  const destination = await resolveTrashDestination({
    docsDir,
    dryRun: cliOptions.dryRun,
  })

  if (destination.warning) {
    console.warn(`[docs:clean] Warning: ${destination.warning}`)
  }

  if (cliOptions.dryRun) {
    console.log(`[docs:clean] Dry run: would move ${selected.length} file(s) to ${destination.directory}`)
    for (const fileName of selected) {
      console.log(`  - ${fileName}`)
    }
    return
  }

  if (destination.kind === 'fallback') {
    await mkdir(destination.directory, { recursive: true })
  }

  const movedFiles: Array<{ source: string, target: string }> = []
  for (const fileName of selected) {
    const sourceFile = path.join(docsDir, fileName)
    const sourceExists = await pathExists(sourceFile)
    if (!sourceExists) {
      throw new Error(`File no longer exists: ${sourceFile}`)
    }

    const targetFile = await resolveUniqueDestination(destination.directory, fileName)
    await moveFileWithExdevFallback(sourceFile, targetFile)
    movedFiles.push({
      source: sourceFile,
      target: targetFile,
    })
  }

  console.log(`[docs:clean] Moved ${movedFiles.length} file(s) to ${destination.directory}`)
  for (const file of movedFiles) {
    console.log(`  - ${path.basename(file.source)} -> ${file.target}`)
  }
}

main().catch((error: unknown) => {
  if (isPromptCanceled(error)) {
    console.log('[docs:clean] Canceled by user')
    process.exit(0)
    return
  }

  console.error('[docs:clean] Failed')
  console.error(error)
  process.exit(1)
})
