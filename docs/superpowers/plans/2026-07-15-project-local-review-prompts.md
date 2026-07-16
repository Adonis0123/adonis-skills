# Project-Local Review Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace portable review attachments with one repository-local, expiring Markdown prompt that `agentic-review-handoff` can resolve through a stable `Review-Prompt-ID`.

**Architecture:** `review-prompt-composer` owns prompt creation and expiration under `$repo_root/.review-handoff/prompts/**`; `agentic-review-handoff` keeps its existing packet lifecycle under `.review-handoff/active/**` and `.review-handoff/archive/**`. The contexts share only the prompt ID/frontmatter contract and the existing repository-local ignore rule.

**Tech Stack:** Python 3 standard library, Markdown skill definitions, JSON eval fixtures, YAML OpenAI metadata, Git CLI, pnpm/Turborepo validation scripts.

## Global Constraints

- Shared repository and working tree only; do not retain cross-environment delivery branches.
- Generate one authoritative Markdown prompt; do not generate patch, tar, manifest, or checksum artifacts.
- Store prompts only below `$repo_root/.review-handoff/prompts/**`.
- Keep the existing agentic packet paths `$repo_root/.review-handoff/active/**` and `$repo_root/.review-handoff/archive/**` unchanged.
- Use local time in filenames and UTC ISO 8601 timestamps in frontmatter.
- Default prompt lifetime is exactly 24 hours.
- Modify `$GIT_COMMON_DIR/info/exclude` idempotently; never modify the tracked `.gitignore`.
- Do not run reviewed-repository tests from the skill, modify reviewed source, stage, stash, commit, push, or send a prompt.
- Do not create a commit while implementing this plan unless the user explicitly authorizes it at execution time.
- Source design: `docs/plans/2026-07-15-review-prompt-composer-project-local-prompts-design.md`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `skills/review-prompt-composer/scripts/write_review_prompt.py` | Resolve the repository, maintain ignore state, archive expired prompts, validate and atomically write one prompt file. |
| `skills/review-prompt-composer/scripts/test_write_review_prompt.py` | Black-box coverage for naming, prompt creation, expiration, collision handling, ignore behavior, and secret-safe failure. |
| `skills/review-prompt-composer/scripts/build_review_handoff.py` | Delete; portable attachment construction is outside the accepted domain. |
| `skills/review-prompt-composer/scripts/test_build_review_handoff.py` | Delete with the removed portable builder. |
| `skills/review-prompt-composer/SKILL.md` | Shared-worktree-only prompt composition workflow and prompt body contract. |
| `skills/review-prompt-composer/evals/evals.json` | Behavioral evals for strict scopes, repository-local prompt writes, expiration, and ID echoing. |
| `skills/review-prompt-composer/agents/openai.yaml` | Default invocation aligned with the project-local prompt workflow. |
| `skills/agentic-review-handoff/references/source-prompt-addressing.md` | Isolated prompt-ID parsing, resolution, validation, and provenance contract. |
| `skills/agentic-review-handoff/SKILL.md` | Fast-path routing and optional source-prompt resolution before packet stage handling. |
| `skills/agentic-review-handoff/references/packet-anatomy.md` | Optional `source_prompt_*` packet frontmatter fields. |
| `skills/agentic-review-handoff/references/packet-addressing.md` | Shared `$GIT_COMMON_DIR/info/exclude` bootstrapping for packet and prompt artifacts. |
| `skills/agentic-review-handoff/evals/evals.json` | Explicit-ID, feedback-echo, unique-fallback, ambiguity, and traversal evals. |
| `skills/agentic-review-handoff/agents/openai.yaml` | Default prompt tells the runtime to resolve echoed IDs safely. |
| `apps/web/src/generated/skills-index-lite.json` | Regenerated public skill metadata; never edit manually. |
| `apps/web/src/generated/skills-detail-index.json` | Regenerated skill body index; never edit manually. |

### Task 1: Replace the Portable Bundle Builder with Prompt Artifact Storage

