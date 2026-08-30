#!/usr/bin/env python3
"""Initialize, validate, and render a web performance audit evidence ledger."""

from __future__ import annotations

import argparse
import html
import ipaddress
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit


SCHEMA_VERSION = "1.1"
PRIORITIES = {"P0", "P1", "P2", "P3"}
CONFIDENCE = {
    "VERIFIED",
    "SCREEN_OBSERVED",
    "INFERENCE",
    "UNVERIFIED",
    "MEASUREMENT_POLLUTION",
}
BUILD_MODES = {"development", "production", "production-equivalent", "unknown"}
TOOL_STATUSES = {"available", "unavailable", "failed", "polluting"}
COVERAGE_STATUSES = {"covered", "partial", "blocked", "skipped"}
CAUSAL_STATUSES = {"measured", "correlated", "source_fact", "source_hypothesis", "unverified"}
EVIDENCE_SOURCES = {
    "browser_metric",
    "trace",
    "network",
    "dom",
    "visual",
    "code",
    "field_data",
    "user_report",
    "tool_log",
}
MACHINE_EVIDENCE_SOURCES = {"browser_metric", "trace", "network", "dom", "field_data"}
DIRECT_IMPACT_SOURCES = {"browser_metric", "trace", "field_data", "visual"}
NON_VERIFYING_SOURCES = {"visual", "user_report", "tool_log"}
CONTENT_TRUST = {"trusted", "untrusted", "mixed", "unknown"}
SENSITIVE_DATA = {"absent", "masked", "present", "unknown"}
BROWSER_PROFILES = {"isolated", "task_specific", "shared", "unknown"}
CONTROL_STATES = {"enabled", "disabled", "redacted", "unavailable", "unknown", "not_applicable"}
TARGET_CLASSES = {"public", "private", "local", "internal", "unknown"}
RISK_DECISIONS = {"proceed", "blocked", "not_applicable"}
FINDING_ID = re.compile(r"^F-[0-9]{3}$")
SURFACE_ID = re.compile(r"^[a-z0-9][a-z0-9._-]*$")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def template(title: str, target_url: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "audit": {
            "title": title,
            "target_url": target_url,
            "target_url_identity_safe": False,
            "target_url_redaction_notes": "TODO: confirm no credentials, secret query, or private identity is recorded",
            "scope": "TODO: requested surfaces and safe journeys",
            "requested_surfaces": [
                {
                    "id": "todo-surface",
                    "label": "TODO: exact requested surface",
                    "required_states": ["cold first-open", "warm return"],
                }
            ],
            "build_mode": "unknown",
            "browser": "TODO: browser and version",
            "viewport": "TODO: width x height and DPR",
            "initial_state": "TODO: tab, selection, playback, scroll",
            "restored_state": "TODO: final restored state",
            "write_boundary": "read-only",
            "privacy": {
                "content_trust": "unknown",
                "sensitive_data": "unknown",
                "browser_profile": "unknown",
                "performance_crux": "unknown",
                "usage_statistics": "unknown",
                "network_headers": "unknown",
                "browser_tooling_used": False,
                "browser_access_authorized": False,
                "target_class": "unknown",
                "risk_decision": "not_applicable",
                "notes": "TODO: page trust, visible data, and browser-tool boundary",
            },
            "started_at": now_iso(),
            "finished_at": "TODO: ISO-8601 completion time",
            "tools": [
                {
                    "name": "TODO: browser capability",
                    "version": "TODO: client, server, or browser version",
                    "status": "unavailable",
                    "role": "TODO: evidence role",
                    "caveat": "TODO: discovery result or pollution risk",
                    "proof": {
                        "discovery": {
                            "performed": False,
                            "evidence": "TODO: how capability discovery was checked",
                        },
                        "handshake": {
                            "performed": False,
                            "evidence": "TODO: handshake result or why it was not possible",
                        },
                        "harmless_call": {
                            "performed": False,
                            "evidence": "TODO: harmless call result or why it was not run",
                        },
                    },
                }
            ],
            "restoration": {
                "initial_state_restored": False,
                "instrumentation_removed": False,
                "throttling_removed": False,
                "media_stopped": False,
                "product_data_changed": False,
                "code_changed": False,
                "notes": "TODO: final state and any exception",
            },
        },
        "coverage": [
            {
                "surface_id": "todo-surface",
                "surface": "TODO: primary tab or journey",
                "state": "cold first-open",
                "conditions": "normal CPU; instrumentation off",
                "status": "blocked",
                "evidence": [],
                "notes": "TODO: cover it or explain why blocked",
            }
        ],
        "findings": [],
        "negative_findings": [],
        "unverified": [
            {
                "path": "production-equivalent verification",
                "reason": "TODO: why it is not verified",
                "needed_evidence": "TODO: equivalent production trace or measurement",
            }
        ],
    }


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON at line {exc.lineno}, column {exc.colno}: {exc.msg}") from exc
    if not isinstance(data, dict):
        raise ValueError("ledger root must be a JSON object")
    return data


