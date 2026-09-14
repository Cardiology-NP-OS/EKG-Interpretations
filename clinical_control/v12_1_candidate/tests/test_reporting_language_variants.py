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
                "why_it_fits": [],
                "why_it_may_not_fit": [],
                "discriminator": "clinical context",
            }],
            "contradiction_summary": ["No unresolved contradiction identified."],
        },
        "limitations": ["ECG alone does not establish a clinical diagnosis."],
        "verification": ["Manual review required."],
    }

def violations_for(text):
    record = base_record()
    record["urgency"]["reason"] = text
    return set(validator.validate_record(record))

strong_variants = [
    "THIS PATIENT HAS a diagnosis.",
    "This   patient   has a diagnosis.",
    "This-patient-has a diagnosis.",
    "The tracing RULES OUT disease.",
    "The tracing rules-out disease.",
    "The patient is SAFE.",
    "The patient is cleared.",
]
strong_failures = []
for phrase in strong_variants:
    got = violations_for(phrase)
    if "reporting_language_too_strong" not in got:
        strong_failures.append((phrase, sorted(got)))
check("strong_language_case_spacing_punctuation_variants", not strong_failures, strong_failures)

cause_variants = [
    "finding CAUSED BY medication",
    "finding caused-by medication",
    "finding DUE TO medication",
    "finding due-to medication",
    "finding secondary-to medication",
]
cause_failures = []
for phrase in cause_variants:
    got = violations_for(phrase)
    if "unsupported_cause_attribution" not in got:
        cause_failures.append((phrase, sorted(got)))
check("cause_connector_case_punctuation_variants", not cause_failures, cause_failures)

mi_variants = [
    "THIS IS AN MI.",
    "This   is   an   MI.",
    "This-is-an-MI.",
    "This is: an MI.",
    "Diagnosis is: acute MI.",
]
mi_failures = []
for phrase in mi_variants:
    got = violations_for(phrase)
    if "unsupported_mi_declaration" not in got:
        mi_failures.append((phrase, sorted(got)))
check("mi_declaration_case_spacing_punctuation_variants", not mi_failures, mi_failures)

safe_controls = [
    "ECG alone does not establish clinical safety.",
    "The ECG does not prove a diagnosis.",
    "The ECG cannot rule out disease.",
    "The patient is not cleared by ECG alone.",
]
safe_failures = []
for phrase in safe_controls:
    got = violations_for(phrase)
    if "reporting_language_too_strong" in got or "negative_ecg_exclusion" in got:
        safe_failures.append((phrase, sorted(got)))
check("negated_calibrated_controls_remain_clean", not safe_failures, safe_failures)

if failed:
    print({"schema": "ekg-v12-1-reporting-language-variant-tests-v1", "pass": False, "passed": passed, "failed": failed, "candidate_active": False})
    raise SystemExit(1)
print({"schema": "ekg-v12-1-reporting-language-variant-tests-v1", "pass": True, "passed": passed, "total": passed, "candidate_active": False})