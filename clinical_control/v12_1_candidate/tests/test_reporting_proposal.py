import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "validation_generated" / "reporting_boundary_validator.py"
PROPOSAL = ROOT / "validation_generated" / "L03_REPORTING_BOUNDARY_REMEDIATION_PROPOSAL.md"
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

expected_linkage = [
    "primary_evidence_for_is_untyped_free_text",
    "primary_pattern_has_no_explicit_observation_reference_field",
    "lead_observation_id_optional",
    "lead_measurement_evidence_ref_optional",
    "measurement_evidence_ids_not_schema_unique",
    "lead_observation_ids_not_schema_unique",
    "measurement_evidence_refs_not_schema_resolved",
]
check(
    "evidence_linkage_findings_exact",
    validator.evidence_linkage_findings() == expected_linkage,
    validator.evidence_linkage_findings(),
)
hashes = validator.source_hash_status()
check(
    "primary_source_hashes_still_exact",
    all(item["match"] for item in hashes.values()),
    hashes,
)

rendered = validator.render_remediation_proposal()
check("proposal_file_exists", PROPOSAL.exists(), str(PROPOSAL))
check(
    "proposal_is_deterministically_current",
    PROPOSAL.read_text(encoding="utf-8") == rendered,
    None,
)
check(
    "proposal_is_explicitly_inactive",
    "PROPOSAL ONLY" in rendered
    and "candidate_active: false" in rendered
    and "does not modify source authority" in rendered,
    rendered[:300],
)
check(
    "proposal_contains_no_activation_claim",
    "authorize activation" in rendered
    and "candidate_active: true" not in rendered,
    None,
)

if failed:
    print({
        "schema": "ekg-v12-1-reporting-proposal-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-reporting-proposal-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
})
