# mattpocock shortlist re-inventory — 2026-08-07

Session pattern: user drops multiple skills.sh links + “叫 Claude/Codex/Grok 测评”.  
Route: **package shortlist / multi-skill inventory**, not UI artifact A/B, not permanent install.

## Aliases

| User / skills.sh | Upstream folder   |
| ---------------- | ----------------- |
| diagnose         | `diagnosing-bugs` |
| code-design      | `codebase-design` |

## Temp evidence

- Clone: `/tmp/mattpocock-skills-eval-20260807/repo` @ `84fdeff`
- Artifacts: `INVENTORY.md`, `PEER_REVIEW_PROMPT.md`, `PEER_SUMMARY.md`, peer-\*.md

## Hash-match already present (5)

`grill-me`, `grill-with-docs`, `domain-modeling`, `codebase-design`, `handoff`  
(also related installed: grilling, to-spec, improve-codebase-architecture, teach)

## Missing (6) → default B

| Skill                        | Dual-track / alt                                                                        | Peer lean                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| tdd                          | `test-driven-development` (heavier)                                                     | Claude weak C; Grok B → synth **B**                                             |
| prototype                    | host-local `spike` skill                                                                | Grok weak C; Claude B → synth **B** (C only for LOGIC HTML / multi-UI variants) |
| setup-matt-pocock-skills     | rewrites CLAUDE/AGENTS + `docs/agents/*`                                                | **B hard**                                                                      |
| triage                       | primary tracker + chat intake + code host dual queue                                    | **B hard**                                                                      |
| code-review                  | requesting-code-review, agentic-review-handoff, code-host CR, open-code-review-delegate | **B**                                                                           |
| diagnose (`diagnosing-bugs`) | `systematic-debugging`                                                                  | **B** (historical C only if red-loop gap on real bug)                           |

## Peer outcomes

| Peer          | Package | Notes                           |
| ------------- | ------- | ------------------------------- |
| Claude (Opus) | C-lean  | only tdd as C                   |
| Grok          | B       | only prototype as C             |
| Codex         | n/a     | usage limit; do not invent vote |

## Synthesis (locked for the owner)

- **Package B** — do not full-install
- Permanent new installs: **none**
- Optional weak C: prototype or tdd only after a real task proves lower mental load than local alt
- Install status that session: temporary-only eval dir; no global add

## Peer CLI lessons (also in peer-review-cli\*)

- Claude: max-turns **8** + `--append-system-prompt` “Do not run tools…”
- Codex usage limit → n/a + continue
- Grok: neutral `/tmp/.../xai-cli` binary copy; extract JSON `text`
