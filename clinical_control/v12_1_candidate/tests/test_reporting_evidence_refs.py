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
        "measurements": [],
        "measurement_evidence": [],
        "lead_observations": [{
            "lead": "II",
            "observations": ["visible observation"],
            "observation_id": None,
            "measurement_evidence_ref": None,
        }],
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

optional = base_record()
check(
    "optional_absent_reference_ids_do_not_create_integrity_violation",
    not {
        "duplicate_observation_id",
        "duplicate_measurement_evidence_id",
        "dangling_measurement_evidence_ref",
    } & set(validator.validate_record(optional)),
    validator.validate_record(optional),
)

duplicate_observation = base_record()
duplicate_observation["lead_observations"] = [
    {"lead": "II", "observations": ["a"], "observation_id": "obs1"},
    {"lead": "V1", "observations": ["b"], "observation_id": "obs1"},
]
check(
    "duplicate_observation_ids_rejected",
    "duplicate_observation_id" in validator.validate_record(duplicate_observation),
    validator.validate_record(duplicate_observation),
)

duplicate_measurement = base_record()
duplicate_measurement["measurement_evidence"] = [
    {"measurement_id": "m1"},
    {"measurement_id": "m1"},
]
check(
    "duplicate_measurement_evidence_ids_rejected",
    "duplicate_measurement_evidence_id" in validator.validate_record(duplicate_measurement),
    validator.validate_record(duplicate_measurement),
)

dangling_lead_ref = base_record()
dangling_lead_ref["measurement_evidence"] = [{"measurement_id": "m1"}]
dangling_lead_ref["lead_observations"][0]["measurement_evidence_ref"] = "missing"
check(
    "dangling_lead_measurement_evidence_ref_rejected",
    "dangling_measurement_evidence_ref" in validator.validate_record(dangling_lead_ref),
    validator.validate_record(dangling_lead_ref),
)

dangling_measurement_ref = base_record()
dangling_measurement_ref["measurement_evidence"] = [{"measurement_id": "m1"}]
dangling_measurement_ref["measurements"] = [{
    "name": "qrs",
    "measurement_evidence_ref": "missing",
}]
check(
    "dangling_measurement_measurement_evidence_ref_rejected",
    "dangling_measurement_evidence_ref" in validator.validate_record(dangling_measurement_ref),
    validator.validate_record(dangling_measurement_ref),
)

resolved = base_record()
resolved["measurement_evidence"] = [{"measurement_id": "m1"}]
resolved["lead_observations"][0]["observation_id"] = "obs1"
resolved["lead_observations"][0]["measurement_evidence_ref"] = "m1"
resolved["measurements"] = [{"name": "qrs", "measurement_evidence_ref": "m1"}]
violations = set(validator.validate_record(resolved))
check(
    "unique_resolved_evidence_references_are_accepted",
    not {
        "duplicate_observation_id",
        "duplicate_measurement_evidence_id",
        "dangling_measurement_evidence_ref",
    } & violations,
    sorted(violations),
)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-evidence-ref-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-evidence-ref-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
})
