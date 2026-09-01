# Route adjustments

Fallback-only. Do not load this file for Architecture / Review-Handoff / Challenge / Discuss — those already live in SKILL.md precedence + tiebreakers. Use this only when the Route picked from the cheat card still doesn't fit on closer inspection. Each rule names _why_ it exists so you can generalize when the literal trigger doesn't match.

## Upgrade — smaller Route is unsafe

- _Any → Light:_ the task involves a file write, verification, or repo mutation. _Why:_ writes are decisions, not lookups.
- _Light → Discuss:_ behavior ambiguous, output undefined, or 2+ implementations with different tradeoffs. _Why:_ committing without alignment guarantees rework.
- _Any → Discuss:_ `destructive=yes` (drop table, force push, delete prod data, schema break, public API removal). _Why:_ failure cost dwarfs one discussion round. (This is Rule #1; restated for completeness.)
- _Any → Review-Handoff:_ user asks for cross-agent / packet review or fix-then-re-review. _Why:_ review skills keep eyes fresh.
- _Light/Plan → Architecture:_ user names a path/module and asks to diagnose structure or run a bounded harden loop. _Why:_ architecture jobs are not ordinary plans or typo-scale edits.
- _Direct/Light → Challenge:_ creative HARD-GATE work without a paid design/spec. _Why:_ implementation without a thesis burns rework.

## Downgrade — heavier Route is ceremony

- _Challenge → Direct/Light:_ the request is not creative HARD-GATE work, or the prompt/spec already fixes the relevant design and behavior. _Why:_ re-challenging wastes their signal only after the design decision has been paid.
- _Discuss → Light:_ one reasonable implementation; user supplied exact behavior. _Why:_ alignment is implicit.
- _Plan → Light:_ the immediate request is direct implementation, regardless of file count. _Why:_ scope changes risk and verification depth, not user intent; a user-facing plan would be overhead.
- _Architecture + unresolved scope → Architecture + `Runtime skill: none`:_ first try user-supplied attachment/reference/Git locators plus one cheap repo signal; only then ask one minimal scope question and do not load a scanner. _Why:_ scanners without a frozen file set become whole-repo thrash, while making users repeat already-resolvable scope wastes a full round trip.
- _Architecture → Light/Discuss:_ the ask is really a bug symptom or product decision rather than structure work. _Why:_ bugs belong to systematic-debugging; named-option decisions belong to Discuss.
- _architecture-hardening-loop → improve-codebase-architecture:_ user asked only for diagnosis/report. _Why:_ harden loops mutate code; diagnose must not silently upgrade.
- _Review-Handoff → inline review:_ no git repo or no packet needed. _Why:_ `agentic-review-handoff` requires a git repo.

## Re-gate mid-task

Re-run the cheat card and precedence rules when the active Route's preconditions change:

- A new destructive signal surfaces (e.g. mid-Plan you find the migration drops a column).
- Scope grows beyond the current plan assumptions or shrinks to one obvious file.
- A new blocking bug appears (Plan → Light + `systematic-debugging` until it closes).
- User adds "don't ask" / "discuss first".
- Architecture diagnose finishes and the user then explicitly asks to harden/implement in the same frozen scope → re-gate to Architecture + `architecture-hardening-loop`.
- Challenge `agent-strawman` is confirmed by the user, or explicitly delegated as a reversible product direction → load grilling / grill-with-docs (do not re-emit a different Route unless signals changed).

Re-gate only when a listed precondition changes; do not re-run it as routine ceremony.
