# Repository Instructions

## Language

- Respond in Chinese unless the user requests another language.
- Use English for code, file names, commands, and commit messages.

## Git Delivery Authorization

- An explicit `commit-push` invocation authorizes committing the selected change set and pushing the current branch to its configured upstream, including `main` or `master`; do not ask for a second protected-branch confirmation.
- Before committing, inspect the branch, upstream, staged diff, and verification. Never force-push. Stop for secrets, unrelated staged changes, a missing or unexpected push target, or a failed push.

## Repository Model

- `skills/<slug>/` contains public skills indexed by the web app; `.agents/skills/` contains internal tooling and is not published.
- `.claude/skills` is a symlink to `.agents/skills` for local runtime testing.
- `apps/web/src/generated/skills-index.json` is generated and is a web build input. After changing public skills, run `pnpm skills:validate` and `pnpm skills:index`; never edit the index manually.

## Commands

```bash
pnpm skills:new
pnpm skills:init <skill-name> --path skills
pnpm skills:quick-validate skills/<skill-slug>
pnpm skills:openai-yaml skills/<skill-slug>
pnpm skills:validate
pnpm skills:index
pnpm skills:install:local [-- --all | --skill <name>]
pnpm skills:test:local [-- --all | --skill <name>]
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
```

- Use `pnpm skills:new` for the normal create, validate, and index flow.
- Add OpenAI metadata only when needed, using `pnpm skills:openai-yaml`.
- For app/runtime changes, run the relevant lint, typecheck, and build checks.

## Repository Conventions

- Keep changes minimal and match existing script and file naming.
- Prefer deterministic scripts over repeated manual steps.
- Change generated artifacts through their source script, then regenerate them.
- Pass script arguments explicitly through `--` in docs and CI when pnpm parsing would be ambiguous.

## Documentation Conventions

- A documented directory must contain canonical English `README.md` and matching Chinese `README.zh-CN.md`.
- Keep both files structurally and semantically aligned, including commands, and add reciprocal language links.
- Every README change must update both files in the same change.

## Skill Authoring

- Use lowercase hyphen-case for skill directories and frontmatter `name`.
- Every `skills/<slug>/SKILL.md` requires non-empty `name` and `description`; CI validates these two fields.
- Add `scripts/`, `references/`, `assets/`, or other documentation only when operationally needed.
- Add `agents/openai.yaml` only for downstream OpenAI metadata integration and generate it with `pnpm skills:openai-yaml`.
- Public skills live in `skills/`; internal skills live in `.agents/skills/` and are not indexed.

```yaml
---
name: skill-name
description: "When and why to use this skill"
allowed-tools: Read, Bash # optional
metadata: # optional
  author: your-name
  version: "1.0.0"
---
```

## Web Coding (`apps/web/**`)

- Use TypeScript and function components; follow existing imports, naming, and nearby test placement.
- Document non-obvious tradeoffs in PR descriptions.
- Prefer ahooks `useLocalStorageState` over direct `window.localStorage`. If direct access is required, document why in code.

## Plan Mode Major Changes

- This section applies only in Plan mode.
- A change is major when it crosses modules/directories, changes public interfaces/architecture/core data flow, or is expected to touch at least 5 files.
- Create one `docs/plan-YYYY-MM-DD-topic.md` per major change; use lowercase kebab-case matching `^plan-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+\.md$`.
- Include background, goals, scope, solution, risks, and acceptance criteria.

## Web UI Contract (`apps/web/src/**` only)

- Before changing web visuals, read `docs/web-ui-clay-contract.md`; its scope and prohibitions are mandatory.
- Do not apply its visual rules to scripts, skills, or non-web packages.
- In particular, never add bottom outer highlight lines such as `0 1px 0 ...` to raised or floating shadows.
