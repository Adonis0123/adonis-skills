#!/usr/bin/env python3
"""Build a deterministic OCR delegation review bundle."""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Any


SENSITIVE_VALUE_FLAGS = {"--background", "--background-file"}
RULE_GROUP_FIELDS = {"group_id", "source", "pattern", "files", "rule"}


def redacted_command(command: list[str]) -> str:
    rendered: list[str] = []
    redact_next = False
    for value in command:
        if redact_next:
            rendered.append("<redacted>")
            redact_next = False
            continue
        rendered.append(value)
        redact_next = value in SENSITIVE_VALUE_FLAGS
    return " ".join(rendered)


def sensitive_values(command: list[str]) -> list[str]:
    values: list[str] = []
    for index, value in enumerate(command[:-1]):
        if value in SENSITIVE_VALUE_FLAGS and command[index + 1]:
            values.append(command[index + 1])
    return values


def run(command: list[str], cwd: Path) -> str:
    try:
        result = subprocess.run(
            command,
            cwd=cwd,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="strict",
        )
    except UnicodeDecodeError as error:
        raise RuntimeError(
            f"command output is not valid UTF-8: {redacted_command(command)}"
        ) from error
    if result.returncode != 0:
        if sensitive_values(command):
            message = "sensitive command output omitted"
        else:
            message = result.stderr.strip() or result.stdout.strip()
        raise RuntimeError(
            f"command failed ({result.returncode}): {redacted_command(command)}\n{message}"
        )
    return result.stdout


def git(repo: Path, *args: str) -> str:
    return run(["git", *args], repo)


