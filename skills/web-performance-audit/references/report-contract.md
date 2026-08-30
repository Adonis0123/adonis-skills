# Evidence ledger and report contract

The report must let another engineer reproduce the observation and know exactly what is fact, interpretation, or missing.

## Confidence labels

| Label                   | Meaning                                                                             | Allowed language                    |
| ----------------------- | ----------------------------------------------------------------------------------- | ----------------------------------- |
| `VERIFIED`              | Repeatable metric, trace, DOM/network state, or source fact under stated conditions | “measured”, “contains”, “requested” |
| `SCREEN_OBSERVED`       | Visible behavior without precise machine-readable timing or ownership               | “visibly”, “screen recording shows” |
| `INFERENCE`             | Causal interpretation supported but not isolated                                    | “likely”, “consistent with”         |
| `UNVERIFIED`            | Plausible/requested path not proven                                                 | “not verified”, “requires”          |
| `MEASUREMENT_POLLUTION` | Tool/environment invalidated product attribution                                    | “discarded”, “localization only”    |

Do not upgrade a label because source code looks suspicious. Runtime evidence and source evidence answer different questions.

The ledger validator also checks coherence: every requested surface label and required state needs an exact coverage row; an `available` tool needs discovery, handshake, and harmless-call proof; machine evidence must name an available tool; `VERIFIED` must be a measured result or a code-backed source fact; and high-priority findings need direct user-impact evidence.

## Finding contract

Every actionable finding contains:

- stable id and priority (`P0` direct severe interaction blocker, `P1` material recurring cost, `P2` bounded opportunity, `P3` low-confidence/minor);
- confidence label;
- exact surface, action, build, activity, throttle, and dataset conditions;
- machine-readable or screen evidence with values and units;
- user impact;
- causal status: measured, correlated, code-backed source fact/hypothesis, or unverified;
- caveats and discarded competing explanations;
- smallest optimization direction, without implementing it;
- equivalent retest and measurable success criterion;
- stop condition.

Avoid severities based only on generic best-practice checklists. A huge source module with no measured impact is not P0. A repeated editor delay can still be high priority when it blocks the product's core journey, even if load Lighthouse is excellent; product impact and reproducibility determine severity, not a universal millisecond threshold.

## Negative findings

Record useful counterevidence, for example:

- repeated cycles did not show monotonic post-recovery heap/listener/node growth;
- scrolling produced no long tasks in the tested list size;
- resize shifts occurred only during artificial viewport changes;
- production build did not reproduce development Coverage/load cost.

Each negative result states its confidence, causal status, conditions, evidence, and scope limit. A machine-measured negative may be `VERIFIED`; visual-only counterevidence must be `SCREEN_OBSERVED`. “No leak in 10 cycles” does not mean “no leak in a 30-minute session.”

## Recommended Markdown report

```markdown
# <Page> performance audit

## Decision summary

- <top finding, impact, confidence>
- <top finding, impact, confidence>
- <most important negative result or production gap>

## Target and conditions

| Field          | Value     |
| -------------- | --------- |
| URL/data       | ...       |
| Browser/build  | ...       |
| Viewport/DPR   | ...       |
| Initial state  | ...       |
| Write boundary | read-only |

## Tool and noise ledger

| Tool/signal | Status | Role | Pollution/caveat |
| ----------- | ------ | ---- | ---------------- |

## Coverage

| Surface/flow | State | Conditions | Status | Evidence/skip reason |
| ------------ | ----- | ---------- | ------ | -------------------- |

## Findings

### F-001 | P0 | VERIFIED | <title>

- Conditions:
- Evidence:
- User impact:
- Causal status and caveats:
- Recommendation:
- Retest / success criterion:
- Stop condition:

## Negative findings

...

## UNVERIFIED and production gaps

...

## Restoration

- Final state:
- Initial state restored:
- Throttling removed:
- Instrumentation removed:
- Media stopped:
- Product data changed: <yes/no + exact exception>
- Code changed: <yes/no + exact exception>
```

## JSON ledger shape

The helper script initializes and validates this semantic structure:

```json
{
  "schema_version": "1.1",
  "audit": {
    "title": "Example runtime audit",
    "target_url": "https://app.example.test/editor/large-project",
    "target_url_identity_safe": true,
    "target_url_redaction_notes": "Sanitized route; no userinfo, query secret, or private identity recorded.",
    "scope": "All editor tabs; read-only",
    "requested_surfaces": [
      {
        "id": "create",
        "label": "Create",
        "required_states": ["cold first-open", "warm return"]
      },
      {
        "id": "text",
        "label": "Text",
        "required_states": ["cold first-open", "warm return"]
      },
      {
        "id": "elements",
        "label": "Elements",
        "required_states": ["cold first-open", "warm return"]
      },
      {
        "id": "gallery",
        "label": "Gallery",
        "required_states": [
          "cold first-open",
          "warm return",
          "10-cycle recovery"
        ]
      }
    ],
    "build_mode": "unknown",
    "initial_state": "Paused on Create",
    "restored_state": "Paused on Create",
    "write_boundary": "read-only",
    "privacy": {
      "content_trust": "trusted",
      "sensitive_data": "masked",
      "browser_profile": "shared",
      "performance_crux": "disabled",
      "usage_statistics": "disabled",
      "network_headers": "redacted",
      "browser_tooling_used": true,
      "browser_access_authorized": true,
      "target_class": "internal",
      "risk_decision": "proceed",
      "notes": "Authenticated internal page; no secrets or response bodies inspected."
    },
    "restoration": {
      "initial_state_restored": true,
      "instrumentation_removed": true,
      "throttling_removed": true,
      "media_stopped": true,
      "product_data_changed": false,
      "code_changed": false,
      "notes": "Returned to the initial tab and scroll position."
    },
    "tools": []
  },
  "coverage": [],
  "findings": [],
  "negative_findings": [],
  "unverified": []
}
```

Run `python3 "{{skill_path}}/scripts/audit_ledger.py" init ...` for the complete template. `{{skill_path}}` is a documentation placeholder for the loaded skill directory and must be replaced before execution. Confirm the runtime's exact URL in the browser, but store only an identity-safe HTTP(S) URL: no userinfo, query, fragment, token, signature, or private account/project identity. The validator checks semantics that prose review commonly misses: allowed labels, exact states, unique ids, evidence/causality coherence, privacy risk decisions, recommendations, blocked reasons, and restoration.

## Recommendation quality

Good:

> 19 offscreen original-image elements remain mounted. Mounted does not prove loaded, decoded, or resident. First measure actual resource pixels and decoded/resident state during the same 33-item scroll flow; only then consider card-sized variants or windowing. Success means a material interaction/resource improvement without blank cards. Stop if the resources are not decoded/resident or the improvement falls inside run-to-run variation.

Bad:

> Use virtualization and memoization to make the page faster.

The good version names the evidence, admits estimate semantics, preserves user constraints, and defines both success and a reason to stop.
