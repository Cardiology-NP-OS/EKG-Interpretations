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
                "why_it_fits": ["compatible observation"],
                "why_it_may_not_fit": ["context incomplete"],
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
    "F13": "Artifact-as-arrhythmia",
    "F18": "Rate from single RR in irregular rhythm",
}
check(
    "rhythm_measurement_failure_contracts_present",
    all(by_id.get(fid, {}).get("name") == name for fid, name in required.items()),
    {fid: by_id.get(fid) for fid in required},
)

def set_surface(record, surface, value):
    interp = record["interpretation"]
    primary = interp["primary_pattern"]
    differential = interp["differential"][0]
    if surface == "primary_label":
        primary["label"] = value
    elif surface == "primary_evidence_for":
        primary["evidence_for"] = [value]
    elif surface == "primary_evidence_against":
        primary["evidence_against"] = [value]
    elif surface == "secondary_findings":
        interp["secondary_findings"] = [value]
    elif surface == "differential_label":
        differential["label"] = value
    elif surface == "differential_why_it_fits":
        differential["why_it_fits"] = [value]
    elif surface == "differential_why_it_may_not_fit":
        differential["why_it_may_not_fit"] = [value]
    elif surface == "differential_discriminator":
        differential["discriminator"] = value
    elif surface == "contradiction_summary":
        interp["contradiction_summary"] = [value]
    elif surface == "urgency_reason":
        record["urgency"]["reason"] = value
    elif surface == "urgency_uncertainty":
        record["urgency"]["uncertainty"] = value
    elif surface == "urgency_recommended_verification":
        record["urgency"]["recommended_verification"] = [value]
    elif surface == "limitations":
        record["limitations"] = [value]
    elif surface == "verification":
        record["verification"] = [value]
    elif surface == "lead_observations":
        record["lead_observations"][0]["observations"] = [value]
    else:
        raise AssertionError(surface)

surfaces = (
    "primary_label", "primary_evidence_for", "primary_evidence_against",
    "secondary_findings", "differential_label", "differential_why_it_fits",
    "differential_why_it_may_not_fit", "differential_discriminator",
    "contradiction_summary", "urgency_reason", "urgency_uncertainty",
    "urgency_recommended_verification", "limitations", "verification",
    "lead_observations",
)

cases = [
    (
        "f13_irregularly_irregular_to_af",
        "Irregularly irregular rhythm is atrial fibrillation despite unresolved artifact.",
        "unsupported_arrhythmia_from_artifact_ambiguous_rhythm",
    ),
    (
        "f18_single_rr_average_rate",
        "Average rate is 96 bpm from a single RR interval in this irregular rhythm.",
        "unsupported_average_rate_from_single_rr",
    ),
]
case_failures = []
attack_cases = 0
for surface in surfaces:
    for name, phrase, expected in cases:
        record = base_record()
        set_surface(record, surface, phrase)
        got = set(validator.validate_record(record))
        attack_cases += 1
        if expected not in got:
            case_failures.append((surface, name, phrase, expected, sorted(got)))
check(
    "f13_f18_source_grounded_overcalls_detected_across_30_surface_cases",
    attack_cases == 30 and not case_failures,
    case_failures[:10],
)

controls = [
    (
        "Irregularly irregular rhythm; atrial fibrillation remains a consideration, "
        "but atrial activity and artifact require assessment."
    ),
    (
        "Rhythm is irregular; average rate requires a longer interval or beat count "
        "rather than a single RR interval."
    ),
]
forbidden = {
    "unsupported_arrhythmia_from_artifact_ambiguous_rhythm",
    "unsupported_average_rate_from_single_rr",
}
control_failures = []
for phrase in controls:
    record = base_record()
    record["urgency"]["reason"] = phrase
    got = set(validator.validate_record(record))
    unexpected = sorted(got & forbidden)
    if unexpected:
        control_failures.append((phrase, unexpected))
check("rhythm_measurement_controls_clean", not control_failures, control_failures)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-failure-registry-rhythm-measurement-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "attack_cases": attack_cases,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-failure-registry-rhythm-measurement-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "attack_cases": attack_cases,
    "candidate_active": False,
})
