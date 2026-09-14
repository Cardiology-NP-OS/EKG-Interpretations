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

regional_ids = validator.registry_boundary_findings()["regional_supporting_lead_ids"]
regional_id = regional_ids[0]

def base_record():
    return {
        "urgency": {
            "uncertainty": "Uncertainty retained.",
            "reason": "",
            "recommended_verification": ["Manual review required."],
        },
        "lead_observations": [{"lead": "II", "observations": ["visible observation"]}],
        "st_t_assessment": {},
        "interpretation": {
            "primary_pattern": {
                "pattern_id": regional_id,
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

attacks = {
    "F03": ("This is Brugada syndrome.", "unsupported_clinical_diagnosis_declaration"),
    "F20": ("This is cardiac tamponade.", "unsupported_clinical_diagnosis_declaration"),
    "F21": ("This is pulmonary embolism.", "unsupported_clinical_diagnosis_declaration"),
    "F23": ("This is acute pericarditis.", "unsupported_clinical_diagnosis_declaration"),
    "F28": ("The patient is safe.", "reporting_language_too_strong"),
}

matrix_failures = []
matrix_cases = 0
for failure_id, (phrase, attack_violation) in attacks.items():
    for flags in itertools.product((False, True), repeat=9):
        (
            missing_evidence,
            hidden_contradiction,
            missing_differential,
            missing_limitations,
            missing_leads,
            missing_uncertainty,
            missing_contradiction_summary,
            missing_verification,
            indeterminate_high_certainty,
        ) = flags
        record = base_record()
        record["urgency"]["reason"] = phrase
        expected = {attack_violation}
        if missing_evidence:
            record["interpretation"]["primary_pattern"]["evidence_for"] = []
            expected.add("missing_evidence")
        if hidden_contradiction:
            record["interpretation"]["primary_pattern"]["confidence"] = "high"
            record["interpretation"]["primary_pattern"]["evidence_against"] = ["strong mimic"]
            expected.add("hidden_contradiction_high_confidence")
        if missing_differential:
            record["interpretation"]["differential"] = []
            expected.add("missing_differential")
        if missing_limitations:
            record["limitations"] = []
            expected.add("missing_limitations")
        if missing_leads:
            record["lead_observations"] = []
            expected.add("missing_supporting_leads")
        if missing_uncertainty:
            record["urgency"]["uncertainty"] = ""
            expected.add("missing_uncertainty")
        if missing_contradiction_summary:
            record["interpretation"]["contradiction_summary"] = []
            expected.add("missing_contradiction_summary")
        if missing_verification:
            record["verification"] = []
            expected.add("missing_verification")
        if indeterminate_high_certainty:
            record["st_t_assessment"]["ischemia_concern"] = "indeterminate"
            record["interpretation"]["primary_pattern"]["confidence"] = "high"
            expected.add("indeterminate_evidence_with_high_certainty")
            if record["interpretation"]["primary_pattern"]["evidence_against"]:
                expected.add("hidden_contradiction_high_confidence")

        got = set(validator.validate_record(record))
        matrix_cases += 1
        if not expected <= got:
            matrix_failures.append({
                "failure_id": failure_id,
                "flags": {
                    "missing_evidence": missing_evidence,
                    "hidden_contradiction": hidden_contradiction,
                    "missing_differential": missing_differential,
                    "missing_limitations": missing_limitations,
                    "missing_leads": missing_leads,
                    "missing_uncertainty": missing_uncertainty,
                    "missing_contradiction_summary": missing_contradiction_summary,
                    "missing_verification": missing_verification,
                    "indeterminate_high_certainty": indeterminate_high_certainty,
                },
                "expected": sorted(expected),
                "got": sorted(got),
            })

check(
    "mixed_boundary_matrix_2560_cases",
    matrix_cases == 2560 and not matrix_failures,
    matrix_failures[:10],
)

repeat_record = base_record()
repeat_record["urgency"]["reason"] = "This is cardiac tamponade."
repeat_record["interpretation"]["primary_pattern"]["confidence"] = "high"
repeat_record["interpretation"]["primary_pattern"]["evidence_against"] = ["strong mimic"]
repeat_record["st_t_assessment"]["ischemia_concern"] = "indeterminate"
repeat_record["verification"] = []
baseline = validator.validate_record(repeat_record)
repeat_failures = []
for index in range(100):
    got = validator.validate_record(repeat_record)
    if got != baseline:
        repeat_failures.append((index, baseline, got))
check("mixed_boundary_repeatability_100_runs", not repeat_failures, repeat_failures[:3])

if failed:
    print({
        "schema": "ekg-v12-1-reporting-mixed-boundary-matrix-v2",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "matrix_cases": matrix_cases,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-mixed-boundary-matrix-v2",
    "pass": True,
    "passed": passed,
    "total": passed,
    "matrix_cases": matrix_cases,
    "repeat_runs": 100,
    "candidate_active": False,
})
