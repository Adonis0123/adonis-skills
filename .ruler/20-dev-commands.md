---
applyTo: '**'
---

## Development Commands

```bash
# Skills management
pnpm skills:new                                      # interactive: create + quick-validate + validate + index
pnpm skills:init <skill-name> --path skills          # scaffold skill directory only
pnpm skills:quick-validate skills/<skill-slug>       # validate single skill frontmatter
pnpm skills:openai-yaml skills/<skill-slug>          # generate skills/<slug>/agents/openai.yaml
pnpm skills:validate                                 # validate all skills (blocks CI on failure)
pnpm skills:index                                    # regenerate apps/web/src/generated/skills-index.json
pnpm skills:install:local [-- --all | --skill <name>] # install skills/ → .agents/skills/
pnpm skills:test:local [-- --all | --skill <name>]    # install + sync → .claude/skills/
pnpm skills:sync:llm                                 # sync .agents/skills/ → .claude/skills/

# AI rules
pnpm ruler:apply                                     # regenerate CLAUDE.md + AGENTS.md from .ruler/*.md

# Web app
pnpm dev
pnpm build
pnpm lint
pnpm typecheck
```

## Recommended Local Validation Flow

1. For a new skill, run `pnpm skills:new` (or `pnpm skills:init ...`) and ensure frontmatter is complete.
2. If OpenAI skill metadata is needed, run `pnpm skills:openai-yaml skills/<skill-slug>`.
3. Run `pnpm skills:quick-validate skills/<skill-slug>`.
4. Run `pnpm skills:validate` for repository-wide checks.
5. Run `pnpm skills:index` to refresh `apps/web/src/generated/skills-index.json`.
6. If local agent testing is needed, run `pnpm skills:install:local` or `pnpm skills:test:local`.
7. For app/runtime changes, run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.

## Updating AI Rules

Edit files in `.ruler/*.md`, then run `pnpm ruler:apply` to regenerate `CLAUDE.md` and `AGENTS.md`. Never edit `CLAUDE.md` or `AGENTS.md` directly.