def git_bytes(repo: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(
            f"git snapshot command failed ({result.returncode}): {message[:2000]}"
        )
    return result.stdout


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def parse_json_object(raw: str, label: str) -> dict[str, Any]:
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise RuntimeError(f"{label} must be an object")
    return value


def validate_object_entries(values: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(values, list):
        raise RuntimeError(f"{label} must be an array")
    for index, value in enumerate(values):
        if not isinstance(value, dict):
            raise RuntimeError(f"{label}[{index}] must be an object")
    return values


def validate_relative_path(value: Any) -> str:
    if not isinstance(value, str) or not value or "\0" in value:
        raise RuntimeError("OCR path must be a non-empty repository-relative string")
    posix = PurePosixPath(value)
    windows = PureWindowsPath(value)
    if (
        posix.is_absolute()
        or windows.is_absolute()
        or bool(windows.drive)
        or ".." in posix.parts
        or ".." in windows.parts
    ):
        raise RuntimeError(f"OCR path must be repository-relative: {value}")
    return value


def validate_preview(
    preview: dict[str, Any], repo: Path
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if preview.get("schema_version") != "1":
        raise RuntimeError("OCR preview schema_version must be '1'")
    mode = preview.get("mode")
    if mode not in {"workspace", "range", "commit"}:
        raise RuntimeError(f"unsupported OCR preview mode: {mode!r}")
    repository = preview.get("repository")
    if not isinstance(repository, str) or not repository:
        raise RuntimeError("OCR preview repository must be a non-empty string")
    if Path(repository).expanduser().resolve() != repo.expanduser().resolve():
        raise RuntimeError("OCR preview repository does not match --repo")

    reviewable = validate_object_entries(
        preview.get("reviewable_files"), "reviewable_files"
    )
    excluded = validate_object_entries(preview.get("excluded_files"), "excluded_files")
    for label, entries in (("reviewable_files", reviewable), ("excluded_files", excluded)):
        for index, entry in enumerate(entries):
            try:
                validate_relative_path(entry.get("path"))
            except RuntimeError as error:
                raise RuntimeError(f"{label}[{index}]: {error}") from error
            if not isinstance(entry.get("status"), str) or not entry["status"]:
                raise RuntimeError(f"{label}[{index}].status must be a non-empty string")

    counts: dict[str, int] = {}
    for field in (
        "total_files",
        "reviewable_count",
        "excluded_count",
        "total_insertions",
        "total_deletions",
    ):
        value = preview.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise RuntimeError(f"OCR preview {field} must be a non-negative integer")
        counts[field] = value
    if counts["reviewable_count"] != len(reviewable):
        raise RuntimeError("OCR preview reviewable_count does not match reviewable_files")
    if counts["excluded_count"] != len(excluded):
        raise RuntimeError("OCR preview excluded_count does not match excluded_files")
    if counts["total_files"] != len(reviewable) + len(excluded):
        raise RuntimeError("OCR preview total_files does not match file arrays")

    if mode == "range":
        for field in ("from", "to", "merge_base"):
            if not isinstance(preview.get(field), str) or not preview[field]:
                raise RuntimeError(f"range preview is missing {field}")
    if mode == "commit" and (
        not isinstance(preview.get("commit"), str) or not preview["commit"]
    ):
        raise RuntimeError("commit preview is missing commit")
    return reviewable, excluded


def validate_rules(
    rules: dict[str, Any], reviewable_entries: list[dict[str, Any]]
) -> None:
    if rules.get("schema_version") != "1":
        raise RuntimeError("OCR rules schema_version must be '1'")
    groups = validate_object_entries(rules.get("groups"), "rules.groups")
    expected_paths = [validate_relative_path(entry.get("path")) for entry in reviewable_entries]
    covered_paths: list[str] = []
    for index, group in enumerate(groups):
        unknown = sorted(set(group) - RULE_GROUP_FIELDS)
        missing = sorted(RULE_GROUP_FIELDS - set(group))
        if unknown or missing:
            details: list[str] = []
            if missing:
                details.append(f"missing {', '.join(missing)}")
            if unknown:
                details.append(f"unknown {', '.join(unknown)}")
            raise RuntimeError(f"rules.groups[{index}] has invalid fields: {'; '.join(details)}")
        group_id = group.get("group_id")
        if not isinstance(group_id, int) or isinstance(group_id, bool) or group_id < 1:
            raise RuntimeError(f"rules.groups[{index}].group_id must be a positive integer")
        for field in ("source", "pattern", "rule"):
            value = group.get(field)
            if not isinstance(value, str) or not value.strip():
                raise RuntimeError(
                    f"rules.groups[{index}].{field} must be a non-empty string"
                )
        files = group.get("files")
        if not isinstance(files, list) or not files:
            raise RuntimeError(f"rules.groups[{index}].files must be a non-empty array")
        for file_index, path in enumerate(files):
            try:
                covered_paths.append(validate_relative_path(path))
            except RuntimeError as error:
                raise RuntimeError(
                    f"rules.groups[{index}].files[{file_index}]: {error}"
                ) from error
    if Counter(covered_paths) != Counter(expected_paths):
        raise RuntimeError(
            "OCR rules must cover every reviewable path exactly once and no other path"
        )


def freeze_requested_refs(
    repo: Path, args: argparse.Namespace
) -> dict[str, str]:
    if args.from_ref:
        from_sha = git(
            repo, "rev-parse", "--verify", f"{args.from_ref}^{{commit}}"
        ).strip()
        to_sha = git(
            repo, "rev-parse", "--verify", f"{args.to_ref}^{{commit}}"
        ).strip()
        merge_base = git(repo, "merge-base", from_sha, to_sha).strip()
        if not from_sha or not to_sha or not merge_base:
            raise RuntimeError("range refs did not resolve to immutable commit ids")
        return {
            "mode": "range",
            "from": from_sha,
            "to": to_sha,
            "merge_base": merge_base,
        }
    if args.commit:
        commit_sha = git(
            repo, "rev-parse", "--verify", f"{args.commit}^{{commit}}"
        ).strip()
        if not commit_sha:
            raise RuntimeError("commit ref did not resolve to an immutable commit id")
        return {"mode": "commit", "commit": commit_sha}
    return {"mode": "workspace"}


def validate_frozen_preview_refs(
    preview: dict[str, Any], frozen: dict[str, str]
) -> None:
    mode = frozen["mode"]
    fields = {
        "workspace": ("mode",),
        "range": ("mode", "from", "to", "merge_base"),
        "commit": ("mode", "commit"),
    }[mode]
    if any(preview.get(field) != frozen.get(field) for field in fields):
        raise RuntimeError("OCR preview does not match the frozen Git refs")


def update_digest(hasher: Any, label: bytes, value: bytes) -> None:
    hasher.update(len(label).to_bytes(8, "big"))
    hasher.update(label)
    hasher.update(len(value).to_bytes(8, "big"))
    hasher.update(value)


def repository_snapshot(repo: Path) -> dict[str, str]:
    repo = repo.resolve()
    head = git(repo, "rev-parse", "HEAD").strip()
    tracked = git_bytes(
        repo,
        "--literal-pathspecs",
        "diff",
        "--binary",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
    )
    untracked_raw = git_bytes(
        repo,
        "--literal-pathspecs",
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
    )
    hasher = hashlib.sha256()
    update_digest(hasher, b"head", head.encode("ascii"))
    update_digest(hasher, b"tracked", tracked)
    update_digest(hasher, b"untracked-names", untracked_raw)
    for raw_path in sorted(value for value in untracked_raw.split(b"\0") if value):
        try:
            path = validate_relative_path(raw_path.decode("utf-8", errors="strict"))
        except UnicodeDecodeError as error:
            raise RuntimeError("untracked Git path is not valid UTF-8") from error
        file_path = repo / path
        metadata = file_path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            update_digest(
                hasher,
                b"untracked-symlink:" + raw_path,
                os.fsencode(file_path.readlink()),
            )
            continue
        if not file_path.resolve().is_relative_to(repo):
            raise RuntimeError(f"untracked path escapes repository: {path}")
        if not stat.S_ISREG(metadata.st_mode):
            raise RuntimeError(f"unsupported untracked file type: {path}")
        file_hasher = hashlib.sha256()
        with file_path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                file_hasher.update(chunk)
        update_digest(
            hasher,
            b"untracked-file:" + raw_path,
            file_hasher.digest(),
        )
    return {"head": head, "fingerprint": f"sha256:{hasher.hexdigest()}"}


def require_stable_snapshot(
    before: dict[str, str], after: dict[str, str]
) -> None:
    if before != after:
        raise RuntimeError("repository changed while the review bundle was being built")


def first_output_line(raw: str, label: str) -> str:
    lines = raw.splitlines()
    if not lines or not lines[0].strip():
        raise RuntimeError(f"{label} returned no output")
    return lines[0].strip()


def freeze_background_input(
    args: argparse.Namespace,
) -> tuple[str | None, Path | None]:
    if not args.background_file:
        return args.background, None

    background_text = Path(args.background_file).expanduser().resolve().read_text(
        encoding="utf-8"
    )
    descriptor, raw_path = tempfile.mkstemp(
        prefix="open-code-review-loop-background-",
        suffix=".txt",
    )
    frozen_path = Path(raw_path)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="") as handle:
            handle.write(background_text)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        try:
            os.close(descriptor)
        except OSError:
            pass
        frozen_path.unlink(missing_ok=True)
        raise
    return background_text, frozen_path


def selector_args(
    args: argparse.Namespace,
    frozen_preview: dict[str, Any] | None = None,
    frozen_background_file: Path | None = None,
) -> list[str]:
    values: list[str] = []
    from_ref = args.from_ref
    to_ref = args.to_ref
    commit = args.commit
    if frozen_preview and frozen_preview.get("mode") == "range":
        from_ref = frozen_preview.get("from")
        to_ref = frozen_preview.get("to")
    if frozen_preview and frozen_preview.get("mode") == "commit":
        commit = frozen_preview.get("commit")
    if from_ref:
        values.extend(["--from", from_ref])
    if to_ref:
        values.extend(["--to", to_ref])
    if commit:
        values.extend(["--commit", commit])
    if args.exclude:
        values.extend(["--exclude", ",".join(args.exclude)])
    if args.rule:
        values.extend(["--rule", str(Path(args.rule).expanduser().resolve())])
    if args.background:
        values.extend(["--background", args.background])
    if args.background_file:
        if frozen_background_file is None:
            raise RuntimeError("--background-file must be frozen before OCR selection")
        values.extend(
            ["--background-file", str(frozen_background_file)]
        )
    return values


def is_tracked(repo: Path, path: str) -> bool:
    path = validate_relative_path(path)
    try:
        result = subprocess.run(
            ["git", "--literal-pathspecs", "ls-files", "--error-unmatch", "--", path],
            cwd=repo,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="strict",
        )
    except UnicodeDecodeError as error:
        raise RuntimeError("git ls-files output is not valid UTF-8") from error
    if result.returncode == 0:
        return True
    if result.returncode == 1:
        return False
    raise RuntimeError(f"git ls-files failed ({result.returncode})")


def workspace_content(repo: Path, entry: dict[str, Any]) -> str:
    path = validate_relative_path(entry.get("path"))
    status = str(entry.get("status", ""))
    file_path = repo / path
    if status in {"added", "untracked"} and not is_tracked(repo, path):
        if file_path.is_symlink():
            return f"SYMLINK -> {file_path.readlink()}\n"
        if not file_path.resolve().is_relative_to(repo):
            raise RuntimeError(f"untracked path escapes repository: {path}")
        try:
            return file_path.read_bytes().decode("utf-8")
        except UnicodeDecodeError as error:
            raise RuntimeError(
                f"untracked reviewable file is not valid UTF-8: {path}"
            ) from error
    return git(
        repo,
        "--literal-pathspecs",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "HEAD",
        "--",
        path,
    )


def commit_content(repo: Path, commit: str, path: str) -> str:
    path = validate_relative_path(path)
    revision = git(repo, "rev-list", "--parents", "-n", "1", commit).strip().split()
    if not revision:
        raise RuntimeError(f"cannot resolve commit: {commit}")
    if len(revision) == 1:
        return git(
            repo,
            "--literal-pathspecs",
            "show",
            "--format=",
            "--no-ext-diff",
            "--no-textconv",
            commit,
            "--",
            path,
        )
    return git(
        repo,
        "--literal-pathspecs",
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        revision[1],
        commit,
        "--",
        path,
    )


def is_explicit_empty_workspace_file(repo: Path, entry: dict[str, Any]) -> bool:
    path = validate_relative_path(entry.get("path"))
    if str(entry.get("status", "")) not in {"added", "untracked"}:
        return False
    if is_tracked(repo, path):
        return False
    file_path = repo / path
    if file_path.is_symlink() or not file_path.resolve().is_relative_to(repo):
        return False
    return file_path.is_file() and file_path.stat().st_size == 0


def diff_content(repo: Path, preview: dict[str, Any], entry: dict[str, Any]) -> str:
    mode = preview.get("mode")
    path = validate_relative_path(entry.get("path"))
    if mode == "workspace":
        content = workspace_content(repo, entry)
    elif mode == "range":
        merge_base = preview.get("merge_base")
        target = preview.get("to")
        if not merge_base or not target:
            raise RuntimeError("range preview is missing merge_base or to")
        content = git(
            repo,
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            f"{merge_base}..{target}",
            "--",
            path,
        )
    elif mode == "commit":
        commit = preview.get("commit")
        if not commit:
            raise RuntimeError("commit preview is missing commit")
        content = commit_content(repo, str(commit), path)
    else:
        raise RuntimeError(f"unsupported OCR preview mode: {mode!r}")
    if not content and not (
        mode == "workspace" and is_explicit_empty_workspace_file(repo, entry)
    ):
        raise RuntimeError(
            f"empty captured content for reviewable file in {mode} mode: {path}"
        )
    return content


def file_evidence(
    repo: Path, preview: dict[str, Any], entry: dict[str, Any]
) -> dict[str, Any]:
    content = diff_content(repo, preview, entry)
    return {
        "path": str(entry["path"]),
        "status": str(entry.get("status", "")),
        "insertions": entry.get("insertions"),
        "deletions": entry.get("deletions"),
        "empty_file": content == "" and is_explicit_empty_workspace_file(repo, entry),
        "content": content,
    }


def partition_excluded_files(
    excluded_files: list[dict[str, Any]], extra_allowed_reasons: list[str]
) -> tuple[list[str], list[dict[str, Any]]]:
    accepted_reasons = sorted(
        {"default_path", "user_exclude", *extra_allowed_reasons}
    )
    unaccepted = [
        entry
        for entry in excluded_files
        if entry.get("exclude_reason") not in accepted_reasons
    ]
    return accepted_reasons, unaccepted


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--output", required=True)
    parser.add_argument("--from-ref")
    parser.add_argument("--to-ref")
    parser.add_argument("--commit")
    parser.add_argument("--exclude", action="append", default=[])
    parser.add_argument("--rule")
    parser.add_argument(
        "--allow-excluded-reason",
        action="append",
        default=[],
        help="accept an OCR exclusion reason in addition to user_exclude",
    )
    background = parser.add_mutually_exclusive_group()
    background.add_argument("--background")
    background.add_argument("--background-file")
    args = parser.parse_args()
    if bool(args.from_ref) != bool(args.to_ref):
        parser.error("--from-ref and --to-ref must be provided together")
    if args.commit and args.from_ref:
        parser.error("--commit cannot be combined with --from-ref/--to-ref")
    return args


def main() -> int:
    args = parse_args()
    if shutil.which("ocr") is None:
        print("ocr is not installed", file=sys.stderr)
        return 3

    repo = Path(args.repo).expanduser().resolve()
    frozen_background_file: Path | None = None
    result_code = 2
    try:
        repo = Path(git(repo, "rev-parse", "--show-toplevel").strip()).resolve()
        output = Path(args.output).expanduser().resolve()
        if output.is_relative_to(repo):
            raise RuntimeError("--output must be outside the repository")
        snapshot_before = repository_snapshot(repo)
        frozen_refs = freeze_requested_refs(repo, args)
        background_text, frozen_background_file = freeze_background_input(args)
        selectors = selector_args(args, frozen_refs, frozen_background_file)
        preview_command = [
            "ocr",
            "delegate",
            "preview",
            "--format",
            "json",
            "--repo",
            str(repo),
            *selectors,
        ]
        preview = parse_json_object(run(preview_command, repo), "OCR preview")
        entries, excluded_files = validate_preview(preview, repo)
        validate_frozen_preview_refs(preview, frozen_refs)
        rule_selectors = selectors

        rules: dict[str, Any] = {"schema_version": "1", "groups": []}
        if entries:
            paths = [str(entry["path"]) for entry in entries]
            rule_command = [
                "ocr",
                "delegate",
                "rule",
                "--format",
                "json",
                "--repo",
                str(repo),
                *rule_selectors,
                "--",
                *paths,
            ]
            rules = parse_json_object(run(rule_command, repo), "OCR rules")
        validate_rules(rules, entries)

        files = [file_evidence(repo, preview, entry) for entry in entries]
        snapshot_after = repository_snapshot(repo)
        require_stable_snapshot(snapshot_before, snapshot_after)
        refs = {
            key: preview.get(key)
            for key in ("from", "to", "commit", "merge_base")
            if preview.get(key) is not None
        }
        base_sha = snapshot_after["head"]
        ocr_version = first_output_line(run(["ocr", "--version"], repo), "ocr --version")
        accepted_reasons, unaccepted_excluded_files = partition_excluded_files(
            excluded_files, args.allow_excluded_reason
        )
        material = {
            "schema_version": "1",
            "mode": preview.get("mode"),
            "base_sha": base_sha,
            "ocr_version": ocr_version,
            "refs": refs,
            "reviewable_files": entries,
            "excluded_files": excluded_files,
            "accepted_exclusion_reasons": accepted_reasons,
            "unaccepted_excluded_files": unaccepted_excluded_files,
            "background": background_text,
            "rules": rules,
            "files": files,
        }
        digest = hashlib.sha256(canonical_json(material).encode("utf-8")).hexdigest()
        bundle = {
            **material,
            "repository": str(repo),
            "evidence_id": f"sha256:{digest}",
        }
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(bundle, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(
            json.dumps(
                {
                    "output": str(output),
                    "evidence_id": bundle["evidence_id"],
                    "mode": bundle["mode"],
                    "reviewable_files": len(files),
                    "excluded_files": len(bundle["excluded_files"]),
                    "unaccepted_excluded_files": len(
                        bundle["unaccepted_excluded_files"]
                    ),
                },
                ensure_ascii=False,
            )
        )
        result_code = 0
    except (OSError, RuntimeError, json.JSONDecodeError, KeyError) as error:
        print(str(error), file=sys.stderr)
    finally:
        if frozen_background_file is not None:
            try:
                frozen_background_file.unlink()
            except FileNotFoundError:
                pass
            except OSError as error:
                print(f"failed to remove frozen background file: {error}", file=sys.stderr)
                result_code = 2
    return result_code


if __name__ == "__main__":
    raise SystemExit(main())
