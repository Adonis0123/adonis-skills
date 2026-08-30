#!/usr/bin/env python3
"""Tests for audit_ledger.py."""

from __future__ import annotations

import importlib.util
import io
import copy
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("audit_ledger.py")
SPEC = importlib.util.spec_from_file_location("audit_ledger", MODULE_PATH)
assert SPEC and SPEC.loader
audit_ledger = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit_ledger)


def valid_ledger() -> dict:
    data = audit_ledger.template("Editor runtime audit", "https://app.example.test/editor/project")
    data["audit"].update(
        {
            "scope": "All primary tabs; read-only",
            "target_url_identity_safe": True,
            "target_url_redaction_notes": "Sanitized fixture route; no query or private identity recorded.",
            "requested_surfaces": [
                {
                    "id": "gallery-all",
                    "label": "Gallery / All",
                    "required_states": ["cold first-open", "warm return"],
                }
            ],
            "build_mode": "development",
            "browser": "Chrome 140",
            "viewport": "1440 x 900; DPR 2",
            "initial_state": "Paused on Create at scroll top",
            "restored_state": "Paused on Create at scroll top; throttle and instrumentation off",
            "finished_at": audit_ledger.now_iso(),
            "privacy": {
                "content_trust": "trusted",
                "sensitive_data": "masked",
                "browser_profile": "task_specific",
                "performance_crux": "disabled",
                "usage_statistics": "disabled",
                "network_headers": "redacted",
                "browser_tooling_used": True,
                "browser_access_authorized": True,
                "target_class": "internal",
                "risk_decision": "proceed",
                "notes": "Sanitized test fixture with no credentials.",
            },
            "restoration": {
                "initial_state_restored": True,
                "instrumentation_removed": True,
                "throttling_removed": True,
                "media_stopped": True,
                "product_data_changed": False,
                "code_changed": False,
                "notes": "All temporary state removed.",
            },
            "tools": [
                {
                    "name": "Chrome DevTools trace",
                    "version": "1.2.3",
                    "status": "available",
                    "role": "runtime metrics",
                    "caveat": "DevTools attached; clean browser run retained as control",
                    "proof": {
                        "discovery": {"performed": True, "evidence": "page list returned target"},
                        "handshake": {"performed": True, "evidence": "selected target page"},
                        "harmless_call": {"performed": True, "evidence": "captured idle trace"},
                    },
                }
            ],
        }
    )
    data["coverage"] = [
        {
            "surface_id": "gallery-all",
            "surface": "Gallery / All",
            "state": "cold first-open",
            "conditions": "normal CPU; paused; instrumentation off",
            "status": "covered",
            "evidence": ["DOM inventory"],
            "notes": "",
        },
        {
            "surface_id": "gallery-all",
            "surface": "Gallery / All",
            "state": "warm return",
            "conditions": "normal CPU; paused; instrumentation off",
            "status": "covered",
            "evidence": ["Event Timing x3"],
            "notes": "",
        }
    ]
    evidence = [
        {
            "signal": "offscreen full-resolution images",
            "value": "19",
            "unit": "images",
            "conditions": "33-item Gallery; 14 images visible",
            "source": "dom",
            "tool": "Chrome DevTools trace",
        }
    ]
    data["findings"] = [
        {
            "id": "F-001",
            "priority": "P2",
            "confidence": "VERIFIED",
            "title": "Gallery mounts offscreen full-resolution images",
            "surface_id": "gallery-all",
            "surface": "Gallery / All",
            "conditions": "33-item dataset; normal CPU; paused",
            "user_impact": "The measured mounted DOM footprint is larger than the visible card count.",
            "causal_status": "measured",
            "caveats": "Decoded RGBA surface is an estimate, not JS heap or guaranteed GPU residency.",
            "evidence": evidence,
            "recommendation": {
                "direction": "First verify loaded, decoded, and resident states plus interaction impact; only then consider card variants or windowing.",
                "retest": "Repeat the same 33-item cold-open and scroll flow with resource and decoded-state evidence.",
                "success_criterion": "Demonstrate lower resource pressure and material interaction improvement without blank cards.",
                "stop_condition": "Stop if resources are not decoded/resident or interaction timing does not improve.",
            },
        }
    ]
    data["negative_findings"] = [
        {
            "confidence": "VERIFIED",
            "causal_status": "measured",
            "claim": "Ten tab cycles did not show monotonic retained growth.",
            "conditions": "Ten equivalent cycles plus an eight-second recovery wait",
            "scope_limit": "Does not cover a 30-minute editing session.",
            "evidence": [
                {
                    "signal": "post-recovery DOM node delta",
                    "value": "-10",
                    "unit": "nodes",
                    "conditions": "after ten cycles",
                    "source": "browser_metric",
                    "tool": "Chrome DevTools trace",
                }
            ],
        }
    ]
    data["unverified"] = [
        {
            "path": "production-equivalent bundle cost",
            "reason": "Only development Coverage was available.",
            "needed_evidence": "Production build transfer, parse, and execution measurement.",
        }
    ]
    return data


