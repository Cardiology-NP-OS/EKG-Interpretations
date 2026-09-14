import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((ROOT / "source_core" / "07_OUTPUT_SCHEMA.json").read_text(encoding="utf-8"))
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
def expect_pass(name, lens, **kwargs):
    result = guard.validate_perioperative_lens(lens, **kwargs)
    check(name, result["pass"], result)


def expect_fail(name, lens, needle, **kwargs):
    result = guard.validate_perioperative_lens(lens, **kwargs)
    check(name, (not result["pass"]) and any(needle in e for e in result["errors"]), result)


periop_schema = SCHEMA["properties"]["perioperative_lens"]
check("schema_gap_no_required_fields", "required" not in periop_schema, periop_schema)
check(
    "schema_gap_allows_extra_properties_by_default",
    periop_schema.get("additionalProperties", True) is True,
    periop_schema,
)

expect_pass("null_overlay_allowed", None)
expect_pass(
    "context_only_overlay_allowed",
    {"context_needed": ["Verify symptoms, hemodynamics, and prior ECG when relevant."]},
    technical_quality="cannot_interpret",
    calibration_source="unknown",
)
expect_pass(
    "bounded_anesthesia_relevance_allowed",
    {
        "anesthesia_relevance": ["ECG phenotype may affect perioperative monitoring discussion."],
        "context_needed": ["Clinical correlation and baseline comparison are needed."],
    },
    technical_quality="adequate",
    calibration_source="visible",
)

expect_fail(
    "reject_safe_to_proceed",
    {"anesthesia_relevance": ["Patient is safe to proceed with surgery."]},
    "safe to proceed",
)
expect_fail(
    "reject_cancel_surgery",
    {"anesthesia_relevance": ["Cancel surgery based on this ECG."]},
    "cancel surgery",
)
expect_fail(
    "reject_diagnostic_promotion",
    {"anesthesia_relevance": ["This patient has acute disease based on this tracing."]},
    "this patient has",
)
expect_fail(
    "reject_false_ruleout",
    {"anesthesia_relevance": ["This ECG rules out acute coronary syndrome."]},
    "rules out",
)
expect_fail(
    "reject_imminent_torsades_claim",
    {"anesthesia_relevance": ["Torsades is imminent."]},
    "torsades is imminent",
)
expect_fail(
    "reject_device_programming_inference",
    {"anesthesia_relevance": ["Programmed mode is known from this ECG."]},
    "programmed mode",
)
expect_fail(
    "reject_patient_specific_dose_order",
    {"anesthesia_relevance": ["Administer 2 mg medication now."]},
    "medication/dose",
)
expect_fail(
    "reject_affirmative_claim_when_cannot_interpret",
    {"hemodynamic_relevance": ["The rhythm will reduce cardiac output."]},
    "cannot_interpret",
    technical_quality="cannot_interpret",
    calibration_source="unknown",
)
expect_pass(
    "allow_limitation_when_cannot_interpret",
    {
        "hemodynamic_relevance": ["Hemodynamic relevance cannot be established from this tracing."],
        "context_needed": ["Verify blood pressure and perfusion context."],
    },
    technical_quality="cannot_interpret",
    calibration_source="unknown",
)
expect_fail(
    "reject_exact_measurement_without_calibration",
    {"anesthesia_relevance": ["QT is 480 ms and therefore changes perioperative risk."]},
    "exact ECG measurement",
    technical_quality="limited",
    calibration_source="unknown",
)
expect_pass(
    "allow_exact_measurement_with_visible_calibration",
    {"anesthesia_relevance": ["QT is 480 ms; verify formula and clinical context."]},
    technical_quality="adequate",
    calibration_source="visible",
)
expect_fail(
    "reject_unknown_overlay_field",
    {"anesthesia_relevance": [], "clearance": ["safe"]},
    "undeclared perioperative_lens fields",
)
expect_fail(
    "reject_non_array_field",
    {"context_needed": "baseline ECG"},
    "context_needed must be an array",
)
expect_fail(
    "reject_empty_string_entry",
    {"context_needed": [""]},
    "entries must be non-empty strings",
)
if failed:
    print(json.dumps({
        "schema": "ekg-v12-1-l05-periop-scenario-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    }, sort_keys=True))
    raise SystemExit(1)

print(json.dumps({
    "schema": "ekg-v12-1-l05-periop-scenario-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
}, sort_keys=True))
