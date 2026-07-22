# Human control plane — removed

> **Removed in T8** (2026-07-22). Dual-window human board / resolve Gate dogfood-failed.

Use **auto loop** instead:

```bash
node scripts/review-loop.mjs run --repo "$REPO" --reviewer=codex
```

See `SKILL.md` and `auto-loop-contract.md`.
