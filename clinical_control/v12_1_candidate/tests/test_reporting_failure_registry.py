import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "source_core"
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
                "why_it_fits": [],
                "why_it_may_not_fit": [],
                "discriminator": "clinical context",
            }],
            "contradiction_summary": ["No unresolved contradiction identified."],
        },
        "limitations": ["ECG alone does not establish a clinical diagnosis."],
        "verification": ["Manual review required."],
    }

registry = json.loads((CORE / "36_FAILURE_MODE_REGISTRY.json").read_text(encoding="utf-8"))
by_id = {item["id"]: item for item in registry["failure_modes"]}
required = {
    "F04": "MI overcall",
    "F05": "ACS false reassurance",
    "F15": "Fake diagnostic probability",
    "F30": "Hidden contradiction",
}
check(
    "required_reporting_failure_contracts_present",
    all(by_id.get(fid, {}).get("name") == name for fid, name in required.items()),
    {fid: by_id.get(fid) for fid in required},
)

f04_label = base_record()
f04_label["interpretation"]["primary_pattern"]["label"] = "acute MI"
check(
    "f04_diagnosis_label_overcall_detected",
    "phenotype_promoted_to_diagnosis" in validator.validate_record(f04_label),
    validator.validate_record(f04_label),
)

f04_literal = base_record()
f04_literal["urgency"]["reason"] = "This is an MI."
check(
    "f04_literal_this_is_an_mi_detected",
    "unsupported_mi_declaration" in validator.validate_record(f04_literal),
    validator.validate_record(f04_literal),
)

f05 = base_record()
f05["urgency"]["reason"] = "A normal ECG rules out disease."
check(
    "f05_negative_ecg_false_reassurance_detected",
    "negative_ecg_exclusion" in validator.validate_record(f05),
    validator.validate_record(f05),
)

f15 = base_record()
f15["urgency"]["reason"] = "87% likely"
check(
    "f15_fake_probability_detected",
    "unsupported_numeric_diagnostic_probability" in validator.validate_record(f15),
    validator.validate_record(f15),
)

f30 = base_record()
f30["interpretation"]["primary_pattern"]["confidence"] = "high"
f30["interpretation"]["primary_pattern"]["evidence_against"] = ["strong mimic"]
check(
    "f30_hidden_contradiction_detected",
    "hidden_contradiction_high_confidence" in validator.validate_record(f30),
    validator.validate_record(f30),
)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-failure-registry-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-failure-registry-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
})
