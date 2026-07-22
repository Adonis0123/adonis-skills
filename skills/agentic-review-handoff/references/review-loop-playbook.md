# Review Loop Playbook

How to use the deterministic `review-loop` CLI. Invoke via **absolute path**.

```bash
RL="$(git rev-parse --show-toplevel)/skills/agentic-review-handoff/scripts/review-loop.mjs"
node "$RL" help
```

## Preferred: auto loop (v2)

Full contract: `auto-loop-contract.md`.

```bash
# Review current worktree vs HEAD (or --base)
node "$RL" run --repo "$REPO" --reviewer=codex --rounds 3

# After BLOCKED + local fixes:
node "$RL" fix-completion --repo "$REPO" --packet "$PACKET" --body-file ./fix.md
node "$RL" run --continue --repo "$REPO" --packet "$PACKET"

# Advisory consult
node "$RL" consult --repo "$REPO" --peer=grok --question-file ./q.md
```

Human touchpoints: initiate · terminal report · exception only.

## Legacy dual-window arms (deprecated)

| Flag | Values | Default |
|---|---|---|
| `loop` | `off` \| `on` | omitted = **off** |
| `profile` | `standard` \| `deep` | **standard** when `loop=on` |
| `runtime` | `visible` \| `headless` | **visible** when `loop=on` |

> Dual-window `open`/`bind`/`wait` dogfood-failed. Prefer auto loop. Sections below are archive reference.

## Scenario 0 — Human control plane (legacy)

### Start: `open` (simultaneous dual prompts)

```bash
node "$RL" open --repo "$REPO" --driver=fake \
  --product-reviewer=codex --product-fixer=codex
# paste PROMPT_REVIEWER.txt → window A
# paste PROMPT_FIXER.txt → window B   (same moment is fine)
```

Both workers bind with the **same** `--packet` from open. Order free. Fixer no longer needs to wait for Reviewer bind.

### Progress / done

```bash
node "$RL" board --repo "$REPO"
# optional: node "$RL" board --repo "$REPO" --watch --watch-ms=2000
node "$RL" summary --repo "$REPO"   # when DONE / allTasksComplete
```

| phase | What you do |
|---|---|
| `WAIT:wait_bind` | Paste the missing role’s PROMPT_*.txt (open already generated them) |
| `READY:*` / `WORKING:*` / `WAIT:*` | Nothing — wait for workers |
| `GATE:*` | **One** `resolve --decision continue\|stop` (any window; never both) |
| `DONE` | Run `summary`; **one agent** pastes `text` (✅ 任务全部完成 + 简洁总结) |

Artifacts: `PROMPTS.md`, `PROMPT_*.txt`, `BOARD.txt`, `SUMMARY.txt` under `$REPO/.review-handoff/runtime/<packet_id>/`. See `human-control-plane.md`.

## Scenario A — `loop=off` (legacy unchanged)

1. Do **not** call `review-loop bind`.
2. Use this skill as before: packet under `.review-handoff/active/`, append-only H1 stages.
3. `review-loop` dual-session routing stays idle; no runtime directory is required.

## Scenario B — `loop=on profile=standard` dual bind (fake driver dry-run)

### Critical: `wait` vs `next` (auto handoff)

| Command | Behavior |
|---|---|
| `next` | **Non-blocking.** If not your turn, returns `idle` immediately and the agent turn often ends. |
| `wait` | **Blocking.** Polls packet/runtime until it is your turn, a gate opens, stop, or `--max-wait-ms`. This is how Reviewer auto-resumes after Fixer without a human “continue”. |
| `wait --once` | Same as a single non-blocking poll (legacy). |

After you `complete`, **always** end the turn with blocking `wait` (not bare `next` for idle), so the session stays alive until the peer advances the packet:

```bash
# After your stage:
node "$RL" complete --repo "$REPO" --role reviewer   # no --auto-stage in production
node "$RL" wait --repo "$REPO" --role reviewer --poll-ms=500 --heartbeat-ms=15000
# stderr heartbeats while Fixer works; when Fixer complete → wait returns claim for re_review
```

From a git repo:

