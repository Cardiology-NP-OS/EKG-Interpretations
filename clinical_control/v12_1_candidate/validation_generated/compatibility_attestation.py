from __future__ import annotations
import hashlib
import json
from typing import Any, Dict, Mapping

SCHEMA="ekg-ep5-pkt02-platform-compatibility-attestation-v1"
PACKET_ID="PKT-EP5-02"
PACKET_SHA256="8a139661488c60a7235461c2dcc92b4c918425820a3a5c9c06a2ae10622981cb"
BASELINE_COMMIT="4a9c196bc384117cb8ce39c3363c1b152d6de2d7"
BASELINE_TREE="7e081088f561e24f864bec094ef42a4aad6a58d8"
STAGE2_RECEIPT_SHA256="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a"
PRIOR_EP5_PACKET_RECEIPT="f6cbd29dba1dffe7324dac8084317231aab8f531b37206c30d87adc7235a066d"
PRIOR_EP5_VERIFICATION_RECEIPT="3020d3e43cf1040470c356e2d767a80276ea0a65b0519c7406e62577208e7bdb"
EP6_PACKET_RECEIPT="a1587a09cdeec4109527d6488d0942e1d5a8076fc573845f21404424d859c3c5"
EP6_OWNER_RUNTIME_MANIFEST="908822fcfcde38bd1032416377da71149689d5cbc82c4af189604aabcec30ffa"
PLATFORM_COMMIT="729adc31fcfb8162d8afc1d31dbcfa167aea1b25"
PLATFORM_TREE="1ffbdc37447686b6d38e1f3574e80cbee5721e08"
PLATFORM_STAGE2_EKG_PIN={
 "commit":"6fbf1814258813bfb6ff78407e013cf23ff9e07d",
 "tree":"01442274b34bf40ae600ee1ee21de8f15ae3b4de",
 "runtime_status":"GOVERNED_INACTIVE",
}
GOVERNED_PIN_CANDIDATE={
 "commit":BASELINE_COMMIT,"tree":BASELINE_TREE,"runtime_status":"GOVERNED_INACTIVE",
 "packet_receipt_sha256":PRIOR_EP5_PACKET_RECEIPT,
 "verification_receipt_sha256":PRIOR_EP5_VERIFICATION_RECEIPT,
}
REJECTION_TRIGGERS=(
 "stale_ep5_receipt","ep6_manifest_mismatch","ekg_identity_drift","source_substitution",
 "manifest_tamper","runtime_activation_attempt","fabricated_clinical_gold",
 "clinical_accuracy_claim","diagnostic_performance_claim","clinical_authority_escalation",
 "revoked_evidence","provenance_mismatch","ci_proof_missing","independent_verification_missing",
 "phi_or_raw_clinical_payload","automatic_platform_mutation_attempt",
)

def _canonical(value: Any)->bytes:
 return json.dumps(value,sort_keys=True,separators=(",",":")).encode("utf-8")

def digest(value: Any)->str:
 return hashlib.sha256(_canonical(value)).hexdigest()

def _hex(value: str,length: int,code: str)->str:
 if not isinstance(value,str) or len(value)!=length:
  raise ValueError(code)
 try:
  int(value,16)
 except ValueError as exc:
  raise ValueError(code) from exc
 return value.lower()
def git_object_portability(git_blob_bytes: bytes,checkout_bytes: bytes)->Dict[str,Any]:
 blob_sha=hashlib.sha256(git_blob_bytes).hexdigest()
 checkout_sha=hashlib.sha256(checkout_bytes).hexdigest()
 normalized=checkout_bytes.replace(b"\r\n",b"\n")
 normalized_sha=hashlib.sha256(normalized).hexdigest()
 translation_only=checkout_sha!=blob_sha and normalized_sha==blob_sha
 return {
  "schema":"ekg-ep5-pkt02-git-object-portability-v1",
  "git_blob_sha256":blob_sha,"checkout_sha256":checkout_sha,
  "normalized_checkout_sha256":normalized_sha,
  "newline_translation_only":translation_only,
  "repository_content_match":checkout_sha==blob_sha or translation_only,
  "authority_basis":"GIT_OBJECT_BYTES",
 }

