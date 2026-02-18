#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEFAULT_SCRIPT_NAME = 'skills:sync:llm'
const DEFAULT_SCRIPT_PATH = 'scripts/sync-llm-skills.ts'
const DEFAULT_SCRIPT_COMMAND_PREFIX = 'node --experimental-strip-types'
const DEFAULT_IS_CI_VERSION = '^4.1.0'
const SCRIPT_NAME_PATTERN = /^[A-Za-z0-9:._-]+$/
const CLAUDE_SKILLS_GITIGNORE_ENTRY = '/.claude/skills'

function printHelp() {
  console.log('Usage: node bootstrap-sync-skills.mjs [options]')
  console.log('')
  console.log('Options:')
  console.log('  --project <path>      Target project root (default: current directory)')
  console.log(`  --script-name <name>  Package script name (default: ${DEFAULT_SCRIPT_NAME}, pattern: [A-Za-z0-9:._-]+)`)
  console.log(`  --script-path <path>  Generated script path (default: ${DEFAULT_SCRIPT_PATH})`)
  console.log('  --skip-postinstall    Skip postinstall injection')
  console.log('  --help                Show help')
}

function getOptionValue(args, index, key) {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${key}`)
  }
  return value
}

function parseArgs(argv) {
  const options = {
    project: process.cwd(),
    scriptName: DEFAULT_SCRIPT_NAME,
    scriptPath: DEFAULT_SCRIPT_PATH,
    skipPostinstall: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--help') {
      printHelp()
      process.exit(0)
    }

    if (arg === '--skip-postinstall') {
      options.skipPostinstall = true
      continue
    }

    if (arg.startsWith('--project=')) {
      options.project = arg.slice('--project='.length)
      continue
    }

    if (arg === '--project') {
      options.project = getOptionValue(argv, index, '--project')
      index += 1
      continue
    }

    if (arg.startsWith('--script-name=')) {
      options.scriptName = arg.slice('--script-name='.length)
      continue
    }

    if (arg === '--script-name') {
      options.scriptName = getOptionValue(argv, index, '--script-name')
      index += 1
      continue
    }

    if (arg.startsWith('--script-path=')) {
      options.scriptPath = arg.slice('--script-path='.length)
      continue
    }

    if (arg === '--script-path') {
      options.scriptPath = getOptionValue(argv, index, '--script-path')
      index += 1
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  validateScriptName(options.scriptName)

  return options
}

async function pathExists(targetPath) {
  const stats = await stat(targetPath).catch(() => null)
  return Boolean(stats)
}

async function resolvePackageRunner(projectRoot, packageManager) {
  const managerName = (packageManager || '').split('@')[0]

  if (managerName === 'pnpm') {
    return 'pnpm run'
  }

  if (managerName === 'yarn') {
    return 'yarn'
  }

  if (managerName === 'bun') {
    return 'bun run'
  }

  if (managerName === 'npm') {
    return 'npm run'
  }

  if (await pathExists(path.join(projectRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm run'
  }

  if (await pathExists(path.join(projectRoot, 'yarn.lock'))) {
    return 'yarn'
  }

  if (await pathExists(path.join(projectRoot, 'bun.lockb'))) {
    return 'bun run'
  }

  return 'npm run'
}

function normalizePackageScriptPath(scriptPath) {
  if (path.isAbsolute(scriptPath)) {
    throw new Error('script-path must be a project-relative path')
  }

  const normalized = path.posix.normalize(scriptPath.replace(/\\/g, '/').replace(/^\.?\//, ''))
  if (!normalized) {
    throw new Error('script-path cannot be empty')
  }

  if (normalized === '..' || normalized.startsWith('../')) {
    throw new Error('script-path cannot escape the project root')
  }

  return {
    fileSystemPath: normalized,
    packageScriptPath: `./${normalized}`,
  }
}

function validateScriptName(scriptName) {
  if (typeof scriptName !== 'string' || scriptName.length === 0) {
    throw new Error('--script-name cannot be empty')
  }

  if (!SCRIPT_NAME_PATTERN.test(scriptName)) {
    throw new Error(
      `Invalid --script-name "${scriptName}". Allowed pattern: [A-Za-z0-9:._-]+`,
    )
  }
}

function getOptionalObjectRecord(packageJson, key) {
  const value = packageJson[key]

  if (value === undefined) {
    return null
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`package.json field "${key}" must be an object when it exists`)
  }

  return value
}

function ensureObjectRecord(packageJson, key) {
  const existing = getOptionalObjectRecord(packageJson, key)
  if (existing) {
    return existing
  }

  const initialized = {}
  packageJson[key] = initialized
  return initialized
}

function ensureIsCiDependency(packageJson) {
  const dependencies = getOptionalObjectRecord(packageJson, 'dependencies')
  const devDependencies = getOptionalObjectRecord(packageJson, 'devDependencies')

  if (dependencies?.['is-ci'] || devDependencies?.['is-ci']) {
    return { added: false }
  }

  const writableDevDependencies = ensureObjectRecord(packageJson, 'devDependencies')
  writableDevDependencies['is-ci'] = DEFAULT_IS_CI_VERSION
  return { added: true }
}

async function loadPackageJson(projectRoot) {
  const packageJsonPath = path.join(projectRoot, 'package.json')
  const raw = await readFile(packageJsonPath, 'utf8').catch(() => null)
  if (!raw) {
    throw new Error(`package.json not found: ${packageJsonPath}`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid package.json: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('package.json must contain a JSON object')
  }

  return {
    packageJsonPath,
    packageJson: parsed,
  }
}

async function readTemplateContent() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const templatePath = path.join(__dirname, '..', 'assets', 'templates', 'sync-llm-skills.ts')

  const template = await readFile(templatePath, 'utf8').catch(() => null)
  if (!template) {
    throw new Error(`Template not found: ${templatePath}`)
  }

  return template
}

async function ensureTemplateScript(projectRoot, scriptPath, templateContent) {
  const absoluteScriptPath = path.join(projectRoot, scriptPath)
  await mkdir(path.dirname(absoluteScriptPath), { recursive: true })

  const currentContent = await readFile(absoluteScriptPath, 'utf8').catch(() => null)
  if (currentContent === templateContent) {
    return { path: absoluteScriptPath, changed: false }
  }

  await writeFile(absoluteScriptPath, templateContent, 'utf8')
  return { path: absoluteScriptPath, changed: true }
}

function hasGitignoreEntry(content, entry) {
  const normalizedLines = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return normalizedLines.includes(entry) || normalizedLines.includes(entry.replace(/^\//, ''))
}

async function ensureGitignoreEntry(projectRoot, entry) {
  const gitignorePath = path.join(projectRoot, '.gitignore')
  const currentContent = await readFile(gitignorePath, 'utf8').catch(() => '')

  if (hasGitignoreEntry(currentContent, entry)) {
    return { path: gitignorePath, changed: false }
  }

  const base = currentContent.trimEnd()
  const next = base ? `${base}\n${entry}\n` : `${entry}\n`
  await writeFile(gitignorePath, next, 'utf8')
  return { path: gitignorePath, changed: true }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasCommandInvocation(script, command) {
  const escapedCommand = escapeRegex(command)
  const commandPattern = new RegExp(`(^|[\\s;&|()])${escapedCommand}(?=($|[\\s;&|()]))`)
  return commandPattern.test(script)
}

function hasScriptRunnerInvocation(script, scriptName) {
  const escapedScriptName = escapeRegex(scriptName)
  const runnerPatterns = [
    new RegExp(`(^|[\\s;&|()])pnpm\\s+run\\s+${escapedScriptName}(?=($|[\\s;&|()]))`),
    new RegExp(`(^|[\\s;&|()])npm\\s+run\\s+${escapedScriptName}(?=($|[\\s;&|()]))`),
    new RegExp(`(^|[\\s;&|()])yarn\\s+${escapedScriptName}(?=($|[\\s;&|()]))`),
    new RegExp(`(^|[\\s;&|()])bun\\s+run\\s+${escapedScriptName}(?=($|[\\s;&|()]))`),
  ]

  return runnerPatterns.some((pattern) => pattern.test(script))
}

function mergePostinstallScript(currentPostinstall, command, scriptName) {
  if (!currentPostinstall) {
    return command
  }

  if (
    hasCommandInvocation(currentPostinstall, command) ||
    hasScriptRunnerInvocation(currentPostinstall, scriptName)
  ) {
    return currentPostinstall
  }

  return `${currentPostinstall} && (${command})`
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const projectRoot = path.resolve(options.project)
  const templateContent = await readTemplateContent()

  const scriptPathInfo = normalizePackageScriptPath(options.scriptPath)
  const templateScriptResult = await ensureTemplateScript(
    projectRoot,
    scriptPathInfo.fileSystemPath,
    templateContent,
  )
  const gitignoreResult = await ensureGitignoreEntry(projectRoot, CLAUDE_SKILLS_GITIGNORE_ENTRY)

  const { packageJson, packageJsonPath } = await loadPackageJson(projectRoot)
  const { added: isCiAdded } = ensureIsCiDependency(packageJson)
  const scripts = packageJson.scripts && typeof packageJson.scripts === 'object'
    ? packageJson.scripts
    : {}

  const syncCommand = `${DEFAULT_SCRIPT_COMMAND_PREFIX} ${scriptPathInfo.packageScriptPath}`
  const existingSyncCommand = scripts[options.scriptName]
  const syncScriptChanged = existingSyncCommand !== syncCommand
  scripts[options.scriptName] = syncCommand

  let postinstallChanged = false
  if (!options.skipPostinstall) {
    const postinstallRunner = await resolvePackageRunner(projectRoot, packageJson.packageManager)
    const postinstallCommand = `is-ci && echo 'Skipping ${options.scriptName} in CI environment' || ${postinstallRunner} ${options.scriptName}`
    const currentPostinstall = scripts.postinstall

    if (currentPostinstall !== undefined && typeof currentPostinstall !== 'string') {
      throw new Error('scripts.postinstall must be a string when it exists')
    }

    const mergedPostinstall = mergePostinstallScript(
      currentPostinstall,
      postinstallCommand,
      options.scriptName,
    )
    postinstallChanged = mergedPostinstall !== currentPostinstall
    scripts.postinstall = mergedPostinstall
  }

  packageJson.scripts = scripts
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')

  console.log(`[bootstrap-sync-skills] Project: ${projectRoot}`)
  console.log(
    `[bootstrap-sync-skills] ${templateScriptResult.changed ? 'Updated' : 'Reused'} template: ${templateScriptResult.path}`,
  )
  console.log(
    `[bootstrap-sync-skills] ${gitignoreResult.changed ? 'Added' : 'Kept'} .gitignore entry: ${CLAUDE_SKILLS_GITIGNORE_ENTRY}`,
  )
  console.log(
    `[bootstrap-sync-skills] ${syncScriptChanged ? 'Set' : 'Kept'} script: ${options.scriptName} = "${syncCommand}"`,
  )
  console.log(
    `[bootstrap-sync-skills] ${isCiAdded ? 'Added' : 'Kept'} devDependency: is-ci`,
  )

  if (options.skipPostinstall) {
    console.log('[bootstrap-sync-skills] Postinstall update skipped')
  } else {
    console.log(
      `[bootstrap-sync-skills] ${postinstallChanged ? 'Merged' : 'Kept'} postinstall hook for ${options.scriptName}`,
    )
  }

  console.log('[bootstrap-sync-skills] Done')
}

main().catch((error) => {
  console.error('[bootstrap-sync-skills] Failed')
  console.error(error)
  process.exit(1)
})
