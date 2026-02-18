#!/usr/bin/env node

import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ALLOWED_MODES = new Set(['audit', 'apply'])
const RULER_APPLY_COMMAND =
  'pnpm dlx @intellectronica/ruler@latest apply --local-only --no-backup'
const SKILLS_SYNC_COMMAND =
  'node --experimental-strip-types ./scripts/sync-claude-skills.ts'
const IGNORE_START = '# START Ruler Generated Files'
const IGNORE_END = '# END Ruler Generated Files'
const IGNORE_BLOCK = `${IGNORE_START}\n/.codex/config.toml\n/AGENTS.md\n/CLAUDE.md\n${IGNORE_END}`
const TEMPLATE_FILES = [
  '.ruler/AGENTS.md',
  '.ruler/00-core-principles.md',
  '.ruler/10-project-context.md',
  '.ruler/20-dev-commands.md',
  '.ruler/30-coding-conventions.md',
  '.ruler/ruler.toml'
]

function parseArgs(argv) {
  const options = {
    target: process.cwd(),
    mode: 'audit',
    withOptionalSync: false,
    force: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--target') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --target')
      }
      options.target = path.resolve(value)
      index += 1
      continue
    }

    if (arg === '--mode') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --mode')
      }
      options.mode = value
      index += 1
      continue
    }

    if (arg === '--with-optional-sync') {
      options.withOptionalSync = true
      continue
    }

    if (arg === '--force') {
      options.force = true
      continue
    }

    if (arg === '--help' || arg === '-h') {
      printHelp()
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!ALLOWED_MODES.has(options.mode)) {
    throw new Error(`Invalid --mode value: ${options.mode}. Allowed: audit, apply`)
  }

  return options
}

function printHelp() {
  console.log('Ruler bootstrap utility')
  console.log('')
  console.log('Usage:')
  console.log(
    '  node ./scripts/bootstrap-ruler.mjs --target /path/to/repo --mode audit|apply [--with-optional-sync] [--force]'
  )
  console.log('')
  console.log('Examples:')
  console.log(
    '  node ./scripts/bootstrap-ruler.mjs --target /repo --mode audit'
  )
  console.log(
    '  node ./scripts/bootstrap-ruler.mjs --target /repo --mode apply --with-optional-sync'
  )
}

function normalizeContent(value) {
  return value.replace(/\r\n/g, '\n').trimEnd()
}

function withTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`
}

async function pathExists(targetPath) {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function ensureDirectory(targetPath) {
  await mkdir(targetPath, { recursive: true })
}

function createReporter() {
  const items = []

  return {
    add(section, status, target, detail) {
      items.push({ section, status, target, detail })
    },
    printSummary(mode) {
      const grouped = new Map()

      for (const item of items) {
        if (!grouped.has(item.section)) {
          grouped.set(item.section, [])
        }
        grouped.get(item.section).push(item)
      }

      console.log('')
      console.log('Summary')
      console.log('-------')

      for (const [section, entries] of grouped.entries()) {
        console.log(section)
        for (const entry of entries) {
          console.log(`- [${entry.status}] ${entry.target} :: ${entry.detail}`)
        }
      }

      const manualActions = items.filter(
        (item) => item.status === 'manual' || item.status === 'differs'
      )

      if (manualActions.length > 0) {
        console.log('')
        console.log('Manual follow-up required for some items.')
      }

      if (mode === 'audit') {
        console.log('')
        console.log('Next: run with --mode apply to create missing files.')
      }
    }
  }
}

async function syncTemplateFile({
  relativePath,
  targetRoot,
  templatesRoot,
  mode,
  force,
  reporter
}) {
  const sourcePath = path.join(templatesRoot, relativePath)
  const targetPath = path.join(targetRoot, relativePath)

  const sourceExists = await pathExists(sourcePath)
  if (!sourceExists) {
    reporter.add('Templates', 'error', relativePath, 'Template source file missing')
    return
  }

  const sourceText = await readFile(sourcePath, 'utf8')
  const targetExists = await pathExists(targetPath)

  if (!targetExists) {
    reporter.add('Templates', 'missing', relativePath, 'Target file is missing')

    if (mode === 'apply') {
      await ensureDirectory(path.dirname(targetPath))
      await writeFile(targetPath, withTrailingNewline(sourceText), 'utf8')
      reporter.add('Templates', 'created', relativePath, 'Created from template')
    }
    return
  }

  const currentText = await readFile(targetPath, 'utf8')
  if (normalizeContent(currentText) === normalizeContent(sourceText)) {
    reporter.add('Templates', 'ok', relativePath, 'Already matches template')
    return
  }

  reporter.add('Templates', 'differs', relativePath, 'File differs from template')

  if (mode === 'apply' && force) {
    await writeFile(targetPath, withTrailingNewline(sourceText), 'utf8')
    reporter.add('Templates', 'overwritten', relativePath, 'Replaced due to --force')
  }
}

function ensureScriptValue({ scripts, key, value, reporter, changes }) {
  if (!scripts[key]) {
    scripts[key] = value
    changes.changed = true
    reporter.add('package.json', 'created', `scripts.${key}`, 'Added missing script')
    return
  }

  if (scripts[key] === value) {
    reporter.add('package.json', 'ok', `scripts.${key}`, 'Already matches recommendation')
    return
  }

  reporter.add('package.json', 'manual', `scripts.${key}`, 'Existing value kept')
}

function hasDependency(packageJson, packageName) {
  const dependencies = packageJson.dependencies ?? {}
  const devDependencies = packageJson.devDependencies ?? {}
  return Boolean(dependencies[packageName] || devDependencies[packageName])
}

function getCiGuardCommand(packageJson) {
  return hasDependency(packageJson, 'is-ci') ? 'is-ci' : '[ -n "$CI" ]'
}

function getRecommendedPostinstall({ withOptionalSync, ciGuardCommand }) {
  if (withOptionalSync) {
    return `${ciGuardCommand} && echo 'Skipping ruler:apply and skills sync in CI environment' || (pnpm run ruler:apply && pnpm run skills:sync:claude)`
  }

  return `${ciGuardCommand} && echo 'Skipping ruler:apply in CI environment' || pnpm run ruler:apply`
}

async function updatePackageJson({ targetRoot, mode, force, withOptionalSync, reporter }) {
  const packageJsonPath = path.join(targetRoot, 'package.json')
  const exists = await pathExists(packageJsonPath)

  if (!exists) {
    reporter.add('package.json', 'manual', 'package.json', 'File not found, skipped')
    return
  }

  const raw = await readFile(packageJsonPath, 'utf8')

  let packageJson
  try {
    packageJson = JSON.parse(raw)
  } catch (error) {
    reporter.add('package.json', 'error', 'package.json', `Invalid JSON: ${error}`)
    return
  }

  const scripts = packageJson.scripts ?? {}
  packageJson.scripts = scripts

  const changes = { changed: false }
  const ciGuardCommand = getCiGuardCommand(packageJson)

  ensureScriptValue({
    scripts,
    key: 'ruler:apply',
    value: RULER_APPLY_COMMAND,
    reporter,
    changes
  })

  if (withOptionalSync) {
    ensureScriptValue({
      scripts,
      key: 'skills:sync:claude',
      value: SKILLS_SYNC_COMMAND,
      reporter,
      changes
    })
  }

  const desiredPostinstall = getRecommendedPostinstall({
    withOptionalSync,
    ciGuardCommand
  })

  if (!scripts.postinstall) {
    scripts.postinstall = desiredPostinstall
    changes.changed = true
    reporter.add(
      'package.json',
      'created',
      'scripts.postinstall',
      `Added recommended postinstall (${ciGuardCommand} guard)`
    )
  } else {
    const hasRulerApply = scripts.postinstall.includes('ruler:apply')
    const hasSkillsSync = !withOptionalSync || scripts.postinstall.includes('skills:sync:claude')

    if (hasRulerApply && hasSkillsSync) {
      reporter.add('package.json', 'ok', 'scripts.postinstall', 'Contains required command(s)')
    } else if (!hasRulerApply && mode === 'apply' && !force) {
      scripts.postinstall = `${scripts.postinstall} && (${desiredPostinstall})`
      changes.changed = true
      reporter.add(
        'package.json',
        'updated',
        'scripts.postinstall',
        `Appended CI-guarded Ruler commands using ${ciGuardCommand} while preserving existing postinstall`
      )
    } else if (mode === 'apply' && force) {
      scripts.postinstall = desiredPostinstall
      changes.changed = true
      reporter.add(
        'package.json',
        'overwritten',
        'scripts.postinstall',
        `Replaced with recommended command (${ciGuardCommand} guard) due to --force`
      )
    } else {
      reporter.add(
        'package.json',
        'manual',
        'scripts.postinstall',
        'Existing postinstall kept; update manually if needed'
      )
    }
  }

  if (hasDependency(packageJson, 'is-ci')) {
    reporter.add(
      'package.json',
      'ok',
      'is-ci',
      'Detected dependency. Recommended CI guard style uses `is-ci`.'
    )
  } else {
    reporter.add(
      'package.json',
      'manual',
      'is-ci',
      'Not detected. Install with `pnpm add -D is-ci` to use the `is-ci` CI guard style.'
    )
  }

  if (mode === 'apply' && changes.changed) {
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8')
  }
}

function replaceIgnoreBlock(content, replacementBlock) {
  const startIndex = content.indexOf(IGNORE_START)
  const endIndex = content.indexOf(IGNORE_END)

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return null
  }

  const endMarkerIndex = endIndex + IGNORE_END.length
  const before = content.slice(0, startIndex).trimEnd()
  const after = content.slice(endMarkerIndex).trimStart()

  let merged = replacementBlock
  if (before) {
    merged = `${before}\n\n${merged}`
  }
  if (after) {
    merged = `${merged}\n\n${after}`
  }

  return withTrailingNewline(merged)
}

async function updateGitignore({ targetRoot, mode, force, reporter }) {
  const gitignorePath = path.join(targetRoot, '.gitignore')
  const exists = await pathExists(gitignorePath)

  if (!exists) {
    reporter.add('.gitignore', 'missing', '.gitignore', 'File is missing')
    if (mode === 'apply') {
      await writeFile(gitignorePath, withTrailingNewline(IGNORE_BLOCK), 'utf8')
      reporter.add('.gitignore', 'created', '.gitignore', 'Created with generated-files block')
    }
    return
  }

  const content = await readFile(gitignorePath, 'utf8')

  if (!content.includes(IGNORE_START) || !content.includes(IGNORE_END)) {
    reporter.add('.gitignore', 'missing', '.gitignore', 'Generated-files block is missing')
    if (mode === 'apply') {
      const base = content.trimEnd()
      const next = base ? `${base}\n\n${IGNORE_BLOCK}\n` : `${IGNORE_BLOCK}\n`
      await writeFile(gitignorePath, next, 'utf8')
      reporter.add('.gitignore', 'created', '.gitignore', 'Appended generated-files block')
    }
    return
  }

  const replaced = replaceIgnoreBlock(content, IGNORE_BLOCK)
  if (!replaced) {
    reporter.add('.gitignore', 'manual', '.gitignore', 'Markers malformed; update manually')
    return
  }

  const currentBlockMatches = normalizeContent(content).includes(normalizeContent(IGNORE_BLOCK))
  if (currentBlockMatches) {
    reporter.add('.gitignore', 'ok', '.gitignore', 'Generated-files block already present')
    return
  }

  reporter.add('.gitignore', 'differs', '.gitignore', 'Generated-files block differs')

  if (mode === 'apply' && force) {
    await writeFile(gitignorePath, replaced, 'utf8')
    reporter.add('.gitignore', 'overwritten', '.gitignore', 'Replaced block due to --force')
  }
}

async function validateTargetRoot(targetRoot) {
  let details

  try {
    details = await stat(targetRoot)
  } catch {
    throw new Error(`Target path does not exist: ${targetRoot}`)
  }

  if (!details.isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetRoot}`)
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2))
  await validateTargetRoot(options.target)

  const scriptFile = fileURLToPath(import.meta.url)
  const scriptDir = path.dirname(scriptFile)
  const templatesRoot = path.resolve(scriptDir, '../assets/templates')
  const reporter = createReporter()

  console.log(`Mode: ${options.mode}`)
  console.log(`Target: ${options.target}`)
  console.log(`Optional sync: ${options.withOptionalSync ? 'enabled' : 'disabled'}`)
  console.log(`Force overwrite: ${options.force ? 'enabled' : 'disabled'}`)

  for (const relativePath of TEMPLATE_FILES) {
    await syncTemplateFile({
      relativePath,
      targetRoot: options.target,
      templatesRoot,
      mode: options.mode,
      force: options.force,
      reporter
    })
  }

  await updateGitignore({
    targetRoot: options.target,
    mode: options.mode,
    force: options.force,
    reporter
  })

  await updatePackageJson({
    targetRoot: options.target,
    mode: options.mode,
    force: options.force,
    withOptionalSync: options.withOptionalSync,
    reporter
  })

  reporter.printSummary(options.mode)
}

run().catch((error) => {
  console.error('Failed to bootstrap Ruler integration')
  console.error(error)
  process.exit(1)
})