def reproducibility_capsule(*,python_version: str,node_version: str,os_family: str)->Dict[str,Any]:
 for name,value in (("python_version",python_version),("node_version",node_version),("os_family",os_family)):
  if not isinstance(value,str) or not value.strip() or len(value)>120:
   raise ValueError("INVALID_"+name.upper())
 body={
  "schema":"ekg-ep5-pkt02-reproducibility-capsule-v1",
  "repository":"Cardiology-NP-OS/EKG-Interpretations",
  "accepted_ekg_commit":BASELINE_COMMIT,"accepted_ekg_tree":BASELINE_TREE,
  "prior_packet_receipt_sha256":PRIOR_EP5_PACKET_RECEIPT,
  "prior_verification_receipt_sha256":PRIOR_EP5_VERIFICATION_RECEIPT,
  "stage2_receipt_sha256":STAGE2_RECEIPT_SHA256,
  "python_version":python_version.strip(),"node_version":node_version.strip(),"os_family":os_family.strip(),
  "gate_entry_points":["npm test","npm run gate:ci","tools/ep3_pkt09_integration_freeze_gate.py",
                       "tools/ep5_pkt01_stage3_baseline_gate.py","tools/ep5_pkt02_compatibility_attestation_gate.py"],
  "replay_stage2_or_ep5_pkt01":False,"raw_clinical_payloads_required":False,
  "phi_required":False,"credentials_required":False,
 }
 return {**body,"capsule_sha256":digest(body)}

def build_attestation(*,attestation_commit: str,attestation_tree: str,github_ci_receipt_sha256: str,
 independent_verification_receipt_sha256: str,reproducibility: Mapping[str,Any],
 github_ci_pass: bool,independent_machine_pass: bool,provenance_integrity_pass: bool,no_phi_verified: bool,
 platform_owner_runtime_manifest_sha256: str=EP6_OWNER_RUNTIME_MANIFEST,
 platform_commit: str=PLATFORM_COMMIT,platform_tree: str=PLATFORM_TREE)->Dict[str,Any]:
 attestation_commit=_hex(attestation_commit,40,"ATTESTATION_COMMIT_INVALID")
 attestation_tree=_hex(attestation_tree,40,"ATTESTATION_TREE_INVALID")
 github_ci_receipt_sha256=_hex(github_ci_receipt_sha256,64,"CI_RECEIPT_INVALID")
 independent_verification_receipt_sha256=_hex(independent_verification_receipt_sha256,64,"INDEPENDENT_RECEIPT_INVALID")
 platform_owner_runtime_manifest_sha256=_hex(platform_owner_runtime_manifest_sha256,64,"PLATFORM_MANIFEST_INVALID")
 platform_commit=_hex(platform_commit,40,"PLATFORM_COMMIT_INVALID")
 platform_tree=_hex(platform_tree,40,"PLATFORM_TREE_INVALID")
 for name,value in (("github_ci_pass",github_ci_pass),("independent_machine_pass",independent_machine_pass),
                    ("provenance_integrity_pass",provenance_integrity_pass),("no_phi_verified",no_phi_verified)):
  if type(value) is not bool: raise ValueError("INVALID_"+name.upper())
 blockers=[]
 if platform_owner_runtime_manifest_sha256!=EP6_OWNER_RUNTIME_MANIFEST: blockers.append("EP6_OWNER_RUNTIME_MANIFEST_MISMATCH")
 if platform_commit!=PLATFORM_COMMIT or platform_tree!=PLATFORM_TREE: blockers.append("PLATFORM_IDENTITY_MISMATCH")
 if not github_ci_pass: blockers.append("GITHUB_CI_PROOF_MISSING")
 if not independent_machine_pass: blockers.append("INDEPENDENT_MACHINE_PROOF_MISSING")
 if not provenance_integrity_pass: blockers.append("PROVENANCE_INTEGRITY_PROOF_MISSING")
 if not no_phi_verified: blockers.append("NO_PHI_PROOF_MISSING")
 pin_delta=(PLATFORM_STAGE2_EKG_PIN["commit"]!=BASELINE_COMMIT or PLATFORM_STAGE2_EKG_PIN["tree"]!=BASELINE_TREE)
 body={
  "schema":SCHEMA,"packet_id":PACKET_ID,"packet_sha256":PACKET_SHA256,
  "baseline_commit":BASELINE_COMMIT,"baseline_tree":BASELINE_TREE,
  "attestation_commit":attestation_commit,"attestation_tree":attestation_tree,
  "stage2_receipt_sha256":STAGE2_RECEIPT_SHA256,
  "prior_ep5_packet_receipt_sha256":PRIOR_EP5_PACKET_RECEIPT,
  "prior_ep5_verification_receipt_sha256":PRIOR_EP5_VERIFICATION_RECEIPT,
  "downstream_ep6_packet_receipt_sha256":EP6_PACKET_RECEIPT,
  "downstream_ep6_owner_runtime_manifest_sha256":platform_owner_runtime_manifest_sha256,
  "downstream_platform_commit":platform_commit,"downstream_platform_tree":platform_tree,
  "accepted_stage2_platform_ekg_pin":dict(PLATFORM_STAGE2_EKG_PIN),
  "governed_pin_candidate":dict(GOVERNED_PIN_CANDIDATE),
  "pin_delta_present":pin_delta,"compatibility_state":"HANDSHAKE_ELIGIBLE" if not blockers else "BLOCKED",
  "platform_pin_mutation_performed":False,"platform_pin_mutation_allowed":False,
  "automatic_repin_performed":False,"silent_repin_allowed":False,
  "compatibility_handshake_required":pin_delta,
  "github_ci_receipt_sha256":github_ci_receipt_sha256,
  "independent_verification_receipt_sha256":independent_verification_receipt_sha256,
  "github_ci_pass":github_ci_pass,"independent_machine_pass":independent_machine_pass,
  "provenance_integrity_pass":provenance_integrity_pass,"no_phi_verified":no_phi_verified,
  "reproducibility_capsule":dict(reproducibility),"residual_blockers":sorted(blockers),
  "approved_adjudicated_gold_count":0,"clinical_gold_admission_performed":False,
  "metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,
  "clinical_accuracy_claimed":False,"candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE",
  "clinical_authority_transferred":False,"runtime_activation_performed":False,
  "diagnostic_inference_performed":False,"prescribing_performed":False,
  "treatment_recommendation_performed":False,"patient_specific_cds_performed":False,
  "automatic_clinical_action_performed":False,"raw_clinical_payloads_included":False,
  "phi_included":False,"synthetic_fixtures_are_clinical_gold":False,
  "source_substitution_allowed":False,"candidate_substitution_allowed":False,
  "automatic_previous_version_fallback_allowed":False,
 }
 body["attestation_sha256"]=digest(body)
 body["immutable"]=True
 return body

