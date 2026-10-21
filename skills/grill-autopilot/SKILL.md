---
name: grill-autopilot
description: "Run a grill-with-docs design interview where one AI asks and another AI answers on the user's behalf, researching reuse on GitHub and the web, so the user is only asked about side effects, facts only they know, or hard-to-reverse choices with weak evidence. Any pairing of Claude Code, Codex, Grok or pi accounts. Ends with a decision log, glossary updates and proposed decision records; optionally hands off to planning, a goal or an implementation loop. Use when the user wants a plan or design grilled without answering every question, says 'grill it for me', 'auto grill', 'answer the grill yourself', or asks two agents to interview and answer each other. Chinese triggers: 自动 grill、替我回答、两个 agent 一问一答、别问我、自己拷问方案。Not for grilling the user directly (use grill-with-docs) or reviewing code (use agentic-review-handoff)."
metadata:
  author: adonis
  version: "1.0.0"
---

# Grill Autopilot

A thin orchestrator. It composes existing skills and adds only a deterministic ledger:

| Piece                                                        | Comes from                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Questions, design tree, glossary, decision records           | `grill-with-docs` (`grilling` + `domain-modeling`)                              |
| Headless peers, multi-round sessions, fallback, web research | `agentic-review-handoff` → `review-loop consult` (`--resume`, `--web`, `--raw`) |
| Answer format check, classification, stop rules              | `scripts/grill-ledger.mjs` (this skill)                                         |
| Hand-off after the grill                                     | `writing-plans`, `goal-gate`, `task-completion-loop`                            |

Vocabulary is in `GLOSSARY.md` next to this file: **Interviewer**, **Proxy**, **Escalation**, **Assumption**, **Decision Log**, **Pairing**.

## Contract

- **Delegation.** Invoking this skill delegates every grill answer to the Proxy. This overrides grilling's "decisions are the user's" and its closing confirmation. Never ask the user mid-session; the only user contact is one batch of Escalations at the end.
- **Escalation, and nothing else, reaches the user**: side effects (safety, external send, payment, deletion); facts only the user knows that block later branches; hard-to-reverse choices whose evidence is weak; an answer that changed twice. Changing product behaviour is not an Escalation here: every decision is `proposed` and nothing is implemented.
- **Writes.** The Interviewer and Proxy are read-only. Only this host session writes, and only: `GLOSSARY.md`, decision records (status `proposed`), `docs/grill/YYYY-MM-DD-<topic>.md`, and run state under `.review-handoff/runtime/grill/<topic>/`. No commit, push, install or message.
- **Speed budget.** One Proxy call per round; 10-minute round timeout; at most 8 rounds; target under 15 minutes for the whole session.

## 0. Preflight (one tool round)

1. Confirm the skills are installed: `grilling`, `domain-modeling` (or `grill-with-docs`) and `agentic-review-handoff`. Missing → stop and give the one install line: `npx skills add mattpocock/skills --skill grill-with-docs --skill grilling --skill domain-modeling` / `npx skills add adonis0123/adonis-skills --skill agentic-review-handoff`.
2. `RL=<agentic-review-handoff dir>/scripts/review-loop.mjs`, `LEDGER=<this skill dir>/scripts/grill-ledger.mjs`, `REPO=<repo root>`, `TOPIC=<kebab-case topic>`, `RUN=$REPO/.review-handoff/runtime/grill/$TOPIC`. Export `REVIEW_LOOP_TIMEOUT_MS=600000`.
3. Read `GLOSSARY.md`, `docs/` decision records and `AGENTS.md`/`CLAUDE.md` for binding rules (decision-record location and naming follow the repo; default `docs/adr/`).
4. Parse options: `--interviewer <account>`, `--proxy <account>`, `--then plan|goal|loop`. Accounts are launcher names (`cc002`, `codex003`, `grok002`, `pi-…`); the product is the name's family.

## 1. Pairing

