import importlib.util
import itertools
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "validation_generated" / "reporting_boundary_validator.py"
spec = importlib.util.spec_from_file_location("reporting_boundary_validator", TOOL)
validator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validator)

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
        "urgency": {"uncertainty": "Uncertainty retained.", "reason": ""},
        "lead_observations": [{"lead": "II", "observations": ["observation"]}],
        "st_t_assessment": {},
        "interpretation": {
            "primary_pattern": {
                "pattern_id": "unclassified",
                "label": "ECG phenotype",
                "confidence": "moderate",
                "evidence_for": ["visible observation"],
                "evidence_against": [],
            },
            "secondary_findings": [],
            "differential": [{
                "label": "context-dependent alternative",
                "why_it_fits": [],
                "why_it_may_not_fit": [],
                "discriminator": "clinical context",
            }],
            "contradiction_summary": ["No unresolved contradiction identified."],
        },
        "limitations": ["ECG alone does not establish a clinical diagnosis."],
        "verification": ["Manual review required."],
    }

def expected_matrix_violations(
    confidence,
    evidence_for,
    evidence_against,
    differential,
    contradiction,
    limitations,
    verification,
    uncertainty,
    indeterminate,
):
    expected = set()
    if not evidence_for:
        expected.add("missing_evidence")
    if not differential:
        expected.add("missing_differential")
    if not contradiction:
        expected.add("missing_contradiction_summary")
    if not limitations:
        expected.add("missing_limitations")
    if not verification:
        expected.add("missing_verification")
    if not uncertainty:
        expected.add("missing_uncertainty")
    if confidence == "high" and evidence_against:
        expected.add("hidden_contradiction_high_confidence")
    if confidence == "high" and indeterminate:
        expected.add("indeterminate_evidence_with_high_certainty")
    return expected

matrix_cases = 0
matrix_failures = []
for values in itertools.product(
    ("high", "moderate", "low"),
    (False, True),
    (False, True),
    (False, True),
    (False, True),
    (False, True),
    (False, True),
    (False, True),
    (False, True),
):
    (
        confidence,
        evidence_for,
        evidence_against,
        differential,
        contradiction,
        limitations,
        verification,
        uncertainty,
        indeterminate,
    ) = values
    record = base_record()
    primary = record["interpretation"]["primary_pattern"]
    primary["confidence"] = confidence
    primary["evidence_for"] = ["visible observation"] if evidence_for else []
    primary["evidence_against"] = ["counterevidence"] if evidence_against else []
    record["interpretation"]["differential"] = (
        base_record()["interpretation"]["differential"] if differential else []
    )
    record["interpretation"]["contradiction_summary"] = (
        ["Contradiction documented."] if contradiction else []
    )
    record["limitations"] = ["Limitation retained."] if limitations else []
    record["verification"] = ["Manual review required."] if verification else []
    record["urgency"]["uncertainty"] = "Uncertainty retained." if uncertainty else ""
    if indeterminate:
        record["st_t_assessment"]["ischemia_concern"] = "indeterminate"

    got = set(validator.validate_record(record))
    expected = expected_matrix_violations(*values)
    matrix_cases += 1
    if got != expected:
        matrix_failures.append({
            "case": values,
            "expected": sorted(expected),
            "got": sorted(got),
        })

check(
    "contradiction_matrix_768_cases",
    matrix_cases == 768 and not matrix_failures,
    matrix_failures[:5],
)

template = validator.template_schema_findings()
required_metadata = {
    "project version",
    "criteria snapshot",
    "source registry version",
    "analysis mode",
}
missing_by_template = template["missing_required_metadata_by_template"]
check(
    "templates_a_through_e_all_omit_structured_required_metadata",
    set(missing_by_template) == {"A", "B", "C", "D", "E"}
    and all(set(items) == required_metadata for items in missing_by_template.values()),
    missing_by_template,
)

probability_cases = [
    "87% likely",
    "87 % likely",
    "87% probability",
    "42.5% chance",
    "100% confidence",
]
for phrase in probability_cases:
    record = base_record()
    record["urgency"]["reason"] = phrase
    check(
        "fake_probability_rejected_" + phrase.replace(" ", "_"),
        "unsupported_numeric_diagnostic_probability" in validator.validate_record(record),
        validator.validate_record(record),
    )

probability_controls = [
    "high confidence observation",
    "pattern is compatible with phenotype",
    "cannot exclude context-dependent alternative",
]
for phrase in probability_controls:
    record = base_record()
    record["urgency"]["reason"] = phrase
    check(
        "non_numeric_calibrated_language_allowed_" + phrase.replace(" ", "_"),
        "unsupported_numeric_diagnostic_probability" not in validator.validate_record(record),
        validator.validate_record(record),
    )

secondary_diagnosis = base_record()
secondary_diagnosis["interpretation"]["secondary_findings"] = ["hyperkalemia"]
check(
    "secondary_diagnosis_promotion_detected",
    "secondary_finding_promoted_to_diagnosis"
    in validator.validate_record(secondary_diagnosis),
    validator.validate_record(secondary_diagnosis),
)

differential_cause = base_record()
differential_cause["interpretation"]["differential"][0]["label"] = (
    "ECG phenotype due to medication"
)
check(
    "differential_cause_attribution_detected",
    "unsupported_cause_attribution" in validator.validate_record(differential_cause),
    validator.validate_record(differential_cause),
)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-matrix-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "matrix_cases": matrix_cases,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-matrix-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "matrix_cases": matrix_cases,
    "candidate_active": False,
})
