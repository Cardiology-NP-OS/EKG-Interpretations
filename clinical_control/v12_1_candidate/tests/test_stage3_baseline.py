from __future__ import annotations
import copy
import importlib.util
import json
import pathlib
import sys

ROOT=pathlib.Path(__file__).resolve().parents[3]
GEN=ROOT/"clinical_control"/"v12_1_candidate"/"validation_generated"

def load_module(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

base=load_module("stage3_baseline",GEN/"stage3_baseline.py")
freeze=load_module("integration_freeze_ep5",GEN/"integration_freeze.py")
passed=0
def check(name,condition):
    global passed
    if not condition:
        raise AssertionError(name)
    passed+=1

check("schema",base.SCHEMA=="ekg-ep5-pkt01-stage3-baseline-v1")
check("packet",base.PACKET_ID=="PKT-EP5-01")
check("packet_hash",base.PACKET_SHA256=="6df3479b50eb504c89aa3380466da39a3b0e58a2ec262a9d78c411f93e78ceb4")
check("baseline_commit",base.BASELINE_COMMIT=="509fdf0aab1c3768584c3159bb03a31202a8a103")
check("baseline_tree",base.BASELINE_TREE=="ea417c8114a6db694234ddc6aea5f3960ea88283")
check("stage2_receipt",base.STAGE2_RECEIPT_SHA256=="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a")
check("stage2_build_commit",base.STAGE2_BUILD_COMMIT=="582956c5829719825e6a271748a06731981cfe70")
check("stage2_build_tree",base.STAGE2_BUILD_TREE=="cb61449f6e5df11ef5240282437852c854362028")
check("stage2_output",base.STAGE2_OUTPUT_SHA256=="7d78ee995d87c11afcf5438ecb242f31e0632721a042c52b1375161ad141c6ff")
check("final_packet_receipt",base.EP3_FINAL_PACKET_RECEIPT_SHA256=="8370d5838e2a23ae82d08a8ec39e5899718f0adc63d81ffaec5e0e9e9a19d5cf")
check("final_verify_receipt",base.EP3_FINAL_VERIFICATION_RECEIPT_SHA256=="9e73b508e03f3f9cf9c0d81e9765281a27beb1fbd98bf945693049de1e36d6f6")
check("packet_receipt_count",len(base.EP3_PACKET_RECEIPTS)==9)
check("verification_receipt_count",len(base.EP3_VERIFICATION_RECEIPTS)==9)
for i in range(1,10):
    pid=f"PKT-EP3-{i:02d}"
    check("packet_key_"+pid,pid in base.EP3_PACKET_RECEIPTS)
    check("packet_hashlen_"+pid,len(base.EP3_PACKET_RECEIPTS[pid])==64)
    check("verify_key_"+pid,pid in base.EP3_VERIFICATION_RECEIPTS)
    check("verify_hashlen_"+pid,len(base.EP3_VERIFICATION_RECEIPTS[pid])==64)

expected_state={
 "approved_adjudicated_gold_count":0,"clinical_gold_admission_performed":False,
 "metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,
 "clinical_accuracy_claimed":False,"candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE",
 "readiness_state":"BLOCKED","activation_eligibility_state":"INELIGIBLE",
 "integration_freeze_state":"BLOCKED","integration_descriptor_status":"PROVISIONAL_READ_ONLY",
}
for key,value in expected_state.items():
    check("state_"+key,base.CURRENT_STATE[key]==value)
lineage=base.stage2_lineage_consistency()
check("lineage_schema",lineage["schema"]=="ekg-ep5-pkt01-stage2-lineage-consistency-v1")
check("lineage_consistent",lineage["consistent"] is True)
check("lineage_no_blockers",lineage["blockers"]==[])
check("lineage_packet_count",lineage["packet_receipts_checked"]==9)
check("lineage_verify_count",lineage["verification_receipts_checked"]==9)
check("lineage_state_count",lineage["state_fields_checked"]==len(base.CURRENT_STATE))
check("lineage_stage2_checked",lineage["stage2_receipt_checked"] is True)

bad=dict(base.EP3_PACKET_RECEIPTS); bad["PKT-EP3-09"]="0"*64
v=base.stage2_lineage_consistency(packet_receipts=bad)
check("packet_drift_fails",v["consistent"] is False)
check("packet_drift_named","PACKET_RECEIPT_MISMATCH:PKT-EP3-09" in v["blockers"])
bad=dict(base.EP3_VERIFICATION_RECEIPTS); bad["PKT-EP3-09"]="0"*64
v=base.stage2_lineage_consistency(verification_receipts=bad)
check("verify_drift_fails",v["consistent"] is False)
check("verify_drift_named","VERIFICATION_RECEIPT_MISMATCH:PKT-EP3-09" in v["blockers"])
v=base.stage2_lineage_consistency(stage2_receipt_sha256="0"*64)
check("stage2_drift_fails",v["consistent"] is False)
check("stage2_drift_named","STAGE2_RECEIPT_MISMATCH" in v["blockers"])
state=dict(base.CURRENT_STATE); state["diagnostic_runtime"]="ACTIVE"
v=base.stage2_lineage_consistency(current_state=state)
check("state_drift_fails",v["consistent"] is False)
check("state_drift_named","STATE_CONFLICT:diagnostic_runtime" in v["blockers"])
blob=b"alpha\nbeta\n"
same=base.checkout_portability(blob,blob)
check("portable_schema",same["schema"]=="ekg-ep5-pkt01-git-object-portability-v1")
check("portable_exact",same["exact_worktree_bytes_match"] is True)
check("portable_repo_match",same["repository_content_match"] is True)
check("portable_no_translation",same["newline_translation_only"] is False)
check("portable_authority",same["authority_basis"]=="GIT_OBJECT_BYTES")
crlf=base.checkout_portability(blob,b"alpha\r\nbeta\r\n")
check("crlf_not_exact",crlf["exact_worktree_bytes_match"] is False)
check("crlf_translation",crlf["newline_translation_only"] is True)
check("crlf_repo_match",crlf["repository_content_match"] is True)
different=base.checkout_portability(blob,b"alpha\ngamma\n")
check("different_not_exact",different["exact_worktree_bytes_match"] is False)
check("different_not_translation",different["newline_translation_only"] is False)
check("different_not_repo_match",different["repository_content_match"] is False)

repro=base.reproducibility_metadata(python_version="3.12.10",node_version="22.20.0",os_family="Windows")
check("repro_schema",repro["schema"]=="ekg-ep5-pkt01-reproducibility-metadata-v1")
check("repro_repo",repro["repository"]=="Cardiology-NP-OS/EKG-Interpretations")
check("repro_commit",repro["baseline_commit"]==base.BASELINE_COMMIT)
check("repro_tree",repro["baseline_tree"]==base.BASELINE_TREE)
check("repro_stage2",repro["stage2_receipt_sha256"]==base.STAGE2_RECEIPT_SHA256)
check("repro_final",repro["ep3_final_packet_receipt_sha256"]==base.EP3_FINAL_PACKET_RECEIPT_SHA256)
check("repro_entry_count",len(repro["test_entry_points"])==5)
check("repro_no_raw",repro["raw_clinical_payloads_required"] is False)
check("repro_no_creds",repro["credentials_embedded"] is False)
check("repro_no_phi",repro["phi_embedded"] is False)
check("repro_hash",len(repro["metadata_sha256"])==64)
for kwargs,code in [
 ({"python_version":"","node_version":"22","os_family":"Windows"},"INVALID_PYTHON_VERSION"),
 ({"python_version":"3.12","node_version":"","os_family":"Windows"},"INVALID_NODE_VERSION"),
 ({"python_version":"3.12","node_version":"22","os_family":""},"INVALID_OS_FAMILY"),
]:
    try:
        base.reproducibility_metadata(**kwargs)
        raised=False
    except ValueError as exc:
        raised=str(exc)==code
    check("repro_invalid_"+code,raised)

donor=base.donor_gap_continuity()
check("donor_schema",donor["schema"]=="ekg-ep5-pkt01-donor-gap-continuity-v1")
check("donor_two",len(donor["records"])==2)
check("donor_all_deferred",donor["all_deferred"] is True)
check("donor_bulk_false",donor["bulk_donor_import_allowed"] is False)
for row in donor["records"]:
    check("donor_disposition_"+row["gap_id"],row["disposition"]=="DEFERRED_WITH_REASON")
    check("donor_bulk_"+row["gap_id"],row["bulk_donor_import_allowed"] is False)
check("donor_geometry_false",donor["records"][0]["untrusted_scale_exact_measurement_allowed"] is False)
check("donor_engine_false",donor["records"][1]["competing_diagnostic_engine_allowed"] is False)

boundaries=freeze.boundary_inventory(ROOT)
check("boundaries_six",len(boundaries)==6)
for row in boundaries:
    check("boundary_present_"+row["boundary"],row["present"] is True)
    check("boundary_hash_"+row["boundary"],isinstance(row["sha256"],str) and len(row["sha256"])==64)
    check("boundary_path_"+row["boundary"],isinstance(row["path"],str) and bool(row["path"]))
manifest=base.build_stage3_baseline_manifest(
 implementation_commit="1"*40,implementation_tree="2"*40,ci_receipt_sha256="3"*64,
 independent_verification_receipt_sha256="4"*64,reproducibility=repro,boundary_records=boundaries)
check("manifest_schema",manifest["schema"]==base.SCHEMA)
check("manifest_packet",manifest["packet_id"]==base.PACKET_ID)
check("manifest_packet_hash",manifest["packet_sha256"]==base.PACKET_SHA256)
check("manifest_baseline_commit",manifest["baseline_commit"]==base.BASELINE_COMMIT)
check("manifest_baseline_tree",manifest["baseline_tree"]==base.BASELINE_TREE)
check("manifest_stage2",manifest["stage2_receipt_sha256"]==base.STAGE2_RECEIPT_SHA256)
check("manifest_stage2_build_commit",manifest["stage2_build_commit"]==base.STAGE2_BUILD_COMMIT)
check("manifest_stage2_build_tree",manifest["stage2_build_tree"]==base.STAGE2_BUILD_TREE)
check("manifest_stage2_output",manifest["stage2_output_sha256"]==base.STAGE2_OUTPUT_SHA256)
check("manifest_final_packet",manifest["ep3_final_packet_receipt_sha256"]==base.EP3_FINAL_PACKET_RECEIPT_SHA256)
check("manifest_final_verify",manifest["ep3_final_verification_receipt_sha256"]==base.EP3_FINAL_VERIFICATION_RECEIPT_SHA256)
check("manifest_receipts",manifest["ep3_packet_receipts"]==base.EP3_PACKET_RECEIPTS)
check("manifest_verifications",manifest["ep3_verification_receipts"]==base.EP3_VERIFICATION_RECEIPTS)
check("manifest_lineage",manifest["stage2_lineage_consistency"]["consistent"] is True)
check("manifest_no_missing",manifest["missing_recovered_v12_boundaries"]==[])
check("manifest_donor",manifest["donor_gap_continuity"]["all_deferred"] is True)
check("manifest_platform_commit",manifest["platform_stage2"]["commit"]=="f07c5f425920f229faa956885ec7231c82a83972")
check("manifest_platform_pin",manifest["platform_accepted_ekg_pin"]["commit"]=="6fbf1814258813bfb6ff78407e013cf23ff9e07d")
check("manifest_pin_drift",manifest["platform_ekg_pin_drift"] is True)
check("manifest_pin_state",manifest["platform_ekg_pin_state"]=="STALE_PIN")
check("manifest_no_silent_repin",manifest["platform_silent_repin_allowed"] is False)
check("manifest_no_auto_repin",manifest["platform_automatic_repin_performed"] is False)
for field in [
 "diagnostic_performance_reporting_allowed","clinical_accuracy_claimed","candidate_active",
 "clinical_authority_transferred","runtime_activation_performed","automatic_candidate_selection_performed",
 "raw_clinical_waveform_or_image_bytes_included","phi_included","synthetic_fixtures_are_clinical_gold",
 "bulk_donor_import_performed","source_substitution_allowed","silent_fallback_allowed",
]:
    check("manifest_false_"+field,manifest[field] is False)
check("manifest_zero_gold",manifest["approved_adjudicated_gold_count"]==0)
check("manifest_no_gold_admission",manifest["clinical_gold_admission_performed"] is False)
check("manifest_not_reportable",manifest["metric_maturity"]=="NOT_REPORTABLE")
check("manifest_runtime",manifest["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("manifest_conformant",manifest["engineering_baseline_conformant"] is True)
check("manifest_hash",len(manifest["manifest_sha256"])==64)
check("manifest_immutable",manifest["immutable"] is True)

validation=base.validate_stage3_baseline_manifest(manifest)
check("validation_schema",validation["schema"]=="ekg-ep5-pkt01-stage3-baseline-validation-v1")
check("validation_valid",validation["valid"] is True)
check("validation_no_blockers",validation["blockers"]==[])
check("validation_runtime",validation["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("validation_candidate",validation["candidate_active"] is False)
check("validation_accuracy",validation["clinical_accuracy_claimed"] is False)
check("validation_pin",validation["platform_ekg_pin_state"]=="STALE_PIN")

descriptor=base.platform_status_descriptor(manifest)
check("descriptor_schema",descriptor["schema"]=="ekg-ep5-pkt01-platform-stage3-status-v1")
check("descriptor_status",descriptor["status"]=="STALE_PIN")
check("descriptor_readonly",descriptor["read_only"] is True)
check("descriptor_stage2",descriptor["stage2_receipt_sha256"]==base.STAGE2_RECEIPT_SHA256)
check("descriptor_current_commit",descriptor["current_ekg_baseline"]["commit"]==base.BASELINE_COMMIT)
check("descriptor_old_pin",descriptor["accepted_platform_ekg_pin"]["commit"]==base.PLATFORM_ACCEPTED_EKG_PIN["commit"])
check("descriptor_no_repin",descriptor["silent_repin_allowed"] is False and descriptor["automatic_repin_performed"] is False)
check("descriptor_runtime",descriptor["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("descriptor_zero_gold",descriptor["approved_adjudicated_gold_count"]==0)
check("descriptor_maturity",descriptor["metric_maturity"]=="NOT_REPORTABLE")
check("descriptor_no_reporting",descriptor["diagnostic_performance_reporting_allowed"] is False)
check("descriptor_no_accuracy",descriptor["clinical_accuracy_claimed"] is False)
check("descriptor_no_authority",descriptor["clinical_authority_transferred"] is False)
check("descriptor_no_diag",descriptor["diagnostic_conclusions_included"] is False)
check("descriptor_no_cds",descriptor["patient_specific_cds_included"] is False)
check("descriptor_no_treatment",descriptor["treatment_or_prescribing_advice_included"] is False)
check("descriptor_no_raw",descriptor["raw_clinical_payloads_included"] is False)
check("descriptor_no_phi",descriptor["phi_included"] is False)
check("descriptor_no_blockers",descriptor["blockers"]==[])
check("descriptor_hash",len(descriptor["descriptor_sha256"])==64)

checkpoint=base.restart_checkpoint(manifest_sha256=manifest["manifest_sha256"])
check("checkpoint_schema",checkpoint["schema"]=="ekg-ep5-pkt01-restart-checkpoint-v1")
check("checkpoint_manifest",checkpoint["manifest_sha256"]==manifest["manifest_sha256"])
check("checkpoint_receipt",checkpoint["last_accepted_receipt_sha256"]==base.STAGE2_RECEIPT_SHA256)
check("checkpoint_git",checkpoint["resume_from_exact_git_identity"] is True)
check("checkpoint_no_replay",checkpoint["replay_accepted_stage2_packets"] is False)
check("checkpoint_no_fallback",checkpoint["automatic_previous_version_fallback_allowed"] is False)
check("checkpoint_no_source_sub",checkpoint["source_substitution_allowed"] is False)
check("checkpoint_no_candidate_sub",checkpoint["candidate_substitution_allowed"] is False)
check("checkpoint_no_authority",checkpoint["authority_rewrite_allowed"] is False)
check("checkpoint_runtime",checkpoint["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("checkpoint_candidate",checkpoint["candidate_active"] is False)
check("checkpoint_hash",len(checkpoint["checkpoint_sha256"])==64)

tampered=copy.deepcopy(manifest); tampered["implementation_commit"]="9"*40
v=base.validate_stage3_baseline_manifest(tampered)
check("tamper_invalid",v["valid"] is False)
check("tamper_hash","MANIFEST_SHA256_MISMATCH" in v["blockers"])
escalated=copy.deepcopy(manifest); escalated["runtime_activation_performed"]=True
v=base.validate_stage3_baseline_manifest(escalated)
check("activation_invalid",v["valid"] is False)
check("activation_named","FORBIDDEN_ESCALATION:runtime_activation_performed" in v["blockers"])
gold=copy.deepcopy(manifest); gold["approved_adjudicated_gold_count"]=1
v=base.validate_stage3_baseline_manifest(gold)
check("gold_invalid",v["valid"] is False)
check("gold_named","CLINICAL_GOLD_STATE_INVALID" in v["blockers"])
repin=copy.deepcopy(manifest); repin["platform_silent_repin_allowed"]=True
v=base.validate_stage3_baseline_manifest(repin)
check("repin_invalid",v["valid"] is False)
check("repin_named","FORBIDDEN_ESCALATION:platform_silent_repin_allowed" in v["blockers"])

check("trigger_count",len(base.FAIL_CLOSED_TRIGGERS)>=19)
for trigger in base.FAIL_CLOSED_TRIGGERS:
    rec=base.invalidation_record(manifest_sha256=manifest["manifest_sha256"],trigger=trigger,reason="synthetic "+trigger)
    check("inv_status_"+trigger,rec["new_status"]=="BLOCKED")
    check("inv_runtime_"+trigger,rec["diagnostic_runtime"]=="GOVERNED_INACTIVE")
    check("inv_candidate_"+trigger,rec["candidate_active"] is False)
    check("inv_repin_"+trigger,rec["platform_repin_allowed"] is False)
    check("inv_fallback_"+trigger,rec["silent_fallback_allowed"] is False)
    check("inv_source_"+trigger,rec["source_substitution_allowed"] is False)
    check("inv_candidate_sub_"+trigger,rec["candidate_substitution_allowed"] is False)
    check("inv_authority_"+trigger,rec["authority_rewrite_allowed"] is False)
    check("inv_lineage_"+trigger,rec["last_accepted_lineage_preserved"] is True)
    check("inv_hash_"+trigger,len(rec["record_sha256"])==64)

fixture=json.loads((GEN/"EP5_PKT01_STAGE3_BASELINE_FIXTURES.json").read_text(encoding="utf-8"))
check("fixture_schema",fixture["schema"]=="ekg-ep5-pkt01-stage3-baseline-fixtures-v1")
for field in ["phi","raw_clinical_payloads_included","synthetic_fixtures_are_clinical_gold",
              "clinical_accuracy_claimed","diagnostic_performance_reporting_allowed","candidate_active",
              "platform_silent_repin_allowed"]:
    check("fixture_false_"+field,fixture[field] is False)
check("fixture_runtime",fixture["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("fixture_count",len(fixture["scenarios"])==18)
ids=[x["id"] for x in fixture["scenarios"]]
check("fixture_unique",len(ids)==len(set(ids)))
for row in fixture["scenarios"]:
    check("fixture_id_"+row["id"],isinstance(row["id"],str) and bool(row["id"]))
check("fixture_stale_pin",next(x for x in fixture["scenarios"] if x["id"]=="platform-stale-pin")["platform_pin_state"]=="STALE_PIN")
check("fixture_crlf",next(x for x in fixture["scenarios"] if x["id"]=="crlf-checkout-translation")["expected_repository_content_match"] is True)
check("fixture_restart",next(x for x in fixture["scenarios"] if x["id"]=="restart-recovery")["replay_accepted_stage2_packets"] is False)

print(json.dumps({
 "schema":"ekg-ep5-pkt01-stage3-baseline-tests-v1","pass":True,"passed":passed,"total":passed,
 "packet_id":base.PACKET_ID,"stage2_receipt_sha256":base.STAGE2_RECEIPT_SHA256,
 "platform_ekg_pin_state":"STALE_PIN","platform_silent_repin_allowed":False,
 "approved_adjudicated_gold_count":0,"clinical_gold_admission_performed":False,
 "metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,
 "clinical_accuracy_claimed":False,"candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE",
 "phi_included":False,"raw_clinical_payloads_included":False,
 "synthetic_fixtures_are_clinical_gold":False,"bulk_donor_import_performed":False
},sort_keys=True))