def validate_attestation(value: Mapping[str,Any])->Dict[str,Any]:
 blockers=[]
 if value.get("schema")!=SCHEMA or value.get("packet_id")!=PACKET_ID or value.get("packet_sha256")!=PACKET_SHA256:
  blockers.append("PACKET_IDENTITY_MISMATCH")
 if value.get("baseline_commit")!=BASELINE_COMMIT or value.get("baseline_tree")!=BASELINE_TREE:
  blockers.append("BASELINE_IDENTITY_MISMATCH")
 if value.get("stage2_receipt_sha256")!=STAGE2_RECEIPT_SHA256:
  blockers.append("STAGE2_RECEIPT_MISMATCH")
 if value.get("prior_ep5_packet_receipt_sha256")!=PRIOR_EP5_PACKET_RECEIPT:
  blockers.append("PRIOR_EP5_PACKET_RECEIPT_MISMATCH")
 if value.get("prior_ep5_verification_receipt_sha256")!=PRIOR_EP5_VERIFICATION_RECEIPT:
  blockers.append("PRIOR_EP5_VERIFICATION_RECEIPT_MISMATCH")
 if value.get("downstream_ep6_packet_receipt_sha256")!=EP6_PACKET_RECEIPT:
  blockers.append("EP6_PACKET_RECEIPT_MISMATCH")
 if value.get("downstream_ep6_owner_runtime_manifest_sha256")!=EP6_OWNER_RUNTIME_MANIFEST:
  blockers.append("EP6_OWNER_RUNTIME_MANIFEST_MISMATCH")
 if value.get("downstream_platform_commit")!=PLATFORM_COMMIT or value.get("downstream_platform_tree")!=PLATFORM_TREE:
  blockers.append("PLATFORM_IDENTITY_MISMATCH")
 if value.get("accepted_stage2_platform_ekg_pin")!=PLATFORM_STAGE2_EKG_PIN:
  blockers.append("STAGE2_PLATFORM_PIN_MISMATCH")
 if value.get("governed_pin_candidate")!=GOVERNED_PIN_CANDIDATE:
  blockers.append("GOVERNED_PIN_CANDIDATE_MISMATCH")
 if value.get("pin_delta_present") is not True or value.get("compatibility_handshake_required") is not True:
  blockers.append("PIN_DELTA_NOT_EXPLICIT")
 for field in ("platform_pin_mutation_performed","platform_pin_mutation_allowed","automatic_repin_performed",
               "silent_repin_allowed","diagnostic_performance_reporting_allowed","clinical_accuracy_claimed",
               "candidate_active","clinical_authority_transferred","runtime_activation_performed",
               "diagnostic_inference_performed","prescribing_performed","treatment_recommendation_performed",
               "patient_specific_cds_performed","automatic_clinical_action_performed",
               "raw_clinical_payloads_included","phi_included","synthetic_fixtures_are_clinical_gold",
               "source_substitution_allowed","candidate_substitution_allowed","automatic_previous_version_fallback_allowed"):
  if value.get(field) is not False: blockers.append("FORBIDDEN_ESCALATION:"+field)
 if value.get("diagnostic_runtime")!="GOVERNED_INACTIVE": blockers.append("DIAGNOSTIC_RUNTIME_NOT_INACTIVE")
 if value.get("approved_adjudicated_gold_count")!=0 or value.get("clinical_gold_admission_performed") is not False:
  blockers.append("CLINICAL_GOLD_STATE_INVALID")
 if value.get("metric_maturity")!="NOT_REPORTABLE": blockers.append("METRIC_MATURITY_INVALID")
 proofs=("github_ci_pass","independent_machine_pass","provenance_integrity_pass","no_phi_verified")
 missing=[x for x in proofs if value.get(x) is not True]
 blockers.extend("PROOF_MISSING:"+x for x in missing)
 if value.get("compatibility_state")!=("HANDSHAKE_ELIGIBLE" if not value.get("residual_blockers") else "BLOCKED"):
  blockers.append("COMPATIBILITY_STATE_INVALID")
 if sorted(value.get("residual_blockers",[]))!=sorted([x for x in blockers if x.startswith(("EP6_","PLATFORM_","PROOF_"))]):
  if value.get("residual_blockers"): blockers.append("RESIDUAL_BLOCKERS_MISMATCH")
 supplied=value.get("attestation_sha256")
 unsigned={k:v for k,v in value.items() if k not in {"attestation_sha256","immutable"}}
 if supplied!=digest(unsigned): blockers.append("ATTESTATION_SHA256_MISMATCH")
 if value.get("immutable") is not True: blockers.append("ATTESTATION_NOT_IMMUTABLE")
 return {"schema":"ekg-ep5-pkt02-attestation-validation-v1","valid":not blockers,
         "blockers":sorted(set(blockers)),"compatibility_state":"HANDSHAKE_ELIGIBLE" if not blockers else "BLOCKED",
         "diagnostic_runtime":"GOVERNED_INACTIVE","platform_pin_mutation_allowed":False}
