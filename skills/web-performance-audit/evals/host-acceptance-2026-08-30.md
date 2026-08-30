# Host acceptance snapshot — 2026-08-30

This is a point-in-time acceptance result for the Adonis Skills package identity `web-performance-audit`, not a promise about future client versions or browser integrations.

## Acceptance layers

1. A temporary Git repository installed the complete skill with:

   ```text
   npx skills add <local-public-skills-directory> --skill web-performance-audit
   ```

   The installer discovered the exact slug and copied all 21 package files.

2. The deterministic suite passed 24/24 checks, including ledger semantics, target privacy, surface coverage, installation guidance, and public portability.
3. Each listed client loaded the installed skill by its native invocation syntax under a read-only boundary and returned a structured result containing the exact skill name, all five evidence labels, honest fallbacks, no silent installation, and restoration expectations.

## Results

| Client      | Version / route                                | Invocation                                                                                        | Exit | Result                                                                                                                           |
| ----------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---: | -------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | 2.1.236 / claude-fable-5                       | Explicit `/web-performance-audit`, plan mode, Read only, strict schema                            |    0 | PASS: exact new identity, five labels, fallbacks, no silent install, restoration                                                 |
| Codex CLI   | 0.151.0 / gpt-5.6-sol                          | Explicit `$web-performance-audit`, read-only sandbox, ephemeral session, strict schema            |    0 | PASS: exact new identity, five labels, fallbacks, no silent install, restoration                                                 |
| Cursor CLI  | cursor-agent 2026.08.25-3e8eec8 / composer-2.5 | Explicit `/web-performance-audit` plus natural-language auto trigger, `ask` mode, sandbox enabled |    0 | PASS: project `.agents/skills` discovery, 16/16 blocked coverage, metric guards, authorization gate, restoration, clean worktree |
| Grok CLI    | 1.0.13 / grok-4.6-build                        | Explicit `/web-performance-audit`, plan mode, web disabled, strict schema                         |    0 | PASS: `structuredOutput` preserved the exact new identity and core contract                                                      |

## Noise and scope limits

- Grok emitted unrelated plugin-collision, Figma MCP handshake, hook-parsing, and missing status-hook environment warnings. The structured result still passed; these warnings do not prove those integrations are healthy.
- Cursor explicit invocation and natural-language auto selection both loaded the exact skill from a temporary repository. The normalized semantic grader passed exact source duration, source-order hierarchy, 16 blocked states with reasons, five evidence labels, clean-baseline ordering, click/heap/image/Coverage/throttling/pollution/small-sample guards, fallbacks, authorization, restoration, and clean-worktree checks.
- Cursor headless `plan` exited 0 but returned only progress text instead of the requested final JSON, so that route is **not accepted** for machine-graded delivery on this version. The read-only `ask` route returned the complete artifact. One alternative-model run hit an account usage limit and one request hit a transient TLS disconnect; neither reached skill execution and neither is counted as a skill result.
- Raw client transcripts are intentionally not committed because they contain host metadata and unrelated plugin paths.
- This port reran installation, discovery, strict core-contract checks, the 24 deterministic tests, and the demo render. Cursor also reran the sixteen-surface browserless fixture under the new slug; that full fixture was not rerun on every other client.
- The live availability of Chrome DevTools MCP, authenticated browser control, Computer Use, Recorder, and React Scan remains environment-specific. A client pass never turns an unavailable browser capability into measured page evidence.

## Publication decision

The repository-neutral package identity and core workflow are verified on the listed Claude Code, Codex CLI, Cursor CLI, and Grok CLI versions, subject to the recorded Cursor headless-mode limitation. Do not extend this claim to unlisted clients or to live browser capabilities that were not discovered, handshaken, and exercised in the target environment.
