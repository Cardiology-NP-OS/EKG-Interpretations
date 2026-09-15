from __future__ import annotations
import copy
import importlib.util
import json
import pathlib

ROOT=pathlib.Path(__file__).resolve().parents[3]
GEN=ROOT/"clinical_control"/"v12_1_candidate"/"validation_generated"

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

att=load("compatibility_attestation",GEN/"compatibility_attestation.py")
passed=0
def check(name,condition):
    global passed
    if not condition:
        raise AssertionError(name)
    passed+=1

check("schema",att.SCHEMA=="ekg-ep5-pkt02-platform-compatibility-attestation-v1")
check("packet",att.PACKET_ID=="PKT-EP5-02")
check("packet_sha",att.PACKET_SHA256=="8a139661488c60a7235461c2dcc92b4c918425820a3a5c9c06a2ae10622981cb")
check("baseline_commit",att.BASELINE_COMMIT=="4a9c196bc384117cb8ce39c3363c1b152d6de2d7")
check("baseline_tree",att.BASELINE_TREE=="7e081088f561e24f864bec094ef42a4aad6a58d8")
check("stage2",att.STAGE2_RECEIPT_SHA256=="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a")
check("prior_packet",att.PRIOR_EP5_PACKET_RECEIPT=="f6cbd29dba1dffe7324dac8084317231aab8f531b37206c30d87adc7235a066d")
check("prior_verify",att.PRIOR_EP5_VERIFICATION_RECEIPT=="3020d3e43cf1040470c356e2d767a80276ea0a65b0519c7406e62577208e7bdb")
check("ep6_receipt",att.EP6_PACKET_RECEIPT=="a1587a09cdeec4109527d6488d0942e1d5a8076fc573845f21404424d859c3c5")
check("ep6_manifest",att.EP6_OWNER_RUNTIME_MANIFEST=="908822fcfcde38bd1032416377da71149689d5cbc82c4af189604aabcec30ffa")
check("platform_commit",att.PLATFORM_COMMIT=="729adc31fcfb8162d8afc1d31dbcfa167aea1b25")
check("platform_tree",att.PLATFORM_TREE=="1ffbdc37447686b6d38e1f3574e80cbee5721e08")
check("old_pin_runtime",att.PLATFORM_STAGE2_EKG_PIN["runtime_status"]=="GOVERNED_INACTIVE")
check("candidate_commit",att.GOVERNED_PIN_CANDIDATE["commit"]==att.BASELINE_COMMIT)
check("candidate_tree",att.GOVERNED_PIN_CANDIDATE["tree"]==att.BASELINE_TREE)
check("candidate_runtime",att.GOVERNED_PIN_CANDIDATE["runtime_status"]=="GOVERNED_INACTIVE")
check("trigger_count",len(att.REJECTION_TRIGGERS)==16)
blob=b"alpha\nbeta\n"
same=att.git_object_portability(blob,blob)
check("same_repo",same["repository_content_match"] is True)
check("same_no_translate",same["newline_translation_only"] is False)
check("same_authority",same["authority_basis"]=="GIT_OBJECT_BYTES")
crlf=att.git_object_portability(blob,b"alpha\r\nbeta\r\n")
check("crlf_repo",crlf["repository_content_match"] is True)
check("crlf_translate",crlf["newline_translation_only"] is True)
different=att.git_object_portability(blob,b"alpha\ngamma\n")
check("different_repo",different["repository_content_match"] is False)
check("different_translate",different["newline_translation_only"] is False)

