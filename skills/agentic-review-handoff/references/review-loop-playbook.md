# Review Loop Playbook (auto loop)

How to use the deterministic `review-loop` CLI. Invoke via **absolute path**.

```bash
RL="$(git rev-parse --show-toplevel)/skills/agentic-review-handoff/scripts/review-loop.mjs"
node "$RL" help
```

Full contract: `auto-loop-contract.md`.

## Commands

```bash
# Review current worktree vs HEAD (or --base), optional --paths scope
node "$RL" run --repo "$REPO" --reviewer=codex --rounds 3 [--paths path1,path2]

# After BLOCKED + local fixes:
node "$RL" fix-completion --repo "$REPO" --packet "$PACKET" --body-file ./fix.md
node "$RL" run --continue --repo "$REPO" --packet "$PACKET"

# Advisory consult
node "$RL" consult --repo "$REPO" --peer=grok --question-file ./q.md
```

Human touchpoints: **initiate · terminal report · exception** only.

## STOP

- Global: `$REPO/.review-handoff/STOP`
- Per packet: `$REPO/.review-handoff/runtime/<packet_id>/STOP`

## Tests

```bash
node --test scripts/test/adapters.test.mjs \
  scripts/test/auto-run.test.mjs \
  scripts/test/auto-run-negatives.test.mjs \
  scripts/test/consult.test.mjs
```

## Removed (T8)

Dual-window `open`/`bind`/`next`/`wait`/claim/freeze/Runtime Gate/`profile=deep` stub and related docs/tests were deleted per `docs/review-loop-orchestrator/plan-2026-07-22-review-loop-v2-auto-loop.md` T8.
