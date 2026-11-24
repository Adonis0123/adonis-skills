# Decision log template

Write to `docs/grill/YYYY-MM-DD-<topic>.md` in the target repository (lowercase kebab-case topic). Every row comes from the ledger; do not restate an answer the ledger does not hold. A decision the red-team overturned is the Proxy's re-answer (`amended` in the ledger), never wording of your own.

The `Red-team` line appears only for hard-to-reverse decisions and copies the ledger's `redteam` and `amended` fields: `hold`, `overturn: <why> → re-answered; was: <old decision>`, or `overturn: <why> → escalated`.

```markdown
# Grill: <topic>

- Date: YYYY-MM-DD
- Pairing: Interviewer <product/account>, Proxy <product/account>[, Red-team <product/account> | skipped: <why>]
- Rounds: <n>; stopped because <frontier empty | stop rule from the ledger>
- Duration: <minutes>
- Status: proposed (no decision here has been implemented)

## Plan

<the user's original request, verbatim>

## Decisions

| ID  | Question | Decision | Status  | Reversibility | Evidence      |
| --- | -------- | -------- | ------- | ------------- | ------------- |
| Q1  | ...      | ...      | Decided | easy          | <URL or path> |
| Q2  | ...      | ...      | Decided | costly        | <URL or path> |

Status is one of `Decided`, `Assumption` (a default the user may overturn) or `Escalation` (held for the user).

## Reasons

### Q1 — <question title>

- Reason: ...
- Revisit if: ...

### Q2 — <a hard-to-reverse decision the red-team overturned>

- Reason: ... (from the re-answer)
- Revisit if: ...
- Red-team: overturn: <why> → re-answered; was: <old decision>

## Escalations

<each Escalation: the question, the Proxy's recommendation, why it is held, and the user's answer once given>

## Assumptions

<each Assumption with the default chosen, so the user can overturn it in one pass>

## Glossary and decision records

- Terms added to `GLOSSARY.md`: ...
- Decision records written (status proposed): ...
```