class AuditLedgerTest(unittest.TestCase):
    def test_template_requires_completion(self) -> None:
        errors = audit_ledger.validate(
            audit_ledger.template("Example", "https://app.example.test/editor/project")
        )
        self.assertTrue(any("completed string" in error for error in errors))
        self.assertTrue(any("finding or negative finding" in error for error in errors))

    def test_valid_ledger_passes_and_renders(self) -> None:
        data = valid_ledger()
        self.assertEqual(audit_ledger.validate(data), [])
        report = audit_ledger.render(data)
        self.assertIn("F-001 | P2 | VERIFIED", report)
        self.assertIn("Decoded RGBA surface is an estimate", report)
        self.assertIn("## Negative findings", report)
        self.assertIn("## Restoration", report)

    def test_duplicate_finding_ids_fail(self) -> None:
        data = valid_ledger()
        data["findings"].append(copy.deepcopy(data["findings"][0]))
        errors = audit_ledger.validate(data)
        self.assertIn("findings[1].id duplicates F-001", errors)

    def test_missing_requested_surface_fails(self) -> None:
        data = valid_ledger()
        data["audit"]["requested_surfaces"].append(
            {"id": "text-basic", "label": "Text / Basic", "required_states": ["cold first-open"]}
        )
        errors = audit_ledger.validate(data)
        self.assertTrue(any("missing requested surface text-basic" in error for error in errors))

    def test_visual_only_cannot_be_verified_or_measured(self) -> None:
        data = valid_ledger()
        finding = data["findings"][0]
        finding["evidence"] = [
            {
                "signal": "panel looked slower",
                "value": "yes",
                "unit": "visual state",
                "conditions": "one screenshot",
                "source": "visual",
            }
        ]
        errors = audit_ledger.validate(data)
        self.assertTrue(any("VERIFIED requires structured" in error for error in errors))
        self.assertTrue(any("measured requires machine-readable" in error for error in errors))

    def test_high_priority_needs_direct_impact_signal(self) -> None:
        data = valid_ledger()
        data["findings"][0]["priority"] = "P1"
        errors = audit_ledger.validate(data)
        self.assertTrue(any("P1 requires direct user-impact evidence" in error for error in errors))

    def test_available_tool_requires_completed_proof(self) -> None:
        data = valid_ledger()
        data["audit"]["tools"][0]["proof"]["harmless_call"]["performed"] = False
        errors = audit_ledger.validate(data)
        self.assertTrue(any("available requires performed" in error for error in errors))
        self.assertTrue(any("must name an available capability" in error for error in errors))

    def test_skipped_coverage_requires_array_and_renders_safely(self) -> None:
        data = valid_ledger()
        data["coverage"][0].update(status="skipped", evidence=[], notes="Blocked by write risk")
        self.assertEqual(audit_ledger.validate(data), [])
        self.assertIn("Blocked by write risk", audit_ledger.render(data))
        data["coverage"][0]["evidence"] = "screen"
        self.assertTrue(any("evidence must be an array" in error for error in audit_ledger.validate(data)))

    def test_restoration_is_rendered_from_data(self) -> None:
        data = valid_ledger()
        data["audit"]["restoration"]["product_data_changed"] = True
        data["audit"]["restoration"]["notes"] = "Accidental selection persisted and was reported."
        report = audit_ledger.render(data)
        self.assertIn("Product data changed: yes", report)
        self.assertIn("Accidental selection persisted", report)

    def test_invalid_finished_timestamp_fails(self) -> None:
        data = valid_ledger()
        data["audit"]["finished_at"] = "today"
        self.assertTrue(any("finished_at must be an ISO-8601" in error for error in audit_ledger.validate(data)))

    def test_finished_timestamp_must_follow_start_and_include_timezone(self) -> None:
        data = valid_ledger()
        data["audit"]["started_at"] = "2026-08-30T10:00:00+00:00"
        data["audit"]["finished_at"] = "2026-08-30T09:00:00+00:00"
        self.assertTrue(any("must not be earlier" in error for error in audit_ledger.validate(data)))
        data["audit"]["finished_at"] = "2026-08-30T11:00:00"
        self.assertTrue(any("timezone offset" in error for error in audit_ledger.validate(data)))

    def test_target_url_rejects_credentials_query_and_fragment(self) -> None:
        data = valid_ledger()
        data["audit"]["target_url"] = (
            "https://user:password@example.test/editor?token=secret&signature=abc#private"
        )
        errors = audit_ledger.validate(data)
        self.assertTrue(any("userinfo credentials" in error for error in errors))
        self.assertTrue(any("must not contain a query" in error for error in errors))
        self.assertTrue(any("must not contain a fragment" in error for error in errors))

    def test_coverage_requires_exact_label_and_every_required_state(self) -> None:
        data = valid_ledger()
        data["coverage"][0]["surface"] = "Wrong label"
        data["coverage"] = data["coverage"][:1]
        errors = audit_ledger.validate(data)
        self.assertTrue(any("must exactly match requested label" in error for error in errors))
        self.assertTrue(any("missing required state 'warm return'" in error for error in errors))

    def test_verified_finding_rejects_unverified_causality(self) -> None:
        data = valid_ledger()
        data["findings"][0]["causal_status"] = "unverified"
        errors = audit_ledger.validate(data)
        self.assertTrue(any("VERIFIED requires measured or source_fact" in error for error in errors))

    def test_finding_requires_exact_requested_surface_label(self) -> None:
        data = valid_ledger()
        data["findings"][0]["surface"] = "Wrong finding label"
        self.assertTrue(
            any("must exactly match requested label" in error for error in audit_ledger.validate(data))
        )

    def test_visual_only_negative_is_screen_observed(self) -> None:
        data = valid_ledger()
        negative = data["negative_findings"][0]
        negative.update(confidence="VERIFIED", causal_status="measured")
        negative["evidence"] = [
            {
                "signal": "no visible jitter",
                "value": "not seen",
                "unit": "visual observation",
                "conditions": "one screen recording",
                "source": "visual",
            }
        ]
        errors = audit_ledger.validate(data)
        self.assertTrue(any("VERIFIED requires machine-readable" in error for error in errors))
        negative.update(confidence="SCREEN_OBSERVED", causal_status="correlated")
        self.assertEqual(audit_ledger.validate(data), [])

    def test_unsafe_browser_privacy_cannot_proceed(self) -> None:
        data = valid_ledger()
        data["audit"]["privacy"].update(
            content_trust="untrusted",
            sensitive_data="present",
            browser_profile="shared",
            performance_crux="enabled",
            usage_statistics="enabled",
            network_headers="enabled",
        )
        errors = audit_ledger.validate(data)
        self.assertTrue(any("isolated browser profile" in error for error in errors))
        self.assertTrue(any("redacted network headers" in error for error in errors))

    def test_blocked_browser_risk_allows_only_blocked_coverage(self) -> None:
        data = valid_ledger()
        data["audit"]["privacy"].update(
            content_trust="untrusted",
            sensitive_data="present",
            browser_profile="shared",
            performance_crux="enabled",
            usage_statistics="enabled",
            network_headers="enabled",
            risk_decision="blocked",
        )
        errors = audit_ledger.validate(data)
        self.assertTrue(any("cannot contain product findings" in error for error in errors))
        self.assertTrue(any("all coverage rows" in error for error in errors))
        data["findings"] = []
        data["negative_findings"] = []
        for item in data["coverage"]:
            item.update(status="blocked", evidence=[], notes="Browser risk preflight blocked access")
        self.assertEqual(audit_ledger.validate(data), [])
        report = audit_ledger.render(data)
        self.assertIn("Audit blocked by privacy preflight", report)
        self.assertNotIn("No actionable product finding was verified", report)

    def test_blocked_risk_applies_even_without_browser_tooling(self) -> None:
        data = valid_ledger()
        data["audit"]["privacy"].update(
            browser_tooling_used=False,
            browser_access_authorized=False,
            risk_decision="blocked",
        )
        errors = audit_ledger.validate(data)
        self.assertTrue(any("cannot contain product findings" in error for error in errors))
        self.assertTrue(any("all coverage rows" in error for error in errors))

    def test_render_command_refuses_invalid_ledger(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            ledger_path = Path(directory) / "ledger.json"
            ledger_path.write_text("{}", encoding="utf-8")
            args = type("Args", (), {"path": str(ledger_path), "output": None})()
            with redirect_stderr(io.StringIO()):
                self.assertEqual(audit_ledger.command_render(args), 1)


if __name__ == "__main__":
    unittest.main()