def compatibility_challenge(attestation: Mapping[str,Any],*,owner_runtime_manifest_sha256: str=EP6_OWNER_RUNTIME_MANIFEST,
 platform_commit: str=PLATFORM_COMMIT,platform_tree: str=PLATFORM_TREE)->Dict[str,Any]:
 validation=validate_attestation(attestation)
 owner_runtime_manifest_sha256=_hex(owner_runtime_manifest_sha256,64,"OWNER_RUNTIME_MANIFEST_INVALID")
 platform_commit=_hex(platform_commit,40,"PLATFORM_COMMIT_INVALID")
 platform_tree=_hex(platform_tree,40,"PLATFORM_TREE_INVALID")
 blockers=list(validation["blockers"])
 if owner_runtime_manifest_sha256!=EP6_OWNER_RUNTIME_MANIFEST: blockers.append("EP6_OWNER_RUNTIME_MANIFEST_MISMATCH")
 if platform_commit!=PLATFORM_COMMIT or platform_tree!=PLATFORM_TREE: blockers.append("PLATFORM_IDENTITY_MISMATCH")
 body={
  "schema":"ekg-ep5-pkt02-compatibility-challenge-v1","attestation_sha256":attestation.get("attestation_sha256"),
  "owner_runtime_manifest_sha256":owner_runtime_manifest_sha256,"platform_commit":platform_commit,
  "platform_tree":platform_tree,"state":"ELIGIBLE" if not blockers else "BLOCKED",
  "blockers":sorted(set(blockers)),"secret_material_included":False,"credential_material_included":False,
  "platform_pin_mutation_performed":False,"silent_repin_allowed":False,
  "diagnostic_runtime":"GOVERNED_INACTIVE","clinical_authority_transfer":False,
 }
 return {**body,"challenge_sha256":digest(body)}