**Files:**
- Delete: `skills/review-prompt-composer/scripts/build_review_handoff.py`
- Delete: `skills/review-prompt-composer/scripts/test_build_review_handoff.py`
- Create: `skills/review-prompt-composer/scripts/write_review_prompt.py`
- Create: `skills/review-prompt-composer/scripts/test_write_review_prompt.py`

**Interfaces:**
- Consumes: repository path, canonical scope, and a UTF-8 body file containing exactly one `{{REVIEW_PROMPT_ID}}` token.
- Produces: JSON with `prompt_path`, `prompt_id`, `branch`, `head`, `scope`, `created_at`, `expires_at`, `archived_paths`, and `warnings`.
- Python API: `create_review_prompt(repo: Path, scope: str, body: str, now: datetime | None = None) -> PromptArtifact`.
- Python API: `archive_expired_prompts(repo: Path, branch_slug: str, now: datetime) -> ArchiveResult`.

- [ ] **Step 1: Add failing black-box tests for repository-local prompt creation**

Create a `unittest` fixture using the existing temporary Git repository pattern. The first test must exercise the CLI and assert the complete public contract:

```python
def test_writes_single_prompt_under_repo_local_branch_inbox(self) -> None:
    (self.repo / "tracked.txt").write_text("changed\n", encoding="utf-8")
    body_file = self.root / "body.md"
    body_file.write_text(REVIEW_BODY, encoding="utf-8")

    result = self.run_writer("all-uncommitted", body_file)

    self.assertEqual(result.returncode, 0, result.stderr)
    payload = json.loads(result.stdout)
    prompt_path = Path(payload["prompt_path"])
    self.assertEqual(prompt_path.parent, self.repo / ".review-handoff/prompts/active/main")
    self.assertRegex(prompt_path.name, r"^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-all-uncommitted\.md$")
    prompt = prompt_path.read_text(encoding="utf-8")
    self.assertIn("artifact_type: review_prompt", prompt)
    self.assertIn(f"prompt_id: \"{payload['prompt_id']}\"", prompt)
    self.assertIn(f"Review-Prompt-ID: `{payload['prompt_id']}`", prompt)
    self.assertNotIn("{{REVIEW_PROMPT_ID}}", prompt)
    self.assertNotIn("tracked.patch", prompt)
    self.assertNotIn("manifest.md", prompt)
    self.assertNotIn(".review-handoff", self.git("status", "--short").stdout)
```

Define `REVIEW_BODY` with all required headings so tests exercise final validation:

```python
REVIEW_BODY = """# 审核任务：测试改动

## 工作区与范围
仓库与范围来自当前测试仓库。

## 待验证目标
验证行为没有回归。

## 改动清单
1. `tracked.txt` — modified

## 审核重点
- 正确性与回归风险。

## 输出要求
第一行必须原样返回：

Review-Prompt-ID: `{{REVIEW_PROMPT_ID}}`
"""
```

- [ ] **Step 2: Run the focused test to prove the old implementation cannot satisfy it**

Run:

```bash
python3 -m unittest skills/review-prompt-composer/scripts/test_write_review_prompt.py -v
```

Expected: FAIL because `write_review_prompt.py` does not exist.

- [ ] **Step 3: Implement the prompt artifact API and CLI**

Implement these exact domain types and constants in `write_review_prompt.py`:

```python
SCOPES = ("all-uncommitted", "staged-only", "unstaged-only", "untracked-only", "ref-range")
PROMPT_TOKEN = "{{REVIEW_PROMPT_ID}}"
REQUIRED_HEADINGS = (
    "# 审核任务",
    "## 工作区与范围",
    "## 待验证目标",
    "## 改动清单",
    "## 审核重点",
    "## 输出要求",
)
PROMPT_TTL = timedelta(hours=24)

@dataclass(frozen=True)
class ArchiveResult:
    archived_paths: tuple[Path, ...]
    warnings: tuple[str, ...]

@dataclass(frozen=True)
class PromptArtifact:
    prompt_path: Path
    prompt_id: str
    branch: str
    head: str
    scope: str
    created_at: datetime
    expires_at: datetime
    archived_paths: tuple[Path, ...]
    warnings: tuple[str, ...]
```