repro=att.reproducibility_capsule(python_version="3.14.2",node_version="22.23.2",os_family="Windows")
check("repro_schema",repro["schema"]=="ekg-ep5-pkt02-reproducibility-capsule-v1")
check("repro_repo",repro["repository"]=="Cardiology-NP-OS/EKG-Interpretations")
check("repro_commit",repro["accepted_ekg_commit"]==att.BASELINE_COMMIT)
check("repro_tree",repro["accepted_ekg_tree"]==att.BASELINE_TREE)
check("repro_packet",repro["prior_packet_receipt_sha256"]==att.PRIOR_EP5_PACKET_RECEIPT)
check("repro_verify",repro["prior_verification_receipt_sha256"]==att.PRIOR_EP5_VERIFICATION_RECEIPT)
check("repro_stage2",repro["stage2_receipt_sha256"]==att.STAGE2_RECEIPT_SHA256)
check("repro_entry_count",len(repro["gate_entry_points"])==5)
check("repro_no_replay",repro["replay_stage2_or_ep5_pkt01"] is False)
check("repro_no_raw",repro["raw_clinical_payloads_required"] is False)
check("repro_no_phi",repro["phi_required"] is False)
check("repro_no_creds",repro["credentials_required"] is False)
check("repro_hash",len(repro["capsule_sha256"])==64)
for kwargs,code in [
 ({"python_version":"","node_version":"22","os_family":"Windows"},"INVALID_PYTHON_VERSION"),
 ({"python_version":"3.14","node_version":"","os_family":"Windows"},"INVALID_NODE_VERSION"),
 ({"python_version":"3.14","node_version":"22","os_family":""},"INVALID_OS_FAMILY"),
]:
    try:
        att.reproducibility_capsule(**kwargs); raised=False
    except ValueError as exc:
        raised=str(exc)==code
    check("repro_invalid_"+code,raised)
manifest=att.build_attestation(
 attestation_commit="1"*40,attestation_tree="2"*40,
 github_ci_receipt_sha256="3"*64,independent_verification_receipt_sha256="4"*64,
 reproducibility=repro,github_ci_pass=True,independent_machine_pass=True,
 provenance_integrity_pass=True,no_phi_verified=True)
check("manifest_schema",manifest["schema"]==att.SCHEMA)
check("manifest_packet",manifest["packet_id"]==att.PACKET_ID)
check("manifest_packet_sha",manifest["packet_sha256"]==att.PACKET_SHA256)
check("manifest_baseline_commit",manifest["baseline_commit"]==att.BASELINE_COMMIT)
check("manifest_baseline_tree",manifest["baseline_tree"]==att.BASELINE_TREE)
check("manifest_stage2",manifest["stage2_receipt_sha256"]==att.STAGE2_RECEIPT_SHA256)
check("manifest_prior_packet",manifest["prior_ep5_packet_receipt_sha256"]==att.PRIOR_EP5_PACKET_RECEIPT)
check("manifest_prior_verify",manifest["prior_ep5_verification_receipt_sha256"]==att.PRIOR_EP5_VERIFICATION_RECEIPT)
check("manifest_ep6_receipt",manifest["downstream_ep6_packet_receipt_sha256"]==att.EP6_PACKET_RECEIPT)
check("manifest_ep6_owner",manifest["downstream_ep6_owner_runtime_manifest_sha256"]==att.EP6_OWNER_RUNTIME_MANIFEST)
check("manifest_platform_commit",manifest["downstream_platform_commit"]==att.PLATFORM_COMMIT)
check("manifest_platform_tree",manifest["downstream_platform_tree"]==att.PLATFORM_TREE)
check("manifest_old_pin",manifest["accepted_stage2_platform_ekg_pin"]==att.PLATFORM_STAGE2_EKG_PIN)
check("manifest_candidate",manifest["governed_pin_candidate"]==att.GOVERNED_PIN_CANDIDATE)
check("manifest_delta",manifest["pin_delta_present"] is True)
check("manifest_state",manifest["compatibility_state"]=="HANDSHAKE_ELIGIBLE")
check("manifest_handshake",manifest["compatibility_handshake_required"] is True)
check("manifest_no_mutation",manifest["platform_pin_mutation_performed"] is False)
check("manifest_mutation_disallowed",manifest["platform_pin_mutation_allowed"] is False)
check("manifest_no_auto_repin",manifest["automatic_repin_performed"] is False)
check("manifest_no_silent",manifest["silent_repin_allowed"] is False)
check("manifest_ci",manifest["github_ci_pass"] is True)
check("manifest_machine",manifest["independent_machine_pass"] is True)
check("manifest_provenance",manifest["provenance_integrity_pass"] is True)
check("manifest_no_phi_proof",manifest["no_phi_verified"] is True)
check("manifest_no_blockers",manifest["residual_blockers"]==[])
for field in [
 "diagnostic_performance_reporting_allowed","clinical_accuracy_claimed","candidate_active",
 "clinical_authority_transferred","runtime_activation_performed","diagnostic_inference_performed",
 "prescribing_performed","treatment_recommendation_performed","patient_specific_cds_performed",
 "automatic_clinical_action_performed","raw_clinical_payloads_included","phi_included",
 "synthetic_fixtures_are_clinical_gold","source_substitution_allowed","candidate_substitution_allowed",
 "automatic_previous_version_fallback_allowed",
]:
    check("manifest_false_"+field,manifest[field] is False)
