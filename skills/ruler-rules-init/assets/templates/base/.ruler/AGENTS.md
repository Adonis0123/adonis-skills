---
applyTo: '**'
---

# AI Collaboration Guidelines

The `.ruler/*.md` files are the single source of truth for repository AI rules.
Run `ruler apply --agents codex,claude` to generate root `AGENTS.md` and `CLAUDE.md`.

These baseline rules apply to both Codex and Claude:

- Communicate primarily in English unless project rules state otherwise.
- Read repository context before making implementation decisions.
- Keep changes minimal and focused on the task objective.