Implement these functions without third-party dependencies:

```python
def run_git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(["git", *args], cwd=repo, check=False, capture_output=True)
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise WriterError(f"git {' '.join(args)} failed: {message}")
    return result.stdout


def resolve_repo(raw_repo: str | Path) -> Path:
    candidate = Path(raw_repo).expanduser().resolve()
    root = os.fsdecode(run_git(candidate, "rev-parse", "--show-toplevel")).strip()
    return Path(root).resolve()


def normalize_branch_slug(branch: str) -> str:
    normalized = branch.lower().replace("/", "-").replace("\\", "-")
    normalized = re.sub(r"[^a-z0-9._-]+", "-", normalized).strip("-.")
    return normalized or "head"


def ensure_review_handoff_excluded(repo: Path) -> Path:
    raw_common_dir = os.fsdecode(run_git(repo, "rev-parse", "--git-common-dir")).strip()
    common_dir = Path(raw_common_dir)
    if not common_dir.is_absolute():
        common_dir = (repo / common_dir).resolve()
    exclude_file = common_dir / "info" / "exclude"
    exclude_file.parent.mkdir(parents=True, exist_ok=True)
    existing = exclude_file.read_text(encoding="utf-8") if exclude_file.exists() else ""
    if not re.search(r"(?m)^/?\.review-handoff/$", existing):
        separator = "" if not existing or existing.endswith("\n") else "\n"
        atomic_write_text(exclude_file, f"{existing}{separator}/.review-handoff/\n")
    return exclude_file
```

Use `tempfile.NamedTemporaryFile(delete=False, dir=destination.parent)` followed by `os.replace()` in `atomic_write_text()`. Serialize YAML string values with `json.dumps(value, ensure_ascii=False)` so branch names and paths cannot break frontmatter.

`create_review_prompt()` must:

1. resolve the real repository root;
2. read branch with `git rev-parse --abbrev-ref HEAD` and HEAD with `git rev-parse HEAD`;
3. validate `scope`, required heading prefixes, non-empty body, exactly one prompt token, private-key markers, and credential-bearing URLs;
4. call `ensure_review_handoff_excluded()`;
5. archive expired prompts for the current branch;
6. create `prompts/active/<branch_slug>/` and `prompts/archive/<branch_slug>/`;
7. allocate `YYYY-MM-DD_HH-mm-<scope_slug>.md`, adding `-02`, `-03`, and so on if either active or archive already contains the name;
8. construct `prompt_id = f"{branch_slug}/{filename_without_md}"`;
9. replace the single prompt token;
10. prepend the accepted frontmatter fields and atomically write the final file;
11. run `git status --short --untracked-files=all` and fail if `.review-handoff/` appears;
12. return `PromptArtifact`.

The CLI accepts:

```text
--repo <path>
--scope all-uncommitted|staged-only|unstaged-only|untracked-only|ref-range
--body-file <path-or-dash>
```

`--body-file -` reads UTF-8 from stdin. Success prints the dataclass as JSON; expected failures prefix the sanitized stderr message with `Error:` and exit 1.

- [ ] **Step 4: Run creation tests and verify they pass**

Run:

```bash
python3 -m unittest skills/review-prompt-composer/scripts/test_write_review_prompt.py -v
```

Expected: creation test PASS, with exactly one `.md` prompt and no portable artifacts.

- [ ] **Step 5: Add failing expiration, collision, malformed-file, exclude, and sensitive-content tests**

Add tests with these exact assertions:

