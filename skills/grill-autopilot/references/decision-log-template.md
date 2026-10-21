# Decision log template

Write to `docs/grill/YYYY-MM-DD-<topic>.md` in the target repository (lowercase kebab-case topic). Every row comes from the ledger; do not restate an answer the ledger does not hold.

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

Status is one of `Decided`, `Assumption` (a default the user may overturn) or `Escalation` (held for the user).

## Reasons

### Q1 — <question title>

- Reason: ...
- Revisit if: ...
- Red-team: <hold | overturn: why> (only for hard-to-reverse decisions)

## Escalations

<each Escalation: the question, the Proxy's recommendation, why it is held, and the user's answer once given>

## Assumptions

<each Assumption with the default chosen, so the user can overturn it in one pass>

## Glossary and decision records

- Terms added to `GLOSSARY.md`: ...
- Decision records written (status proposed): ...
```
