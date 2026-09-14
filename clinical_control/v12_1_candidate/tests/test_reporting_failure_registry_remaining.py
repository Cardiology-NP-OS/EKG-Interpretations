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

registry = json.loads((CORE / "36_FAILURE_MODE_REGISTRY.json").read_text(encoding="utf-8"))
by_id = {item["id"]: item for item in registry["failure_modes"]}
required = {
    "F03": "Pattern-to-syndrome leap",
    "F20": "Electrical alternans equals tamponade",
    "F21": "Right-heart strain equals PE",
    "F23": "Pericarditis ECG equals clinical pericarditis",
    "F28": "Routine equals safe",
}
check(
    "remaining_reporting_failure_contracts_present",
    all(by_id.get(fid, {}).get("name") == name for fid, name in required.items()),
    {fid: by_id.get(fid) for fid in required},
)

attack_classes = {
    "F03": ("This is Brugada syndrome.", "unsupported_clinical_diagnosis_declaration"),
    "F20": ("This is cardiac tamponade.", "unsupported_clinical_diagnosis_declaration"),
    "F21": ("This is pulmonary embolism.", "unsupported_clinical_diagnosis_declaration"),
    "F23": ("This is acute pericarditis.", "unsupported_clinical_diagnosis_declaration"),
    "F28": ("The patient is safe.", "reporting_language_too_strong"),
}
attack_failures = []
attack_cases = 0
for surface in surfaces:
    for failure_id, (phrase, expected) in attack_classes.items():
        record = base_record()
        set_surface(record, surface, phrase)
        got = set(validator.validate_record(record))
        attack_cases += 1
        if expected not in got:
            attack_failures.append({
                "surface": surface,
                "failure_id": failure_id,
                "expected": expected,
                "got": sorted(got),
            })
check(
    "remaining_failure_modes_detected_across_75_surface_cases",
    attack_cases == 75 and not attack_failures,
    attack_failures[:12],
)

safe_controls = [
    "A Brugada ECG pattern requires clinical context before syndrome diagnosis.",
    "Electrical alternans is descriptive; hemodynamic and echo correlation are required.",
    "ECG right-heart strain requires clinical and imaging evaluation.",
    "A pericarditis-like ECG pattern requires clinical criteria.",
    "No time-critical ECG feature is identified; ECG alone does not establish clinical safety.",
]
safe_failures = []
for phrase in safe_controls:
    record = base_record()
    record["urgency"]["reason"] = phrase
    got = set(validator.validate_record(record))
    unexpected = sorted(got & {
        "unsupported_clinical_diagnosis_declaration",
        "reporting_language_too_strong",
    })
    if unexpected:
        safe_failures.append((phrase, unexpected))
check("remaining_failure_mode_controls_clean", not safe_failures, safe_failures)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-failure-registry-remaining-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "attack_cases": attack_cases,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-failure-registry-remaining-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "attack_cases": attack_cases,
    "candidate_active": False,
})