```python
FIXED_NOW = datetime(2026, 7, 15, 6, 30, tzinfo=timezone.utc)


def prompt_body(path: Path) -> str:
    return path.read_text(encoding="utf-8").split("---\n", 2)[2]


def test_archives_expired_prompt_without_deleting_it(self) -> None:
    self.dirty_tracked_file()
    first = WRITER.create_review_prompt(self.repo, "all-uncommitted", REVIEW_BODY, FIXED_NOW)
    original_body = prompt_body(first.prompt_path)

    second = WRITER.create_review_prompt(
        self.repo,
        "all-uncommitted",
        REVIEW_BODY,
        FIXED_NOW + timedelta(hours=25),
    )

    archived = self.repo / ".review-handoff/prompts/archive/main" / first.prompt_path.name
    self.assertFalse(first.prompt_path.exists())
    self.assertTrue(archived.exists())
    self.assertIn("lifecycle_state: expired", archived.read_text(encoding="utf-8"))
    self.assertEqual(prompt_body(archived), original_body)
    self.assertIn(archived, second.archived_paths)

def test_keeps_unexpired_prompt_active(self) -> None:
    self.dirty_tracked_file()
    first = WRITER.create_review_prompt(self.repo, "all-uncommitted", REVIEW_BODY, FIXED_NOW)

    WRITER.create_review_prompt(
        self.repo,
        "all-uncommitted",
        REVIEW_BODY,
        FIXED_NOW + timedelta(hours=23),
    )

    self.assertTrue(first.prompt_path.exists())
    self.assertIn("lifecycle_state: active", first.prompt_path.read_text(encoding="utf-8"))

def test_collision_adds_numeric_suffix(self) -> None:
    self.dirty_tracked_file()
    first = WRITER.create_review_prompt(self.repo, "all-uncommitted", REVIEW_BODY, FIXED_NOW)
    second = WRITER.create_review_prompt(self.repo, "all-uncommitted", REVIEW_BODY, FIXED_NOW)

    self.assertNotEqual(first.prompt_path, second.prompt_path)
    self.assertTrue(second.prompt_path.name.endswith("-all-uncommitted-02.md"))

def test_malformed_active_prompt_is_preserved_and_reported(self) -> None:
    self.dirty_tracked_file()
    malformed = self.repo / ".review-handoff/prompts/active/main/broken.md"
    malformed.parent.mkdir(parents=True)
    malformed.write_text("---\nexpires_at: not-a-date\n---\nbroken\n", encoding="utf-8")

    artifact = WRITER.create_review_prompt(self.repo, "all-uncommitted", REVIEW_BODY, FIXED_NOW)

    self.assertTrue(malformed.exists())
    self.assertTrue(any("broken.md" in warning for warning in artifact.warnings))

def test_existing_unanchored_exclude_is_not_duplicated(self) -> None:
    self.dirty_tracked_file()
    exclude_file = self.repo / ".git/info/exclude"
    exclude_file.write_text(".review-handoff/\n", encoding="utf-8")

    WRITER.create_review_prompt(self.repo, "all-uncommitted", REVIEW_BODY, FIXED_NOW)

    self.assertEqual(exclude_file.read_text(encoding="utf-8"), ".review-handoff/\n")

def test_sensitive_body_fails_without_printing_secret(self) -> None:
    self.dirty_tracked_file()
    secret = "https://alice:do-not-print@example.invalid/private"
    body = REVIEW_BODY.replace("验证行为没有回归。", secret)

    with self.assertRaises(WRITER.WriterError) as raised:
        WRITER.create_review_prompt(self.repo, "all-uncommitted", body, FIXED_NOW)

    self.assertIn("credential-bearing URL", str(raised.exception))
    self.assertNotIn("do-not-print", str(raised.exception))
    prompt_root = self.repo / ".review-handoff/prompts"
    self.assertFalse(prompt_root.exists())
```

In the test fixture, implement `dirty_tracked_file()` as:

```python
def dirty_tracked_file(self) -> None:
    (self.repo / "tracked.txt").write_text("changed\n", encoding="utf-8")
```

- [ ] **Step 6: Implement expiration and self-healing archive behavior**

Parse only the controlled YAML frontmatter keys needed by this helper. On expiration:

1. reject missing/invalid `expires_at`, `prompt_id`, or `lifecycle_state` as a warning and preserve the file;
2. refuse to overwrite an archive collision;
3. rewrite `lifecycle_state: expired` through a same-directory temporary file;
4. move with `os.replace(active_path, archive_path)`;
5. if a prior interrupted run left `lifecycle_state: expired` in active, move it without rewriting;
6. never delete archive files.

