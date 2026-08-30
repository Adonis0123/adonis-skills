# Synthetic editor performance audit demo

## Decision summary

- **F-001 · P2 · VERIFIED** — Synthetic playback switch records a 296 ms lab click duration: The fixture records a 296 ms lab interaction; it does not establish a product budget violation, regression, or visible delay.
- **F-002 · P2 · INFERENCE** — Offscreen mounted originals are a decode-pressure hypothesis: If the mounted originals are loaded and decoded, they may compete with scrolling and playback resources.
- **F-003 · P3 · VERIFIED** — The fixture contains repeated third-party requests: No user-visible performance impact is established by request count alone.
- Counterevidence (VERIFIED): The synthetic 10-cycle fixture does not show monotonic post-recovery DOM growth.

## Target and conditions

| Field              | Value                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------- |
| URL                | https://app.example.test/editor/sanitized-project                                             |
| URL identity-safe  | yes; Synthetic route; no account, query, fragment, or private project identifier is recorded. |
| Scope              | Synthetic fixture demonstrating the report contract; not a live product claim                 |
| Browser/build      | Sanitized Chrome trace fixture; development                                                   |
| Viewport           | 1440 x 900; DPR 2                                                                             |
| Initial state      | Paused on Media; instrumentation off                                                          |
| Write boundary     | read-only                                                                                     |
| Requested surfaces | Media / Video, Library / All                                                                  |

## Trust and privacy

| Field                                  | Value                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Content trust                          | trusted                                                                                  |
| Sensitive data                         | absent                                                                                   |
| Browser profile                        | isolated                                                                                 |
| Browser tooling / authorization / risk | False / False / not_applicable                                                           |
| Target class                           | internal                                                                                 |
| CrUX / usage statistics / headers      | not_applicable / not_applicable / redacted                                               |
| Notes                                  | Synthetic fixture contains no real URL, account, token, customer data, or response body. |

## Tool and noise ledger

| Tool/capability         | Version | Status    | Role                                                          | Proof                                                                                                                                                    | Caveat                                                                                  |
| ----------------------- | ------- | --------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Sanitized trace fixture | 1       | available | Demonstrate trace, DOM, network, and recovery evidence fields | discovery: assets/demo-audit-ledger.json loaded; handshake: schema_version 1.1 recognized; call: validator and renderer completed without product access | Synthetic values demonstrate output semantics and are not current product measurements. |

## Coverage

| Surface/flow  | State                       | Conditions                                              | Status  | Evidence/notes             |
| ------------- | --------------------------- | ------------------------------------------------------- | ------- | -------------------------- |
| Media / Video | cold first-open             | synthetic fixture; normal CPU; instrumentation off      | covered | TRACE-DEMO-000             |
| Media / Video | warm switch during playback | synthetic fixture; 4× CPU slowdown; instrumentation off | covered | TRACE-DEMO-001             |
| Library / All | cold first-open             | synthetic 48-item fixture; normal CPU; paused           | covered | DOM-DEMO-001; NET-DEMO-001 |
| Library / All | warm return                 | synthetic 48-item fixture; normal CPU; paused           | covered | DOM-DEMO-002               |
| Library / All | 10-cycle recovery           | synthetic 48-item fixture; normal CPU; fixed recovery   | covered | MEM-DEMO-001               |

## Findings

### F-001 | P2 | VERIFIED | Synthetic playback switch records a 296 ms lab click duration

- **Surface:** Media / Video
- **Conditions:** synthetic fixture; playback active; 4× CPU slowdown; instrumentation off; three equivalent runs
- **User impact:** The fixture records a 296 ms lab interaction; it does not establish a product budget violation, regression, or visible delay.
- **Causal status:** measured
- **Caveats:** This is a lab click duration, not field INP and not a current product result.

| Signal                | Value | Unit | Conditions                                                 | Source | Tool                    |
| --------------------- | ----: | ---- | ---------------------------------------------------------- | ------ | ----------------------- |
| click duration median |   296 | ms   | three synthetic equivalent runs; playback; 4× CPU slowdown | trace  | Sanitized trace fixture |