def non_empty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and not value.strip().startswith("TODO:")


def require_text(container: dict[str, Any], key: str, prefix: str, errors: list[str]) -> None:
    if not non_empty(container.get(key)):
        errors.append(f"{prefix}.{key} must be a non-empty completed string")


def parse_timestamp(value: Any, key: str, errors: list[str]) -> datetime | None:
    if not non_empty(value):
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        errors.append(f"audit.{key} must be an ISO-8601 timestamp")
        return None
    if parsed.utcoffset() is None:
        errors.append(f"audit.{key} must include a timezone offset")
        return None
    return parsed


def validate_safe_target_url(value: Any) -> list[str]:
    errors: list[str] = []
    if not non_empty(value):
        return errors
    raw = str(value)
    if any(ord(char) < 32 or ord(char) == 127 for char in raw):
        return ["audit.target_url must not contain control characters"]
    try:
        parsed = urlsplit(raw)
        hostname = parsed.hostname
    except ValueError:
        return ["audit.target_url must be a valid HTTP(S) URL"]
    if parsed.scheme not in {"http", "https"} or not hostname:
        errors.append("audit.target_url must be a valid HTTP(S) URL")
    if parsed.username is not None or parsed.password is not None:
        errors.append("audit.target_url must not contain userinfo credentials")
    if parsed.query:
        errors.append("audit.target_url must not contain a query; record a sanitized identity-safe URL")
    if parsed.fragment:
        errors.append("audit.target_url must not contain a fragment; record a sanitized identity-safe URL")
    return errors


def inferred_target_class(value: Any) -> str:
    try:
        hostname = (urlsplit(str(value)).hostname or "").lower().rstrip(".")
    except ValueError:
        return "unknown"
    if not hostname:
        return "unknown"
    if hostname == "localhost" or hostname.endswith(".localhost"):
        return "local"
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None:
        if address.is_loopback:
            return "local"
        if address.is_private or address.is_link_local:
            return "private"
        return "public"
    if hostname.endswith((".local", ".internal", ".test")):
        return "internal"
    return "public"


def validate_evidence(
    evidence: Any,
    prefix: str,
    errors: list[str],
    available_tools: set[str],
) -> set[str]:
    sources: set[str] = set()
    if not isinstance(evidence, list) or not evidence:
        errors.append(f"{prefix} must contain at least one evidence item")
        return sources
    for index, item in enumerate(evidence):
        item_prefix = f"{prefix}[{index}]"
        if not isinstance(item, dict):
            errors.append(f"{item_prefix} must be an object")
            continue
        for key in ("signal", "value", "unit", "conditions"):
            require_text(item, key, item_prefix, errors)
        source = item.get("source")
        if source not in EVIDENCE_SOURCES:
            errors.append(
                f"{item_prefix}.source must be one of {', '.join(sorted(EVIDENCE_SOURCES))}"
            )
            continue
        sources.add(source)
        if source in MACHINE_EVIDENCE_SOURCES:
            require_text(item, "tool", item_prefix, errors)
            tool = item.get("tool")
            if non_empty(tool) and tool not in available_tools:
                errors.append(
                    f"{item_prefix}.tool must name an available capability with completed proof"
                )
    return sources


