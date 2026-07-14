#!/usr/bin/env python3
"""Build a portable review handoff bundle without mutating repository state."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath


SCOPES = (
    "all-uncommitted",
    "staged-only",
    "unstaged-only",
    "untracked-only",
)
SAFE_ENV_NAMES = {".env.example", ".env.sample", ".env.template"}
SENSITIVE_NAMES = {".npmrc", ".netrc", "id_rsa", "id_ed25519"}
SENSITIVE_SUFFIXES = {".key", ".p12", ".pfx", ".pem"}
PRIVATE_KEY_MARKER = re.compile(rb"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----")
CREDENTIAL_URL = re.compile(rb"[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@", re.IGNORECASE)


class BuilderError(RuntimeError):
    """Expected, user-actionable handoff build failure."""


def run_git(repo: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise BuilderError(f"git {' '.join(args)} failed: {message}")
    return result.stdout


def git_paths(repo: Path, *args: str) -> list[str]:
    raw = run_git(repo, *args)
    return [os.fsdecode(item) for item in raw.split(b"\0") if item]


def resolve_repo(raw_repo: str) -> Path:
    candidate = Path(raw_repo).expanduser().resolve()
    try:
        root = run_git(candidate, "rev-parse", "--show-toplevel")
    except (BuilderError, OSError) as exc:
        raise BuilderError(f"Not a Git repository: {candidate}") from exc
    return Path(os.fsdecode(root).strip()).resolve()


def resolve_head(repo: Path) -> str:
    try:
        return os.fsdecode(run_git(repo, "rev-parse", "--verify", "HEAD")).strip()
    except BuilderError as exc:
        raise BuilderError("The repository must have a HEAD commit before building a handoff") from exc


def is_inside(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def sensitive_path_reason(relative_path: str) -> str | None:
    name = PurePosixPath(relative_path).name.lower()
    if name in SAFE_ENV_NAMES:
        return None
    if name == ".env" or name.startswith(".env."):
        return "environment file"
    if name in SENSITIVE_NAMES:
        return "credential file"
    if PurePosixPath(name).suffix in SENSITIVE_SUFFIXES:
        return "private credential file"
    return None


def sensitive_content_reason(content: bytes) -> str | None:
    if PRIVATE_KEY_MARKER.search(content):
        return "private key material"
    if CREDENTIAL_URL.search(content):
        return "credential-bearing URL"
    return None


def scan_sensitive_material(
    repo: Path,
    attached_paths: list[str],
    patch_payloads: list[bytes],
    untracked_paths: list[str],
) -> None:
    findings: list[tuple[str, str]] = []
    for relative_path in sorted(set(attached_paths)):
        reason = sensitive_path_reason(relative_path)
        if reason:
            findings.append((relative_path, reason))

    for index, payload in enumerate(patch_payloads, start=1):
        reason = sensitive_content_reason(payload)
        if reason:
            findings.append((f"patch-{index}", reason))

    for relative_path in untracked_paths:
        path = repo / relative_path
        if path.is_file() and not path.is_symlink():
            reason = sensitive_content_reason(path.read_bytes())
            if reason:
                findings.append((relative_path, reason))

    if findings:
        summary = ", ".join(f"{path} ({reason})" for path, reason in findings)
        raise BuilderError(
            f"Sensitive material detected; no artifacts were written: {summary}",
        )


def normalize_tar_info(info: tarfile.TarInfo) -> tarfile.TarInfo:
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mtime = 0
    return info


def write_untracked_archive(repo: Path, paths: list[str], destination: Path) -> None:
    with destination.open("wb") as raw_file:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_file, mtime=0) as gzip_file:
            with tarfile.open(fileobj=gzip_file, mode="w", dereference=False) as archive:
                for relative_path in sorted(paths):
                    archive.add(
                        repo / relative_path,
                        arcname=relative_path,
                        recursive=False,
                        filter=normalize_tar_info,
                    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def make_output_dir(repo: Path, head: str, raw_output_dir: str | None) -> tuple[Path, Path | None]:
    if raw_output_dir:
        final_dir = Path(raw_output_dir).expanduser().resolve()
        if is_inside(final_dir, repo):
            raise BuilderError("Output directory must be outside the repository")
        if final_dir.exists():
            raise BuilderError(f"Output directory already exists: {final_dir}")
        final_dir.parent.mkdir(parents=True, exist_ok=True)
        work_dir = Path(
            tempfile.mkdtemp(prefix=".review-handoff-", dir=final_dir.parent),
        )
        return work_dir, final_dir

    base_dir = Path(tempfile.gettempdir()) / "review-prompt-composer"
    base_dir.mkdir(parents=True, exist_ok=True)
    safe_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", repo.name).strip("-") or "repo"
    work_dir = Path(
        tempfile.mkdtemp(prefix=f"{safe_name}-{head[:8]}-", dir=base_dir),
    )
    return work_dir, None


def artifact_record(path: Path) -> dict[str, object]:
    return {
        "name": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256(path),
    }


def build_manifest(
    repo: Path,
    head: str,
    scope: str,
    counts: dict[str, int],
    artifacts: list[dict[str, object]],
    check_commands: list[str],
    has_prerequisite: bool,
    has_tracked_patch: bool,
    has_untracked_archive: bool,
) -> str:
    lines = [
        "# Review Handoff Manifest",
        "",
        f"- Repository: `{repo.name}`",
        f"- HEAD: `{head}`",
        f"- Scope: `{scope}`",
        f"- Staged files: {counts['staged_files']}",
        f"- Unstaged tracked files: {counts['unstaged_files']}",
        f"- Untracked files in repository: {counts['untracked_files']}",
        f"- Included untracked files: {counts['included_untracked_files']}",
        "",
        "## Artifact checksums",
        "",
        "| File | Bytes | SHA-256 |",
        "|---|---:|---|",
    ]
    for artifact in artifacts:
        lines.append(
            f"| `{artifact['name']}` | {artifact['bytes']} | `{artifact['sha256']}` |",
        )

    lines.extend(
        [
            "",
            "## Receiver workflow",
            "",
            f"Start from a clean disposable checkout at `{head}`.",
        ],
    )
    step = 1
    if has_prerequisite:
        lines.extend(
            [
                f"{step}. Run `git apply --binary --check prerequisite-staged.patch`.",
                f"{step + 1}. Run `git apply --binary prerequisite-staged.patch`.",
                "   This patch only reconstructs the index baseline and is not part of the review scope.",
            ],
        )
        step += 2
    if has_tracked_patch:
        lines.extend(
            [
                f"{step}. Run `git apply --binary --check tracked.patch`.",
                f"{step + 1}. Run `git apply --binary tracked.patch`.",
            ],
        )
        step += 2
    if has_untracked_archive:
        lines.append(f"{step}. Run `tar -xzf untracked-files.tar.gz` from the repository root.")

    lines.extend(
        [
            "",
            "Review only the declared scope. Do not commit, stage, stash, or push as part of setup.",
            "",
            "## Repository-defined checks",
            "",
        ],
    )
    if check_commands:
        lines.extend(f"- `{command}`" for command in check_commands)
    else:
        lines.append("- No reliable check command was supplied.")
    lines.extend(
        [
            "",
            "The builder performs only a high-confidence sensitive-material scan; the sender must still inspect the handoff before external delivery.",
            "",
        ],
    )
    return "\n".join(lines)


def collect_bundle_inputs(repo: Path, scope: str) -> dict[str, object]:
    head = resolve_head(repo)
    staged_paths = git_paths(repo, "diff", "--cached", "--name-only", "-z", "--")
    unstaged_paths = git_paths(repo, "diff", "--name-only", "-z", "--")
    untracked_paths = git_paths(repo, "ls-files", "--others", "--exclude-standard", "-z")
    staged_patch = run_git(repo, "diff", "--cached", "--binary", "--")
    unstaged_patch = run_git(repo, "diff", "--binary", "--")

    prerequisite_patch = b""
    tracked_patch = b""
    included_untracked: list[str] = []
    attached_paths: list[str] = []

    if scope == "all-uncommitted":
        tracked_patch = run_git(repo, "diff", "--binary", "HEAD", "--")
        included_untracked = untracked_paths
        attached_paths = staged_paths + unstaged_paths + untracked_paths
    elif scope == "staged-only":
        tracked_patch = staged_patch
        attached_paths = staged_paths
    elif scope == "unstaged-only":
        tracked_patch = unstaged_patch
        prerequisite_patch = staged_patch
        attached_paths = staged_paths + unstaged_paths
    elif scope == "untracked-only":
        included_untracked = untracked_paths
        attached_paths = untracked_paths
    else:
        raise BuilderError(f"Unsupported scope: {scope}")

    if not tracked_patch and not included_untracked:
        raise BuilderError(f"No changes found for scope: {scope}")

    scan_sensitive_material(
        repo,
        attached_paths,
        [payload for payload in (prerequisite_patch, tracked_patch) if payload],
        included_untracked,
    )

    return {
        "head": head,
        "staged_paths": staged_paths,
        "unstaged_paths": unstaged_paths,
        "untracked_paths": untracked_paths,
        "included_untracked": included_untracked,
        "prerequisite_patch": prerequisite_patch,
        "tracked_patch": tracked_patch,
    }


def build_bundle(
    repo: Path,
    scope: str,
    raw_output_dir: str | None,
    check_commands: list[str],
) -> dict[str, object]:
    inputs = collect_bundle_inputs(repo, scope)
    head = str(inputs["head"])
    work_dir, final_dir = make_output_dir(repo, head, raw_output_dir)

    try:
        artifact_paths: list[Path] = []
        prerequisite_patch = bytes(inputs["prerequisite_patch"])
        tracked_patch = bytes(inputs["tracked_patch"])
        included_untracked = list(inputs["included_untracked"])

        if prerequisite_patch:
            path = work_dir / "prerequisite-staged.patch"
            path.write_bytes(prerequisite_patch)
            artifact_paths.append(path)
        if tracked_patch:
            path = work_dir / "tracked.patch"
            path.write_bytes(tracked_patch)
            artifact_paths.append(path)
        if included_untracked:
            path = work_dir / "untracked-files.tar.gz"
            write_untracked_archive(repo, included_untracked, path)
            artifact_paths.append(path)

        artifact_records = [artifact_record(path) for path in artifact_paths]
        counts = {
            "staged_files": len(inputs["staged_paths"]),
            "unstaged_files": len(inputs["unstaged_paths"]),
            "untracked_files": len(inputs["untracked_paths"]),
            "included_untracked_files": len(included_untracked),
        }
        manifest_path = work_dir / "manifest.md"
        manifest_path.write_text(
            build_manifest(
                repo,
                head,
                scope,
                counts,
                artifact_records,
                check_commands,
                bool(prerequisite_patch),
                bool(tracked_patch),
                bool(included_untracked),
            ),
            encoding="utf-8",
        )
        artifact_paths.append(manifest_path)

        if final_dir:
            work_dir.rename(final_dir)
            output_dir = final_dir
        else:
            output_dir = work_dir

        return {
            "output_dir": str(output_dir),
            "scope": scope,
            "head": head,
            "counts": counts,
            "artifacts": [
                artifact_record(output_dir / path.name)
                for path in artifact_paths
            ],
        }
    except Exception:
        if work_dir.exists():
            shutil.rmtree(work_dir)
        raise


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a portable Git review handoff outside the repository",
    )
    parser.add_argument("--repo", required=True, help="Path inside the Git repository")
    parser.add_argument("--scope", required=True, choices=SCOPES)
    parser.add_argument(
        "--output-dir",
        help="Exact output directory; must not exist and must be outside the repository",
    )
    parser.add_argument(
        "--check-command",
        action="append",
        default=[],
        help="Repository-defined check command to record; repeat as needed",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        repo = resolve_repo(args.repo)
        payload = build_bundle(
            repo,
            args.scope,
            args.output_dir,
            list(args.check_command),
        )
    except (BuilderError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(payload, indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