- **Interviewer**: this host session, running `grill-with-docs` itself. With `--interviewer`, an external session driven by `references/interviewer-brief.md` through `consult --raw` with its own `--resume` chain.
- **Proxy**: a product different from the Interviewer's, so one model does not grade its own questions.
  - `--proxy <account>` → `--peer=<family> --peer-command=<account>`.
  - Otherwise, when the Interviewer is pi, read `review-loop prefs`, choose the first product in its saved `order` (`claude`, `codex` or `grok`), and pass it explicitly as `--peer=<product>`. Do not pass `--host=pi`: preference routing accepts only the three reviewer products. Pass the remaining saved products in order as `--fallback=<product,product>`; omit this flag when none remain. Read preferences with `node "$RL" prefs`, without changing them.
  - For other Interviewer products, `--host=<Interviewer product> --skip-host` lets the saved Reviewer preference pick it (`review-loop prefs`).
  - pi has no web search; it can be the Interviewer but not the Proxy.
- **Red-team** (step 4): a third product used by neither role, or skipped when none is installed.

State the pairing in one line when starting, then keep going.

## 2. Round loop

Each round:

1. **Interviewer turn.** Produce the frontier exactly as `grilling` says, numbering questions `Q<n>` across the whole session (re-asked questions keep their id). Treat `Decided` and `Assumption` answers as the user's; treat `Escalation` questions as open and do not ask what depends on them.
2. **Proxy turn.** Write the questions to `$RUN/round-<n>.md`.
   - Round 1: fill `references/proxy-brief.md` with the plan, repo root and binding rules, append the questions, then
     `node "$RL" consult --repo "$REPO" <pairing flags> --web --raw --question-file "$RUN/round-1.md"`.
   - Later rounds: `node "$RL" consult --repo "$REPO" --resume <recordPath> --web --raw --question-file "$RUN/round-<n>.md"` (same `recordPath` every round).
   - Save the result's `text` to `$RUN/answers-<n>.md`.
3. **Gate.** `node "$LEDGER" check --answers="$RUN/answers-<n>.md" --ledger="$RUN/ledger.json" --round=<n>`.
   - Exit 1 with `reask`: resume the Proxy once with only those ids and their `fix` lines, then rerun with `--attempt=2`. A block still broken becomes an `UNVERIFIED` Assumption, except a recognized escalation condition (`side-effect`, `fact`, `OPEN`, or `costly` with `low` confidence) remains an `UNVERIFIED` Escalation; never ask a third time.
4. **Record inline.** Resolved terms go into `GLOSSARY.md` now (domain-modeling rules: no implementation details). Offer a decision record only when domain-modeling's three conditions hold; write it with status `proposed`.
5. **Stop** when the Interviewer's frontier is empty or the ledger's `stop` is non-empty.

**Failures.**

| Result                                     | Action                                                                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fallbacks` present or `contextLost: true` | The new Proxy session cannot see earlier rounds: start the next prompt with a short ledger summary (id, decision, status).                                                                                                        |
| Timeout with no fallback left              | Stop the loop and report `DELIVERY_UNKNOWN`; preserve the session for inspection. Do not resubmit to the same product or switch accounts within its family. Only the consult script may advance its configured fallback products. |
| Any other failure                          | Stop the loop, report it, keep the ledger.                                                                                                                                                                                        |

## 3. Red-team (only when needed)

If `totals.hardToReverseDecided` is non-empty, run one advisory `consult` (not `--raw`, with `--web`) on the red-team product. Give it only those decisions with their reason and evidence, and ask for `hold` or `overturn: <why>` per id. Each `overturn` becomes an Escalation. No hard-to-reverse decisions → skip; say so in the log.

## 4. Escalations and close

1. Write the decision log from `references/decision-log-template.md`.
2. No Escalations → done, no question to the user.
3. Escalations → one batch through the host's question tool, at most 4 per call, ranked costly first, then low confidence. Each shows the Proxy's recommendation as the first option. No question tool → a `需要你拍板` heading followed by the numbered questions.
4. Answers that unblock the frontier → up to 2 more rounds, then update the log. These answers are the user's, so record them as `Decided`.
5. `--then`: `plan` → `writing-plans` with the log as the spec; `goal` → `goal-gate`; `loop` → `task-completion-loop`. Those skills apply their own gates; the delegation here does not carry over to implementation side effects.

## Report

One short block: pairing, rounds and stop reason, duration, counts of Decided / Assumption / Escalation, red-team result, files written, anything `UNVERIFIED` or skipped.
