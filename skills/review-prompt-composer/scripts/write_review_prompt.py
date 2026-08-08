#!/usr/bin/env python3
"""Write one ignored, repository-local review prompt artifact."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import tempfile
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path


SCOPES = (
    "all-uncommitted",
    "staged-only",
    "unstaged-only",
    "untracked-only",
    "ref-range",
)
PROMPT_TOKEN = "{{REVIEW_PROMPT_ID}}"
SCOPE_DIGEST_TOKEN = "{{SCOPE_DIGEST}}"
VERIFY_COMMAND_TOKEN = "{{VERIFY_COMMAND}}"
PROMPT_TTL = timedelta(hours=24)
REQUIRED_HEADINGS = (
    "# 审核任务",
    "## 工作区与范围",
    "## 待验证目标",
    "## 改动清单",
    "## 审核重点",
    "## 输出要求",
)
PRIVATE_KEY_MARKER = re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")
CREDENTIAL_URL = re.compile(
    r"[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@",
    re.IGNORECASE,
)


class WriterError(RuntimeError):
    """Expected, user-actionable prompt writer failure."""


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
    scope_digest: str
    scope_base: str
    scope_target: str
    created_at: datetime
    expires_at: datetime
    archived_paths: tuple[Path, ...] = ()
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class ScopeEvidence:
    head: str
    scope: str
    digest: str
    base_sha: str
    target_sha: str


def run_git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise WriterError(f"git {' '.join(args)} failed: {message}")
    return result.stdout


def resolve_repo(raw_repo: str | Path) -> Path:
    candidate = Path(raw_repo).expanduser().resolve()
    try:
        root = os.fsdecode(run_git(candidate, "rev-parse", "--show-toplevel")).strip()
    except (OSError, WriterError) as exc:
        raise WriterError(f"Not a Git repository: {candidate}") from exc
    return Path(root).resolve()


def resolve_git_sha(repo: Path, value: str) -> str:
    resolved = os.fsdecode(run_git(repo, "rev-parse", "--verify", value)).strip()
    if not re.fullmatch(r"[0-9a-f]{40}", resolved):
        raise WriterError(f"Git ref did not resolve to a full SHA: {value}")
    return resolved


def frame_bytes(label: str, value: bytes) -> bytes:
    label_bytes = label.encode("ascii")
    return label_bytes + b":" + str(len(value)).encode("ascii") + b":" + value + b"\n"


def untracked_payload(repo: Path) -> bytes:
    raw_paths = run_git(repo, "ls-files", "--others", "--exclude-standard", "-z")
    paths = sorted(path for path in raw_paths.split(b"\0") if path)
    chunks: list[bytes] = []
    for raw_path in paths:
        path = repo / os.fsdecode(raw_path)
        try:
            mode = path.lstat().st_mode
            if path.is_symlink():
                content = os.fsencode(os.readlink(path))
                kind = b"symlink"
            elif path.is_file():
                content = path.read_bytes()
                kind = b"file"
            else:
                continue
        except OSError as exc:
            raise WriterError(
                f"Unable to read untracked path for scope digest: {os.fsdecode(raw_path)}",
            ) from exc
        chunks.extend(
            [
                frame_bytes("path", raw_path),
                frame_bytes("kind", kind),
                frame_bytes("mode", f"{mode & 0o777:o}".encode("ascii")),
                frame_bytes("content", content),
            ],
        )
    return b"".join(chunks)


def compute_scope_evidence(
    repo: Path,
    scope: str,
    *,
    base: str | None = None,
    target: str | None = None,
) -> ScopeEvidence:
    if scope not in SCOPES:
        raise WriterError(f"Unsupported scope: {scope}")
    repo = resolve_repo(repo)
    head = resolve_git_sha(repo, "HEAD")
    base_sha = ""
    target_sha = ""
    untracked = b""

    if scope == "all-uncommitted":
        diff = run_git(
            repo,
            "diff",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
            head,
            "--",
        )
        untracked = untracked_payload(repo)
    elif scope == "staged-only":
        diff = run_git(
            repo,
            "diff",
            "--cached",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
            "--",
        )
    elif scope == "unstaged-only":
        diff = run_git(
            repo,
            "diff",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
            "--",
        )
    elif scope == "untracked-only":
        diff = b""
        untracked = untracked_payload(repo)
    else:
        if not base or not target:
            raise WriterError("ref-range scope requires both --base and --target")
        base_sha = resolve_git_sha(repo, base)
        target_sha = resolve_git_sha(repo, target)
        diff = run_git(
            repo,
            "diff",
            "--binary",
            "--no-ext-diff",
            "--no-textconv",
            f"{base_sha}...{target_sha}",
            "--",
        )

    canonical = b"".join(
        [
            frame_bytes("format", b"review-prompt-scope-v1"),
            frame_bytes("scope", scope.encode("ascii")),
            frame_bytes("head", head.encode("ascii")),
            frame_bytes("base", base_sha.encode("ascii")),
            frame_bytes("target", target_sha.encode("ascii")),
            frame_bytes("diff", diff),
            frame_bytes("untracked", untracked),
        ],
    )
    return ScopeEvidence(
        head=head,
        scope=scope,
        digest=hashlib.sha256(canonical).hexdigest(),
        base_sha=base_sha,
        target_sha=target_sha,
    )


def normalize_branch_slug(branch: str) -> str:
    normalized = branch.lower().replace("/", "-").replace("\\", "-")
    normalized = re.sub(r"[^a-z0-9._-]+", "-", normalized).strip("-.")
    return normalized or "head"


def format_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            delete=False,
        ) as temporary:
            temporary.write(content)
            temporary_path = Path(temporary.name)
        os.replace(temporary_path, path)
    finally:
        if temporary_path is not None and temporary_path.exists():
            temporary_path.unlink()


def ensure_review_handoff_excluded(repo: Path) -> Path:
    raw_common_dir = os.fsdecode(
        run_git(repo, "rev-parse", "--git-common-dir"),
    ).strip()
    common_dir = Path(raw_common_dir)
    if not common_dir.is_absolute():
        common_dir = (repo / common_dir).resolve()
    exclude_file = common_dir / "info" / "exclude"
    existing = exclude_file.read_text(encoding="utf-8") if exclude_file.exists() else ""
    if not re.search(r"(?m)^/?\.review-handoff/$", existing):
        separator = "" if not existing or existing.endswith("\n") else "\n"
        atomic_write_text(exclude_file, f"{existing}{separator}/.review-handoff/\n")
    return exclude_file


def validate_body(body: str) -> None:
    if not body.strip():
        raise WriterError("Prompt body must not be empty")
    for heading in REQUIRED_HEADINGS:
        if not any(line.startswith(heading) for line in body.splitlines()):
            raise WriterError(f"Prompt body is missing required heading: {heading}")
    if body.count(PROMPT_TOKEN) != 1:
        raise WriterError("Prompt body must contain exactly one review prompt ID token")
    if body.count(SCOPE_DIGEST_TOKEN) != 1:
        raise WriterError("Prompt body must contain exactly one scope digest token")
    if body.count(VERIFY_COMMAND_TOKEN) != 1:
        raise WriterError("Prompt body must contain exactly one verify command token")
    if PRIVATE_KEY_MARKER.search(body):
        raise WriterError("Sensitive material detected: private key material")
    if CREDENTIAL_URL.search(body):
        raise WriterError("Sensitive material detected: credential-bearing URL")


def frontmatter_value(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def parse_frontmatter(path: Path) -> tuple[dict[str, str], str]:
    content = path.read_text(encoding="utf-8")
    match = re.fullmatch(r"---\n(?P<metadata>.*?)\n---\n(?P<body>.*)", content, re.DOTALL)
    if match is None:
        raise WriterError("missing or malformed frontmatter")
    metadata: dict[str, str] = {}
    for line in match.group("metadata").splitlines():
        key, separator, raw_value = line.partition(":")
        if not separator:
            continue
        value = raw_value.strip()
        if value.startswith('"'):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError as exc:
                raise WriterError(f"invalid frontmatter value for {key}") from exc
            if not isinstance(parsed, str):
                raise WriterError(f"frontmatter value for {key} must be a string")
            value = parsed
        metadata[key.strip()] = value
    return metadata, match.group("body")


def parse_utc_timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise WriterError("invalid expires_at timestamp") from exc
    if parsed.tzinfo is None:
        raise WriterError("expires_at timestamp must include a timezone")
    return parsed.astimezone(timezone.utc)


def archive_expired_prompts(
    repo: Path,
    branch_slug: str,
    now: datetime,
) -> ArchiveResult:
    active_dir = repo / ".review-handoff" / "prompts" / "active" / branch_slug
    archive_dir = repo / ".review-handoff" / "prompts" / "archive" / branch_slug
    if not active_dir.exists():
        return ArchiveResult((), ())

    archived_paths: list[Path] = []
    warnings: list[str] = []
    normalized_now = now.astimezone(timezone.utc)
    for prompt_path in sorted(active_dir.glob("*.md")):
        try:
            metadata, _ = parse_frontmatter(prompt_path)
            prompt_id = metadata.get("prompt_id")
            state = metadata.get("lifecycle_state")
            expires_at = metadata.get("expires_at")
            head = metadata.get("head")
            scope = metadata.get("scope")
            if not prompt_id or not state or not expires_at or not head or not scope:
                raise WriterError("missing prompt lifecycle metadata")
            if metadata.get("artifact_type") != "review_prompt":
                raise WriterError("artifact_type is not review_prompt")
            format_version = metadata.get("format_version")
            if format_version not in {"1", "2"}:
                raise WriterError("unsupported format_version")
            if format_version == "2":
                if not re.fullmatch(r"[0-9a-f]{64}", metadata.get("scope_digest", "")):
                    raise WriterError("missing or invalid scope_digest")
                if "scope_base" not in metadata or "scope_target" not in metadata:
                    raise WriterError("missing scope range metadata")
            expected_prompt_id = f"{branch_slug}/{prompt_path.stem}"
            if prompt_id != expected_prompt_id:
                raise WriterError("prompt_id does not match its repository path")
            if not re.fullmatch(r"[0-9a-f]{40}", head):
                raise WriterError("head is not a 40-character Git SHA")
            if scope not in SCOPES:
                raise WriterError(f"unsupported prompt scope: {scope}")
            is_expired = state == "expired" or parse_utc_timestamp(expires_at) <= normalized_now
            if not is_expired:
                if state != "active":
                    raise WriterError(f"unsupported lifecycle_state: {state}")
                continue

            archive_dir.mkdir(parents=True, exist_ok=True)
            destination = archive_dir / prompt_path.name
            if destination.exists():
                raise WriterError("matching archive prompt already exists")
            content = prompt_path.read_text(encoding="utf-8")
            if state != "expired":
                updated = re.sub(
                    r"(?m)^lifecycle_state:\s*active\s*$",
                    "lifecycle_state: expired",
                    content,
                    count=1,
                )
                if updated == content:
                    raise WriterError("active lifecycle metadata could not be updated")
                atomic_write_text(prompt_path, updated)
            os.replace(prompt_path, destination)
            archived_paths.append(destination)
        except (OSError, UnicodeError, WriterError) as exc:
            warnings.append(f"{prompt_path.name}: {exc}")

    return ArchiveResult(tuple(archived_paths), tuple(warnings))


def allocate_prompt_path(
    repo: Path,
    branch_slug: str,
    scope: str,
    created_at: datetime,
) -> Path:
    active_dir = repo / ".review-handoff" / "prompts" / "active" / branch_slug
    archive_dir = repo / ".review-handoff" / "prompts" / "archive" / branch_slug
    local_stamp = created_at.astimezone().strftime("%Y-%m-%d_%H-%M")
    base_name = f"{local_stamp}-{scope}"
    suffix = 1
    while True:
        collision_suffix = "" if suffix == 1 else f"-{suffix:02d}"
        filename = f"{base_name}{collision_suffix}.md"
        active_path = active_dir / filename
        archive_path = archive_dir / filename
        if not active_path.exists() and not archive_path.exists():
            return active_path
        suffix += 1


def create_review_prompt(
    repo: Path,
    scope: str,
    body: str,
    now: datetime | None = None,
    *,
    base: str | None = None,
    target: str | None = None,
) -> PromptArtifact:
    if scope not in SCOPES:
        raise WriterError(f"Unsupported scope: {scope}")
    validate_body(body)
    repo = resolve_repo(repo)
    branch = os.fsdecode(run_git(repo, "rev-parse", "--abbrev-ref", "HEAD")).strip()
    branch_slug = normalize_branch_slug(branch)
    created_at = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    expires_at = created_at + PROMPT_TTL

    ensure_review_handoff_excluded(repo)
    archive_result = archive_expired_prompts(repo, branch_slug, created_at)
    scope_evidence = compute_scope_evidence(
        repo,
        scope,
        base=base,
        target=target,
    )
    head = scope_evidence.head
    prompt_path = allocate_prompt_path(repo, branch_slug, scope, created_at)
    prompt_id = f"{branch_slug}/{prompt_path.stem}"

    verify_command = " ".join(
        shlex.quote(part)
        for part in (
            sys.executable,
            str(Path(__file__).resolve()),
            "--repo",
            str(repo),
            "--verify-prompt",
            str(prompt_path),
        )
    )
    rendered_body = (
        body.replace(PROMPT_TOKEN, prompt_id)
        .replace(SCOPE_DIGEST_TOKEN, scope_evidence.digest)
        .replace(VERIFY_COMMAND_TOKEN, verify_command)
    )
    frontmatter = "\n".join(
        [
            "---",
            "artifact_type: review_prompt",
            "format_version: 2",
            f"prompt_id: {frontmatter_value(prompt_id)}",
            f"branch: {frontmatter_value(branch)}",
            f"head: {frontmatter_value(head)}",
            f"scope: {frontmatter_value(scope)}",
            f"scope_digest: {frontmatter_value(scope_evidence.digest)}",
            f"scope_base: {frontmatter_value(scope_evidence.base_sha)}",
            f"scope_target: {frontmatter_value(scope_evidence.target_sha)}",
            f"created_at: {frontmatter_value(format_utc(created_at))}",
            f"expires_at: {frontmatter_value(format_utc(expires_at))}",
            "lifecycle_state: active",
            "---",
            "",
        ],
    )
    atomic_write_text(prompt_path, f"{frontmatter}{rendered_body.rstrip()}\n")

    status = os.fsdecode(
        run_git(repo, "status", "--short", "--untracked-files=all"),
    )
    if ".review-handoff" in status:
        prompt_path.unlink(missing_ok=True)
        raise WriterError("Generated review prompt is not ignored by Git")

    return PromptArtifact(
        prompt_path=prompt_path,
        prompt_id=prompt_id,
        branch=branch,
        head=head,
        scope=scope,
        scope_digest=scope_evidence.digest,
        scope_base=scope_evidence.base_sha,
        scope_target=scope_evidence.target_sha,
        created_at=created_at,
        expires_at=expires_at,
        archived_paths=archive_result.archived_paths,
        warnings=archive_result.warnings,
    )


def verify_review_prompt(repo: Path, raw_prompt_path: str | Path) -> dict[str, object]:
    repo = resolve_repo(repo)
    prompt_path = Path(raw_prompt_path).expanduser().resolve()
    prompt_root = (repo / ".review-handoff" / "prompts").resolve()
    try:
        prompt_path.relative_to(prompt_root)
    except ValueError:
        raise WriterError("Prompt path escapes the repository prompt root")
    if not prompt_path.is_file():
        raise WriterError("Review prompt does not exist")

    metadata, body = parse_frontmatter(prompt_path)
    if metadata.get("artifact_type") != "review_prompt":
        raise WriterError("artifact_type is not review_prompt")
    if metadata.get("format_version") != "2":
        return {
            "ok": False,
            "status": "stale",
            "reason": "legacy_prompt_has_no_scope_digest",
            "prompt_path": str(prompt_path),
        }

    scope = metadata.get("scope", "")
    expected_digest = metadata.get("scope_digest", "")
    expected_head = metadata.get("head", "")
    if scope not in SCOPES or not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
        raise WriterError("Prompt scope metadata is malformed")
    if expected_digest not in body:
        raise WriterError("Prompt body scope digest does not match frontmatter")

    if metadata.get("lifecycle_state") != "active":
        return {
            "ok": False,
            "status": "stale",
            "reason": "prompt_not_active",
            "prompt_path": str(prompt_path),
        }
    expires_at = parse_utc_timestamp(metadata.get("expires_at", ""))
    if expires_at <= datetime.now(timezone.utc):
        return {
            "ok": False,
            "status": "stale",
            "reason": "prompt_expired",
            "prompt_path": str(prompt_path),
        }

    current_branch = os.fsdecode(
        run_git(repo, "rev-parse", "--abbrev-ref", "HEAD"),
    ).strip()
    if current_branch != metadata.get("branch"):
        return {
            "ok": False,
            "status": "stale",
            "reason": "branch_mismatch",
            "expected_branch": metadata.get("branch"),
            "actual_branch": current_branch,
            "prompt_path": str(prompt_path),
        }

    current_head = resolve_git_sha(repo, "HEAD")
    if current_head != expected_head:
        return {
            "ok": False,
            "status": "stale",
            "reason": "head_mismatch",
            "expected_head": expected_head,
            "actual_head": current_head,
            "prompt_path": str(prompt_path),
        }

    evidence = compute_scope_evidence(
        repo,
        scope,
        base=metadata.get("scope_base") or None,
        target=metadata.get("scope_target") or None,
    )
    if evidence.digest != expected_digest:
        return {
            "ok": False,
            "status": "stale",
            "reason": "scope_digest_mismatch",
            "expected_digest": expected_digest,
            "actual_digest": evidence.digest,
            "prompt_path": str(prompt_path),
        }
    return {
        "ok": True,
        "status": "fresh",
        "scope": scope,
        "scope_digest": evidence.digest,
        "prompt_path": str(prompt_path),
    }


def read_body_file(raw_path: str) -> str:
    if raw_path == "-":
        return sys.stdin.read()
    return Path(raw_path).expanduser().read_text(encoding="utf-8")


def serialize_artifact(artifact: PromptArtifact) -> dict[str, object]:
    payload = asdict(artifact)
    payload["prompt_path"] = str(artifact.prompt_path)
    payload["created_at"] = format_utc(artifact.created_at)
    payload["expires_at"] = format_utc(artifact.expires_at)
    payload["archived_paths"] = [str(path) for path in artifact.archived_paths]
    payload["warnings"] = list(artifact.warnings)
    return payload


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Write or verify one repository-local review prompt",
    )
    parser.add_argument("--repo", required=True, help="Path inside the Git repository")
    parser.add_argument("--scope", choices=SCOPES)
    parser.add_argument(
        "--body-file",
        help="UTF-8 prompt body path, or - to read stdin",
    )
    parser.add_argument("--base", help="Resolved base ref for ref-range scope")
    parser.add_argument("--target", help="Resolved target ref for ref-range scope")
    parser.add_argument(
        "--verify-prompt",
        help="Read-only freshness check for an existing format_version 2 prompt",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        if args.verify_prompt:
            if args.scope or args.body_file or args.base or args.target:
                raise WriterError(
                    "--verify-prompt cannot be combined with creation options",
                )
            result = verify_review_prompt(Path(args.repo), args.verify_prompt)
            print(json.dumps(result, indent=2, ensure_ascii=True))
            return 0 if result["ok"] else 2
        if not args.scope or not args.body_file:
            raise WriterError("Creation requires --scope and --body-file")
        body = read_body_file(args.body_file)
        artifact = create_review_prompt(
            Path(args.repo),
            args.scope,
            body,
            base=args.base,
            target=args.target,
        )
    except (OSError, UnicodeError, WriterError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(serialize_artifact(artifact), indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
