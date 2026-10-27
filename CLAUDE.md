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
- `skills/desktop-agent-activity`, `skills/installed-app-feature-inventory`, and `skills/dev-environment-roi-audit` are exported from a private source (listed in `.export-manifest.json`). Treat them as generated: edit the private source, not these copies; the next export overwrites local edits.
- `apps/web/src/generated/skills-index-lite.json`, `skills-detail-index.json`, and `skills-catalog-layout.json` are generated web build inputs. After changing public skills, run `pnpm skills:validate` and `pnpm skills:index`; never edit the index manually.
- Every public skill needs an entry under `skills:` in `apps/web/content/skill-catalog.yaml` (Display Name, Scenario Group, Visitor-facing tags, summary, and use cases in English and Chinese); the same file holds the ordered `groups` and `featured` lists. `pnpm skills:validate` fails without them. Keep this copy out of SKILL.md frontmatter: the Agent Skills spec allows only string `metadata` values.

## Install Targets

| Host                                    | Command                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex, Cursor, other `skills` CLI hosts | `npx skills add adonis0123/adonis-skills --skill <name>` (`-g` global, `--list` to list)                                                             |
| Claude Code                             | `/plugin marketplace add Adonis0123/adonis-skills`, then `/plugin install adonis-skills@adonis-skills` (manifest: `.claude-plugin/marketplace.json`) |
| Hermes Agent                            | `hermes skills tap add adonis0123/adonis-skills`                                                                                                     |

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

`pnpm dev` serves the web app at `http://localhost:3000`. After a UI change, open it and check a screenshot before reporting done.

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

### Catalog entry for a new or changed public skill

When you add a public skill or change what one does, write its `apps/web/content/skill-catalog.yaml` entry yourself in the same change; do not leave it for the user. Follow the root `DESIGN.md` and the existing entries:

- `displayName`: a short Title Case English name a Visitor understands without knowing the slug, plus a natural Chinese name (not a word-for-word translation). The slug stays the install identifier.
- `group`: the one existing Scenario Group a Visitor would look in. Add a new group only when none fits; a new group needs `title`, `summary` (en/zh) and an illustration.
- `summary` and `use_cases` in English and Chinese, written for a Visitor, not for the agent; `tags` from `SKILL_TAGS`.
- `featured` is curated by the maintainer: change it only when asked. A newly featured skill needs its own illustration.
- Illustrations follow `DESIGN.md` → Illustration: transparent clay art generated with Codex image generation from the hero reference, no text. Add the PNG and WebP to `adonis-brand/projects/skills/illustrations/`, register the copy in `adonis-brand/data/consumers.json`, then copy the WebP to `apps/web/public/brand/illustrations/`.
- Then run `pnpm skills:validate` and `pnpm skills:index` and stage the regenerated `apps/web/src/generated/`. The pre-commit hook runs `scripts/precommit-skills.mjs`, which blocks a commit touching `skills/` or the catalog when validation fails or the generated index is stale.

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

- Before changing web visuals, read the root `DESIGN.md` (what the site looks like) and `docs/web-ui-clay-contract.md` (how this repo implements it); both are mandatory. `DESIGN.md` is generated by `pnpm brand:sync` from the private `adonis-brand` repo: never edit it here.
- Colors come from the design system in the private `adonis-brand` repo (`design-system/tokens.json`; `projects/skills/theme.json` picks the accent theme, currently `leaf`). Components use design-system roles only. `apps/web/src/styles/brand-tokens.css` and `theme-roles.css` are generated: change the brand repo, then run `pnpm brand:sync`; CI runs `pnpm brand:check`.
- Do not apply its visual rules to scripts, skills, or non-web packages.
- In particular, never add bottom outer highlight lines such as `0 1px 0 ...` to raised or floating shadows.