Use `datetime.fromisoformat(value.removesuffix("Z") + "+00:00")` and require timezone-aware UTC metadata.

- [ ] **Step 7: Run the complete helper suite**

Run:

```bash
python3 -m unittest skills/review-prompt-composer/scripts/test_write_review_prompt.py -v
```

Expected: all helper tests PASS and `ResourceWarning`/temporary-file leakage is absent.

### Task 2: Rewrite the Review Prompt Composer Contract

**Files:**
- Modify: `skills/review-prompt-composer/SKILL.md`
- Modify: `skills/review-prompt-composer/evals/evals.json`
- Modify: `skills/review-prompt-composer/agents/openai.yaml`

**Interfaces:**
- Consumes: canonical Git scope and shared-worktree evidence from the current repository.
- Produces: one body passed to `write_review_prompt.py`, then a clickable repository-local prompt path.
- Published token: `Review-Prompt-ID: \`<prompt_id>\``.

- [ ] **Step 1: Replace portable-handoff evals with failing project-local prompt evals**

Keep strict scope coverage while changing delivery expectations. Include at least these cases:

```json
{
  "id": 1,
  "name": "all-uncommitted-project-local-prompt",
  "prompt": "同一项目里的另一个审核团队可以直接读取当前工作区。请生成提示词审核全部未提交改动。",
  "expected_output": "采用 all-uncommitted；创建 .review-handoff/prompts/active/<branch_slug>/<local_minute>-all-uncommitted.md；正文包含真实仓库根、HEAD、完整状态清单和 Review-Prompt-ID 回显要求；不生成 patch、tar、manifest 或 checksum。",
  "files": []
}
```

Add separate evals for `staged-only`, partially staged `unstaged-only` without prerequisite patches, nested cwd root resolution, 24-hour expiration, sensitive body output, and `$GIT_COMMON_DIR/info/exclude` idempotency.

- [ ] **Step 2: Rewrite `SKILL.md` around the accepted shared-worktree workflow**

Bump metadata version to `2.0.0`. The description must state that the skill is for reviewers with access to the same repository/worktree and that it writes one ignored prompt under `.review-handoff/prompts/`; remove every claim about portable, external, inline-patch, attachment, tar, binary replay, manifest, or checksum support.

The workflow must contain these ordered sections:

1. resolve repository identity and canonical scope;
2. collect strict scope evidence and explicit exclusions;
3. run the prompt-content sensitive-information gate;
4. determine falsifiable review objectives;
5. derive repository-defined checks without running them;
6. compose the fixed body contract with exactly one `{{REVIEW_PROMPT_ID}}` token;
7. call `write_review_prompt.py`;
8. read its JSON, verify the final file, and return a clickable path;
9. instruct returned feedback to use `agentic-review-handoff`.

The output rules must say the `.md` file is authoritative and chat contains only its path, prompt ID, scope, expiration, and a concise delivery instruction.

- [ ] **Step 3: Update the OpenAI default prompt**

Set `default_prompt` to:

```yaml
default_prompt: "Use $review-prompt-composer to create one repository-local, copy-ready Markdown review prompt for the requested Git scope under $repo_root/.review-handoff/prompts/active/<branch_slug>/. Assume the reviewer reads the same working tree, preserve staged/unstaged/untracked boundaries exactly, require the reviewer to echo Review-Prompt-ID, and never generate patches, archives, manifests, or checksums."
```

- [ ] **Step 4: Run composer validation**

Run:

```bash
python3 -m unittest skills/review-prompt-composer/scripts/test_write_review_prompt.py -v
pnpm skills:quick-validate skills/review-prompt-composer
node -e "JSON.parse(require('fs').readFileSync('skills/review-prompt-composer/evals/evals.json','utf8'))"
```

Expected: Python tests PASS, quick validation reports the skill is valid, and JSON parsing exits 0.