def validate(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if data.get("schema_version") != SCHEMA_VERSION:
        errors.append(f"schema_version must be {SCHEMA_VERSION!r}")

    audit = data.get("audit")
    if not isinstance(audit, dict):
        return errors + ["audit must be an object"]
    for key in (
        "title",
        "target_url",
        "target_url_redaction_notes",
        "scope",
        "browser",
        "viewport",
        "initial_state",
        "restored_state",
        "write_boundary",
        "started_at",
        "finished_at",
    ):
        require_text(audit, key, "audit", errors)
    errors.extend(validate_safe_target_url(audit.get("target_url")))
    if audit.get("target_url_identity_safe") is not True:
        errors.append("audit.target_url_identity_safe must be true before validation")
    started_at = parse_timestamp(audit.get("started_at"), "started_at", errors)
    finished_at = parse_timestamp(audit.get("finished_at"), "finished_at", errors)
    if started_at is not None and finished_at is not None and finished_at < started_at:
        errors.append("audit.finished_at must not be earlier than audit.started_at")
    if audit.get("build_mode") not in BUILD_MODES:
        errors.append(f"audit.build_mode must be one of {', '.join(sorted(BUILD_MODES))}")
    if audit.get("write_boundary") != "read-only":
        errors.append("audit.write_boundary must be 'read-only' for this audit skill")

    requested = audit.get("requested_surfaces")
    requested_ids: set[str] = set()
    requested_surfaces: dict[str, tuple[str, set[str]]] = {}
    if not isinstance(requested, list) or not requested:
        errors.append("audit.requested_surfaces must be a non-empty array")
    else:
        for index, item in enumerate(requested):
            prefix = f"audit.requested_surfaces[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{prefix} must be an object")
                continue
            require_text(item, "id", prefix, errors)
            require_text(item, "label", prefix, errors)
            required_states = item.get("required_states")
            state_set: set[str] = set()
            if not isinstance(required_states, list) or not required_states:
                errors.append(f"{prefix}.required_states must be a non-empty array")
            else:
                for state_index, state in enumerate(required_states):
                    if not non_empty(state):
                        errors.append(
                            f"{prefix}.required_states[{state_index}] must be a completed string"
                        )
                    elif state in state_set:
                        errors.append(f"{prefix}.required_states duplicates {state}")
                    else:
                        state_set.add(state)
            surface_id = item.get("id")
            if non_empty(surface_id) and not SURFACE_ID.fullmatch(surface_id):
                errors.append(f"{prefix}.id must use lowercase letters, digits, dot, underscore, or dash")
            elif surface_id in requested_ids:
                errors.append(f"{prefix}.id duplicates {surface_id}")
            elif non_empty(surface_id):
                requested_ids.add(surface_id)
                if non_empty(item.get("label")):
                    requested_surfaces[surface_id] = (item["label"], state_set)

    privacy = audit.get("privacy")
    if not isinstance(privacy, dict):
        errors.append("audit.privacy must be an object")
    else:
        if privacy.get("content_trust") not in CONTENT_TRUST:
            errors.append(f"audit.privacy.content_trust must be one of {', '.join(sorted(CONTENT_TRUST))}")
        if privacy.get("sensitive_data") not in SENSITIVE_DATA:
            errors.append(f"audit.privacy.sensitive_data must be one of {', '.join(sorted(SENSITIVE_DATA))}")
        if privacy.get("browser_profile") not in BROWSER_PROFILES:
            errors.append(f"audit.privacy.browser_profile must be one of {', '.join(sorted(BROWSER_PROFILES))}")
        for key in ("performance_crux", "usage_statistics", "network_headers"):
            if privacy.get(key) not in CONTROL_STATES:
                errors.append(f"audit.privacy.{key} must be one of {', '.join(sorted(CONTROL_STATES))}")
        for key in ("browser_tooling_used", "browser_access_authorized"):
            if not isinstance(privacy.get(key), bool):
                errors.append(f"audit.privacy.{key} must be boolean")
        if privacy.get("target_class") not in TARGET_CLASSES:
            errors.append(
                f"audit.privacy.target_class must be one of {', '.join(sorted(TARGET_CLASSES))}"
            )
        if privacy.get("risk_decision") not in RISK_DECISIONS:
            errors.append(
                f"audit.privacy.risk_decision must be one of {', '.join(sorted(RISK_DECISIONS))}"
            )
        detected_class = inferred_target_class(audit.get("target_url"))
        if detected_class in {"local", "private", "internal"} and privacy.get("target_class") != detected_class:
            errors.append(
                f"audit.privacy.target_class must be {detected_class} for the sanitized target URL"
            )
        if privacy.get("browser_tooling_used"):
            if privacy.get("browser_access_authorized") is not True:
                errors.append("browser tooling requires explicit browser_access_authorized=true")
            if privacy.get("risk_decision") not in {"proceed", "blocked"}:
                errors.append("browser tooling requires risk_decision proceed or blocked")
            for key in (
                "content_trust",
                "sensitive_data",
                "browser_profile",
                "performance_crux",
                "usage_statistics",
                "network_headers",
                "target_class",
            ):
                if privacy.get(key) == "unknown":
                    errors.append(f"browser tooling requires a known audit.privacy.{key}")
            if privacy.get("risk_decision") == "proceed":
                if privacy.get("content_trust") in {"untrusted", "mixed"} and privacy.get("browser_profile") != "isolated":
                    errors.append("untrusted or mixed content requires an isolated browser profile")
                if privacy.get("browser_profile") == "shared" and (
                    privacy.get("content_trust") != "trusted"
                    or privacy.get("sensitive_data") not in {"absent", "masked"}
                ):
                    errors.append("a shared profile may proceed only with trusted content and absent or masked sensitive data")
                if privacy.get("sensitive_data") == "present":
                    if privacy.get("browser_profile") not in {"isolated", "task_specific"}:
                        errors.append("present sensitive data requires an isolated or task-specific profile")
                    if privacy.get("performance_crux") not in {"disabled", "unavailable", "not_applicable"}:
                        errors.append("present sensitive data requires CrUX lookup disabled or unavailable")
                    if privacy.get("usage_statistics") not in {"disabled", "unavailable", "not_applicable"}:
                        errors.append("present sensitive data requires usage statistics disabled or unavailable")
                    if privacy.get("network_headers") != "redacted":
                        errors.append("present sensitive data requires redacted network headers")
                if privacy.get("target_class") in {"local", "private", "internal"} and privacy.get("performance_crux") not in {
                    "disabled",
                    "unavailable",
                    "not_applicable",
                }:
                    errors.append("local, private, or internal targets require CrUX lookup disabled or unavailable")
        require_text(privacy, "notes", "audit.privacy", errors)

    tools = audit.get("tools")
    available_tools: set[str] = set()
    if not isinstance(tools, list) or not tools:
        errors.append("audit.tools must contain at least one capability result")
    else:
        seen_tools: set[str] = set()
        for index, tool in enumerate(tools):
            prefix = f"audit.tools[{index}]"
            if not isinstance(tool, dict):
                errors.append(f"{prefix} must be an object")
                continue
            for key in ("name", "version", "role", "caveat"):
                require_text(tool, key, prefix, errors)
            name = tool.get("name")
            if non_empty(name) and name in seen_tools:
                errors.append(f"{prefix}.name duplicates {name}")
            elif non_empty(name):
                seen_tools.add(name)
            status = tool.get("status")
            if status not in TOOL_STATUSES:
                errors.append(f"{prefix}.status must be one of {', '.join(sorted(TOOL_STATUSES))}")
            proof = tool.get("proof")
            if not isinstance(proof, dict):
                errors.append(f"{prefix}.proof must be an object")
            else:
                for key in ("discovery", "handshake", "harmless_call"):
                    step = proof.get(key)
                    if not isinstance(step, dict):
                        errors.append(f"{prefix}.proof.{key} must be an object")
                        continue
                    if not isinstance(step.get("performed"), bool):
                        errors.append(f"{prefix}.proof.{key}.performed must be boolean")
                    require_text(step, "evidence", f"{prefix}.proof.{key}", errors)
            proof_complete = isinstance(proof, dict) and all(
                isinstance(proof.get(key), dict)
                and proof[key].get("performed") is True
                and non_empty(proof[key].get("evidence"))
                for key in ("discovery", "handshake", "harmless_call")
            )
            if status == "available" and not proof_complete:
                errors.append(f"{prefix} available requires performed discovery, handshake, and harmless call proof")
            if status == "available" and non_empty(name) and proof_complete:
                available_tools.add(name)

    restoration = audit.get("restoration")
    if not isinstance(restoration, dict):
        errors.append("audit.restoration must be an object")
    else:
        for key in (
            "initial_state_restored",
            "instrumentation_removed",
            "throttling_removed",
            "media_stopped",
            "product_data_changed",
            "code_changed",
        ):
            if not isinstance(restoration.get(key), bool):
                errors.append(f"audit.restoration.{key} must be boolean")
        require_text(restoration, "notes", "audit.restoration", errors)

    coverage = data.get("coverage")
    covered_surface_ids: set[str] = set()
    covered_states: dict[str, set[str]] = {surface_id: set() for surface_id in requested_ids}
    coverage_keys: set[tuple[str, str, str]] = set()
    if not isinstance(coverage, list) or not coverage:
        errors.append("coverage must contain every requested surface or flow")
    else:
        for index, item in enumerate(coverage):
            prefix = f"coverage[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{prefix} must be an object")
                continue
            for key in ("surface_id", "surface", "state", "conditions"):
                require_text(item, key, prefix, errors)
            surface_id = item.get("surface_id")
            if non_empty(surface_id):
                covered_surface_ids.add(surface_id)
                if surface_id not in requested_ids:
                    errors.append(f"{prefix}.surface_id is not listed in audit.requested_surfaces")
                elif surface_id in requested_surfaces:
                    expected_label, required_states = requested_surfaces[surface_id]
                    if item.get("surface") != expected_label:
                        errors.append(f"{prefix}.surface must exactly match requested label {expected_label!r}")
                    if item.get("state") not in required_states:
                        errors.append(
                            f"{prefix}.state must be one of the requested required_states for {surface_id}"
                        )
                    elif non_empty(item.get("state")):
                        covered_states[surface_id].add(item["state"])
            key = (str(surface_id), str(item.get("state")), str(item.get("conditions")))
            if key in coverage_keys:
                errors.append(f"{prefix} duplicates surface/state/conditions {key}")
            coverage_keys.add(key)
            status = item.get("status")
            if status not in COVERAGE_STATUSES:
                errors.append(f"{prefix}.status must be one of {', '.join(sorted(COVERAGE_STATUSES))}")
            evidence_refs = item.get("evidence")
            if not isinstance(evidence_refs, list) or not all(non_empty(ref) for ref in evidence_refs):
                errors.append(f"{prefix}.evidence must be an array of completed strings")
            if status == "covered" and not evidence_refs:
                errors.append(f"{prefix}.evidence must not be empty for covered work")
            if status in {"blocked", "skipped", "partial"} and not non_empty(item.get("notes")):
                errors.append(f"{prefix}.notes must explain {status} coverage")
    for missing_id in sorted(requested_ids - covered_surface_ids):
        errors.append(f"coverage is missing requested surface {missing_id}; add a covered/partial/blocked/skipped row")
    for surface_id, (_, required_states) in requested_surfaces.items():
        for missing_state in sorted(required_states - covered_states.get(surface_id, set())):
            errors.append(
                f"coverage is missing required state {missing_state!r} for {surface_id}; add a covered/partial/blocked/skipped row"
            )

    findings = data.get("findings")
    negative_findings = data.get("negative_findings")
    if not isinstance(findings, list):
        errors.append("findings must be an array")
        findings = []
    if not isinstance(negative_findings, list):
        errors.append("negative_findings must be an array")
        negative_findings = []
    risk_blocked = isinstance(privacy, dict) and privacy.get("risk_decision") == "blocked"
    if not findings and not negative_findings and not risk_blocked:
        errors.append("record at least one finding or negative finding before final validation")

    seen_ids: set[str] = set()
    for index, finding in enumerate(findings):
        prefix = f"findings[{index}]"
        if not isinstance(finding, dict):
            errors.append(f"{prefix} must be an object")
            continue
        finding_id = finding.get("id")
        if not isinstance(finding_id, str) or not FINDING_ID.fullmatch(finding_id):
            errors.append(f"{prefix}.id must match F-NNN")
        elif finding_id in seen_ids:
            errors.append(f"{prefix}.id duplicates {finding_id}")
        else:
            seen_ids.add(finding_id)
        priority = finding.get("priority")
        confidence = finding.get("confidence")
        causal_status = finding.get("causal_status")
        if priority not in PRIORITIES:
            errors.append(f"{prefix}.priority must be one of {', '.join(sorted(PRIORITIES))}")
        if confidence not in CONFIDENCE:
            errors.append(f"{prefix}.confidence must be one of {', '.join(sorted(CONFIDENCE))}")
        if causal_status not in CAUSAL_STATUSES:
            errors.append(f"{prefix}.causal_status must be one of {', '.join(sorted(CAUSAL_STATUSES))}")
        for key in ("surface_id", "title", "surface", "conditions", "user_impact", "caveats"):
            require_text(finding, key, prefix, errors)
        if non_empty(finding.get("surface_id")) and finding.get("surface_id") not in requested_ids:
            errors.append(f"{prefix}.surface_id is not listed in audit.requested_surfaces")
        elif finding.get("surface_id") in requested_surfaces:
            expected_label, _ = requested_surfaces[finding["surface_id"]]
            if finding.get("surface") != expected_label:
                errors.append(f"{prefix}.surface must exactly match requested label {expected_label!r}")
        sources = validate_evidence(
            finding.get("evidence"), f"{prefix}.evidence", errors, available_tools
        )
        if confidence == "VERIFIED" and sources and sources <= NON_VERIFYING_SOURCES:
            errors.append(f"{prefix} VERIFIED requires structured runtime, source, or field evidence")
        if confidence == "VERIFIED" and causal_status not in {"measured", "source_fact"}:
            errors.append(f"{prefix} VERIFIED requires measured or source_fact causal status")
        if confidence == "SCREEN_OBSERVED":
            if "visual" not in sources:
                errors.append(f"{prefix} SCREEN_OBSERVED requires visual evidence")
            if causal_status != "correlated":
                errors.append(f"{prefix} SCREEN_OBSERVED requires correlated causal status")
        if confidence == "INFERENCE" and causal_status not in {"correlated", "source_hypothesis"}:
            errors.append(f"{prefix} INFERENCE requires correlated or source_hypothesis causal status")
        if confidence == "UNVERIFIED" and causal_status != "unverified":
            errors.append(f"{prefix} UNVERIFIED requires causal_status unverified")
        if confidence == "MEASUREMENT_POLLUTION" and causal_status not in {"measured", "correlated"}:
            errors.append(f"{prefix} MEASUREMENT_POLLUTION requires measured or correlated causal status")
        if causal_status == "measured" and not (sources & MACHINE_EVIDENCE_SOURCES):
            errors.append(f"{prefix} measured requires machine-readable evidence")
        if causal_status == "source_fact" and "code" not in sources:
            errors.append(f"{prefix} source_fact requires code evidence")
        if causal_status == "source_hypothesis" and "code" not in sources:
            errors.append(f"{prefix} source_hypothesis requires code evidence")
        if priority in {"P0", "P1"} and not (sources & DIRECT_IMPACT_SOURCES):
            errors.append(f"{prefix} {priority} requires direct user-impact evidence")
        if priority in {"P0", "P1"} and confidence in {"UNVERIFIED", "MEASUREMENT_POLLUTION"}:
            errors.append(f"{prefix} {priority} cannot be {confidence}")
        recommendation = finding.get("recommendation")
        if not isinstance(recommendation, dict):
            errors.append(f"{prefix}.recommendation must be an object")
        else:
            for key in ("direction", "retest", "success_criterion", "stop_condition"):
                require_text(recommendation, key, f"{prefix}.recommendation", errors)

    for index, finding in enumerate(negative_findings):
        prefix = f"negative_findings[{index}]"
        if not isinstance(finding, dict):
            errors.append(f"{prefix} must be an object")
            continue
        confidence = finding.get("confidence")
        causal_status = finding.get("causal_status")
        if confidence not in {"VERIFIED", "SCREEN_OBSERVED"}:
            errors.append(f"{prefix}.confidence must be VERIFIED or SCREEN_OBSERVED")
        if causal_status not in CAUSAL_STATUSES:
            errors.append(f"{prefix}.causal_status must be one of {', '.join(sorted(CAUSAL_STATUSES))}")
        for key in ("claim", "conditions", "scope_limit"):
            require_text(finding, key, prefix, errors)
        sources = validate_evidence(
            finding.get("evidence"), f"{prefix}.evidence", errors, available_tools
        )
        if confidence == "VERIFIED":
            if causal_status != "measured":
                errors.append(f"{prefix} VERIFIED requires measured causal status")
            if not (sources & MACHINE_EVIDENCE_SOURCES):
                errors.append(f"{prefix} VERIFIED requires machine-readable evidence")
        if confidence == "SCREEN_OBSERVED":
            if causal_status != "correlated":
                errors.append(f"{prefix} SCREEN_OBSERVED requires correlated causal status")
            if "visual" not in sources:
                errors.append(f"{prefix} SCREEN_OBSERVED requires visual evidence")

    unverified = data.get("unverified")
    if not isinstance(unverified, list):
        errors.append("unverified must be an array")
    else:
        for index, item in enumerate(unverified):
            prefix = f"unverified[{index}]"
            if not isinstance(item, dict):
                errors.append(f"{prefix} must be an object")
                continue
            for key in ("path", "reason", "needed_evidence"):
                require_text(item, key, prefix, errors)
    if risk_blocked:
        if findings or negative_findings:
            errors.append("a blocked browser risk decision cannot contain product findings")
        if isinstance(coverage, list) and any(
            isinstance(item, dict) and item.get("status") not in {"blocked", "skipped"}
            for item in coverage
        ):
            errors.append("a blocked browser risk decision requires all coverage rows to be blocked or skipped")
    return errors


