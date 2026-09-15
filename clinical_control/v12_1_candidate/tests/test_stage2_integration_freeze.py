from __future__ import annotations
import copy
import importlib.util
import json
import pathlib
import sys

ROOT=pathlib.Path(__file__).resolve().parents[3]
GEN=ROOT/"clinical_control"/"v12_1_candidate"/"validation_generated"
spec=importlib.util.spec_from_file_location("integration_freeze",GEN/"integration_freeze.py")
freeze=importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(freeze)

passed=0
def check(name, condition):
    global passed
    if not condition:
        raise AssertionError(name)
    passed += 1

# Frozen identities and exact accepted lineage.
check("packet_id", freeze.PACKET_ID=="PKT-EP3-09")
check("packet_hash", freeze.PACKET_SHA256=="3391254b7af3dec5c847c167a40ad3cc2aa070e976cfd552d48f38332c1ae294")
check("baseline_commit", freeze.BASELINE_COMMIT=="6fbf1814258813bfb6ff78407e013cf23ff9e07d")
check("baseline_tree", freeze.BASELINE_TREE=="01442274b34bf40ae600ee1ee21de8f15ae3b4de")
check("stage1_receipt", freeze.STAGE1_RECEIPT_SHA256=="76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")
check("prior_receipt", freeze.PRIOR_PACKET_RECEIPT_SHA256==freeze.PACKET_RECEIPTS["PKT-EP3-08"])
check("eight_receipts", len(freeze.PACKET_RECEIPTS)==8)
check("eight_verification_receipts", len(freeze.PACKET_VERIFICATION_RECEIPTS)==8)
check("eight_impl_identities", len(freeze.ACCEPTED_IMPLEMENTATION_IDENTITIES)==8)
for i in range(1,9):
    pid=f"PKT-EP3-{i:02d}"
    check(f"receipt_exists_{pid}", len(freeze.PACKET_RECEIPTS[pid])==64)
    check(f"verification_exists_{pid}", len(freeze.PACKET_VERIFICATION_RECEIPTS[pid])==64)
    commit,tree=freeze.ACCEPTED_IMPLEMENTATION_IDENTITIES[pid]
    check(f"commit_exists_{pid}", len(commit)==40)
    check(f"tree_exists_{pid}", len(tree)==40)

# Current state must remain clinically fail-closed.
expected_state={
    "approved_adjudicated_gold_count":0,
    "clinical_gold_admission_performed":False,
    "metric_maturity":"NOT_REPORTABLE",
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "readiness_state":"BLOCKED",
    "activation_eligibility_state":"INELIGIBLE",
    "candidate_active":False,
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "integration_freeze_state":"BLOCKED",
    "integration_descriptor_status":"PROVISIONAL_READ_ONLY",
}
for key,value in expected_state.items():
    check(f"state_{key}", freeze.CURRENT_STATE[key]==value)

# Cross-packet consistency over exact Build authority.
consistency=freeze.cross_packet_consistency(
    packet_receipts=freeze.PACKET_RECEIPTS,
    verification_receipts=freeze.PACKET_VERIFICATION_RECEIPTS,
    current_state=freeze.CURRENT_STATE,
)
check("consistency_schema", consistency["schema"]=="ekg-ep3-pkt09-cross-packet-consistency-v1")
check("consistency_true", consistency["consistent"] is True)
check("consistency_no_blockers", consistency["blockers"]==[])
check("consistency_receipt_count", consistency["packet_receipts_checked"]==8)
check("consistency_verify_count", consistency["verification_receipts_checked"]==8)
check("consistency_state_count", consistency["state_fields_checked"]==len(freeze.CURRENT_STATE))

bad_receipts=dict(freeze.PACKET_RECEIPTS); bad_receipts["PKT-EP3-04"]="0"*64
bad=freeze.cross_packet_consistency(packet_receipts=bad_receipts,verification_receipts=freeze.PACKET_VERIFICATION_RECEIPTS,current_state=freeze.CURRENT_STATE)
check("receipt_mismatch_fails", bad["consistent"] is False)
check("receipt_mismatch_named", "PACKET_RECEIPT_MISMATCH:PKT-EP3-04" in bad["blockers"])

