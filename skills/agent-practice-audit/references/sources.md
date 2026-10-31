# Sources

Refresh mode searches only these official domains. A page outside the list is never added, however good it looks. Third-party blogs, newsletters, X/Twitter, YouTube, Reddit, Medium and course sites are excluded, including posts that quote official pages: follow the quote back to the official page and cite that.

`scripts/check_practices.py` enforces the same list (`ALLOWED_DOMAINS`, `GITHUB_ORGS`). Change both together.

## Allowlist

| Vendor    | Domains                                                                                                  | Notes                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Anthropic | `code.claude.com`, `docs.anthropic.com`, `docs.claude.com`, `claude.com`, `anthropic.com` (incl. `www.`) | Claude Code docs and `anthropic.com/engineering` posts.                                                                       |
| OpenAI    | `learn.chatgpt.com`, `developers.openai.com`, `openai.com`, `platform.openai.com`                        | Codex guides, docs and announcements.                                                                                         |
| Google    | `geminicli.com`, `github.com/google-gemini/*`, `developers.googleblog.com`, `ai.google.dev`              | Gemini CLI docs live on the site and in the `google-gemini/gemini-cli` repository `docs/`. Other GitHub orgs are not allowed. |
| Cursor    | `cursor.com`, `docs.cursor.com`                                                                          | Docs and the official blog.                                                                                                   |
| xAI       | `docs.x.ai`                                                                                              | Grok docs.                                                                                                                    |
| Tencent   | `codebuddy.ai` (incl. `www.`), `cloud.tencent.com`                                                       | CodeBuddy product docs only; other `cloud.tencent.com` products are out of scope.                                             |

## Seed URLs

Start here, then follow in-site links and the vendor's own search. Seeds marked _verified_ back at least one practice in `practices.json` (checked live on the date in `changelog.md`). Seeds marked _seed_ are starting points that refresh has not yet confirmed; fetch them before relying on them.

| Vendor    | URL                                                            | State                             |
| --------- | -------------------------------------------------------------- | --------------------------------- |
| Anthropic | https://code.claude.com/docs/en/best-practices                 | verified                          |
| Anthropic | https://code.claude.com/docs/en/memory                         | verified                          |
| Anthropic | https://code.claude.com/docs/en/costs                          | verified                          |
| Anthropic | https://code.claude.com/docs/en/common-workflows               | verified                          |
| Anthropic | https://code.claude.com/docs/en/hooks-guide                    | seed                              |
| Anthropic | https://code.claude.com/docs/en/settings                       | seed                              |
| Anthropic | https://code.claude.com/docs/en/sub-agents                     | seed                              |
| Anthropic | https://www.anthropic.com/engineering                          | seed (index of engineering posts) |
| OpenAI    | https://learn.chatgpt.com/guides/best-practices                | verified                          |
| OpenAI    | https://learn.chatgpt.com/docs/sandboxing.md                   | verified                          |
| OpenAI    | https://learn.chatgpt.com/docs/non-interactive-mode            | verified                          |
| OpenAI    | https://learn.chatgpt.com/docs/agent-configuration/agents-md   | verified                          |
| OpenAI    | https://developers.openai.com/codex                            | seed                              |
| Google    | https://geminicli.com/docs/                                    | seed                              |
| Google    | https://github.com/google-gemini/gemini-cli/tree/main/docs     | seed                              |
| Google    | https://developers.googleblog.com/ (search "Gemini CLI")       | seed                              |
| Cursor    | https://cursor.com/blog/agent-best-practices                   | verified                          |
| Cursor    | https://cursor.com/docs                                        | seed                              |
| xAI       | https://docs.x.ai/                                             | seed                              |
| Tencent   | https://www.codebuddy.ai/docs                                  | seed                              |
| Tencent   | https://cloud.tencent.com/document/product (CodeBuddy section) | seed                              |

## Offline digests

Every page that a practice cites has `references/sources/<slug>.md`, and each source entry in `practices.json` names it in `source`. The digest holds frontmatter (`slug`, `title`, `publisher`, `url`, `fetchedAt`, `lastVerifiedAt`, `linkStatus` = ok | redirected | unreachable, `finalUrl` when redirected), a 5-12 bullet summary in our own words (no copied paragraphs), and the short verbatim quotes the practices cite. When a page cannot be opened (403, region block, outage), the report keeps the link but marks it unavailable and shows the digest, and verifiers judge against the digest (`basis: digest`). `check_practices.py --fetch --update-digests` refreshes the link state; it never deletes a digest or a practice.

## What counts as a practice

- An instruction a user can follow or check: "keep CLAUDE.md under 200 lines", not "Claude is great at refactoring".
- Stated by the vendor in its own voice. Release notes count when they recommend a behaviour; feature lists alone do not.
- Observable in local logs or config (or honestly `na` with a reason in `detect`).
- Not a duplicate: when two vendors say the same thing, add the second quote as another source on the existing practice.
