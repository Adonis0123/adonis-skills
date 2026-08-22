---
name: decision-first-technical-writing
description: "Create, rewrite, or review internal technical design documents that lead with decisions and progressively expose architecture, runtime flows, data models, API contracts, failure behavior, scope, and open questions. Use for design docs, architecture proposals, module plans, API or schema designs, and decision records. Do not use for tutorials, marketing copy, or code-only implementation plans."
metadata:
  author: adonis
  version: "1.0.0"
---

# Decision-First Technical Writing

Write technical design documents for two reading passes: a reviewer should understand the decisions and boundaries quickly, while an implementer should be able to continue into exact behavior and contracts.

## Establish the document contract

Infer the audience, decision to support, and scope from the request and available evidence. Ask only when missing information would materially change the document or when an unresolved product choice cannot be decided from the available context.

Before writing:

- Separate verified facts, settled decisions, proposals, and open questions. Never present one category as another.
- Preserve exact identifiers such as package names, types, fields, endpoints, error codes, and repository-relative paths.
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

Before delivering, check that:

- every summary decision has a detailed home;
- ownership and scope remain consistent across prose, diagrams, schemas, and APIs;
- every described runtime branch has an observable result or error;
- field names and types agree across data and API contracts;
- pending choices are not encoded as finalized behavior;
- unverified claims are labeled rather than silently completed.
