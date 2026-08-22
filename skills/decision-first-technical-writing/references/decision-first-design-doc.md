# Decision-First Design Document Profile

Use this profile when creating or substantially restructuring an internal technical design document. It is a flexible reading order, not a mandatory template.

## Reader contract

The document should let a reviewer answer these questions in sequence:

1. What has been decided?
2. What is in scope now, later, or not at all?
3. Which component owns each responsibility?
4. What happens at runtime, including conflict and failure paths?
5. What are the exact data and interface contracts?
6. How will the change migrate, roll back, and prove correct?
7. Which choices are still open?

If a section does not help answer one of these questions, omit or link it.

## Opening block

Keep the first screen compact:

1. Title that names the module or decision.
2. Links to requirements, current contracts, or source data when available.
3. A **Core Decisions** callout with roughly three to seven settled decisions.

Write each decision as:

```markdown
- **Decision dimension**: chosen behavior; ownership or boundary; important consequence.
```

Do not place rationale essays, implementation steps, or pending choices in this block. Put unresolved choices in a separate **Open Decisions** block with the evidence or owner needed to close each one.

## Status vocabulary

Keep these dimensions separate and use one consistent set of labels within a document:

| Dimension          | Example states                      | Answers                                |
| ------------------ | ----------------------------------- | -------------------------------------- |
| Decision certainty | Decided, Proposed, Pending          | How certain is this?                   |
| Contract lifecycle | New, Changed, Deprecated            | What happens to the existing contract? |
| Delivery scope     | This iteration, Later, Out of scope | When will it be delivered?             |

Never use a delivery label such as "later" to imply that a product decision is settled. Never place behavior under an "out of scope" heading while describing it as required in the current flow.

## Recommended reading order

Select the sections needed by the design:

```markdown
# <Module or decision>

<Source requirements and related documents>

> Core Decisions

## Scope and non-goals

## System model

### Responsibility boundaries

### Code landing points

## Module design

### <Module A>

### <Module B>

## Runtime flows

## Data model

## API contracts

## Errors and failure behavior

## Migration, rollback, and validation

## Open decisions
```

The order should move from stable concepts to dynamic behavior and then exact contracts. Keep source requirements outside the design body when a reliable canonical document already exists.

## Section pattern

For each substantial module, cover only the applicable items:

- **Decision**: the selected behavior.
- **Ownership**: which layer or component creates, validates, stores, or exposes the data.
- **Invariants**: conditions that must remain true.
- **Current scope**: what ships in this change.
- **Non-goals**: nearby work intentionally excluded.
- **Flow**: success, retry, conflict, and failure behavior.
- **Contract**: exact inputs, outputs, persisted fields, and errors.

State the conclusion first. Explain rationale after the reader knows what was chosen.

## Visual encoding

Choose the smallest representation that preserves the relationship:

| Information                                                    | Preferred form              |
| -------------------------------------------------------------- | --------------------------- |
| Three or more entities, ownership boundaries, or cardinalities | Static relationship diagram |
| Requests with branches, retries, conflicts, or callbacks       | Sequence diagram            |
| Repeated fields, status changes, or exact mappings             | Table                       |
| Schemas, payloads, interfaces, SQL, or code landing points     | Code block                  |
| One relationship or one linear action                          | Prose                       |

Every visual must agree with the surrounding contracts. A diagram is explanatory evidence, not a substitute for exact inputs, outputs, and failure results.

## Deliberate repetition

Repeat at two levels only:

1. The opening summary states the global decision.
2. The owning section states its local implication and exact contract.

Do not repeat full rationale or contract text across modules. Link to the primary section when another section depends on it.

## Final consistency pass

Verify the document as a connected contract:

- Each core decision points to one primary detail section.
- Scope labels do not contradict runtime flows or API status.
- Ownership is identical in prose, diagrams, data models, and code landing points.
- Sequence branches map to return values, errors, retries, or explicit terminal states.
- Schema fields match request and response fields where they represent the same concept.
- Migration and rollback order respect data and compatibility dependencies.
- Validation describes observable evidence, not only planned implementation steps.
- Open decisions are collected and excluded from unconditional contracts.
- Deleted approaches are removed rather than left as strikethrough history unless change history is itself required.
