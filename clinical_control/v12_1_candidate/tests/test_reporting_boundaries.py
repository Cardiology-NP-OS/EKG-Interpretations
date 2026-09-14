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
        "lead_observations": [{"lead": "II", "observations": ["observation"]}],
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
            "differential": ["context-dependent alternative"],
            "contradiction_summary": ["No unresolved contradiction identified."],
        },
        "limitations": ["ECG alone does not establish a clinical diagnosis."],
        "verification": ["Manual review required."],
    }

hashes = validator.source_hash_status()
check(
    "primary_source_hashes_exact",
    all(item["match"] for item in hashes.values()),
    hashes,
)

expected_gaps = {
    "primary_evidence_for_allows_empty",
    "differential_allows_empty",
    "contradiction_summary_allows_empty",
    "limitations_allows_empty",
    "verification_allows_empty",
    "urgency_uncertainty_allows_empty",
    "lead_observations_allows_empty",
    "primary_pattern_label_free_text",
    "secondary_findings_free_text",
    "pattern_id_not_registry_enforced",
}
schema_gaps = set(validator.schema_gap_findings())
check("known_schema_safety_gaps_detected", schema_gaps == expected_gaps, sorted(schema_gaps))

template = validator.template_schema_findings()
check("structured_guide_requires_metadata", template["guide_declares_required_metadata"])
check(
    "template_a_metadata_omission_detected",
    set(template["template_a_missing_required_metadata"])
    == {"project version", "criteria snapshot", "source registry version", "analysis mode"},
    template,
)

safe = base_record()
check("bounded_record_has_no_lane_violations", validator.validate_record(safe) == [], validator.validate_record(safe))

missing = base_record()
missing["urgency"]["uncertainty"] = ""
missing["interpretation"]["primary_pattern"]["evidence_for"] = []
missing["interpretation"]["differential"] = []
missing["interpretation"]["contradiction_summary"] = []
missing["limitations"] = []
missing["verification"] = []
violations = set(validator.validate_record(missing))
check(
    "required_safety_content_missing_is_detected",
    {
        "missing_uncertainty",
        "missing_evidence",
        "missing_differential",
        "missing_contradiction_summary",
        "missing_limitations",
        "missing_verification",
    } <= violations,
    sorted(violations),
)

strong = base_record()
strong["urgency"]["reason"] = "This patient has a definitive diagnosis."
check(
    "overstated_reporting_language_detected",
    "reporting_language_too_strong" in validator.validate_record(strong),
    validator.validate_record(strong),
)

diagnosis = base_record()
diagnosis["interpretation"]["primary_pattern"]["label"] = "acute MI"
check(
    "phenotype_to_diagnosis_promotion_detected",
    "phenotype_promoted_to_diagnosis" in validator.validate_record(diagnosis),
    validator.validate_record(diagnosis),
)

cause = base_record()
cause["interpretation"]["primary_pattern"]["label"] = "ECG phenotype due to medication"
check(
    "unsupported_cause_attribution_detected",
    "unsupported_cause_attribution" in validator.validate_record(cause),
    validator.validate_record(cause),
)

negative = base_record()
negative["urgency"]["reason"] = "This ECG rules out disease."
negative_violations = set(validator.validate_record(negative))
check(
    "negative_ecg_exclusion_detected",
    {"negative_ecg_exclusion", "reporting_language_too_strong"} <= negative_violations,
    sorted(negative_violations),
)

indeterminate = base_record()
indeterminate["st_t_assessment"]["ischemia_concern"] = "indeterminate"
indeterminate["interpretation"]["primary_pattern"]["confidence"] = "high"
check(
    "indeterminate_evidence_high_certainty_detected",
    "indeterminate_evidence_with_high_certainty" in validator.validate_record(indeterminate),
    validator.validate_record(indeterminate),
)

contradicted = base_record()
contradicted["interpretation"]["primary_pattern"]["confidence"] = "high"
contradicted["interpretation"]["primary_pattern"]["evidence_against"] = ["contradictory evidence"]
check(
    "high_confidence_with_counterevidence_detected",
    "hidden_contradiction_high_confidence" in validator.validate_record(contradicted),
    validator.validate_record(contradicted),
)

regional = base_record()
regional["interpretation"]["primary_pattern"]["pattern_id"] = "complete_rbbb"
regional["lead_observations"] = []
check(
    "regional_pattern_without_supporting_leads_detected",
    "missing_supporting_leads" in validator.validate_record(regional),
    validator.validate_record(regional),
)

secondary = base_record()
secondary["interpretation"]["primary_pattern"]["label"] = "ECG phenotype"
secondary["interpretation"]["secondary_findings"] = ["no ECG phenotype"]
check(
    "secondary_primary_contradiction_detected",
    "secondary_primary_contradiction" in validator.validate_record(secondary),
    validator.validate_record(secondary),
)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-boundary-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-boundary-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "known_contract_findings": sorted(schema_gaps),
    "candidate_active": False,
})
