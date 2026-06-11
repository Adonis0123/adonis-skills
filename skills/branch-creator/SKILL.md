---
name: branch-creator
description: "Create safe Git feature or hotfix branches with concise names. Use this whenever the user asks to create a branch, start work on a new feature or fix, wants a `feat/...` or `hotfix/...` branch name, asks for a short branch slug from a task description, or wants help before beginning local Git work. Default to recommending the branch name and command first, then create only after user confirmation. Do not push, commit, rebase, or create PRs."
metadata:
  author: adonis
  version: "1.1.1"
---

# Branch Creator

Create a local Git branch with a short, readable name:

- `feat/<slug>` for normal feature work
- `hotfix/<slug>` for urgent fixes or production-impacting repairs

Three qualities define a good run, in this order:

1. **Accurate** — the prefix matches urgency, and the slug names the thing with words the team already uses.
2. **Fast** — the whole flow takes at most two shell commands and a handful of output lines.
3. **Short** — the slug is 1–3 words, ideally 2; short names get typed by hand, tab-completed, and scanned in PR lists, so every extra word costs more than it informs.

Branch creation changes the local checkout, so the default workflow is propose first, create after confirmation.

## Trigger Examples

Use this skill when the user says things like:

- "帮我创建一个分支做支付成功页修复"
- "起个 feat 分支，做 pricing table cleanup"
- "new branch for login redirect fix"
- "hotfix branch for failed billing confirmation"
- "我要开始做这个功能，先建分支"

Do not use this skill for:

- committing, pushing, opening PRs/MRs, or finishing branches
- renaming or deleting existing branches
- complex release branching strategy design

## Decision Rules

### Prefix

Pick one prefix:

- Use `feat/` for new features, non-urgent product changes, refactors tied to a feature, UI improvements, and planned work.
- Use `hotfix/` for urgent fixes, production breakages, release-blocking fixes, payment/auth/data-loss fixes, or when the user explicitly says hotfix.

If both are plausible, recommend one and ask for confirmation. Do not silently use `hotfix/` just because the task is a bug; reserve it for urgency or release pressure.

### Slug

Generate the part after the slash from the user's task:

- Use lowercase English words joined by hyphens.
- **1–3 words, prefer 2. Aim for a slug under 16 characters; treat 20 as the ceiling.** If the task does not fit in 3 words, pick the first concrete slice or ask one scope question.
- **Reuse vocabulary the project already has.** If the request or surrounding context mentions an existing script, command, module, or team term (`track:gen`, `paid-success`, `pricing-table`), derive the slug from it (`track-gen`) instead of re-describing the task in fresh English (`tracker-code-generation`). The team greps, tab-completes, and recognizes branches by the words they already use, so a shorter borrowed name is also the more accurate one. Do not go searching the repo for vocabulary — only reuse terms already visible in the request or conversation.
- Drop filler words that carry no meaning in context: `add`, `update`, `fix`, `new`, `page`, `feature`, `code`, `logic`, `issue`, `support`.
- Avoid issue numbers unless the user provided one and clearly wants it included.

Tightening examples — the "loose" names are what to avoid:

| Task | Loose (too long) | Tight |
| --- | --- | --- |
| 改埋点代码的生成方式（项目里有 `track:gen`） | `feat/tracker-code-generation` | `feat/track-gen` |
| 登录后跳转修复 | `feat/fix-login-redirect-issue` | `feat/login-redirect` |
| 线上支付确认弹窗崩溃 | `hotfix/payment-confirmation-modal-crash` | `hotfix/pay-confirm` |
| pricing 页面多币种支持 | `feat/pricing-multi-currency-support` | `feat/pricing-currency` |

Safe character set: letters `a-z`, numbers `0-9`, hyphen `-`, one slash between prefix and slug. Avoid spaces, uppercase, underscores, dots, quotes, emoji, shell metacharacters, consecutive slashes, and Git-reserved sequences such as `..` or `@{`.

## Workflow

Speed matters here: every extra shell command is a round trip the user waits through, and `git ls-remote` is a *network* round trip that can take seconds. The whole flow needs at most two commands — one to inspect, one to create.

### 1. Inspect (one command)

```bash
git status --short --branch
```

This single call tells you everything you need: it errors if the directory is not a Git repository (stop and tell the user), the `## ...` line shows the current branch, and any remaining lines show uncommitted changes. Do not also run `git rev-parse`, `git branch --show-current`, `git show-ref`, or any remote query during the proposal step.

A dirty working tree is not a blocker — `git switch -c` carries the changes onto the new branch. Mention it in one clause and continue.

### 2. Propose (four lines, then stop)

Reply in the user's language, in exactly this shape:

```text
推荐分支：feat/track-gen
命令：git switch -c feat/track-gen
原因：<one sentence covering both prefix and slug choice>
（当前 master，工作区干净）确认后我创建。
```

The final line compresses the repository state into one parenthetical. Do not output a checklist that reports each individual check on its own line (格式 / 本地同名 / 远端同名 / …) — that is slower to produce and slower to read, and the checks happen at creation time anyway.

If the user's intent is too vague to name well, ask one concise question instead of proposing. Good branch names depend on small scope.

### 3. Create (one command, after confirmation)

If the original request already pre-authorizes creation ("直接创建", "create it now", "不用确认"), propose and create in the same turn — still show the name and command, just don't wait.

If the user confirms a branch you already proposed in the previous turn, use that exact branch name unless the user asks to change it. Do not regenerate the slug.

```bash
git check-ref-format --branch <branch-name> && git switch -c <branch-name>
```

No pre-checks needed beyond this chain: `git switch -c` itself fails cleanly if the branch already exists — handle that by offering `git switch <branch-name>` instead. If `git check-ref-format` fails, do not try shell escaping or quoting tricks; generate a simpler safe name and confirm it. Skip the remote-collision check by default: it costs a network round trip, and a collision surfaces harmlessly at push time anyway. Run `git ls-remote --heads origin <branch-name>` only if the user explicitly asks about the remote.

Never push, commit, rebase, merge, delete branches, or create a PR/MR as part of this skill.

### 4. Report (one or two lines)

```text
已创建并切换：feat/track-gen（原 master）
未提交的改动已随分支带过来。
```

The parenthetical reports the previous branch only. The second line appears only when the working tree was dirty. If creation fails, quote the failing command and the relevant error line, then suggest the smallest safe next step.

## Quality Bar

A good result is boring, fast, and short:

- At most two shell commands total, and no network calls.
- Slug is 1–3 words (prefer 2), under 20 characters, reusing project vocabulary when it exists.
- The prefix communicates urgency correctly.
- The proposal is 4 lines; the post-creation report is 1–2 lines.
- The checkout never changes before the user has seen the name and command.
