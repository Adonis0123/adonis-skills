# Cross-agent compatibility contract

This skill uses the Agent Skills file format and keeps provider-specific behavior at the capability boundary.

## Portable package rules

- The canonical package is one directory containing `SKILL.md`, optional `scripts/`, `references/`, `assets/`, and product metadata under `agents/`.
- Keep the public identity equal to the directory/frontmatter name: `web-performance-audit`.
- Use only portable frontmatter fields required by the repository. Do not put provider-specific tool names in `allowed-tools`.
- `{{skill_path}}` is this repository's documentation placeholder for the directory containing the loaded `SKILL.md`. A host must resolve and replace it before file access; never send the literal braces to a shell. If the host cannot expose the loaded skill root, use the known installed skill directory from discovery instead of guessing from the working directory or a user's home path.
- Scripts use Python's standard library and accept explicit input/output paths.
- Instructions name capabilities first. A host may expose Chrome DevTools through MCP, a CLI, a plugin, or no direct integration.

## Discovery locations

Install from the public Adonis Skills repository:

```text
npx skills add adonis0123/adonis-skills --skill web-performance-audit
```

Otherwise, copy the complete `web-performance-audit` directory into a skill location documented by the current client. Do not copy only `SKILL.md`; the validator, references, demo assets, and metadata are part of the package. Do not guess a home directory or modify global client configuration when a project-scoped installation is sufficient.

Cursor's official Agent Skills documentation lists project-level `.agents/skills/` and `.cursor/skills/` among its discovery roots, so the same project-scoped installation works without a Cursor-only copy.

Invoke `/web-performance-audit` in Claude Code, Cursor CLI, and Grok CLI, and `$web-performance-audit` in Codex CLI. These are discovery hints, not compatibility proof.

Claude Code, Codex CLI, Cursor CLI, and Grok CLI behavior can drift by version; verify discovery with a real invocation rather than treating an installed directory as proof.

Installing this skill and installing browser capabilities are separate operations. When Chrome DevTools MCP, a structured browser, Computer Use, Recorder access, or React localization is missing, follow `{{skill_path}}/references/capability-bootstrap.md`. Never bundle a machine-specific Chrome executable, browser profile, debugging port, credential store, or user-level path into the public package.

The latest repository acceptance snapshot is `../evals/host-acceptance-2026-08-30.md`. Treat it as dated evidence: it records current passes and client-side blockers instead of converting package compatibility into a runtime guarantee.

## Host acceptance test

For each supported client, use a temporary repository with the skill installed and ask the client, in read-only/plan mode when available, to process the same sanitized fixture. A pass requires the output to:

1. identify the skill by its exact name;
2. honor the read-only boundary;
3. route unavailable tools to fallbacks instead of fabricating results;
4. preserve evidence labels and measurement caveats;
5. include coverage, recommendations, negative results, `UNVERIFIED` paths, and restoration;
6. avoid editing fixture/product files.
7. resolve bundled resources without emitting or executing the literal text `{{skill_path}}`.
8. preserve the fixture's exact target and surface names; matching only the number of tabs is a failure.
9. when a required tool is absent, give a capability-level fallback or official installation card without silently mutating the host.

Test both explicit invocation and a natural-language trigger if the host supports automatic skill selection. Record the CLI version, exit code, output, and worktree diff. “The model mentioned the skill” is not enough; verify the required behavior in the output. Grade semantic requirements rather than an unrequested JSON container type or hierarchy delimiter.

### Cursor CLI headless route

Cursor CLI supports both `plan` and `ask` as read-only modes. For headless acceptance that requires a final machine-readable artifact, use `ask` and verify the parsed result plus a clean worktree:

```text
cursor-agent --print --output-format json --mode ask --sandbox enabled \
  --workspace <temporary-repository> '/web-performance-audit <sanitized request>'
```

Only pass `--trust` for an inspected isolated repository. On the accepted 2026.08.25 CLI, the equivalent `plan` command could exit successfully after returning progress text without the requested final JSON; therefore exit code alone is not acceptance proof. Re-test this limitation before removing it.

Official Cursor references:

- https://cursor.com/docs/skills
- https://cursor.com/docs/cli/using
- https://cursor.com/docs/cli/reference/parameters

## Tool adapter rules

| Host capability         | Workflow role                                    | If unavailable                                                                |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Chrome DevTools MCP/CLI | trace, Network, DOM, Coverage, Memory, emulation | browser probes, exported trace, visual evidence, source hypotheses; mark gaps |
| Browser plugin/driver   | exact authenticated interaction and snapshots    | Computer Use or user-provided recording; mark structured DOM gaps             |
| Computer Use            | Recorder/DevTools UI and visual-only controls    | structured driver or user-performed UI step; do not invent visual state       |
| Shell/Python            | evidence-ledger validation and rendering         | follow the report contract manually                                           |
| React Scan/Profiler     | React-localized hypothesis                       | browser trace plus source inspection; mark React ownership unverified         |

The workflow remains useful with partial capabilities because every missing layer becomes explicit coverage. It is not acceptable to silently downgrade a quantitative claim to a visual guess.

## Freshness rule

Before publishing claims that a client supports this skill, rerun the acceptance test on the locally installed client version. MCP configuration, skill discovery paths, permission flags, and non-interactive modes are version-sensitive.