def pin_candidate_record(attestation: Mapping[str,Any])->Dict[str,Any]:
 validation=validate_attestation(attestation)
 body={
  "schema":"ekg-ep5-pkt02-governed-pin-candidate-v1",
  "attestation_sha256":attestation.get("attestation_sha256"),
  "candidate":dict(GOVERNED_PIN_CANDIDATE),"state":"CANDIDATE_ONLY" if validation["valid"] else "BLOCKED",
  "metadata_only":True,"platform_write_performed":False,"platform_write_allowed":False,
  "runtime_activation_performed":False,"diagnostic_runtime":"GOVERNED_INACTIVE",
  "clinical_authority_transfer":False,"clinical_validity_inferred":False,
 }
 return {**body,"record_sha256":digest(body)}

def platform_status_descriptor(attestation: Mapping[str,Any])->Dict[str,Any]:
 validation=validate_attestation(attestation)
 body={
  "schema":"ekg-ep5-pkt02-platform-compatibility-status-v1",
  "attestation_sha256":attestation.get("attestation_sha256"),
  "status":"HANDSHAKE_ELIGIBLE" if validation["valid"] else "BLOCKED",
  "platform_current_pin_state":"STALE_PIN","governed_candidate_available":validation["valid"],
  "accepted_stage2_pin":dict(PLATFORM_STAGE2_EKG_PIN),"governed_pin_candidate":dict(GOVERNED_PIN_CANDIDATE),
  "residual_blockers":list(validation["blockers"]),"silent_repin_allowed":False,
  "automatic_repin_performed":False,"platform_pin_mutation_performed":False,
  "diagnostic_runtime":"GOVERNED_INACTIVE","approved_adjudicated_gold_count":0,
  "metric_maturity":"NOT_REPORTABLE","clinical_accuracy_claimed":False,
  "diagnostic_performance_reporting_allowed":False,"clinical_authority_transfer":False,
  "raw_clinical_payloads_included":False,"phi_included":False,
 }
 return {**body,"descriptor_sha256":digest(body)}
def recovery_capsule(attestation: Mapping[str,Any])->Dict[str,Any]:
 validation=validate_attestation(attestation)
 body={
  "schema":"ekg-ep5-pkt02-recovery-capsule-v1","attestation_sha256":attestation.get("attestation_sha256"),
  "state":"READY" if validation["valid"] else "BLOCKED","accepted_ekg_commit":BASELINE_COMMIT,
  "accepted_ekg_tree":BASELINE_TREE,"prior_packet_receipt_sha256":PRIOR_EP5_PACKET_RECEIPT,
  "prior_verification_receipt_sha256":PRIOR_EP5_VERIFICATION_RECEIPT,
  "resume_from_git_object_identity":True,"replay_stage2_or_ep5_pkt01":False,
  "automatic_previous_version_fallback_allowed":False,"source_substitution_allowed":False,
  "candidate_substitution_allowed":False,"platform_pin_mutation_allowed":False,
  "diagnostic_runtime":"GOVERNED_INACTIVE","clinical_authority_transfer":False,
  "raw_clinical_payloads_required":False,"phi_required":False,
 }
 return {**body,"recovery_capsule_sha256":digest(body)}

def invalidation_record(*,attestation_sha256: str,trigger: str,reason: str)->Dict[str,Any]:
 attestation_sha256=_hex(attestation_sha256,64,"ATTESTATION_SHA256_INVALID")
 if trigger not in REJECTION_TRIGGERS: raise ValueError("INVALIDATION_TRIGGER_UNSUPPORTED")
 if not isinstance(reason,str) or not reason.strip() or len(reason)>280: raise ValueError("INVALIDATION_REASON_REQUIRED")
 body={
  "schema":"ekg-ep5-pkt02-attestation-invalidation-v1","attestation_sha256":attestation_sha256,
  "trigger":trigger,"reason":reason.strip(),"new_state":"REVOKED","last_accepted_lineage_preserved":True,
  "platform_pin_mutation_allowed":False,"automatic_previous_version_fallback_allowed":False,
  "silent_repin_allowed":False,"source_substitution_allowed":False,"candidate_substitution_allowed":False,
  "diagnostic_runtime":"GOVERNED_INACTIVE","clinical_authority_transfer":False,
 }
 return {**body,"invalidation_sha256":digest(body)}
