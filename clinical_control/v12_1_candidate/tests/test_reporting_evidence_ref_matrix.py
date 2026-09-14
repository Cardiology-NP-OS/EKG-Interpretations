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
        "measurements": [],
        "measurement_evidence": [],
        "lead_observations": [{
            "lead": "II",
            "observations": ["visible observation"],
            "observation_id": "obs1",
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

def measurement_evidence(mode):
    if mode == "none":
        return []
    if mode == "unique":
        return [{"measurement_id": "m1"}]
    if mode == "duplicate":
        return [{"measurement_id": "m1"}, {"measurement_id": "m1"}]
    raise AssertionError(mode)

def ref_value(mode):
    return {"null": None, "resolved": "m1", "dangling": "missing"}[mode]

matrix_failures = []
matrix_cases = 0
for evidence_mode, lead_ref_mode, measurement_ref_mode, observation_mode in itertools.product(
    ("none", "unique", "duplicate"),
    ("null", "resolved", "dangling"),
    ("null", "resolved", "dangling"),
    ("unique", "duplicate"),
):
    record = base_record()
    record["measurement_evidence"] = measurement_evidence(evidence_mode)
    record["lead_observations"][0]["measurement_evidence_ref"] = ref_value(lead_ref_mode)
    if observation_mode == "duplicate":
        record["lead_observations"].append({
            "lead": "V1",
            "observations": ["second observation"],
            "observation_id": "obs1",
            "measurement_evidence_ref": None,
        })
    measurement_ref = ref_value(measurement_ref_mode)
    if measurement_ref is not None:
        record["measurements"] = [{"name": "qrs", "measurement_evidence_ref": measurement_ref}]

    expected = set()
    if evidence_mode == "duplicate":
        expected.add("duplicate_measurement_evidence_id")
    if observation_mode == "duplicate":
        expected.add("duplicate_observation_id")
    available = {"m1"} if evidence_mode in {"unique", "duplicate"} else set()
    refs = [r for r in (ref_value(lead_ref_mode), measurement_ref) if r]
    if any(ref not in available for ref in refs):
        expected.add("dangling_measurement_evidence_ref")

    integrity = set(validator.evidence_reference_violations(record))
    matrix_cases += 1
    if integrity != expected:
        matrix_failures.append({
            "case": [evidence_mode, lead_ref_mode, measurement_ref_mode, observation_mode],
            "expected": sorted(expected),
            "got": sorted(integrity),
        })

check(
    "evidence_reference_matrix_54_cases",
    matrix_cases == 54 and not matrix_failures,
    matrix_failures[:8],
)

# Deterministic repeatability: the same record must return byte-for-byte-equivalent ordering.
probe = base_record()
probe["measurement_evidence"] = [{"measurement_id": "m1"}, {"measurement_id": "m1"}]
probe["lead_observations"][0]["measurement_evidence_ref"] = "missing"
first = validator.evidence_reference_violations(probe)
repeatable = all(validator.evidence_reference_violations(probe) == first for _ in range(100))
check("evidence_reference_results_repeatable_100_runs", repeatable, first)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-evidence-ref-matrix-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "matrix_cases": matrix_cases,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-evidence-ref-matrix-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "matrix_cases": matrix_cases,
    "candidate_active": False,
})