check("manifest_gold_zero",manifest["approved_adjudicated_gold_count"]==0)
check("manifest_no_gold_admission",manifest["clinical_gold_admission_performed"] is False)
check("manifest_maturity",manifest["metric_maturity"]=="NOT_REPORTABLE")
check("manifest_runtime",manifest["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("manifest_hash",len(manifest["attestation_sha256"])==64)
check("manifest_immutable",manifest["immutable"] is True)

valid=att.validate_attestation(manifest)
check("validation_schema",valid["schema"]=="ekg-ep5-pkt02-attestation-validation-v1")
check("validation_valid",valid["valid"] is True)
check("validation_no_blockers",valid["blockers"]==[])
check("validation_state",valid["compatibility_state"]=="HANDSHAKE_ELIGIBLE")
check("validation_runtime",valid["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("validation_no_mutation",valid["platform_pin_mutation_allowed"] is False)

challenge=att.compatibility_challenge(manifest)
check("challenge_schema",challenge["schema"]=="ekg-ep5-pkt02-compatibility-challenge-v1")
check("challenge_attestation",challenge["attestation_sha256"]==manifest["attestation_sha256"])
check("challenge_owner",challenge["owner_runtime_manifest_sha256"]==att.EP6_OWNER_RUNTIME_MANIFEST)
check("challenge_platform_commit",challenge["platform_commit"]==att.PLATFORM_COMMIT)
check("challenge_platform_tree",challenge["platform_tree"]==att.PLATFORM_TREE)
check("challenge_eligible",challenge["state"]=="ELIGIBLE")
check("challenge_no_blockers",challenge["blockers"]==[])
check("challenge_no_secret",challenge["secret_material_included"] is False)
check("challenge_no_creds",challenge["credential_material_included"] is False)
check("challenge_no_mutation",challenge["platform_pin_mutation_performed"] is False)
check("challenge_no_silent",challenge["silent_repin_allowed"] is False)
check("challenge_runtime",challenge["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("challenge_no_authority",challenge["clinical_authority_transfer"] is False)
check("challenge_hash",len(challenge["challenge_sha256"])==64)
candidate=att.pin_candidate_record(manifest)
check("candidate_schema",candidate["schema"]=="ekg-ep5-pkt02-governed-pin-candidate-v1")
check("candidate_state",candidate["state"]=="CANDIDATE_ONLY")
check("candidate_metadata",candidate["metadata_only"] is True)
check("candidate_no_write",candidate["platform_write_performed"] is False)
check("candidate_write_disallowed",candidate["platform_write_allowed"] is False)
check("candidate_no_activation",candidate["runtime_activation_performed"] is False)
check("candidate_runtime",candidate["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("candidate_no_authority",candidate["clinical_authority_transfer"] is False)
check("candidate_no_clinical",candidate["clinical_validity_inferred"] is False)
check("candidate_hash",len(candidate["record_sha256"])==64)

status=att.platform_status_descriptor(manifest)
check("status_schema",status["schema"]=="ekg-ep5-pkt02-platform-compatibility-status-v1")
check("status_eligible",status["status"]=="HANDSHAKE_ELIGIBLE")
check("status_stale",status["platform_current_pin_state"]=="STALE_PIN")
check("status_candidate",status["governed_candidate_available"] is True)
check("status_no_blockers",status["residual_blockers"]==[])
check("status_no_silent",status["silent_repin_allowed"] is False)
check("status_no_auto",status["automatic_repin_performed"] is False)
check("status_no_mutation",status["platform_pin_mutation_performed"] is False)
check("status_runtime",status["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("status_gold",status["approved_adjudicated_gold_count"]==0)
check("status_maturity",status["metric_maturity"]=="NOT_REPORTABLE")
check("status_no_accuracy",status["clinical_accuracy_claimed"] is False)
check("status_no_reporting",status["diagnostic_performance_reporting_allowed"] is False)
check("status_no_authority",status["clinical_authority_transfer"] is False)
check("status_no_raw",status["raw_clinical_payloads_included"] is False)
check("status_no_phi",status["phi_included"] is False)
check("status_hash",len(status["descriptor_sha256"])==64)

recovery=att.recovery_capsule(manifest)
check("recovery_schema",recovery["schema"]=="ekg-ep5-pkt02-recovery-capsule-v1")
check("recovery_ready",recovery["state"]=="READY")
check("recovery_commit",recovery["accepted_ekg_commit"]==att.BASELINE_COMMIT)
check("recovery_tree",recovery["accepted_ekg_tree"]==att.BASELINE_TREE)
check("recovery_git",recovery["resume_from_git_object_identity"] is True)
check("recovery_no_replay",recovery["replay_stage2_or_ep5_pkt01"] is False)
check("recovery_no_fallback",recovery["automatic_previous_version_fallback_allowed"] is False)
check("recovery_no_source",recovery["source_substitution_allowed"] is False)
check("recovery_no_candidate",recovery["candidate_substitution_allowed"] is False)
check("recovery_no_mutation",recovery["platform_pin_mutation_allowed"] is False)
check("recovery_runtime",recovery["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("recovery_no_authority",recovery["clinical_authority_transfer"] is False)
check("recovery_no_raw",recovery["raw_clinical_payloads_required"] is False)
check("recovery_no_phi",recovery["phi_required"] is False)
check("recovery_hash",len(recovery["recovery_capsule_sha256"])==64)
tampered=copy.deepcopy(manifest); tampered["attestation_commit"]="9"*40
v=att.validate_attestation(tampered)
check("tamper_invalid",v["valid"] is False)
check("tamper_hash","ATTESTATION_SHA256_MISMATCH" in v["blockers"])
mutated=copy.deepcopy(manifest); mutated["platform_pin_mutation_allowed"]=True
v=att.validate_attestation(mutated)
check("mutation_invalid",v["valid"] is False)
check("mutation_named","FORBIDDEN_ESCALATION:platform_pin_mutation_allowed" in v["blockers"])
activated=copy.deepcopy(manifest); activated["runtime_activation_performed"]=True
v=att.validate_attestation(activated)
check("activation_invalid",v["valid"] is False)
check("activation_named","FORBIDDEN_ESCALATION:runtime_activation_performed" in v["blockers"])
gold=copy.deepcopy(manifest); gold["approved_adjudicated_gold_count"]=1
v=att.validate_attestation(gold)
check("gold_invalid",v["valid"] is False)
check("gold_named","CLINICAL_GOLD_STATE_INVALID" in v["blockers"])
wrong_owner=att.compatibility_challenge(manifest,owner_runtime_manifest_sha256="0"*64)
check("wrong_owner_blocked",wrong_owner["state"]=="BLOCKED")
check("wrong_owner_named","EP6_OWNER_RUNTIME_MANIFEST_MISMATCH" in wrong_owner["blockers"])
wrong_platform=att.compatibility_challenge(manifest,platform_commit="0"*40)
check("wrong_platform_blocked",wrong_platform["state"]=="BLOCKED")
check("wrong_platform_named","PLATFORM_IDENTITY_MISMATCH" in wrong_platform["blockers"])

for trigger in att.REJECTION_TRIGGERS:
    rec=att.invalidation_record(attestation_sha256=manifest["attestation_sha256"],trigger=trigger,reason="synthetic "+trigger)
    check("inv_schema_"+trigger,rec["schema"]=="ekg-ep5-pkt02-attestation-invalidation-v1")
    check("inv_trigger_"+trigger,rec["trigger"]==trigger)
    check("inv_revoked_"+trigger,rec["new_state"]=="REVOKED")
    check("inv_lineage_"+trigger,rec["last_accepted_lineage_preserved"] is True)
    check("inv_no_mutation_"+trigger,rec["platform_pin_mutation_allowed"] is False)
    check("inv_no_fallback_"+trigger,rec["automatic_previous_version_fallback_allowed"] is False)
    check("inv_no_silent_"+trigger,rec["silent_repin_allowed"] is False)
    check("inv_no_source_"+trigger,rec["source_substitution_allowed"] is False)
    check("inv_no_candidate_"+trigger,rec["candidate_substitution_allowed"] is False)
    check("inv_runtime_"+trigger,rec["diagnostic_runtime"]=="GOVERNED_INACTIVE")
    check("inv_no_authority_"+trigger,rec["clinical_authority_transfer"] is False)
    check("inv_hash_"+trigger,len(rec["invalidation_sha256"])==64)
fixture=json.loads((GEN/"EP5_PKT02_COMPATIBILITY_ATTESTATION_FIXTURES.json").read_text(encoding="utf-8"))
check("fixture_schema",fixture["schema"]=="ekg-ep5-pkt02-compatibility-attestation-fixtures-v1")
for field in ["phi","raw_clinical_payloads_included","synthetic_fixtures_are_clinical_gold",
              "clinical_accuracy_claimed","diagnostic_performance_reporting_allowed",
              "platform_pin_mutation_allowed","silent_repin_allowed"]:
    check("fixture_false_"+field,fixture[field] is False)
check("fixture_runtime",fixture["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("fixture_count",len(fixture["scenarios"])==16)
ids=[x["id"] for x in fixture["scenarios"]]
check("fixture_unique",len(ids)==len(set(ids)))
for row in fixture["scenarios"]:
    check("fixture_id_"+row["id"],isinstance(row["id"],str) and bool(row["id"]))
    check("fixture_no_phi_"+row["id"],fixture["phi"] is False)
check("fixture_valid",next(x for x in fixture["scenarios"] if x["id"]=="valid-handshake-offer")["expected_state"]=="HANDSHAKE_ELIGIBLE")
check("fixture_crlf",next(x for x in fixture["scenarios"] if x["id"]=="crlf-checkout-translation")["expected_repository_content_match"] is True)
check("fixture_candidate",next(x for x in fixture["scenarios"] if x["id"]=="governed-pin-candidate")["expected_metadata_only"] is True)
check("fixture_recovery",next(x for x in fixture["scenarios"] if x["id"]=="recovery-capsule")["replay_stage2_or_ep5_pkt01"] is False)

print(json.dumps({
 "schema":"ekg-ep5-pkt02-compatibility-attestation-tests-v1",
 "pass":True,"passed":passed,"total":passed,"packet_id":att.PACKET_ID,
 "compatibility_state":"HANDSHAKE_ELIGIBLE","platform_current_pin_state":"STALE_PIN",
 "platform_pin_mutation_allowed":False,"silent_repin_allowed":False,
 "diagnostic_runtime":"GOVERNED_INACTIVE","approved_adjudicated_gold_count":0,
 "metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,
 "clinical_accuracy_claimed":False,"clinical_authority_transfer":False,
 "phi_included":False,"raw_clinical_payloads_included":False
},sort_keys=True))
