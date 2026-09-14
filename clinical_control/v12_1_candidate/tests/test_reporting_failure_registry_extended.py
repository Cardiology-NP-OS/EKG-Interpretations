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

def with_reason(text):
    record = base_record()
    record["urgency"]["reason"] = text
    return set(validator.validate_record(record))

registry = json.loads((CORE / "36_FAILURE_MODE_REGISTRY.json").read_text(encoding="utf-8"))
by_id = {item["id"]: item for item in registry["failure_modes"]}
required = {
    "F08": "WCT mechanism overconfidence",
    "F12": "Pacing overreach",
    "F16": "Culprit artery overlocalization",
    "F19": "Low voltage etiology overcall",
    "F22": "LVH voltage equals anatomy",
    "F24": "Hyperkalemia morphology equals potassium value",
}
check(
    "extended_reporting_failure_contracts_present",
    all(by_id.get(fid, {}).get("name") == name for fid, name in required.items()),
    {fid: by_id.get(fid) for fid in required},
)

cases = [
    ("f08_vt_mechanism", "This wide-complex tachycardia is VT.", "unsupported_wct_mechanism_declaration"),
    ("f08_svt_aberrancy", "This wide-complex tachycardia is SVT with aberrancy.", "unsupported_wct_mechanism_declaration"),
    ("f12_programming", "The device is programmed VVI.", "unsupported_device_state_inference"),
    ("f12_battery", "The pacemaker battery is depleted.", "unsupported_device_state_inference"),
    ("f16_artery", "The culprit artery is established by this ECG.", "unsupported_culprit_artery_declaration"),
    ("f19_effusion", "Low voltage means pericardial effusion.", "unsupported_low_voltage_etiology"),
    ("f19_infiltrative", "Low voltage proves infiltrative disease.", "unsupported_low_voltage_etiology"),
    ("f22_anatomy", "LVH voltage confirms anatomic LV hypertrophy.", "unsupported_lvh_anatomic_declaration"),
    ("f24_numeric_k", "The serum potassium is 6.8 from this ECG.", "unsupported_numeric_potassium_inference"),
]

case_failures = []
for name, phrase, expected in cases:
    got = with_reason(phrase)
    if expected not in got:
        case_failures.append((name, phrase, expected, sorted(got)))
check("extended_failure_modes_detected", not case_failures, case_failures)

safe_controls = [
    "Wide-complex tachycardia; VT remains a consideration and mechanism is uncertain.",
    "Paced complexes are visible; device programming requires interrogation.",
    "Regional ECG findings are present; culprit artery is not established by ECG alone.",
    "Low voltage is descriptive; etiology requires clinical or imaging context.",
    "LVH voltage pattern is present; anatomic hypertrophy is not established by ECG alone.",
    "Hyperkalemia-like morphology is present; serum potassium requires measurement.",
]
forbidden = {
    "unsupported_wct_mechanism_declaration",
    "unsupported_device_state_inference",
    "unsupported_culprit_artery_declaration",
    "unsupported_low_voltage_etiology",
    "unsupported_lvh_anatomic_declaration",
    "unsupported_numeric_potassium_inference",
}
safe_failures = []
for phrase in safe_controls:
    unexpected = sorted(with_reason(phrase) & forbidden)
    if unexpected:
        safe_failures.append((phrase, unexpected))
check("calibrated_extended_controls_clean", not safe_failures, safe_failures)

if failed:
    print({"schema": "ekg-v12-1-reporting-failure-registry-extended-v1", "pass": False,
           "passed": passed, "failed": failed, "candidate_active": False})
    raise SystemExit(1)
print({"schema": "ekg-v12-1-reporting-failure-registry-extended-v1", "pass": True,
       "passed": passed, "total": passed, "candidate_active": False})
