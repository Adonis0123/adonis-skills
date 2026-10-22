# Launching, messaging and resuming Workers

Read this before starting any headless Worker, sending a fix round, or resuming a session. Use the `<command>` the probe reports per account (`accounts.md`); through sideby it already ends in `--`, a hand-written accounts-file command may not.

## Headless launch shapes

| Product     | One-shot                                                                                                                                                                                              | Next round                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Claude Code | `cd <worktree> && <command> -p "$(cat <spec>)" --output-format stream-json --verbose --allowedTools <list> --settings '{"crossSessionInbound":"accept"}' < /dev/null > <lane>.jsonl 2> err.log` | `<command> --resume <session_id> -p "<delta>" ...` |
| Codex       | `<command> exec --json -C <worktree> -s workspace-write -o <out.md> - < <spec> > <lane>.jsonl`                                                                                                        | `<command> exec resume <session> ...`              |
| Grok Build  | `<command> --cwd <worktree> --prompt-file <spec> --output-format streaming-json --allow <rule> ... > <lane>.jsonl`                                                                                    | add `--resume <session>`                           |
| Antigravity | `<command> -p "$(cat <spec>)" --output-format json --print-timeout 0s` (drafting)                                                                                                                     | add `--continue` in the same worktree              |

Write each Worker's event stream into the Run directory and register it with `lane add --output`; the Board reads the current activity from it. In Orca, prefer a titled Orca terminal handed to `orchestration worker-start --terminal` over a hidden headless run, so the Worker shows in the sidebar the user already watches (`run-board.md` § Orca mode). Grok has no Orca agent id: keep Grok Lanes headless.

## Why each flag is there

- **Never wait on a TTY.** Close stdin, run in the background, and grant the edit/run permissions the worktree needs, or a Worker hangs silently.
- **Claude permissions.** `--permission-mode acceptEdits` is not enough: Bash (`pnpm install`, git, tests) is denied under `-p` and the Lane stalls. Give the narrowest explicit allow list the Lane needs (`--allowedTools "Edit Write Read Bash(pnpm:*) Bash(git:*)"`; Grok `--allow <rule>`). Blanket modes (Claude `--permission-mode bypassPermissions`, Grok `--always-approve`) need the user's explicit authorization for this Run: a worktree only separates Git working files, it does not stop a command from reaching other paths, and the spec's Ownership is an instruction, not a sandbox.
- **Claude messages.** A `-p` session cannot show the approval dialog, so a message from the Coordinator or another session is held and dropped after five minutes unless the session accepts peer messages. `--settings '{"crossSessionInbound":"accept"}'` turns that on for this one Worker (Claude Code's own recommendation for unattended `-p` workers). Prefer it over `sideby messages inbound accept`, which changes the account's settings for every session.
- **Codex prompt on stdin (`-`).** `-i <image>` takes several values and swallows a prompt written after it, so a prompt given as an argument after `-i` is lost. `-o <file>` writes the final message, which is easier than reading the JSONL stream; add `-c tools.web_search=true` for research and `-s read-only` when nothing may change.
- **Headless sessions load the user's full skills and global instructions**, which can dwarf a small task's cost: give trivial reviews to the cheapest available product.

## Reading the result

Claude streams JSON events ending in `result` (`session_id`, `result`, `total_cost_usd`, `num_turns`, `is_error`); Codex a JSONL stream whose `item.completed` events carry the messages (the final message is also in `-o`); Grok `streaming-json` events with `text` deltas ending in `end`. Read the task-spec Return block from that text; the Worker's summary file is what the Coordinator reads (`task-spec.md`).

For any other CLI, check its `--help` for a non-interactive mode before dispatching; if it has none, do not use it as a Worker.

## Fix rounds and resumes

A fix round sends only the findings and Coordinator decisions, never the whole conversation. In order of preference:

1. A running interactive Claude Worker: `sideby send <session> "<delta>" --json` after `sideby send --help` succeeds; Orca Workers keep `orchestration reply`. Headless `exec`/`-p` runs cannot take messages: wait for the end, then resume (item 2).
2. A finished Worker: `sideby resume <id> -- -p "<delta>"` (Claude example); verify Host argument pass-through once, else the per-product "Next round" column above.
3. Do not assume any other resume behavior.

Before either, register the round: `B lane set --id <lane> --round <N> --output <run dir>/<lane>-<N>.jsonl`, and redirect the resumed run's stdout to that file.

A fix round soon after the first resumes the same Worker session, so its cached context is reused. After a long gap the cache has expired and a resume rewrites the whole context (one Run paid about $4-5 per resume to fix 2-5 findings); for a small delta after a long gap, start a fresh session with the original spec path plus the delta instead.

## Interactive sessions

With a multi-account manager such as sideby, interactive sessions stay the user's to start, with one exception: inside Orca, once the user has authorized dispatch, you may open visible Orca terminals on sideby accounts for Workers, titled `<Lane short name> · <role>` (e.g. `B9 卡片 · 写`); sideby adds the account and id through `accountTitle`. Do not overwrite its Session Label. Non-interactive `-p` / `exec` runs (`sideby run <ref> -- -p ...`) are fine when the user has authorized dispatch.

## Stopping

Stop processes by pid, never by a command-line pattern: a pattern once stopped another Run's background process and a researcher. Orca Workers: `orchestration worker-stop`.

## Reviewer prompts

A reviewer prompt (e.g. for `open-code-review-delegate`) names the range (`<base>..<head>`), a requirement summary, the focus list, 100% file coverage, and "also review the tests and docs OCR excludes". For a merge commit, review the conflict resolution with `git show --remerge-diff <merge>` plus the diff against each parent. A Codex reviewer under `exec -s read-only` cannot run Vitest (no temp dirs): it marks test execution `UNVERIFIED` and the coordinator re-runs the tests.