### Task 3: Add Safe Prompt-ID Resolution to Agentic Review Handoff

**Files:**
- Create: `skills/agentic-review-handoff/references/source-prompt-addressing.md`
- Modify: `skills/agentic-review-handoff/SKILL.md`
- Modify: `skills/agentic-review-handoff/references/packet-anatomy.md`
- Modify: `skills/agentic-review-handoff/references/packet-addressing.md`
- Modify: `skills/agentic-review-handoff/evals/evals.json`
- Modify: `skills/agentic-review-handoff/agents/openai.yaml`

**Interfaces:**
- Consumes: explicit `--prompt-id`, echoed `Review-Prompt-ID`, existing packet `source_prompt_id`, or one unique non-expired current-branch prompt.
- Produces: optional `source_prompt_id`, `source_prompt_head`, and `source_prompt_scope` packet frontmatter.
- Does not modify: any file under `.review-handoff/prompts/**`.

- [ ] **Step 1: Add failing evals for all resolution paths and unsafe inputs**

Append eval cases with exact expected behavior for:

```text
1. Explicit --prompt-id=feat-auth/2026-07-15_14-30-all-uncommitted.
2. Pasted feedback whose first line is Review-Prompt-ID: `feat-auth/2026-07-15_14-30-all-uncommitted`.
3. No ID plus exactly one non-expired current-branch prompt.
4. No ID plus two non-expired prompts: ask instead of selecting latest.
5. ID containing ../ or an absolute path: reject before reading any target.
6. Same ID present in active and archive: report conflict.
7. Expired source prompt: allow historical provenance but revalidate feedback against current code.
```

Every successful case must expect all three `source_prompt_*` fields and must assert that the source prompt remains byte-for-byte unchanged.

- [ ] **Step 2: Create the source-prompt addressing reference**

Write `source-prompt-addressing.md` with this fixed resolution order:

```text
explicit --prompt-id or named prompt path
  -> echoed Review-Prompt-ID in pasted content
  -> current packet source_prompt_id
  -> exactly one non-expired prompt for the current branch
  -> ask the user
```

Specify the accepted ID regex and safe candidate construction:

```regex
^[a-z0-9._-]+/[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}-[a-z0-9-]+(?:-[0-9]{2})?$
```

Resolve candidates only by joining parsed components beneath:

```text
$repo_root/.review-handoff/prompts/active/<branch_slug>/<filename>.md
$repo_root/.review-handoff/prompts/archive/<branch_slug>/<filename>.md
```

Then resolve real paths and assert they remain descendants of the corresponding prompt directory. Validate frontmatter `prompt_id`, `head`, `scope`, `expires_at`, and `lifecycle_state`. Reject duplicate active/archive matches, frontmatter mismatch, malformed metadata, absolute paths, and traversal.

- [ ] **Step 3: Integrate optional provenance into the fast path and packet contract**

Add `source-prompt-addressing.md` to the `SKILL.md` Fast Path map. Before packet creation or continuation, resolve optional source provenance only when the user supplies feedback/ID/path or when exactly one current-branch prompt exists; prompt resolution must not replace the existing packet-addressing algorithm.

Add these optional fields to `packet-anatomy.md`:

```yaml
source_prompt_id: feat-auth/2026-07-15_14-30-all-uncommitted
source_prompt_head: 78b4382b19abd651a2274b5f6f188849cbec845d
source_prompt_scope: all-uncommitted
```

Update the ignore bootstrap in `SKILL.md` and `packet-addressing.md` to resolve the exclude file through `git rev-parse --git-common-dir`, matching the composer helper and Git's repository-local exclude contract. Preserve acceptance of both `/.review-handoff/` and `.review-handoff/` and keep the operation idempotent.

State explicitly:

- source prompt metadata is provenance, not verified review evidence;
- pasted reviewer feedback remains a defect report that must be validated;
- expired prompts can be historical sources but current code wins;
- agentic never modifies, expires, archives, or deletes prompt files;
- lack of a prompt is not an error for existing agentic workflows.

