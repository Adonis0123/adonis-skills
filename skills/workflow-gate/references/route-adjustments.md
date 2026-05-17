# Route adjustments

Use this only when the Route picked from the cheat card doesn't fit on closer inspection. Each rule names *why* it exists so you can generalize when the literal trigger doesn't match.

## Upgrade — smaller Route is unsafe

- *Any → Light:* the task involves a file write, verification, or repo mutation. *Why:* writes are decisions, not lookups.
- *Light → Discuss:* behavior ambiguous, output undefined, or 2+ implementations with different tradeoffs. *Why:* committing without alignment guarantees rework.
- *Any → Discuss:* `destructive=yes` (drop table, force push, delete prod data, schema break, public API removal). *Why:* failure cost dwarfs one discussion round. (This is Rule #1; restated for completeness.)
- *Plan → Full:* ≥ 3 bounded contexts AND parallel agents would shorten wall-clock time. *Why:* serial executor bottlenecks fan-out.
- *Any → Review-Handoff:* user asks for cross-agent / packet review or fix-then-re-review. *Why:* review skills keep eyes fresh.

## Downgrade — heavier Route is ceremony

- *Brainstorm → Direct/Light:* the request is not creative HARD-GATE work, or the prompt/spec already fixes the relevant design and behavior. *Why:* re-exploring wastes their signal only after the design decision has been paid.
- *Discuss → Light:* one reasonable implementation; user supplied exact behavior. *Why:* alignment is implicit.
- *Plan → Light:* one or two files, obvious task list. *Why:* not a plan, just overhead.
- *Full → Plan:* sequential or context-heavy. *Why:* `subagent-driven-development` only pays off on real fan-out.
- *Review-Handoff → inline review:* no git repo or no packet needed. *Why:* `agentic-review-handoff` requires a git repo.

## Re-gate mid-task

Re-run the cheat card and precedence rules when the active Route's preconditions change:

- A new destructive signal surfaces (e.g. mid-Plan you find the migration drops a column).
- Scope crosses a Plan/Full threshold (≥ 3 bounded contexts or shrinks to one file).
- A new blocking bug appears (Plan → Light + `systematic-debugging` until it closes).
- User adds "don't ask" / "discuss first".

Re-gating costs ~30 sec; riding a stale Route costs hours.