```bash
RL=.../scripts/review-loop.mjs
REPO=$(git rev-parse --show-toplevel)

# Session 1 (reviewer)
node "$RL" bind --repo "$REPO" --role reviewer --product claude \
  --loop=on --profile=standard --runtime=visible --driver=fake --create-packet

# Session 2 (fixer) — same latest packet auto-selected if only one active
node "$RL" bind --repo "$REPO" --role fixer --product codex \
  --loop=on --profile=standard --runtime=visible --driver=fake

# Reviewer claims and completes a stage (auto-stage is accepted only because bind durably armed fake)
node "$RL" next --repo "$REPO" --role reviewer
node "$RL" complete --repo "$REPO" --role reviewer --auto-stage
# Keep process blocked until Fixer advances (or use max-wait for tests):
# node "$RL" wait --repo "$REPO" --role reviewer --poll-ms=100 --max-wait-ms=5000

# Fixer
node "$RL" next --repo "$REPO" --role fixer
node "$RL" complete --repo "$REPO" --role fixer --auto-stage

# Re-review (if wait already returned with claim, skip next)
node "$RL" next --repo "$REPO" --role reviewer
node "$RL" complete --repo "$REPO" --role reviewer --auto-stage

node "$RL" status --repo "$REPO"
```

In a real AI session, **never mid-file edit the packet**. Production write path:

```bash
# after next/wait returned a claim for your role:
# 1) draft full H1 section(s) to /tmp/stage.md
node "$RL" append-eof --repo "$REPO" --role fixer --stage fix_completion --body-file /tmp/stage.md
node "$RL" complete --repo "$REPO" --role fixer   # no --auto-stage
node "$RL" wait --repo "$REPO" --role fixer --poll-ms=500 --heartbeat-ms=15000
```

`--auto-stage` is **fake dry-run only**. `complete` validates last physical H1 vs frontmatter, lifecycle/location, subject-file boundary, and claim generation. Mid-file inserts → Protocol Gate with `human.resolveOnce` + recovery text. **Agents must call blocking `wait` after complete** so the model tool call stays open across the peer's work.

If `wait`/`complete` returns `gate`: print `human.action`, **do not** resolve unless the human named you; do **not** re-ask the other chat window.

Durable state:

- Packet: `$REPO/.review-handoff/active/<branch>/*.md`
- Runtime: `$REPO/.review-handoff/runtime/<packet_id>/` (`bindings.json`, `claim.json`, `gate.json`, `driver.json`, `run-meta.json`, `events.jsonl`)

## Scenario C — Runtime Gate (driver unavailable)

```bash
# Bind both roles to the real visible driver. Without durable H1 evidence,
# bind/next exposes Runtime Gate; omitting --driver on next reuses visible-wait.
node "$RL" bind --repo "$REPO" --role reviewer --product claude \
  --loop=on --profile=standard --runtime=visible --driver=visible-wait --create-packet
node "$RL" bind --repo "$REPO" --role fixer --product codex \
  --loop=on --profile=standard --runtime=visible --driver=visible-wait
node "$RL" next --repo "$REPO" --role reviewer
# → ok:false, runtimeGate:true, next.kind=gate, gateType=runtime
# allowedResolutions include arm_headless_explicit (explicit only — never auto)

node "$RL" resolve --repo "$REPO" --decision stop
# or: choose_other_surface | retry_driver | arm_headless_explicit
```

## H1 probe (Session Driver capability)

```bash
# CI smoke (short idle — does NOT claim 15min multi-product interactive PASS)
node "$RL" h1-probe --idle-seconds=2 --out /tmp/h1-matrix.json

# Documented full idle budget (still marks productInteractive UNVERIFIED unless harness attaches real CLIs)
node "$RL" h1-probe --idle-seconds=900 --out ./h1-matrix.json
```

Matrix fields include `result`, `productInteractiveSession`, `threeHandoffs`, `autoHeadlessOnFailure: false`.

## Gate / disarm

```bash
node "$RL" gate --repo "$REPO" --type protocol --evidence "..."
node "$RL" resolve --repo "$REPO" --decision continue   # if allowed for that gate type
node "$RL" disarm --repo "$REPO"
```

## What “very usable” means here

| Check | How |
|---|---|
| Protocol correctness without LLM | `node --test scripts/test/*.test.mjs` from skill dir |
| Dual-session handoff | dual-session test ≥3 edges |
| Claim fencing and stage integrity | protocol-safety tests use real concurrent child processes and forged packet groups |
| No silent headless | Runtime Gate path |
| H1 recordable | `h1-probe` JSON matrix |
| Legacy safe | Scenario A |

Do **not** claim Claude/Codex/Grok 15-minute interactive H1 PASS unless the matrix `productInteractiveSession` column was actually measured PASS for that product.
