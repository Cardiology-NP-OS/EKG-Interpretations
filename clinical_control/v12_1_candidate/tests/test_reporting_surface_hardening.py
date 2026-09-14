import importlib.util
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
        "lead_observations": [{"lead": "II", "observations": ["visible observation"]}],
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
                "why_it_fits": ["compatible observation"],
                "why_it_may_not_fit": ["context incomplete"],
                "discriminator": "clinical context",
            }],
            "contradiction_summary": ["No unresolved contradiction identified."],
        },
        "limitations": ["ECG alone does not establish a clinical diagnosis."],
        "verification": ["Manual review required."],
    }

recommended_safety = base_record()
recommended_safety["urgency"]["reason"] = (
    "No time-critical ECG feature is identified on this tracing; "
    "ECG alone does not establish clinical safety."
)
check(
    "recommended_clinical_safety_language_not_false_positive",
    "reporting_language_too_strong" not in validator.validate_record(recommended_safety),
    validator.validate_record(recommended_safety),
)

contradiction_surface = base_record()
contradiction_surface["interpretation"]["contradiction_summary"] = [
    "This patient has a definitive diagnosis."
]
check(
    "strong_language_in_contradiction_summary_detected",
    "reporting_language_too_strong" in validator.validate_record(contradiction_surface),
    validator.validate_record(contradiction_surface),
)

differential_surface = base_record()
differential_surface["interpretation"]["differential"][0]["why_it_fits"] = [
    "finding caused by medication"
]
check(
    "causal_attribution_in_differential_rationale_detected",
    "unsupported_cause_attribution" in validator.validate_record(differential_surface),
    validator.validate_record(differential_surface),
)

evidence_surface = base_record()
evidence_surface["interpretation"]["primary_pattern"]["evidence_for"] = ["87% likely"]
check(
    "fake_probability_in_primary_evidence_detected",
    "unsupported_numeric_diagnostic_probability" in validator.validate_record(evidence_surface),
    validator.validate_record(evidence_surface),
)

negative_surface = base_record()
negative_surface["interpretation"]["differential"][0]["discriminator"] = (
    "A negative ECG rules out disease"
)
check(
    "negative_exclusion_in_differential_discriminator_detected",
    "negative_ecg_exclusion" in validator.validate_record(negative_surface),
    validator.validate_record(negative_surface),
)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-surface-hardening-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-surface-hardening-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
})
