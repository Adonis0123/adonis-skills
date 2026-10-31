---
slug: codex-non-interactive
title: Non-interactive mode
publisher: OpenAI
url: https://learn.chatgpt.com/docs/non-interactive-mode
fetchedAt: 2026-10-31
lastVerifiedAt: 2026-10-31
linkStatus: ok
finalUrl:
---

# Non-interactive mode

## Summary

- `codex exec` runs Codex in scripts and CI without the interactive interface.
- Progress goes to stderr and only the final message goes to stdout, so output is easy to pipe or redirect.
- Piped stdin is added as context when a prompt is also supplied, and `--ephemeral` avoids saving session files.
- Runs default to a read-only sandbox; writing needs workspace-write, and full access belongs only in controlled environments.
- `--json` emits a JSON Lines event stream, `-o` saves only the final message, and `--output-schema` requests a response matching a schema.
- Authenticate with an API key scoped to the single invocation, and keep keys away from steps that run untrusted repository code.
- The `resume` subcommand continues a prior session, and runs expect a Git repository unless the check is skipped.
- Examples include a CI workflow that proposes fixes after failed builds and patterns for piping command output into `codex exec`.

## Cited quotes

- "Use danger-full-access only in a controlled environment" (safe-low-risk-preset)
