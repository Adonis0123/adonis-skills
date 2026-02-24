import { spawn } from 'node:child_process'
import { cp, readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkbox, confirm, select } from '@inquirer/prompts'

type CliOptions = {
  all: boolean
  dryRun: boolean
  interactive: boolean
  skills: string[]
  syncLlm: boolean
}

type SelectionResult =
  | {
      action: 'exit'
    }
  | {
      action: 'install'
      installAll: boolean
      skills: string[]
    }

function getOptionValue(args: string[], index: number, key: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${key}`)
  }
  return value
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

function parseArgs(argv: string[]): CliOptions {
  let all = false
  let dryRun = false
  let interactive = true
  let interactiveSpecified = false
  const skills: string[] = []
  let syncLlm = false
  let selectionSpecified = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      continue
    }

    if (arg === '--all') {
      all = true
      selectionSpecified = true
      continue
    }

    if (arg === '--dry-run') {
      dryRun = true
      continue
    }

    if (arg === '--interactive') {
      interactive = true
      interactiveSpecified = true
      continue
    }

    if (arg === '--no-interactive') {
      interactive = false
      interactiveSpecified = true
      continue
    }

    if (arg === '--sync-llm') {
      syncLlm = true
      continue
    }

    if (arg.startsWith('--skill=')) {
      skills.push(arg.slice('--skill='.length).trim())
      selectionSpecified = true
      continue
    }

    if (arg === '--skill') {
      skills.push(getOptionValue(argv, index, '--skill').trim())
      index += 1
      selectionSpecified = true
      continue
    }

    if (arg === '--help') {
      printHelp()
      process.exit(0)
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  const normalizedSkills = dedupe(skills.filter(Boolean))
  if (all && normalizedSkills.length > 0) {
    throw new Error('Cannot combine --all with --skill')
  }

  if (selectionSpecified && !interactiveSpecified) {
    interactive = false
  }

  if (!interactive && !all && normalizedSkills.length === 0) {
    throw new Error('Use --skill <slug> (repeatable) or --all when non-interactive')
  }

  return {
    all,
    dryRun,
    interactive,
    skills: normalizedSkills,
    syncLlm,
  }
}

function printHelp() {
  console.log('Usage: node --experimental-strip-types ./scripts/install-local-skills.ts [options]')
  console.log('')
  console.log('Options:')
  console.log('  --interactive          Open interactive select/checkbox menus (default)')
  console.log('  --no-interactive       Disable interactive mode')
  console.log('  --skill <slug>         Install a specific skill (repeatable)')
  console.log('  --all                  Install all skills')
  console.log('  --sync-llm             Sync .agents/skills -> .claude/skills after install')
  console.log('  --dry-run              Print planned commands without executing')
  console.log('  --help                 Show help')
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
    console.log(`[skills:install:local] Dry run: ${display}`)
    return
  }

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

async function resolveRepoRoot(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  return path.resolve(__dirname, '..')
}

async function loadAvailableSkills(repoRoot: string): Promise<string[]> {
  const skillsDir = path.resolve(repoRoot, 'skills')
  const entries = await readdir(skillsDir, { withFileTypes: true })

  const slugs: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      continue
    }

    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md')
    const skillStats = await stat(skillFile).catch(() => null)
    if (!skillStats?.isFile()) {
      throw new Error(`[${entry.name}] Missing SKILL.md`)
    }

    slugs.push(entry.name)
  }

  if (slugs.length === 0) {
    throw new Error('No skills found in ./skills')
  }

  return slugs.sort((a, b) => a.localeCompare(b))
}

async function runInteractiveSelection(skills: string[]): Promise<SelectionResult> {
  const action = await select({
    message: 'Select installation method',
    choices: [
      {
        name: 'Install selected skills',
        value: 'selected',
      },
      {
        name: 'Install all skills',
        value: 'all',
      },
      {
        name: 'Exit',
        value: 'exit',
      },
    ],
  })

  if (action === 'exit') {
    return { action: 'exit' }
  }

  if (action === 'all') {
    const accepted = await confirm({
      message: `Confirm installing all skills (${skills.length} total)?`,
      default: true,
    })

    if (!accepted) {
      return { action: 'exit' }
    }

    return {
      action: 'install',
      installAll: true,
      skills: [],
    }
  }

  const selected = await checkbox({
    message: 'Select skills to install (space to toggle, enter to confirm)',
    choices: skills.map((slug) => ({
      name: slug,
      value: slug,
    })),
    loop: false,
    required: true,
  })

  const accepted = await confirm({
    message: `Confirm installing ${selected.length} skill(s)?`,
    default: true,
  })

  if (!accepted) {
    return { action: 'exit' }
  }

  return {
    action: 'install',
    installAll: false,
    skills: selected,
  }
}

async function mergeSkillFiles(options: {
  repoRoot: string
  slugs: string[]
  dryRun: boolean
}) {
  const { repoRoot, slugs, dryRun } = options
  const skillsDir = path.join(repoRoot, 'skills')
  const agentsSkillsDir = path.join(repoRoot, '.agents/skills')

  for (const slug of slugs) {
    const src = path.join(skillsDir, slug)
    const dest = path.join(agentsSkillsDir, slug)

    // Only merge into directories that npx skills already installed
    const destExists = await stat(dest).then(() => true).catch(() => false)
    if (!destExists) continue

    if (dryRun) {
      console.log(`[skills:install:local] Dry run: merge ${src} -> ${dest}`)
      continue
    }

    await cp(src, dest, { recursive: true, force: true })
    console.log(`[skills:install:local] Merged skill files: ${slug}`)
  }
}

async function installSkills(options: {
  dryRun: boolean
  installAll: boolean
  repoRoot: string
  skills: string[]
}) {
  const { dryRun, installAll, repoRoot, skills } = options
  let installedSlugs: string[]

  if (installAll) {
    await runCommand({
      command: 'npx',
      args: ['-y', 'skills', 'add', './skills', '-a', 'codex', '-y', '--skill', '*'],
      cwd: repoRoot,
      dryRun,
    })
    installedSlugs = await loadAvailableSkills(repoRoot)
  } else {
    for (const skill of skills) {
      await runCommand({
        command: 'npx',
        args: ['-y', 'skills', 'add', './skills', '-a', 'codex', '-y', '--skill', skill],
        cwd: repoRoot,
        dryRun,
      })
    }
    installedSlugs = skills
  }

  // npx skills filters out certain files (e.g. _-prefixed). Merge to ensure
  // .agents/skills/ is a complete mirror of skills/.
  await mergeSkillFiles({ repoRoot, slugs: installedSlugs, dryRun })
}

async function syncLlmSkills(repoRoot: string, dryRun: boolean) {
  await runCommand({
    command: process.execPath,
    args: ['--experimental-strip-types', './scripts/sync-llm-skills.ts'],
    cwd: repoRoot,
    dryRun,
  })
}

function ensureKnownSkills(selected: string[], available: string[]) {
  const availableSet = new Set(available)
  const unknown = selected.filter((skill) => !availableSet.has(skill))
  if (unknown.length > 0) {
    throw new Error(`Unknown skills: ${unknown.join(', ')}`)
  }
}

async function main() {
  const cliOptions = parseArgs(process.argv.slice(2))
  const repoRoot = await resolveRepoRoot()
  const availableSkills = await loadAvailableSkills(repoRoot)

  let installAll = cliOptions.all
  let targetSkills = cliOptions.skills

  if (cliOptions.interactive) {
    const selection = await runInteractiveSelection(availableSkills)
    if (selection.action === 'exit') {
      console.log('[skills:install:local] Canceled by user')
      return
    }

    installAll = selection.installAll
    targetSkills = selection.skills
  } else {
    ensureKnownSkills(targetSkills, availableSkills)
  }

  if (!installAll && targetSkills.length === 0) {
    throw new Error('No skills selected')
  }

  console.log(
    `[skills:install:local] Installing ${installAll ? `all skills (${availableSkills.length})` : targetSkills.join(', ')}`,
  )
  await installSkills({
    dryRun: cliOptions.dryRun,
    installAll,
    repoRoot,
    skills: targetSkills,
  })

  if (cliOptions.syncLlm) {
    console.log('[skills:install:local] Syncing .agents/skills -> .claude/skills')
    await syncLlmSkills(repoRoot, cliOptions.dryRun)
  }
}

main().catch((error: unknown) => {
  console.error('[skills:install:local] Failed')
  console.error(error)
  process.exit(1)
})
