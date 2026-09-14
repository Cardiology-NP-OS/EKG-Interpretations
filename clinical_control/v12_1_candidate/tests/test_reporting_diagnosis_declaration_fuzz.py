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
        "urgency": {
            "uncertainty": "Uncertainty retained.",
            "reason": "",
            "recommended_verification": ["Manual review required."],
        },
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
                "why_it_fits": [],
                "why_it_may_not_fit": [],
                "discriminator": "clinical context",
            }],
            "contradiction_summary": ["No unresolved contradiction identified."],
        },
        "limitations": ["ECG alone does not establish a clinical diagnosis."],
        "verification": ["Manual review required."],
    }

attack_failures = []
attack_cases = 0
for term in validator.DIAGNOSIS_LABEL_TERMS:
    variants = [
        f"This is {term}.",
        f"THIS:IS:{term.upper()}.",
        f"this-is-{term}.",
        f"Diagnosis:is:{term}.",
        f"The-patient-has-{term}.",
    ]
    for phrase in variants:
        record = base_record()
        record["urgency"]["reason"] = phrase
        got = set(validator.validate_record(record))
        attack_cases += 1
        if "unsupported_clinical_diagnosis_declaration" not in got:
            attack_failures.append((term, phrase, sorted(got)))

check(
    "all_diagnosis_terms_rejected_across_case_separator_variants",
    attack_cases == len(validator.DIAGNOSIS_LABEL_TERMS) * 5 and not attack_failures,
    attack_failures[:10],
)

control_failures = []
control_cases = 0
for term in validator.DIAGNOSIS_LABEL_TERMS:
    controls = [
        f"Cannot establish {term} from ECG alone.",
        f"Clinical context is required before diagnosing {term}.",
    ]
    for phrase in controls:
        record = base_record()
        record["urgency"]["reason"] = phrase
        got = set(validator.validate_record(record))
        control_cases += 1
        if "unsupported_clinical_diagnosis_declaration" in got:
            control_failures.append((term, phrase, sorted(got)))

check(
    "calibrated_diagnosis_controls_remain_clean",
    control_cases == len(validator.DIAGNOSIS_LABEL_TERMS) * 2 and not control_failures,
    control_failures[:10],
)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-diagnosis-declaration-fuzz-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "attack_cases": attack_cases,
        "control_cases": control_cases,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-diagnosis-declaration-fuzz-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "attack_cases": attack_cases,
    "control_cases": control_cases,
    "candidate_active": False,
})