bad_verification=dict(freeze.PACKET_VERIFICATION_RECEIPTS); bad_verification["PKT-EP3-08"]="0"*64
bad=freeze.cross_packet_consistency(packet_receipts=freeze.PACKET_RECEIPTS,verification_receipts=bad_verification,current_state=freeze.CURRENT_STATE)
check("verification_mismatch_fails", bad["consistent"] is False)
check("verification_mismatch_named", "VERIFICATION_RECEIPT_MISMATCH:PKT-EP3-08" in bad["blockers"])

bad_state=dict(freeze.CURRENT_STATE); bad_state["diagnostic_runtime"]="ACTIVE"
bad=freeze.cross_packet_consistency(packet_receipts=freeze.PACKET_RECEIPTS,verification_receipts=freeze.PACKET_VERIFICATION_RECEIPTS,current_state=bad_state)
check("state_conflict_fails", bad["consistent"] is False)
check("state_conflict_named", "STATE_CONFLICT:diagnostic_runtime" in bad["blockers"])

# Donor gaps are explicitly adjudicated without bulk import/runtime expansion.
donor=freeze.donor_gap_verdict()
check("donor_schema", donor["schema"]=="ekg-ep3-pkt09-donor-gap-adjudication-v1")
check("donor_count", len(donor["records"])==2)
check("donor_conformant", donor["conformant"] is True)
check("donor_bulk_forbidden", donor["bulk_donor_import_allowed"] is False)
for record in donor["records"]:
    check(f"donor_disposition_{record['gap_id']}", record["disposition"] in {"MUST_SHIP_NOW","ENGINEERING_ONLY_ARCHIVE","DEFERRED_WITH_REASON"})
    check(f"donor_bulk_{record['gap_id']}", record["bulk_donor_import_allowed"] is False)
check("geometry_deferred", donor["records"][0]["disposition"]=="DEFERRED_WITH_REASON")
check("geometry_no_runtime_measurement", donor["records"][0]["runtime_measurement_capability_added"] is False)
check("reader_deferred", donor["records"][1]["disposition"]=="DEFERRED_WITH_REASON")
check("reader_no_diagnosis", donor["records"][1]["diagnostic_conclusions_allowed"] is False)
check("reader_no_auto_candidate", donor["records"][1]["automatic_candidate_selection_allowed"] is False)
check("reader_bounded_scope", len(donor["records"][1]["must_ship_now_scope"])==4)

# Recovered boundaries must be present and content-addressed.
boundaries=freeze.boundary_inventory(ROOT)
check("boundary_count", len(boundaries)==6)
for record in boundaries:
    check(f"boundary_present_{record['boundary']}", record["present"] is True)
    check(f"boundary_hash_{record['boundary']}", isinstance(record["sha256"],str) and len(record["sha256"])==64)

# Build immutable manifest.
manifest=freeze.build_integration_manifest(
    implementation_commit="1"*40,
    implementation_tree="2"*40,
    source_pack_sha256="3"*64,
    candidate_identity_sha256="4"*64,
    ci_receipt_sha256="5"*64,
    independent_verification_receipt_sha256="6"*64,
    boundary_records=boundaries,
)
check("manifest_schema", manifest["schema"]=="ekg-ep3-pkt09-integration-manifest-v1")
check("manifest_immutable", manifest["immutable"] is True)
check("manifest_hash", len(manifest["manifest_sha256"])==64)
check("manifest_conformant", manifest["engineering_release_conformant"] is True)
check("manifest_no_missing_boundaries", manifest["missing_recovered_boundaries"]==[])
check("manifest_exact_receipts", manifest["packet_receipts"]==freeze.PACKET_RECEIPTS)
check("manifest_exact_verification", manifest["packet_verification_receipts"]==freeze.PACKET_VERIFICATION_RECEIPTS)
check("manifest_no_phi", manifest["phi_included"] is False)
check("manifest_no_raw", manifest["raw_clinical_waveform_or_image_bytes_included"] is False)
check("manifest_no_activation", manifest["diagnostic_runtime_activation_performed"] is False)
check("manifest_no_authority_transfer", manifest["clinical_authority_transferred"] is False)
check("manifest_no_auto_selection", manifest["automatic_candidate_selection_performed"] is False)
check("manifest_no_accuracy_claim", manifest["clinical_accuracy_claimed"] is False)
check("manifest_no_reporting", manifest["diagnostic_performance_reporting_allowed"] is False)
check("manifest_synth_not_gold", manifest["synthetic_fixtures_are_clinical_gold"] is False)
check("manifest_no_bulk_import", manifest["bulk_donor_import_performed"] is False)

