# mattpocock@wayfinder single-skill trial (2026-09-09)

Baseline for [skills.sh/mattpocock/skills/wayfinder](https://www.skills.sh/mattpocock/skills/wayfinder). Re-inventory before treating as forever.

## Verdict

| Field    | Value                                                   |
| -------- | ------------------------------------------------------- |
| Choice   | **B** — do not permanent install                        |
| Status   | temporary-only `/tmp/wayfinder-eval-20260908/`          |
| Peers    | Claude **B** · Codex **B** · Grok **B**                 |
| Upstream | `3cca18b` 2026-09-04; SKILL.md sha256 `fee6e1d0…3aa0f1` |

## What it is

Slash-only (`disable-model-invocation` + `allow_implicit_invocation: false`) multi-session **decision map** on the issue tracker. Tickets are questions (grilling / prototype / research / task), not build slices. Plan don’t do. One HITL ticket per session. Cleared map → `to-spec` → `to-tickets` → `implement`.

Needs tracker wiring from `setup-matt-pocock-skills` (not installed; must not run during eval). Fallback: local markdown `.scratch/`.

## Why B

- Local **`discuss-before-plan` + `grilling` + `workflow-gate` + `writing-plans` / host `plan` + the primary tracker** already covers decide → plan → queue.
- Hard dual-track: GitHub/`.scratch` maps vs the existing tracker / chat intake / code host.
- Downstream `to-tickets` / `implement` / `prototype` / Matt `research` not installed — map has nowhere to hand off in this stack.
- Real exercise: an internal-beta feedback sink map, 4 tickets, resolved research 04 + grilling 01, frontier → 02. **Usable ≠ gap** (same job is one Decision Summary).

## Use instead

1. `discuss-before-plan`
2. `grilling` / `grill-with-docs`
3. Primary tracker + `writing-plans` / `to-spec`

## When to revisit A

Only if a real multi-session foggy epic **loses frontier** under Decision Summary + the primary tracker, **and** the map is allowed as that epic’s only decision store without setup rewriting agent docs. Work queue stays in the existing tracker → never. **Never** dual always-on.

## Process-skill note

Do not score from SKILL.md prose. Chart one disposable local-markdown map, resolve one ticket, record HITL simulation. Never run setup. Upstream FAQ: agents may write “this map carries execution” into Notes — treat as a known hole, not a reason to install.
