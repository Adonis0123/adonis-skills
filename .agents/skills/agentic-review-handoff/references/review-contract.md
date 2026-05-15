# Review Contract

Use this contract for formal agentic code or document review. The reviewer is read-only unless the user explicitly asks for fixes.

## Contents

- Required Preamble — scope + verification block
- Findings Format — severity ladder, Source tag taxonomy, severity/source consistency rule
- Verdict — single verdict from the fixed vocabulary
- No Findings Format — what to emit when there are no findings
- Feedback Validation Format — table for verifying another reviewer's claims
- Deep Review Lens — first-principles / DDD / cohesion-coupling / source-driven, used only when the user asks or the change is architectural

## Required Preamble

Start by naming the inspected scope:

```md
Scope reviewed: staged diff / working tree diff / full branch diff / docs only / specific files.
Verification: commands run, skipped checks, or blocked checks.
```

Keep the preamble short. Findings come next.

## Findings Format

Findings come first, ordered by severity.

```md
## Findings

- [P1] Title
  File: path/to/file.ts:123
  Evidence: what the code/docs/test output shows
  Source: verified from code  ← required
  Impact: concrete failure mode
  Suggested fix: smallest safe change
```

Severity:

- `P0`: data loss, security issue, broken production path, or unrecoverable release blocker.
- `P1`: likely user-visible bug, spec violation, serious regression, or high-confidence missing guard.
- `P2`: edge-case bug, maintainability issue with concrete cost, missing test for risky behavior.
- `P3`: minor issue, low-risk cleanup, documentation clarity.
- `Preference`: style or taste, not a correctness issue.

Every non-preference finding must carry a `Source:` line with one of these tags. The tag tells the reader how much weight to put on the claim:

- `verified from code` — read the actual file or diff in this session.
- `verified from docs` — checked official documentation in this session (paste a URL or document title that you actually loaded).
- `verified from test output` — ran the test and observed the result in this session.
- `inferred from prompt` — claim is based only on the user's pasted snippet, description, or commit message. Use this whenever you do not have repo access.
- `HYPOTHESIS` — plausible but unverified, including downstream impact you have not inspected.

External-API / SDK / framework / browser / platform claims have a stricter rule: do not write `verified from docs` unless you actually loaded the doc this session. Without an in-session doc lookup, the only correct tag is `HYPOTHESIS`. The shorthand "training knowledge only" is not a valid Source tag — if that is the actual basis, the claim is `HYPOTHESIS`, full stop. Severity must be downgraded one level or carry an explicit "severity contingent on doc check" note.

Source tag and severity must be consistent. A `P0` or `P1` claim whose only source is `HYPOTHESIS` should either be downgraded one level OR carry an explicit "severity contingent on full inspection" note in the Evidence line. Documentation evidence does not replace runtime verification for behavior-affecting changes.

Other rules:

- Every non-preference finding needs file:line evidence.
- If exact line numbers are unavailable, cite the smallest file/function/symbol scope and say why.
- Do not include a finding if the only evidence is "this feels wrong".
- Separate generated artifact drift from source-code defects.

## Verdict

After findings, provide exactly one verdict:

- `BLOCKED`: at least one P0/P1 must be fixed before merge.
- `PASS_WITH_CONCERNS`: no blocker, but there are P2/P3 issues or verification gaps.
- `PASS`: no meaningful issues found and relevant checks passed.
- `NO_FINDINGS`: formal review found no issues; include residual risk if any.

## No Findings Format

```md
No findings.

Verification:
- command: result
- command: result

Residual risk:
- what was not tested or what depends on external systems
```

## Feedback Validation Format

When validating another reviewer or team's feedback:

```md
## Feedback Validation

| Claim | Verdict | Evidence | Action |
|---|---|---|---|
| ... | valid / partially valid / invalid / hypothesis | file:line or command output | fix / no action / needs human decision |
```

Do not treat the earlier feedback as authoritative. Verify each claim independently.

## Deep Review Lens

Use only when triggered by the user or by architectural/cross-module risk.

### First Principles

- Goal: what outcome must this change achieve?
- Constraints: what must not change?
- Invariants: what behavior or data contract must remain true?
- Evidence: what proves each claim?
- Assumptions: what is inferred but not verified?
- Failure modes: under what concrete scenario does this break?

### DDD

- Is the domain language consistent with existing docs and code?
- Does the change belong in the current bounded context?
- Are domain rules owned by the module closest to the domain concept?
- Are cross-context mappings explicit?
- Is the design avoiding tactical DDD objects without real invariants?

### Cohesion and Coupling

- Change locality: how many modules must change for one rule change?
- Dependency direction: does low-level code know high-level UI/business details?
- Rule ownership: is a business rule duplicated?
- Hidden coupling: does behavior depend on timing, naming, global state, or side effects?
- Interface size: does the API expose more than callers need?

### Source-Driven Check

- Use official or primary sources for version-sensitive APIs, library behavior, browser/framework constraints, payments, security, and external platforms.
- Apply the same `Source:` tags defined in the Findings Format section.
- Only invoke source-driven research when the question depends on external/library/platform behavior. For purely internal architecture or domain-rule questions, source-driven check adds noise — skip it.
