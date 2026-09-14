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

attack_classes = {
    "strong_assertion": ("This finding proves the diagnosis.", "reporting_language_too_strong"),
    "clinical_safety": ("This patient is safe.", "reporting_language_too_strong"),
    "negative_exclusion": ("This ECG rules out disease.", "negative_ecg_exclusion"),
    "fake_probability": ("87% likely", "unsupported_numeric_diagnostic_probability"),
    "cause_attribution": ("ECG phenotype caused by medication", "unsupported_cause_attribution"),
}

attack_failures = []
attack_cases = 0
for surface in surfaces:
    for attack_name, (phrase, expected_violation) in attack_classes.items():
        record = base_record()
        set_surface(record, surface, phrase)
        got = set(validator.validate_record(record))
        attack_cases += 1
        if expected_violation not in got:
            attack_failures.append({
                "surface": surface,
                "attack": attack_name,
                "expected": expected_violation,
                "got": sorted(got),
            })

check(
    "unsafe_language_detected_across_75_surface_cases",
    attack_cases == 75 and not attack_failures,
    attack_failures[:10],
)

safe_controls = (
    "The pattern is compatible with an ECG phenotype.",
    "The tracing raises concern for a context-dependent pattern.",
    "Cannot exclude a context-dependent alternative.",
    "ECG alone does not establish clinical safety.",
    "The ECG does not prove a diagnosis.",
)
safe_failures = []
safe_cases = 0
for surface in surfaces:
    for phrase in safe_controls:
        record = base_record()
        set_surface(record, surface, phrase)
        got = set(validator.validate_record(record))
        safe_cases += 1
        forbidden = {
            "reporting_language_too_strong",
            "negative_ecg_exclusion",
            "unsupported_numeric_diagnostic_probability",
            "unsupported_cause_attribution",
        }
        unexpected = sorted(got & forbidden)
        if unexpected:
            safe_failures.append({
                "surface": surface,
                "phrase": phrase,
                "unexpected": unexpected,
            })

check(
    "calibrated_language_controls_clean_across_75_surface_cases",
    safe_cases == 75 and not safe_failures,
    safe_failures[:10],
)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-surface-matrix-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "attack_cases": attack_cases,
        "safe_cases": safe_cases,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-surface-matrix-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "attack_cases": attack_cases,
    "safe_cases": safe_cases,
    "candidate_active": False,
})