def inline(value: Any) -> str:
    return html.escape(str(value if value is not None else ""), quote=False).replace("\r", " ").replace("\n", " ")


def md(value: Any) -> str:
    return inline(value).replace("|", "\\|")


def render_evidence(items: list[dict[str, Any]]) -> list[str]:
    lines = [
        "| Signal | Value | Unit | Conditions | Source | Tool |",
        "| --- | ---: | --- | --- | --- | --- |",
    ]
    for item in items:
        lines.append(
            f"| {md(item['signal'])} | {md(item['value'])} | {md(item['unit'])} | "
            f"{md(item['conditions'])} | {md(item['source'])} | {md(item.get('tool', 'n/a'))} |"
        )
    return lines


def render(data: dict[str, Any]) -> str:
    audit = data["audit"]
    findings = sorted(data["findings"], key=lambda item: (item["priority"], item["id"]))
    decision_findings = [
        item
        for item in findings
        if item["confidence"] not in {"UNVERIFIED", "MEASUREMENT_POLLUTION"}
    ]
    lines = [f"# {inline(audit['title'])}", "", "## Decision summary", ""]
    risk_blocked = audit["privacy"]["risk_decision"] == "blocked"
    if risk_blocked:
        lines.append(
            "- Audit blocked by privacy preflight; no product measurement or product finding was produced."
        )
    elif decision_findings:
        for finding in decision_findings[:3]:
            lines.append(
                f"- **{inline(finding['id'])} · {inline(finding['priority'])} · {inline(finding['confidence'])}** — "
                f"{inline(finding['title'])}: {inline(finding['user_impact'])}"
            )
    else:
        lines.append("- No actionable product finding was verified in the tested scope.")
    if data["negative_findings"] and not risk_blocked:
        counterevidence = data["negative_findings"][0]
        lines.append(
            f"- Counterevidence ({inline(counterevidence['confidence'])}): "
            f"{inline(counterevidence['claim'])}"
        )

    lines.extend(
        [
            "",
            "## Target and conditions",
            "",
            "| Field | Value |",
            "| --- | --- |",
            f"| URL | {md(audit['target_url'])} |",
            f"| URL identity-safe | yes; {md(audit['target_url_redaction_notes'])} |",
            f"| Scope | {md(audit['scope'])} |",
            f"| Browser/build | {md(audit['browser'])}; {md(audit['build_mode'])} |",
            f"| Viewport | {md(audit['viewport'])} |",
            f"| Initial state | {md(audit['initial_state'])} |",
            f"| Write boundary | {md(audit['write_boundary'])} |",
            f"| Requested surfaces | {md(', '.join(item['label'] for item in audit['requested_surfaces']))} |",
            "",
            "## Trust and privacy",
            "",
            "| Field | Value |",
            "| --- | --- |",
            f"| Content trust | {md(audit['privacy']['content_trust'])} |",
            f"| Sensitive data | {md(audit['privacy']['sensitive_data'])} |",
            f"| Browser profile | {md(audit['privacy']['browser_profile'])} |",
            f"| Browser tooling / authorization / risk | {md(audit['privacy']['browser_tooling_used'])} / {md(audit['privacy']['browser_access_authorized'])} / {md(audit['privacy']['risk_decision'])} |",
            f"| Target class | {md(audit['privacy']['target_class'])} |",
            f"| CrUX / usage statistics / headers | {md(audit['privacy']['performance_crux'])} / {md(audit['privacy']['usage_statistics'])} / {md(audit['privacy']['network_headers'])} |",
            f"| Notes | {md(audit['privacy']['notes'])} |",
            "",
            "## Tool and noise ledger",
            "",
            "| Tool/capability | Version | Status | Role | Proof | Caveat |",
            "| --- | --- | --- | --- | --- | --- |",
        ]
    )
    for tool in audit["tools"]:
        proof = tool["proof"]
        lines.append(
            f"| {md(tool['name'])} | {md(tool['version'])} | {md(tool['status'])} | {md(tool['role'])} | "
            f"discovery: {md(proof['discovery']['evidence'])}; handshake: {md(proof['handshake']['evidence'])}; "
            f"call: {md(proof['harmless_call']['evidence'])} | {md(tool['caveat'])} |"
        )

    lines.extend(
        [
            "",
            "## Coverage",
            "",
            "| Surface/flow | State | Conditions | Status | Evidence/notes |",
            "| --- | --- | --- | --- | --- |",
        ]
    )
    for item in data["coverage"]:
        evidence = "; ".join(map(str, item.get("evidence") or []))
        details = evidence or item.get("notes", "")
        lines.append(
            f"| {md(item['surface'])} | {md(item['state'])} | {md(item['conditions'])} | "
            f"{md(item['status'])} | {md(details)} |"
        )

    lines.extend(["", "## Findings", ""])
    if risk_blocked:
        lines.append("Not evaluated: privacy preflight blocked product measurement.")
    elif not findings:
        lines.append("No actionable product finding was verified.")
    for finding in findings:
        rec = finding["recommendation"]
        lines.extend(
            [
                f"### {inline(finding['id'])} | {inline(finding['priority'])} | {inline(finding['confidence'])} | {inline(finding['title'])}",
                "",
                f"- **Surface:** {inline(finding['surface'])}",
                f"- **Conditions:** {inline(finding['conditions'])}",
                f"- **User impact:** {inline(finding['user_impact'])}",
                f"- **Causal status:** {inline(finding['causal_status'])}",
                f"- **Caveats:** {inline(finding['caveats'])}",
                "",
                *render_evidence(finding["evidence"]),
                "",
                f"- **Recommendation:** {inline(rec['direction'])}",
                f"- **Retest:** {inline(rec['retest'])}",
                f"- **Success criterion:** {inline(rec['success_criterion'])}",
                f"- **Stop condition:** {inline(rec['stop_condition'])}",
                "",
            ]
        )

    lines.extend(["## Negative findings", ""])
    if not data["negative_findings"]:
        lines.append("None recorded.")
    for item in data["negative_findings"]:
        lines.extend(
            [
                f"### {inline(item['confidence'])} | {inline(item['claim'])}",
                "",
                f"- **Conditions:** {inline(item['conditions'])}",
                f"- **Causal status:** {inline(item['causal_status'])}",
                f"- **Scope limit:** {inline(item['scope_limit'])}",
                "",
                *render_evidence(item["evidence"]),
                "",
            ]
        )

    lines.extend(["## UNVERIFIED and production gaps", ""])
    if not data["unverified"]:
        lines.append("None recorded.")
    for item in data["unverified"]:
        lines.append(
            f"- **{inline(item['path'])}** — {inline(item['reason'])} Needed evidence: {inline(item['needed_evidence'])}"
        )

    lines.extend(
        [
            "",
            "## Restoration",
            "",
            f"- Final state: {inline(audit['restored_state'])}",
            f"- Initial state restored: {'yes' if audit['restoration']['initial_state_restored'] else 'no'}",
            f"- Instrumentation removed: {'yes' if audit['restoration']['instrumentation_removed'] else 'no'}",
            f"- Throttling removed: {'yes' if audit['restoration']['throttling_removed'] else 'no'}",
            f"- Media stopped: {'yes' if audit['restoration']['media_stopped'] else 'no'}",
            f"- Product data changed: {'yes' if audit['restoration']['product_data_changed'] else 'no'}",
            f"- Code changed: {'yes' if audit['restoration']['code_changed'] else 'no'}",
            f"- Notes: {inline(audit['restoration']['notes'])}",
            f"- Finished: {inline(audit['finished_at'])}",
            "",
        ]
    )
    return "\n".join(lines)


