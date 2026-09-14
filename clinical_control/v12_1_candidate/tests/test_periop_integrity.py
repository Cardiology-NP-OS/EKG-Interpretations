import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUARD_PATH = ROOT / "validation_generated" / "L05_PERIOP_OVERLAY_GUARD.py"

spec = importlib.util.spec_from_file_location("l05_periop_guard", GUARD_PATH)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

passed = 0
failed = []


def check(name, condition, detail=None):
    global passed
    if condition:
        passed += 1
        print("PASS", name)
    else:
        failed.append((name, detail))
        print("FAIL", name, detail)


def base_record():
    return {
        "input": {
            "clinical_context_provided": True,
            "serial_comparison": True,
        },
        "technical_quality": {
            "grade": "adequate",
            "calibration_source": "visible",
        },
        "interpretation": {
            "contradiction_summary": [],
        },
        "limitations": [],
        "verification": ["Review source ECG and supplied clinical context."],
        "acquisition_integrity": {
            "status": "consistent",
            "source_kind": "digital_signal",
            "findings": [],
        },
        "serial_binding": {
            "state": "same_family_verified",
            "comparison_scope": "patient_serial",
            "evidence_source": "source_metadata",
            "temporal_change_language_allowed": True,
            "reason": "verified",
        },
        "perioperative_lens": None,
    }


def expect_pass(name, value):
    result = guard.validate_analysis_record(value)
    check(name, result["pass"], result)


def expect_fail(name, value, needle):
    result = guard.validate_analysis_record(value)
    check(name, (not result["pass"]) and any(needle in e for e in result["errors"]), result)


case = base_record()
case["serial_binding"]["temporal_change_language_allowed"] = False
case["serial_binding"]["state"] = "identity_unknown"
case["serial_binding"]["comparison_scope"] = "not_allowed"
case["perioperative_lens"] = {
    "anesthesia_relevance": ["This is a new ECG change."],
    "context_needed": ["Verify prior/current identity before comparison."],
}
expect_fail("native_serial_binding_blocks_change_language", case, "verified serial comparison")

case["serial_binding"]["temporal_change_language_allowed"] = True
case["serial_binding"]["state"] = "same_family_verified"
case["serial_binding"]["comparison_scope"] = "patient_serial"
expect_pass("native_serial_binding_allows_verified_change_language", case)


case = base_record()
case["acquisition_integrity"]["status"] = "possible_inconsistency"
case["acquisition_integrity"]["findings"] = ["Source integrity concern requires correlation."]
case["perioperative_lens"] = {
    "anesthesia_relevance": ["The ECG phenotype may affect perioperative discussion."],
}
expect_fail("integrity_issue_requires_limitation", case, "requires explicit top-level limitations")
expect_fail("integrity_issue_requires_context_needed", case, "requires perioperative context_needed")

case["limitations"] = ["Acquisition integrity concern limits ECG-derived conclusions."]
case["perioperative_lens"]["context_needed"] = ["Resolve source-integrity concern before stronger conclusions."]
expect_pass("integrity_issue_with_limits_and_context_is_bounded", case)

case = base_record()
case["perioperative_lens"] = {
    "anesthesia_relevance": ["Surgical urgency overrides uncertainty and limitations."],
    "context_needed": ["Proceed despite uncertainty."],
}
expect_fail("reject_surgery_override_of_uncertainty", case, "cannot override uncertainty")

case = base_record()
case["perioperative_lens"] = {
    "anesthesia_relevance": ["Perioperative context bypasses source integrity restrictions."],
    "context_needed": ["Use the tracing anyway."],
}
expect_fail("reject_periop_override_of_source_integrity", case, "cannot override uncertainty")


if failed:
    print(json.dumps({
        "schema": "ekg-v12-1-l05-periop-integrity-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    }, sort_keys=True))
    raise SystemExit(1)

print(json.dumps({
    "schema": "ekg-v12-1-l05-periop-integrity-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
}, sort_keys=True))
