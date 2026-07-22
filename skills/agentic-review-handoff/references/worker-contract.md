> **LEGACY (deprecated).** Worker bind/wait contract for dual-window mode. Prefer auto loop.

# Worker contract (loop mode)

When `loop=on`, each visible AI session is a **role worker**. The Coordination Kernel decides *when* you act; you decide *what* to write in the packet.

## After `review-loop next` / `wait` returns a claim

1. Read the full packet and current git evidence.
2. Perform only the claimed stage (`review`, `fix`, or `re_review`).
3. **Write the stage only via `append-eof`** (or dry-run `--auto-stage` on fake).  
   - Draft the H1 body in a temp file.  
   - `review-loop append-eof --role <you> --stage <anchor> --body-file /tmp/s.md`  
   - **Never** ApplyPatch / search-replace into the middle of the packet (causes Protocol Gate).
4. Call `review-loop complete --role <you>` (no `--auto-stage` in production).
5. Call **blocking** `review-loop wait --role <you>` so the session stays alive for the peer — **unless** `complete` returned `allTasksComplete: true`.
6. When wait returns `act` + claim → step 1. When `gate` → print `board` / human.action and **stop** (do not resolve unless the human named you as resolver). When `stop` → end.
7. **When `complete` (or `board`) shows `allTasksComplete: true`:** run `review-loop summary` if needed, **paste `text` into the user-visible chat once** (✅ 任务全部完成 + 简洁总结), then stop. Do not ask for another continue. This is how the human sees “全部完成” in **one** agent.

Do **not** end the turn after a single `idle` unless the user ends dual-session mode or `allTasksComplete` is true.

## Gate behavior (workers)

If `next.kind === 'gate'` or `complete` returns Protocol Gate:

1. Do **not** call `resolve` yourself.
2. Tell the human to run **`review-loop board`** then **one** `resolve --decision continue|stop`.
3. Wait (blocking) until gate clears — do not re-prompt the human every turn.

## Reviewer

- Subject files remain read-only.
- May write the packet under a claim.
- Prefer evidence over peer summaries.

## Fixer

- Revalidate findings before editing subject files.
- Map every changed subject file to a finding + verification in Fix Completion.

## Gates

If `next.kind === 'gate'`, do not edit subject files. Surface the gate to the user and run `review-loop resolve` only after an explicit human decision.