validation=freeze.validate_manifest(manifest)
check("validation_schema", validation["schema"]=="ekg-ep3-pkt09-manifest-validation-v1")
check("validation_valid", validation["valid"] is True)
check("validation_no_blockers", validation["blockers"]==[])
check("validation_still_blocked_clinically", validation["integration_freeze_state"]=="BLOCKED")
check("validation_runtime_inactive", validation["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("validation_candidate_inactive", validation["candidate_active"] is False)

# Deterministic descriptor is read-only and clinically inactive.
descriptor=freeze.platform_descriptor(manifest)
check("descriptor_schema", descriptor["schema"]=="ekg-ep3-pkt09-platform-integration-descriptor-v1")
check("descriptor_status", descriptor["status"]=="PROVISIONAL_READ_ONLY")
check("descriptor_read_only", descriptor["read_only"] is True)
check("descriptor_provenance", descriptor["provenance_complete"] is True)
check("descriptor_zero_gold", descriptor["approved_adjudicated_gold_count"]==0)
check("descriptor_not_reportable", descriptor["metric_maturity"]=="NOT_REPORTABLE")
check("descriptor_reporting_false", descriptor["diagnostic_performance_reporting_allowed"] is False)
check("descriptor_accuracy_false", descriptor["clinical_accuracy_claimed"] is False)
check("descriptor_blocked", descriptor["readiness_state"]=="BLOCKED")
check("descriptor_ineligible", descriptor["activation_eligibility_state"]=="INELIGIBLE")
check("descriptor_candidate_inactive", descriptor["candidate_active"] is False)
check("descriptor_runtime_inactive", descriptor["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("descriptor_no_raw", descriptor["raw_clinical_waveform_or_image_bytes_included"] is False)
check("descriptor_no_phi", descriptor["phi_included"] is False)
check("descriptor_no_diag", descriptor["diagnostic_conclusions_included"] is False)
check("descriptor_no_cds", descriptor["patient_specific_clinical_decision_support_included"] is False)
check("descriptor_no_treatment", descriptor["treatment_or_prescribing_advice_included"] is False)
check("descriptor_no_auto_candidate", descriptor["automatic_candidate_selection_allowed"] is False)
check("descriptor_no_runtime_influence", descriptor["runtime_influence_allowed"] is False)
check("descriptor_no_authority_transfer", descriptor["clinical_authority_transferred"] is False)
check("descriptor_hash", len(descriptor["descriptor_sha256"])==64)
check("descriptor_has_clinical_blockers", len(descriptor["blockers"])>=4)

# Manifest tamper and forbidden escalation must fail closed.
tampered=copy.deepcopy(manifest); tampered["candidate_identity_sha256"]="7"*64
v=freeze.validate_manifest(tampered)
check("tamper_invalid", v["valid"] is False)
check("tamper_hash_blocker", "MANIFEST_SHA256_MISMATCH" in v["blockers"])

escalated=copy.deepcopy(manifest); escalated["diagnostic_runtime_activation_performed"]=True
v=freeze.validate_manifest(escalated)
check("activation_escalation_invalid", v["valid"] is False)
check("activation_escalation_blocker", "FORBIDDEN_ESCALATION:diagnostic_runtime_activation_performed" in v["blockers"])

phi=copy.deepcopy(manifest); phi["phi_included"]=True
v=freeze.validate_manifest(phi)
check("phi_invalid", v["valid"] is False)
check("phi_blocker", "FORBIDDEN_ESCALATION:phi_included" in v["blockers"])

# Every fail-closed trigger produces append-only rollback semantics.
check("trigger_count", len(freeze.FAIL_CLOSED_TRIGGERS)>=16)
for trigger in freeze.FAIL_CLOSED_TRIGGERS:
    record=freeze.invalidation_record(manifest_sha256=manifest["manifest_sha256"],trigger=trigger,reason=f"synthetic test {trigger}")
    check(f"invalidate_state_{trigger}", record["new_integration_freeze_state"]=="BLOCKED")
    check(f"invalidate_eligibility_{trigger}", record["new_activation_eligibility_state"]=="INELIGIBLE")
    check(f"invalidate_runtime_{trigger}", record["new_diagnostic_runtime"]=="GOVERNED_INACTIVE")
    check(f"invalidate_candidate_{trigger}", record["candidate_active"] is False)
    check(f"invalidate_no_fallback_{trigger}", record["silent_fallback_allowed"] is False)
    check(f"invalidate_no_source_sub_{trigger}", record["source_substitution_allowed"] is False)
    check(f"invalidate_no_candidate_sub_{trigger}", record["candidate_substitution_allowed"] is False)
    check(f"invalidate_no_authority_{trigger}", record["authority_rewrite_allowed"] is False)
    check(f"invalidate_hash_{trigger}", len(record["record_sha256"])==64)

# Asset classification preserves engineering/product boundaries.
assets=freeze.asset_classification()
check("asset_schema", assets["schema"]=="ekg-ep3-pkt09-asset-classification-v1")
check("product_assets", len(assets["product_runtime_assets"])==3)
check("engineering_assets", len(assets["engineering_only_assets"])==4)
check("no_clinical_runtime_assets", assets["clinical_runtime_assets_added"]==[])
check("no_raw_assets", assets["raw_clinical_payload_assets_added"]==[])
check("no_authority_assets", assets["authority_transfer_assets_added"]==[])

# Fixture corpus is non-PHI and cannot be mistaken for clinical evidence.
fixture=json.loads((GEN/"EP3_PKT09_INTEGRATION_FREEZE_FIXTURES.json").read_text(encoding="utf-8"))
check("fixture_schema", fixture["schema"]=="ekg-ep3-pkt09-integration-freeze-fixtures-v1")
check("fixture_no_phi", fixture["phi"] is False)
check("fixture_no_raw", fixture["raw_clinical_waveform_or_image_bytes_included"] is False)
check("fixture_synth_not_gold", fixture["synthetic_fixtures_are_clinical_gold"] is False)
check("fixture_no_accuracy", fixture["clinical_accuracy_claimed"] is False)
check("fixture_no_reporting", fixture["diagnostic_performance_reporting_allowed"] is False)
check("fixture_candidate_inactive", fixture["candidate_active"] is False)
check("fixture_runtime", fixture["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("fixture_freeze", fixture["integration_freeze_state"]=="BLOCKED")
check("fixture_scenarios", len(fixture["scenarios"])==15)
ids=[x["id"] for x in fixture["scenarios"]]
check("fixture_ids_unique", len(ids)==len(set(ids)))
for scenario in fixture["scenarios"]:
    check(f"fixture_id_{scenario['id']}", isinstance(scenario["id"],str) and bool(scenario["id"]))
check("fixture_synthetic_case_not_gold", next(x for x in fixture["scenarios"] if x["id"]=="synthetic-not-gold")["is_clinical_gold"] is False)

print(json.dumps({
    "schema":"ekg-ep3-pkt09-integration-freeze-tests-v1",
    "pass":True,
    "passed":passed,
    "total":passed,
    "packet_id":freeze.PACKET_ID,
    "approved_adjudicated_gold_count":0,
    "clinical_gold_admission_performed":False,
    "metric_maturity":"NOT_REPORTABLE",
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "candidate_active":False,
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "integration_freeze_state":"BLOCKED",
    "integration_descriptor_status":"PROVISIONAL_READ_ONLY",
    "raw_clinical_waveform_or_image_bytes_included":False,
    "phi_included":False,
    "synthetic_fixtures_are_clinical_gold":False,
    "bulk_donor_import_performed":False,
},sort_keys=True))