def command_init(args: argparse.Namespace) -> int:
    output = Path(args.path)
    url_errors = validate_safe_target_url(args.url)
    if url_errors:
        for error in url_errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 2
    if output.exists() and not args.force:
        print(f"ERROR: {output} already exists; pass --force to replace it", file=sys.stderr)
        return 2
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(template(args.title, args.url), indent=2) + "\n", encoding="utf-8")
    print(output)
    return 0


def command_validate(args: argparse.Namespace) -> int:
    try:
        data = load_json(Path(args.path))
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    errors = validate(data)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print(f"FAILED: {len(errors)} validation error(s)", file=sys.stderr)
        return 1
    print("OK: audit ledger is valid")
    return 0


def command_render(args: argparse.Namespace) -> int:
    try:
        data = load_json(Path(args.path))
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    errors = validate(data)
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        print("FAILED: refusing to render an invalid ledger", file=sys.stderr)
        return 1
    content = render(data)
    if args.output:
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(content, encoding="utf-8")
        print(output)
    else:
        print(content, end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="create a new evidence ledger template")
    init_parser.add_argument("path")
    init_parser.add_argument("--url", required=True)
    init_parser.add_argument("--title", required=True)
    init_parser.add_argument("--force", action="store_true")
    init_parser.set_defaults(handler=command_init)

    validate_parser = subparsers.add_parser("validate", help="validate ledger semantics")
    validate_parser.add_argument("path")
    validate_parser.set_defaults(handler=command_validate)

    render_parser = subparsers.add_parser("render", help="render a valid ledger as Markdown")
    render_parser.add_argument("path")
    render_parser.add_argument("--output")
    render_parser.set_defaults(handler=command_render)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return int(args.handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