- **Recommendation:** Use a real trace to split renderer, media, framework, and third-party work before choosing an implementation.
- **Retest:** Repeat the same playback switch with normal CPU and 4× CPU slowdown, instrumentation off, after any authorized change.
- **Success criterion:** Meet a product-approved interaction budget with improvement larger than run-to-run variation and no media regression.
- **Stop condition:** Stop if a production-equivalent clean run does not reproduce the delay or the difference falls inside run-to-run variation.

### F-002 | P2 | INFERENCE | Offscreen mounted originals are a decode-pressure hypothesis

- **Surface:** Library / All
- **Conditions:** synthetic 48-item Library DOM inventory; 14 cards visible
- **User impact:** If the mounted originals are loaded and decoded, they may compete with scrolling and playback resources.
- **Causal status:** correlated
- **Caveats:** Mounted is not loaded, decoded, or resident; the nominal RGBA8 proxy is not JS heap or GPU residency.

| Signal                                    | Value | Unit     | Conditions                              | Source | Tool                    |
| ----------------------------------------- | ----: | -------- | --------------------------------------- | ------ | ----------------------- |
| offscreen mounted original-image elements |    19 | elements | synthetic 48-item Library DOM inventory | dom    | Sanitized trace fixture |

- **Recommendation:** First verify loaded, decoded, and resident states plus interaction impact; only then consider card variants or windowing.
- **Retest:** Measure the same list with resource metadata, decoded-state evidence, a fixed scroll, and playback negative control.
- **Success criterion:** Demonstrate less decode/resource pressure and a material interaction improvement without blank cards.
- **Stop condition:** Stop if offscreen resources are not decoded/resident or the interaction signal does not improve.

### F-003 | P3 | VERIFIED | The fixture contains repeated third-party requests

- **Surface:** Library / All
- **Conditions:** synthetic tab-exploration window
- **User impact:** No user-visible performance impact is established by request count alone.
- **Causal status:** measured
- **Caveats:** Request count is not bandwidth, main-thread cost, privacy impact, or causal attribution.

| Signal                    | Value | Unit     | Conditions                       | Source  | Tool                    |
| ------------------------- | ----: | -------- | -------------------------------- | ------- | ----------------------- |
| third-party request count |    79 | requests | synthetic tab-exploration window | network | Sanitized trace fixture |

- **Recommendation:** Attribute transfer and main-thread work before changing tracker lifecycle.
- **Retest:** Compare an equivalent product-approved tracker-on/off or isolated initiator trace.
- **Success criterion:** Show a reproducible user-facing or resource improvement without losing required analytics.
- **Stop condition:** Stop if the requests are cached/idle and have no material transfer, task, or interaction cost.

## Negative findings

### VERIFIED | The synthetic 10-cycle fixture does not show monotonic post-recovery DOM growth.

- **Conditions:** ten equivalent cycles plus fixed recovery
- **Causal status:** measured
- **Scope limit:** Does not cover a long editing session or media decoder resources.

| Signal                       | Value | Unit  | Conditions                  | Source         | Tool                    |
| ---------------------------- | ----: | ----- | --------------------------- | -------------- | ----------------------- |
| post-recovery DOM node delta |   -10 | nodes | synthetic ten-cycle fixture | browser_metric | Sanitized trace fixture |

## UNVERIFIED and production gaps

- **production-equivalent product behavior** — This artifact is a synthetic showcase, not a live browser run. Needed evidence: Run the same contract against the authorized exact target with clean production-equivalent traces.

## Restoration

- Final state: Paused on Media; instrumentation and throttle off
- Initial state restored: yes
- Instrumentation removed: yes
- Throttling removed: yes
- Media stopped: yes
- Product data changed: no
- Code changed: no
- Notes: Synthetic demo did not open or mutate a product page.
- Finished: 2026-08-30T00:05:00+00:00
