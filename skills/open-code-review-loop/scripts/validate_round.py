#!/usr/bin/env python3
"""Validate an AI reviewer result against an OCR review bundle."""

from __future__ import annotations

import argparse
from collections import Counter
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
import re
import subprocess
import unicodedata
from pathlib import Path
from typing import Any

# Neither module has a fallback: without them main() answers UNVERIFIED.
try:
    import fcntl
except ImportError:  # no advisory file locks on this platform
    fcntl = None
try:
    import pwd
except ImportError:  # no account database on this platform
    pwd = None


PRODUCTS = {"codex", "claude-code", "grok-build", "cursor-cli"}
CATEGORIES = {
    "bug",
    "security",
    "performance",
    "maintainability",
    "test",
    "style",
    "documentation",
    "other",
}
SEVERITIES = {"critical", "high", "medium", "low"}
VERDICTS = {"FINDINGS", "NO_FINDINGS", "BLOCKED"}
EVIDENCE_ID_PATTERN = re.compile(r"^sha256:[0-9a-f]{64}$")
BASE_SHA_PATTERN = re.compile(r"^[0-9a-f]{40}(?:[0-9a-f]{24})?$")
STATE_DIR_NAME = "open-code-review-loop"
ENTRY_STATUSES = {"started", "valid", "invalid"}
BASE_ROUND_BUDGET = 3
GRANT_USAGE = '--grant-rounds <N> --granted-by "<the user\'s own words>"'
REBUILD_HINT = (
    "rebuild the bundle with build_review_bundle.py instead of writing or "
    "editing it by hand"
)
# build_review_bundle.py seals the same fields (EVIDENCE_MATERIAL_FIELDS).
# `repository` is one of them: pointing an existing bundle at another checkout
# breaks the digest instead of selecting that checkout's ledger.
BUNDLE_MATERIAL_FIELDS = (
    "schema_version",
    "mode",
    "repository",
    "base_sha",
    "ocr_version",
    "refs",
    "reviewable_files",
    "supplemental_reviewable_files",
    "excluded_files",
    "accepted_exclusion_reasons",
    "unaccepted_excluded_files",
    "background",
    "rules",
    "supplemental_rules",
    "files",
)
REVIEW_FIELDS = {
    "schema_version",
    "evidence_id",
    "reviewer",
    "files",
    "findings",
    "verdict",
    "block_reason",
}
REVIEWER_FIELDS = {"product", "session_id"}
FILE_FIELDS = {"path", "status", "disposition", "reason"}
FINDING_FIELDS = {
    "id",
    "path",
    "start_line",
    "end_line",
    "category",
    "severity",
    "content",
    "required_fix",
    "acceptance_check",
}


def load_object(path: str) -> dict[str, Any]:
    value = json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain one JSON object")
    return value


