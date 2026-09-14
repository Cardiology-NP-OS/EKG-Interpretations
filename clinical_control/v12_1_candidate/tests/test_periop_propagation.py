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


def record():
    return {
        "input": {
            "clinical_context_provided": False,
            "serial_comparison": False,
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
        "perioperative_lens": None,
    }


def expect_pass(name, value):
    result = guard.validate_analysis_record(value)
    check(name, result["pass"], result)


def expect_fail(name, value, needle):
    result = guard.validate_analysis_record(value)
    check(name, (not result["pass"]) and any(needle in e for e in result["errors"]), result)
case = record()
case["perioperative_lens"] = {
    "anesthesia_relevance": ["The ECG confirms the diagnosis and changes perioperative planning."],
    "context_needed": ["Confirm the clinical diagnosis independently."],
}
expect_fail("reject_ecg_as_diagnostic_proof", case, "cannot use ECG as proof")

case = record()
case["perioperative_lens"] = {
    "anesthesia_relevance": ["The ECG establishes the etiology of the abnormality."],
    "context_needed": ["Clinical correlation is required."],
}
expect_fail("reject_ecg_as_etiologic_proof", case, "cannot use ECG as proof")

case = record()
case["technical_quality"]["grade"] = "limited"
case["perioperative_lens"] = {
    "anesthesia_relevance": ["Interpretation is limited; perioperative relevance remains uncertain."],
    "context_needed": ["Verify the finding on a higher-quality tracing."],
}
expect_fail("limited_quality_requires_top_level_limitation", case, "requires explicit top-level limitations")
case["limitations"] = ["Source quality limits confidence in ECG-derived conclusions."]
expect_pass("limited_quality_with_limitation_is_bounded", case)

case = record()
case["technical_quality"]["grade"] = "poor"
case["perioperative_lens"] = {
    "context_needed": ["Obtain a more reliable tracing before ECG-dependent conclusions."]
}
expect_fail("poor_quality_requires_top_level_limitation", case, "requires explicit top-level limitations")

case["limitations"] = ["Poor technical quality limits interpretation."]
expect_pass("poor_quality_with_limitation_is_bounded", case)

case = record()
case["technical_quality"]["grade"] = "cannot_interpret"
case["technical_quality"]["calibration_source"] = "unknown"
case["perioperative_lens"] = {
    "context_needed": ["The ECG cannot establish perioperative relevance; obtain adequate source data."]
}
expect_fail("cannot_interpret_requires_top_level_limitation", case, "requires explicit top-level limitations")
case["limitations"] = ["Tracing cannot be interpreted reliably."]
expect_pass("cannot_interpret_with_limitation_context_only_is_bounded", case)

case = record()
case["perioperative_lens"] = {
    "anesthesia_relevance": ["This phenotype may be relevant to perioperative discussion."],
    "context_needed": ["Verify hemodynamics and prior ECG."],
}
case["verification"] = []
expect_fail("context_needed_requires_verification_propagation", case, "must propagate to top-level verification")

case["verification"] = ["Verify hemodynamics and compare with a reliable prior ECG when available."]
expect_pass("context_needed_with_verification_is_bounded", case)

if failed:
    print(json.dumps({
        "schema": "ekg-v12-1-l05-periop-propagation-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    }, sort_keys=True))
    raise SystemExit(1)
print(json.dumps({
    "schema": "ekg-v12-1-l05-periop-propagation-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
}, sort_keys=True))