- [ ] **Step 4: Update the OpenAI default prompt**

Append one concise instruction to the current default prompt:

```text
When reviewer feedback contains Review-Prompt-ID, safely resolve the matching file under .review-handoff/prompts/{active,archive}/, record source_prompt_id/source_prompt_head/source_prompt_scope in the packet, and never mutate the source prompt; if no ID is present, auto-select only when exactly one non-expired prompt exists for the current branch.
```

- [ ] **Step 5: Validate the agentic contract**

Run:

```bash
pnpm skills:quick-validate skills/agentic-review-handoff
node -e "JSON.parse(require('fs').readFileSync('skills/agentic-review-handoff/evals/evals.json','utf8'))"
rg -n "source_prompt_(id|head|scope)|Review-Prompt-ID" skills/agentic-review-handoff
```

Expected: quick validation passes, eval JSON parses, and the grep shows the addressing reference, packet anatomy, skill routing, eval coverage, and OpenAI metadata.

### Task 4: Regenerate Public Metadata and Run Repository-Wide Verification

**Files:**
- Regenerate: `apps/web/src/generated/skills-index-lite.json`
- Regenerate: `apps/web/src/generated/skills-detail-index.json`
- Verify: all files changed by Tasks 1–3 plus the accepted design and this plan

**Interfaces:**
- Consumes: final `SKILL.md` frontmatter and bodies.
- Produces: synchronized web skill metadata and a verified implementation diff.

- [ ] **Step 1: Run both Python behavior suites and inspect their full output**

Run:

```bash
python3 -m unittest skills/review-prompt-composer/scripts/test_write_review_prompt.py -v
```

Expected: every prompt creation, expiration, collision, ignore, malformed-file, and sensitive-content test passes.

- [ ] **Step 2: Run skill validation**

Run:

```bash
pnpm skills:quick-validate skills/review-prompt-composer
pnpm skills:quick-validate skills/agentic-review-handoff
pnpm skills:validate
```

Expected: both focused validators and repository-wide validation exit 0.

- [ ] **Step 3: Regenerate the web indexes**

Run:

```bash
pnpm skills:index
```

Expected: output names exactly `apps/web/src/generated/skills-index-lite.json` and `apps/web/src/generated/skills-detail-index.json`; no other generated path is introduced.

- [ ] **Step 4: Prove the removed portable vocabulary is gone from the composer**

Run:

```bash
rg -n "tracked\.patch|prerequisite-staged\.patch|untracked-files\.tar\.gz|manifest\.md|64 KiB|跨环境|attachment package" skills/review-prompt-composer
```

Expected: no matches.

- [ ] **Step 5: Prove prompt/packet ownership remains separated**

Run:

```bash
rg -n "\.review-handoff/(prompts|active|archive)|source_prompt_" skills/review-prompt-composer skills/agentic-review-handoff
```

Expected: composer writes only `prompts/**`; agentic packet paths remain top-level `active/**` and `archive/**`; agentic references `prompts/**` read-only and records only `source_prompt_*` provenance.

- [ ] **Step 6: Review the final diff and formatting**

Run:

```bash
git diff --check
git status --short
git diff --stat
git diff -- skills/review-prompt-composer skills/agentic-review-handoff apps/web/src/generated docs/plans docs/superpowers/plans
```

Expected: no whitespace errors; only the planned files changed; no `.review-handoff/` runtime artifacts appear; no unrelated user changes are modified.

## Self-Review Record

- Spec coverage: storage, naming, timestamps, 24-hour expiration, archive behavior, ignore bootstrapping, strict scope, single-file output, ID echo, safe agentic resolution, provenance, errors, and verification all map to Tasks 1–4.
- Placeholder scan: implementation steps contain no forbidden placeholder tokens or unspecified error/test instructions.
- Interface consistency: the prompt frontmatter fields and `Review-Prompt-ID` format match the agentic `source_prompt_*` contract; prompt paths and branch slugs are identical across both skills.
- Scope check: the two skills are coupled through one published identifier contract and should remain one implementation plan.
