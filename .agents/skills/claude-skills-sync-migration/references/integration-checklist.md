# Integration Checklist

Use this checklist when migrating the skill-sync workflow to another repository.

## 1. Runtime Requirements

- Node.js >= 22.6.0 (required for `--experimental-strip-types`).
- Target repository must have a writable `package.json`.
- The generated command assumes TypeScript script execution via:
  - `node --experimental-strip-types ./scripts/sync-llm-skills.ts`

## 2. Source and Target Directory Rules

- Default source directory: `.agents/skills`
- Default target:
  - `.claude/skills`
- Generated script supports runtime overrides:
  - `--source=<path>`
  - `--targets=claude`
  - `--dry-run`
- Source directory must exist and be a directory; otherwise the script exits with code `1`.
- Sync replacement must be atomic:
  - stage copy to `target.__tmp__`
  - switch target via rename
  - keep rollback path with `target.__bak__` when switch fails

## 3. package.json Injection Rules

- Ensure `scripts.skills:sync:llm` exists and points to the generated TS script.
- Ensure `is-ci` dependency exists:
  - if missing in `dependencies` and `devDependencies`, bootstrap must add `devDependencies.is-ci` (default `^4.1.0`)
- Ensure `.gitignore` includes `/.claude/skills`.
- Ensure `--script-name` validation is enforced:
  - allowed pattern: `[A-Za-z0-9:._-]+`
  - invalid names (for example `skills:sync:llm;rm -rf /`) must fail with non-zero exit code
- Ensure `postinstall` merge policy is append-only:
  - no existing `postinstall` -> create `is-ci && echo 'Skipping <script-name> in CI environment' || <runner> <script-name>`
  - existing `postinstall` without sync command -> append `&& (is-ci && echo 'Skipping <script-name> in CI environment' || <runner> <script-name>)`
  - existing `postinstall` already contains exact sync command/invocation -> no duplicate append
  - similar substring names (for example `my-skills:sync:llm-extra`) must not block append

## 4. Monorepo vs Single Repository Notes

- Monorepo:
  - run bootstrap from repository root (the `package.json` you want to update)
  - keep source path relative to that root unless explicitly overridden
  - align runner with root package manager (`pnpm`, `yarn`, `bun`, `npm`)
- Single repository:
  - defaults work directly if `.agents/skills` exists in root
  - use `--source` when the skill catalog lives elsewhere

## 5. Verification Commands

- Dry run:
```bash
pnpm run skills:sync:llm -- --dry-run
```

- Claude only:
```bash
pnpm run skills:sync:llm -- --targets=claude
```

- Full sync:
```bash
pnpm run skills:sync:llm
```

## 6. Safety Regression Checks

- Invalid script name is rejected:
```bash
node ./scripts/bootstrap-sync-skills.mjs --script-name='skills:sync:llm;echo x'
```
- Missing `is-ci` is auto-installed:
  - precondition: no `is-ci` in `dependencies`/`devDependencies`
  - expected: bootstrap writes `devDependencies.is-ci`
- `.gitignore` is updated:
  - precondition: `.gitignore` does not contain `/.claude/skills`
  - expected: bootstrap appends `/.claude/skills`
- Postinstall substring false-positive is avoided:
  - precondition: `postinstall` contains `my-skills:sync:llm-extra`
  - expected: bootstrap still appends real sync command
- Sync failure does not wipe target directory:
  - simulate copy/switch failure
  - verify target is still present or recovered from backup
