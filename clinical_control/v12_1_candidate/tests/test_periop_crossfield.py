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


def expect_pass(name, record):
    result = guard.validate_analysis_record(record)
    check(name, result["pass"], result)


def expect_fail(name, record, needle):
    result = guard.validate_analysis_record(record)
    check(name, (not result["pass"]) and any(needle in e for e in result["errors"]), result)
record = base_record()
record["perioperative_lens"] = {
    "anesthesia_relevance": ["The ECG phenotype may be relevant to perioperative monitoring discussion."],
    "context_needed": ["Verify symptoms and hemodynamics."],
}
expect_pass("bounded_relevance_with_context_needed", record)

record = base_record()
record["perioperative_lens"] = {
    "anesthesia_relevance": ["The ECG phenotype may be relevant to perioperative planning."]
}
expect_fail("relevance_without_context_fails_closed", record, "must name context_needed")

record = base_record()
record["input"]["clinical_context_provided"] = True
record["perioperative_lens"] = {
    "anesthesia_relevance": ["The ECG phenotype may be relevant to perioperative planning."]
}
expect_pass("supplied_context_can_support_bounded_relevance", record)
record = base_record()
record["input"]["clinical_context_provided"] = True
record["interpretation"]["contradiction_summary"] = ["Current evidence conflicts with another source."]
record["perioperative_lens"] = {
    "anesthesia_relevance": ["The ECG phenotype may affect perioperative discussion."]
}
expect_fail("contradiction_requires_context_or_verification", record, "contradictions require")

record["perioperative_lens"]["context_needed"] = ["Resolve the conflicting evidence before stronger conclusions."]
expect_pass("contradiction_with_context_needed_is_bounded", record)

record = base_record()
record["perioperative_lens"] = {
    "anesthesia_relevance": ["This is a new ECG change."],
    "context_needed": ["Compare with a verified prior ECG."],
}
expect_fail("new_change_requires_verified_serial_pair", record, "serial-change")

record["input"]["serial_comparison"] = True
expect_pass("new_change_allowed_when_serial_comparison_verified", record)
record = base_record()
record["input"]["clinical_context_provided"] = True
record["perioperative_lens"] = {
    "anesthesia_relevance": ["History of a prior diagnosis confirms the current ECG finding."],
    "context_needed": ["Review the current tracing independently."],
}
expect_fail("history_cannot_establish_current_tracing", record, "historical diagnosis")

record = base_record()
record["technical_quality"]["grade"] = "cannot_interpret"
record["technical_quality"]["calibration_source"] = "unknown"
record["limitations"] = ["Tracing cannot be interpreted reliably."]
record["perioperative_lens"] = {
    "context_needed": ["The ECG cannot answer perioperative relevance; verify clinical context."]
}
expect_pass("cannot_interpret_allows_context_only_overlay", record)

record = base_record()
record["technical_quality"]["calibration_source"] = "unknown"
record["perioperative_lens"] = {
    "anesthesia_relevance": ["QT is 480 ms; verify formula and context."],
    "context_needed": ["Obtain trustworthy calibration."],
}
expect_fail("record_blocks_exact_measurement_without_calibration", record, "exact ECG measurement")
record = base_record()
record["perioperative_lens"] = {
    "context_needed": ["Verify clinical context."],
    "clearance": ["proceed"],
}
expect_fail("record_blocks_undeclared_clearance_field", record, "undeclared perioperative_lens fields")

if failed:
    print(json.dumps({
        "schema": "ekg-v12-1-l05-periop-crossfield-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    }, sort_keys=True))
    raise SystemExit(1)

print(json.dumps({
    "schema": "ekg-v12-1-l05-periop-crossfield-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
}, sort_keys=True))
