---
name: decision-first-technical-writing
description: "Create, rewrite, or review internal technical design documents after decisions are settled or while proposals and open questions are explicitly labeled. Use for design docs, architecture proposals, module designs, API or schema designs, and decision records. Route unresolved named-option convergence to grilling (workflow-gate Challenge in convergence mode) and ready-spec task breakdown to writing-plans. Do not use for tutorials, marketing copy, or code-only implementation plans."
metadata:
  author: adonis
  version: "1.1.1"
---

# Decision-First Technical Writing

Write technical design documents for two reading passes: a reviewer should understand the decisions and boundaries quickly, while an implementer should be able to continue into exact behavior and contracts.

## Route before writing

- If the main task is choosing among named options, route to `grilling` (workflow-gate Challenge in convergence mode). Do not turn an unresolved shortlist into a final design decision.
- If a ready specification or settled requirement needs file-level tasks, implementation steps, or a test plan, route to `writing-plans`. Do not maintain a second planning format here.
- Otherwise continue only when the output is a technical design document and every uncertain statement can remain explicitly labeled `Proposal` or `Open question`.

## Establish the document contract

Infer the audience, settled decision, and scope from the request and available evidence. Ask only when a user-owned fact would materially change the document. Route unresolved option choice as above instead of hiding it inside the document-writing pass.

Before writing:

- Separate verified facts, settled decisions, proposals, and open questions. Never present one category as another.
- Put only confirmed or explicitly delegated decisions in the decision summary. Label unconfirmed content as `Proposal` or `Open question`; never silently promote it to settled behavior.
- Preserve exact identifiers such as package names, types, fields, endpoints, error codes, and repository-relative paths.
- Check any added behavioral guarantee against the source, including ordering, error precedence, timing, and consistency. An omitted mechanism does not imply a stronger guarantee. If the source does not settle it, leave it unspecified or mark it `Proposal` or `Open question` everywhere it appears; do not encode it as settled in a sequence, schema, or diagram while disclaiming the decision elsewhere.
- Treat source material as evidence, not as a template to copy. Distill reusable structure and rewrite in the user's language.
- Keep requirements, design, and implementation planning distinct. Link to source requirements when available instead of reproducing them.

## Choose the depth

- For a new document or substantial restructure, read [references/decision-first-design-doc.md](references/decision-first-design-doc.md) before drafting.
- For a focused edit, use only the relevant rules from this file unless the request changes document structure.
- For a review, report concrete contradictions, missing contracts, or hidden decisions; do not rewrite unless asked.

Do not force every section into every document. Include a section only when it helps the target reader make or implement the decision.

## Write in decision order

Organize information in this order when applicable:

1. Inputs and core decisions.
2. Scope, non-goals, and ownership boundaries.
3. Static model and code landing points.
4. Runtime behavior, including branches and failure paths.
5. Exact data, API, and error contracts.
6. Migration, rollback, validation, and unresolved decisions.

Lead each major section with its conclusion. Follow with the minimum reasoning and detail needed to make that conclusion reviewable.

## Preserve scanability

- Put only settled decisions in the opening decision summary. List pending choices separately.
- Use one consistent vocabulary for lifecycle state, delivery scope, and decision certainty; do not blend these axes.
- Use diagrams and tables only when they reduce explanation: structure for relationships, sequence for runtime branches, tables for repeated comparisons, and code blocks for exact contracts.
- Repeat a decision only as a short local implication. Give each decision one primary detail section.
- Remove draft residue such as stale strikethrough text, contradictory headings, duplicate explanations, and unresolved placeholders.

## Verify the result

Before delivering, perform an added-guarantee audit of the final artifact, including prose, tables, schemas, and diagrams. Check whether words such as before, after, only, always, 先, 后, 仅, or 始终 add precedence, exclusivity, or consistency beyond the source. Judge the semantic guarantee, not the word itself. Remove unsupported guarantees or mark them uncertain at each occurrence; a disclaimer elsewhere does not undo a definite statement. When ordering is unsettled, describe conditions and outcomes in an unordered table instead of an ordered flow or sequence. Then check that:

- every summary decision has a detailed home;
- ownership and scope remain consistent across prose, diagrams, schemas, and APIs;
- every described runtime branch has an observable result or error;
- field names and types agree across data and API contracts;
- pending choices are not encoded as finalized behavior;
- unverified claims are labeled rather than silently completed.