def non_empty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def canonical_evidence_id(bundle: dict[str, Any]) -> str | None:
    if any(field not in bundle for field in BUNDLE_MATERIAL_FIELDS):
        return None
    material = {field: bundle[field] for field in BUNDLE_MATERIAL_FIELDS}
    encoded = json.dumps(
        material,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def identity(entry: Any) -> tuple[str, str]:
    if not isinstance(entry, dict):
        return "", ""
    path = entry.get("path")
    status = entry.get("status")
    return (
        path if isinstance(path, str) else "",
        status if isinstance(status, str) else "",
    )


def reject_unknown_fields(
    errors: list[str], label: str, value: dict[str, Any], allowed: set[str]
) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        errors.append(f"{label} has unknown fields: {', '.join(unknown)}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--review")
    mode.add_argument("--check-call", action="store_true")
    mode.add_argument(
        "--grant-rounds",
        metavar="N",
        help="Record N extra rounds that the user authorized; needs --granted-by",
    )
    parser.add_argument(
        "--granted-by",
        help="The user's own words authorizing the extra rounds, verbatim",
    )
    parser.add_argument(
        "--history",
        help="Deprecated: the ledger path is derived from the repository; "
        "any other path is refused",
    )
    parser.add_argument("--product", choices=sorted(PRODUCTS))
    parser.add_argument("--session-id")
    parser.add_argument("--output")
    return parser


def parse_args() -> argparse.Namespace:
    return build_parser().parse_args()


def validate(bundle: dict[str, Any], review: dict[str, Any]) -> dict[str, Any]:
    errors: list[str] = []
    reject_unknown_fields(errors, "review", review, REVIEW_FIELDS)
    ocr_expected_entries = bundle.get("reviewable_files")
    supplemental_expected_entries = bundle.get("supplemental_reviewable_files")
    files = review.get("files")
    findings = review.get("findings")
    reviewer = review.get("reviewer")
    verdict = review.get("verdict")
    unaccepted_excluded = bundle.get("unaccepted_excluded_files")

    if review.get("schema_version") != "1":
        errors.append("schema_version must be '1'")
    bundle_evidence_id = bundle.get("evidence_id")
    review_evidence_id = review.get("evidence_id")
    if not isinstance(bundle_evidence_id, str) or not EVIDENCE_ID_PATTERN.fullmatch(
        bundle_evidence_id
    ):
        errors.append("bundle.evidence_id must be a canonical sha256 digest")
    computed_evidence_id = canonical_evidence_id(bundle)
    if computed_evidence_id is None:
        missing = sorted(set(BUNDLE_MATERIAL_FIELDS) - set(bundle))
        errors.append(
            "bundle is missing canonical evidence material fields: "
            + ", ".join(missing)
        )
    elif bundle_evidence_id != computed_evidence_id:
        errors.append("bundle.evidence_id does not match canonical bundle material")
    if not isinstance(review_evidence_id, str) or not EVIDENCE_ID_PATTERN.fullmatch(
        review_evidence_id
    ):
        errors.append("review.evidence_id must be a canonical sha256 digest")
    if review_evidence_id != bundle_evidence_id:
        errors.append("evidence_id does not match the bundle")
    if not isinstance(ocr_expected_entries, list):
        errors.append("bundle.reviewable_files must be an array")
        ocr_expected_entries = []
    if not isinstance(supplemental_expected_entries, list):
        errors.append("bundle.supplemental_reviewable_files must be an array")
        supplemental_expected_entries = []
    expected_entries = [*ocr_expected_entries, *supplemental_expected_entries]
    if not isinstance(files, list):
        errors.append("files must be an array")
        files = []
    if not isinstance(findings, list):
        errors.append("findings must be an array")
        findings = []
    if not isinstance(reviewer, dict):
        errors.append("reviewer must be an object")
        reviewer = {}
    reject_unknown_fields(errors, "reviewer", reviewer, REVIEWER_FIELDS)
    product = reviewer.get("product")
    if not isinstance(product, str) or product not in PRODUCTS:
        errors.append("reviewer.product is not a supported canonical product id")
    if "session_id" not in reviewer:
        errors.append("reviewer.session_id must be present")
    elif reviewer.get("session_id") is not None and not non_empty(
        reviewer.get("session_id")
    ):
        errors.append("reviewer.session_id must be null or a non-empty string")
    if not isinstance(verdict, str) or verdict not in VERDICTS:
        errors.append("verdict must be FINDINGS, NO_FINDINGS, or BLOCKED")
    if "block_reason" not in review:
        errors.append("block_reason must be present")
    elif review.get("block_reason") is not None and not isinstance(
        review.get("block_reason"), str
    ):
        errors.append("block_reason must be null or a string")
    if verdict != "BLOCKED" and review.get("block_reason") is not None:
        errors.append("block_reason must be null unless verdict is BLOCKED")
    if not isinstance(unaccepted_excluded, list):
        errors.append("bundle.unaccepted_excluded_files must be an array")
        unaccepted_excluded = []

    expected_counter = Counter(identity(entry) for entry in expected_entries)
    bundle_files = bundle.get("files")
    if not isinstance(bundle_files, list):
        errors.append("bundle.files must be an array")
        bundle_files = []
    bundle_file_counter = Counter(
        identity(entry) for entry in bundle_files if isinstance(entry, dict)
    )
    if expected_counter != bundle_file_counter:
        errors.append(
            "bundle.files must capture every selected review (path, status) identity exactly once"
        )
    actual_counter = Counter(identity(entry) for entry in files if isinstance(entry, dict))
    if expected_counter != actual_counter:
        errors.append(
            "files must account for every selected review (path, status) identity exactly once"
        )

    reviewed = 0
    skipped = 0
    expected_paths = {path for path, _ in expected_counter}
    for index, entry in enumerate(files):
        if not isinstance(entry, dict):
            errors.append(f"files[{index}] must be an object")
            continue
        reject_unknown_fields(errors, f"files[{index}]", entry, FILE_FIELDS)
        if not non_empty(entry.get("path")):
            errors.append(f"files[{index}].path must be a non-empty string")
        if not non_empty(entry.get("status")):
            errors.append(f"files[{index}].status must be a non-empty string")
        disposition = entry.get("disposition")
        if disposition == "reviewed":
            reviewed += 1
        elif disposition == "skipped":
            skipped += 1
            if not non_empty(entry.get("reason")):
                errors.append(f"files[{index}].reason is required when skipped")
        else:
            errors.append(f"files[{index}].disposition must be reviewed or skipped")
        if "reason" not in entry:
            errors.append(f"files[{index}].reason must be present")
        elif not non_empty(entry.get("reason")):
            errors.append(f"files[{index}].reason must be a non-empty string")

    finding_ids: set[str] = set()
    required_strings = ("id", "path", "content", "required_fix", "acceptance_check")
    for index, finding in enumerate(findings):
        if not isinstance(finding, dict):
            errors.append(f"findings[{index}] must be an object")
            continue
        reject_unknown_fields(errors, f"findings[{index}]", finding, FINDING_FIELDS)
        for field in required_strings:
            if not non_empty(finding.get(field)):
                errors.append(f"findings[{index}].{field} must be a non-empty string")
        finding_id = finding.get("id")
        if isinstance(finding_id, str):
            if finding_id in finding_ids:
                errors.append(f"duplicate finding id: {finding_id}")
            finding_ids.add(finding_id)
        finding_path = finding.get("path")
        if isinstance(finding_path, str) and finding_path not in expected_paths:
            errors.append(f"findings[{index}].path is outside the selected review set")
        category = finding.get("category")
        if not isinstance(category, str) or category not in CATEGORIES:
            errors.append(f"findings[{index}].category is invalid")
        severity = finding.get("severity")
        if not isinstance(severity, str) or severity not in SEVERITIES:
            errors.append(f"findings[{index}].severity is invalid")
        start = finding.get("start_line")
        end = finding.get("end_line")
        if "start_line" not in finding or "end_line" not in finding:
            errors.append(
                f"findings[{index}].start_line and end_line must be present"
            )
        if (start is None) != (end is None):
            errors.append(
                f"findings[{index}] must include start_line and end_line together or omit both"
            )
        if start is not None and (not isinstance(start, int) or isinstance(start, bool) or start < 1):
            errors.append(f"findings[{index}].start_line must be a positive integer")
        if end is not None and (not isinstance(end, int) or isinstance(end, bool) or end < 1):
            errors.append(f"findings[{index}].end_line must be a positive integer")
        if isinstance(start, int) and isinstance(end, int) and end < start:
            errors.append(f"findings[{index}].end_line must be >= start_line")

    total = len(expected_entries)
    coverage_rate = 1.0 if total == 0 else reviewed / total
    if verdict == "NO_FINDINGS":
        if findings:
            errors.append("NO_FINDINGS requires an empty findings array")
        if skipped or reviewed != total:
            errors.append("NO_FINDINGS requires 100% reviewed coverage and zero skipped files")
        if unaccepted_excluded:
            errors.append("NO_FINDINGS requires zero unaccepted excluded files")
    elif verdict == "FINDINGS":
        if not findings:
            errors.append("FINDINGS requires at least one finding")
        if skipped or reviewed != total:
            errors.append("FINDINGS requires full reviewed coverage and zero skipped files")
    elif verdict == "BLOCKED" and not non_empty(review.get("block_reason")):
        errors.append("BLOCKED requires block_reason")

    valid = not errors
    clean = valid and verdict == "NO_FINDINGS"
    return {
        "valid": valid,
        "clean": clean,
        "verdict": verdict,
        "evidence_id": bundle.get("evidence_id"),
        "total_files": total,
        "ocr_reviewable_files": len(ocr_expected_entries),
        "supplemental_reviewable_files": len(supplemental_expected_entries),
        "reviewed_files": reviewed,
        "skipped_files": skipped,
        "coverage_rate": coverage_rate,
        "finding_count": len(findings),
        "unaccepted_excluded_files": len(unaccepted_excluded),
        "errors": errors,
    }


HOME_NOT_USED = (
    "HOME is not used instead, because a caller could point it at an empty "
    "directory and start the round count again from zero"
)


def default_state_root() -> Path:
    """Return the fixed per-user state directory for the round ledgers.

    The home directory comes from the account database, not from HOME,
    XDG_STATE_HOME, or any argument: a caller that could move the ledgers
    could start every count again from zero. There is no fallback: an account
    the database cannot place gets no ledger directory, and the script
    answers UNVERIFIED.
    """
    if pwd is None:
        raise ValueError(
            "cannot locate the round ledgers: this platform has no account "
            f"database (Python has no pwd module). {HOME_NOT_USED}. Run the "
            "loop with a Python on macOS, Linux, or WSL, then rerun the same "
            "command"
        )
    uid = os.getuid()
    try:
        home = pwd.getpwuid(uid).pw_dir
    except KeyError:
        raise ValueError(
            "cannot locate the round ledgers: the account database has no "
            f"entry for the current user (uid {uid}). {HOME_NOT_USED}. Give "
            f"uid {uid} an account entry with an absolute home directory (in "
            "a container, run as a user listed in /etc/passwd instead of a "
            "bare numeric uid), then rerun the same command"
        ) from None
    if not non_empty(home) or not os.path.isabs(home):
        raise ValueError(
            f"cannot locate the round ledgers: the account database lists "
            f"{home!r} as the home directory of uid {uid}, which is not an "
            f"absolute path. {HOME_NOT_USED}. Set an absolute home directory "
            "in that account entry, then rerun the same command"
        )
    return Path(home) / ".local" / "state" / STATE_DIR_NAME


# Tests replace this constant in-process. The CLI has no flag or environment
# variable for it, so a loop that runs the script cannot relocate the ledgers.
# None means the account database could not place it; state_root() says why.
try:
    STATE_ROOT: Path | None = default_state_root()
except ValueError:
    STATE_ROOT = None


def state_root() -> Path:
    """The ledger state directory, or the reason there is none."""
    return default_state_root() if STATE_ROOT is None else STATE_ROOT


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def git_output(repository: str, *args: str) -> str:
    # GIT_DIR / GIT_WORK_TREE would let the caller answer for another checkout.
    environment = {
        key: value for key, value in os.environ.items() if not key.startswith("GIT_")
    }
    try:
        completed = subprocess.run(
            ["git", "-C", repository, *args],
            capture_output=True, text=True, check=False, env=environment, timeout=30,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError(
            f"cannot run git for bundle.repository {repository}: {error}. Make "
            "git available on PATH and rerun the same command"
        ) from error
    if completed.returncode != 0:
        detail = (completed.stderr.strip().splitlines() or ["no output"])[-1]
        raise ValueError(
            f"bundle.repository {repository} is not a Git checkout on this "
            f"machine (git {' '.join(args)} failed: {detail}); {REBUILD_HINT}"
        )
    return completed.stdout.strip()


def repository_identity(bundle: dict[str, Any]) -> str:
    """Return the checkout root that Git itself reports for the bundle.

    The ledger is keyed by this answer, never by the bundle's own text.
    bundle.repository is also part of the evidence digest, which main() checks
    first: a bundle built in one checkout cannot be pointed at another one,
    not even a worktree or clone on the same HEAD.
    """
    repository = bundle.get("repository")
    base_sha = bundle.get("base_sha")
    if not non_empty(repository) or not os.path.isabs(repository):
        raise ValueError(
            "bundle.repository must be the absolute repository path that "
            f"build_review_bundle.py records; {REBUILD_HINT}"
        )
    if not isinstance(base_sha, str) or not BASE_SHA_PATTERN.fullmatch(base_sha):
        raise ValueError(
            f"bundle.base_sha must be the full commit hash of HEAD; {REBUILD_HINT}"
        )
    toplevel = git_output(repository, "rev-parse", "--show-toplevel")
    head = git_output(repository, "rev-parse", "HEAD")
    try:
        same_directory = os.path.samefile(toplevel, repository)
    except OSError:
        same_directory = False
    if not same_directory:
        raise ValueError(
            f"bundle.repository {repository} is not the root of its Git "
            f"checkout (Git reports {toplevel}); {REBUILD_HINT}"
        )
    if head != base_sha:
        raise ValueError(
            f"bundle.base_sha {base_sha} is not HEAD of {toplevel} (HEAD is "
            f"{head}): the bundle is stale or was edited. Rebuild it with "
            "build_review_bundle.py; rounds already in the ledger still count"
        )
    return os.path.realpath(toplevel)


def ledger_path(repository: str) -> Path:
    """Derive the one round ledger of a repository checkout.

    `repository` is the answer of repository_identity(). The caller never
    chooses this path: a handoff, a resumed session, a new round directory, or
    a new commit must land on the rounds that were already used.
    """
    repository_key = hashlib.sha256(repository.encode("utf-8")).hexdigest()[:16]
    root = state_root()
    path = root / "ledgers" / f"{repository_key}.json"
    if path.resolve().is_relative_to(Path(repository).resolve()):
        raise ValueError(
            f"the round ledger {path} would sit inside the repository and drift "
            "the evidence. The ledger location is fixed, so this loop cannot "
            f"run on a repository that contains {root}; run it on a "
            "checkout outside that directory"
        )
    return path


def loop_start(entries: list[dict[str, Any]]) -> int:
    """Index of the first entry after the last validated NO_FINDINGS."""
    return max(
        (index + 1 for index, item in enumerate(entries) if item.get("clean")),
        default=0,
    )


def loop_grants(ledger: dict[str, Any]) -> list[dict[str, Any]]:
    """Grants recorded after the last validated NO_FINDINGS."""
    closed = [
        item["grants_closed"] for item in ledger["entries"] if item.get("clean")
    ]
    return ledger["grants"][closed[-1] if closed else 0:]


def call_gate(ledger: dict[str, Any], evidence_id: str) -> dict[str, Any]:
    """Count evidence rounds separately from the single format correction.

    Rounds belong to the open loop: every evidence since the last validated
    NO_FINDINGS, whatever HEAD it was built on. Only that clean result closes
    a loop; a new commit, session, or round directory does not.
    """
    entries = ledger["entries"]
    start = loop_start(entries)
    grants = loop_grants(ledger)
    # A grant is the user's decision to continue, so failures before it no
    # longer lock the ledger; rounds are never forgotten.
    window = max(start, grants[-1]["entries_before"]) if grants else start
    failures = Counter(
        item["evidence_id"]
        for item in entries[window:]
        if item["status"] == "invalid"
    )
    current = entries[start:]
    evidence = {item["evidence_id"] for item in current}
    granted = sum(grant["rounds"] for grant in grants)
    budget = BASE_ROUND_BUDGET + granted
    rounds = len(evidence | {evidence_id})
    reason = fix = None
    if any(count >= 2 for count in failures.values()):
        reason = "UNVERIFIED: repeated malformed output"
        fix = (
            "Do not call the Reviewer again; report UNVERIFIED with the ledger "
            "path. Only the user can reopen this ledger: ask, then record their "
            f"words with {GRANT_USAGE}."
        )
    elif rounds > budget:
        reason = "HUMAN_GATE: round budget exhausted"
        fix = (
            "Do not call the Reviewer. Ask the user whether to add rounds and "
            f"record their own words with {GRANT_USAGE}. A host's unattended "
            "prompt is not a grant: when nobody is present, defer the open "
            "findings and stop. A new commit, bundle, or session does not "
            "start a new count."
        )
    elif any(
        item["evidence_id"] == evidence_id and item["status"] == "valid"
        for item in entries
    ):
        reason = "UNVERIFIED: evidence already reviewed"
        fix = (
            "This evidence already has a validated review in the ledger; use "
            "that result. Only changed code produces new evidence, and new "
            "evidence consumes a round."
        )
    base_shas = list(dict.fromkeys(
        item["base_sha"] for item in current if item.get("base_sha")
    ))
    gate = {"call_allowed": reason is None, "stop": reason,
            "rounds_used": len(evidence), "round_budget": budget,
            "granted_rounds": granted, "base_shas": base_shas}
    if fix:
        gate["fix"] = fix
    return gate


def open_attempt(ledger: dict[str, Any], evidence_id: str) -> dict[str, Any] | None:
    """The started, not yet validated call for this evidence in the open loop."""
    entries = ledger["entries"]
    for item in reversed(entries[loop_start(entries):]):
        if item["evidence_id"] == evidence_id:
            return item if item["status"] == "started" else None
    return None


def record_attempt(
    ledger: dict[str, Any], evidence_id: str, base_sha: str, gate_passed: bool
) -> dict[str, Any]:
    """Count the round when the gate lets a call through, not when it returns.

    A Reviewer that starts and is then interrupted has still used the round;
    passing the gate again for the same evidence reuses the same entry.
    """
    entry = open_attempt(ledger, evidence_id)
    if entry is None:
        entry = {"evidence_id": evidence_id, "base_sha": base_sha,
                 "status": "started", "check_calls": 0, "started_at": timestamp()}
        ledger["entries"].append(entry)
    if gate_passed:
        entry["check_calls"] = entry.get("check_calls", 0) + 1
    if base_sha not in ledger["base_shas"]:
        ledger["base_shas"].append(base_sha)
    return entry


def invalid_ledger(path: Path) -> ValueError:
    return ValueError(
        f"Invalid round ledger at {path}. Do not delete, edit, or recreate "
        "it: stop, report UNVERIFIED with this path, and let the user "
        "repair or remove the file"
    )


def read_entry(item: Any, legacy_base_sha: Any, grant_count: int) -> dict[str, Any]:
    """Normalize one round; a legacy entry carries only `valid`."""
    if not isinstance(item, dict):
        raise ValueError("entry must be an object")
    evidence_id = item.get("evidence_id")
    if not isinstance(evidence_id, str) or not EVIDENCE_ID_PATTERN.fullmatch(evidence_id):
        raise ValueError("entry.evidence_id is invalid")
    status = item.get("status")
    if status is None and type(item.get("valid")) is bool:
        status = "valid" if item["valid"] else "invalid"
    if status not in ENTRY_STATUSES:
        raise ValueError("entry.status is invalid")
    entry: dict[str, Any] = {"evidence_id": evidence_id}
    base_sha = item.get("base_sha", legacy_base_sha)
    if base_sha is not None:
        if not isinstance(base_sha, str) or not BASE_SHA_PATTERN.fullmatch(base_sha):
            raise ValueError("entry.base_sha is invalid")
        entry["base_sha"] = base_sha
    entry["status"] = status
    if "clean" in item:
        # Only a validated NO_FINDINGS written by this script closes a loop; a
        # legacy `valid: true` never does.
        grants_closed = item.get("grants_closed")
        if (
            item["clean"] is not True
            or status != "valid"
            or type(grants_closed) is not int
            or not 0 <= grants_closed <= grant_count
        ):
            raise ValueError("entry.clean is invalid")
        entry["clean"] = True
        entry["grants_closed"] = grants_closed
    if "check_calls" in item:
        if type(item["check_calls"]) is not int or item["check_calls"] < 0:
            raise ValueError("entry.check_calls is invalid")
        entry["check_calls"] = item["check_calls"]
    for field in ("started_at", "reviewed_at"):
        if field in item:
            if not non_empty(item[field]):
                raise ValueError(f"entry.{field} is invalid")
            entry[field] = item[field]
    return entry


def read_ledger(path: Path) -> dict[str, Any]:
    """Load the ledger; a legacy bare list of rounds carries no grants."""
    if not path.exists():
        return {"entries": [], "grants": [], "base_shas": []}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ValueError(
            f"cannot read the round ledger at {path}: {error}. Make the file "
            "readable for this host and rerun; do not replace it"
        ) from error
    except ValueError:
        raw = None
    if isinstance(raw, list):
        raw = {"entries": raw}
    if not isinstance(raw, dict):
        raise invalid_ledger(path)
    raw_entries = raw.get("entries")
    grants = raw.get("grants", [])
    legacy_base_sha = raw.get("base_sha")
    base_shas = raw.get(
        "base_shas", [] if legacy_base_sha is None else [legacy_base_sha]
    )
    if (
        not isinstance(raw_entries, list)
        or not isinstance(grants, list)
        or not isinstance(base_shas, list)
        or any(
            not isinstance(value, str) or not BASE_SHA_PATTERN.fullmatch(value)
            for value in base_shas
        )
    ):
        raise invalid_ledger(path)
    try:
        entries = [
            read_entry(item, legacy_base_sha, len(grants)) for item in raw_entries
        ]
    except ValueError as error:
        raise invalid_ledger(path) from error
    if any(
        not isinstance(grant, dict)
        or type(grant.get("rounds")) is not int
        or grant["rounds"] < 1
        or not non_empty(grant.get("granted_by"))
        or not non_empty(grant.get("at"))
        or type(grant.get("entries_before")) is not int
        or not 0 <= grant["entries_before"] <= len(entries)
        for grant in grants
    ):
        raise invalid_ledger(path)
    return {"entries": entries, "grants": grants, "base_shas": base_shas}


def unwritable_ledger(path: Path, error: OSError) -> ValueError:
    return ValueError(
        f"cannot write the round ledger at {path}: {error}. Make "
        f"{state_root()} writable for this host (a sandboxed host needs it as an "
        "extra writable directory), then rerun the same command. The ledger "
        "location is fixed: no argument or environment variable moves it, and "
        "a call that cannot be recorded must not be made"
    )


@contextmanager
def ledger_lock(path: Path) -> Iterator[None]:
    """Serialize read-check-write so two sessions cannot both take a round.

    There is no unlocked mode: without a lock two calls can each read the
    same count and one round is lost, so the caller gets UNVERIFIED instead.
    """
    if fcntl is None:
        raise ValueError(
            f"cannot lock the round ledger at {path}: this Python has no fcntl "
            "module, so the platform offers no file lock, and without one two "
            "sessions could both take the same round. Nothing was read or "
            "written. Run the loop with a Python on macOS, Linux, or WSL, "
            "then rerun the same command"
        )
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        handle = open(path.with_name(f"{path.name}.lock"), "a", encoding="utf-8")
    except OSError as error:
        raise unwritable_ledger(path, error) from error
    with handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX)
        except OSError as error:
            raise ValueError(
                f"cannot lock the round ledger at {path}: {error}. The ledger "
                "was not read or changed. The file system that holds "
                f"{state_root()} must support flock: keep that directory on a "
                "local disk instead of a network or sandbox mount without "
                "file locks, then rerun the same command"
            ) from error
        yield


def write_ledger(path: Path, repository: str, ledger: dict[str, Any]) -> None:
    document = {
        "schema_version": "3",
        "repository": repository,
        "base_shas": ledger["base_shas"],
        "entries": ledger["entries"],
        "grants": ledger["grants"],
    }
    temporary = path.with_name(f"{path.name}.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_text(
            json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        os.replace(temporary, path)
    except OSError as error:
        raise unwritable_ledger(path, error) from error


def same_path(first: Path, second: Path) -> bool:
    """Compare two paths by name and, when both exist, by the file they are."""
    if first == second:
        return True
    try:
        return os.path.samefile(first, second)
    except OSError:
        return False


def refuse_output_over_ledger(output: str | None, ledger: Path | None = None) -> None:
    """Refuse an --output that would write over the round ledger.

    The result JSON is written after the lock is released, so a path that is
    the ledger, its .tmp or .lock companion, or anything else in the state
    directory would replace the recorded rounds. Symlinks and relative
    spellings are resolved first, and existing files are compared by identity,
    so a hard link or a differently-cased name is caught as well.
    """
    if not output:
        return
    target = Path(output).expanduser().resolve()
    root = state_root().resolve()
    protected = [] if ledger is None else [
        ledger.with_name(ledger.name + suffix).resolve()
        for suffix in ("", ".tmp", ".lock")
    ]
    if (
        any(same_path(target, item) for item in protected)
        or any(same_path(parent, root) for parent in (target, *target.parents))
    ):
        raise OutputRefused(
            f"--output {output} is refused: it resolves to {target}, which is "
            f"the round ledger, one of its .tmp/.lock files, or a path inside "
            f"the ledger state directory {root}; writing the result there "
            "would destroy the recorded rounds. Nothing was written. Pass "
            "another path for --output, for example a file in this round's "
            "own directory, and rerun the same command"
        )


class OutputRefused(ValueError):
    """--output must not be written: it points at the ledger state."""


def grant_text_key(text: str) -> str:
    """Letters and digits only, so punctuation or hidden characters cannot
    disguise a placeholder."""
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(
        char for char in normalized if unicodedata.category(char)[0] in "LN"
    )


def visible_grant_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text)
    return "".join(
        char for char in normalized if unicodedata.category(char)[0] not in "CZ"
    )


PLACEHOLDER_GRANT_KEYS = frozenset(
    grant_text_key(text)
    for text in (
        "TODO", "TBD", "FIXME", "XXX", "placeholder", "用户原话",
        "the user's own words", "the user's own words about extra rounds",
    )
)
# Blanket "take the recommendation" replies and host unattended prompts say
# nothing about adding review rounds. This list is deliberately short and
# exact: a sentence that also names the rounds is accepted.
UNATTENDED_GRANT_KEYS = frozenset(
    grant_text_key(text)
    for text in (
        "按推荐", "按推荐来", "按推荐继续", "都按推荐来", "都按推荐",
        "go on with the recommended option",
        "continue with the recommended option",
        "proceed with the recommended option",
    )
)
UNATTENDED_GRANT_MARKERS = (grant_text_key("nobody is here to answer"),)


def validate_grant(rounds: str, granted_by: str | None) -> tuple[int, str]:
    if not re.fullmatch(r"[1-9][0-9]*", rounds.strip()):
        raise ValueError(
            "--grant-rounds must be a positive whole number of extra rounds, "
            f"for example --grant-rounds 2; got {rounds!r}"
        )
    key = grant_text_key(granted_by) if isinstance(granted_by, str) else ""
    if not key:
        raise ValueError(
            "--granted-by must quote the user's own words that authorize extra "
            'rounds, for example --granted-by "two more rounds are fine"; '
            "blank, punctuation-only, or invisible text is not a quote. Ask "
            "the user when they have not said so; a host's unattended prompt "
            "or the agent's own judgment is not a grant"
        )
    visible = visible_grant_text(granted_by)
    if (visible.startswith("<") and visible.endswith(">")) or key in PLACEHOLDER_GRANT_KEYS:
        raise ValueError(
            f"--granted-by {granted_by!r} is a placeholder, not something the "
            "user said. Replace it with the sentence the user actually wrote "
            'about adding rounds, for example --granted-by "two more rounds '
            'are fine"; when they have not written one, ask them, or when '
            "nobody is present defer the open findings and stop"
        )
    if key in UNATTENDED_GRANT_KEYS or any(
        marker in key for marker in UNATTENDED_GRANT_MARKERS
    ):
        raise ValueError(
            f"--granted-by {granted_by!r} is a blanket go-ahead or a host's "
            "unattended prompt and says nothing about extra review rounds. "
            "Ask the user whether to add rounds and quote their answer; when "
            "their answer does name the rounds (for example 「按推荐继续，再审"
            "两轮」), quote that whole sentence. When nobody is present, defer "
            "the open findings and stop"
        )
    return int(rounds), granted_by.strip()


def main() -> int:
    args = parse_args()
    # --output is written only after both checks below have passed. An error
    # before that point (no account entry, unreadable bundle, stale evidence)
    # goes to stdout alone: the path could still be the ledger or a hard link
    # to it outside the state directory.
    output_checked = False
    try:
        # Without a ledger directory no call can be recorded, so none is made.
        state_root()
        # Before anything is read or written: no ledger, lock, or result file
        # may be touched for an --output aimed at the ledger state.
        refuse_output_over_ledger(args.output)
        try:
            bundle = load_object(args.bundle)
        except (OSError, ValueError) as error:
            raise ValueError(
                f"cannot read --bundle {args.bundle}: {error}; pass the "
                "bundle.json that build_review_bundle.py wrote for this round"
            ) from error
        evidence_id = canonical_evidence_id(bundle)
        if evidence_id is None or bundle.get("evidence_id") != evidence_id:
            raise ValueError(
                "bundle.evidence_id does not match canonical bundle material "
                "(bundle.repository is part of it, so a bundle cannot be "
                "pointed at another checkout); " + REBUILD_HINT
            )
        repository = repository_identity(bundle)
        path = ledger_path(repository)
        refuse_output_over_ledger(args.output, path)
        output_checked = True
        if args.history and Path(args.history).expanduser().resolve() != path.resolve():
            raise ValueError(
                f"--history {args.history} is refused: the script derives the "
                "round ledger from the repository Git reports for the bundle, "
                "so a new path cannot reset the count. Drop --history (or pass "
                f"exactly {path}) and rerun. Rounds recorded there still "
                f"count; extra rounds need {GRANT_USAGE}"
            )
        if args.granted_by is not None and args.grant_rounds is None:
            raise ValueError(
                f"--granted-by only records a grant; use it as {GRANT_USAGE}"
            )
        grant_request = (
            None if args.grant_rounds is None
            else validate_grant(args.grant_rounds, args.granted_by)
        )
        with ledger_lock(path):
            ledger = read_ledger(path)
            gate = call_gate(ledger, evidence_id)
            if grant_request is not None:
                grant = {
                    "at": timestamp(),
                    "rounds": grant_request[0],
                    "granted_by": grant_request[1],
                    "entries_before": len(ledger["entries"]),
                }
                ledger["grants"].append(grant)
                write_ledger(path, repository, ledger)
                result = {"valid": True, "clean": False, "granted": grant,
                          **call_gate(ledger, evidence_id)}
            elif not gate["call_allowed"]:
                # A refused gate writes nothing: the ledger stays byte-identical.
                result = {"valid": False, "clean": False, **gate}
            elif args.check_call:
                # Passing the gate is what uses the round, so it is on disk
                # before the Reviewer starts.
                record_attempt(ledger, evidence_id, bundle["base_sha"], True)
                write_ledger(path, repository, ledger)
                result = {"valid": True, "clean": False,
                          **call_gate(ledger, evidence_id)}
            else:
                try:
                    review = load_object(args.review)
                    if args.product:
                        from extract_product_output import extract, normalize_reviewer_identity
                        review = normalize_reviewer_identity(
                            args.product, review, extract(args.product, review), args.session_id
                        )
                    result = validate(bundle, review)
                except (OSError, ValueError) as error:
                    result = {"valid": False, "clean": False, "errors": [str(error)]}
                entry = record_attempt(ledger, evidence_id, bundle["base_sha"], False)
                entry["status"] = "valid" if result["valid"] else "invalid"
                entry["reviewed_at"] = timestamp()
                # Report the loop this review belongs to before closing it.
                result.update(call_gate(ledger, evidence_id))
                if result["valid"]:
                    # A completed review is not a retry failure.
                    result["stop"] = None
                    result.pop("fix", None)
                if result["clean"]:
                    # Only a validated NO_FINDINGS ends a loop; the next
                    # evidence then starts a new budget without old grants.
                    entry["clean"] = True
                    entry["grants_closed"] = len(ledger["grants"])
                    result["loop_closed"] = True
                write_ledger(path, repository, ledger)
        result["ledger"] = str(path)
    except (OSError, ValueError) as error:  # OutputRefused is a ValueError
        result = {"valid": False, "clean": False, "call_allowed": False,
                  "stop": "UNVERIFIED", "errors": [str(error)]}

    rendered = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output and output_checked:
        output = Path(args.output).expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0 if result.get("valid") else 2


if __name__ == "__main__":
    raise SystemExit(main())
