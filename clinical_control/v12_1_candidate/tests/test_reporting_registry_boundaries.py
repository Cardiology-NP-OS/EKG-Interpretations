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

def base_record(pattern_id):
    return {
        "urgency": {"uncertainty": "Uncertainty retained.", "reason": ""},
        "lead_observations": [{"lead": "II", "observations": ["visible observation"]}],
        "st_t_assessment": {},
        "interpretation": {
            "primary_pattern": {
                "pattern_id": pattern_id,
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
        "limitations": ["ECG alone does not establish a final conclusion."],
        "verification": ["Manual review required."],
    }

registry = validator.registry_boundary_findings()
check("registry_has_59_patterns", registry["total_patterns"] == 59, registry)
check(
    "all_59_patterns_require_context_boundary",
    len(registry["context_required_ids"]) == 59,
    registry["context_required_ids"],
)
check(
    "29_patterns_require_regional_supporting_leads",
    len(registry["regional_supporting_lead_ids"]) == 29,
    registry["regional_supporting_lead_ids"],
)
context_failures = []
for pattern_id in registry["context_required_ids"]:
    record = base_record(pattern_id)
    record["urgency"]["reason"] = "ECG phenotype due to medication"
    got = set(validator.validate_record(record))
    if not {"unsupported_cause_attribution", "context_required_for_etiology"} <= got:
        context_failures.append((pattern_id, sorted(got)))
check(
    "all_context_required_patterns_reject_etiology_promotion",
    not context_failures,
    context_failures[:5],
)

strong_failures = []
for pattern_id in registry["context_required_ids"]:
    record = base_record(pattern_id)
    record["urgency"]["reason"] = "This patient has a definitive diagnosis."
    got = set(validator.validate_record(record))
    if "reporting_language_too_strong" not in got:
        strong_failures.append((pattern_id, sorted(got)))
check(
    "all_context_required_patterns_reject_definitive_language",
    not strong_failures,
    strong_failures[:5],
)
lead_failures = []
for pattern_id in registry["regional_supporting_lead_ids"]:
    record = base_record(pattern_id)
    record["lead_observations"] = []
    got_empty = set(validator.validate_record(record))
    record["lead_observations"] = [{"lead": "II", "observations": []}]
    got_hollow = set(validator.validate_record(record))
    if "missing_supporting_leads" not in got_empty or "missing_supporting_leads" not in got_hollow:
        lead_failures.append((pattern_id, sorted(got_empty), sorted(got_hollow)))
check(
    "all_regional_patterns_require_nonempty_supporting_lead_observations",
    not lead_failures,
    lead_failures[:5],
)

lead_controls = []
for pattern_id in registry["regional_supporting_lead_ids"]:
    record = base_record(pattern_id)
    got = set(validator.validate_record(record))
    if "missing_supporting_leads" in got:
        lead_controls.append((pattern_id, sorted(got)))
check(
    "regional_patterns_accept_named_nonempty_supporting_lead_observations",
    not lead_controls,
    lead_controls[:5],
)
if failed:
    print({
        "schema": "ekg-v12-1-reporting-registry-boundary-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-registry-boundary-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "context_required_patterns": len(registry["context_required_ids"]),
    "regional_patterns": len(registry["regional_supporting_lead_ids"]),
    "candidate_active": False,
})
