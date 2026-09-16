"""EP5 Packet 6 governed clinical-evidence admission readiness.

This module is metadata-only governance. It can evaluate whether opaque future
external evidence metadata is structurally ready for governed review, but it
cannot admit clinical gold, ingest raw clinical payloads/PHI, report diagnostic
performance, or activate EKG runtime.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, Mapping, Sequence

SCHEMA="ekg-ep5-pkt06-evidence-admission-readiness-v1"
PACKET_ID="PKT-EP5-06"
PACKET_SHA256="7e6fa688dba977898a17647495a38a71524d9fb249afe77c5e6a96e586166fb2"
BASELINE_COMMIT="db71c98539d7894ea1a3d40d7aa2c9a7b0b24dd4"
BASELINE_TREE="777f1bd10d59ccecb2e7f4894aea7ca88745b0d2"
STAGE2_RECEIPT_SHA256="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a"
ACCEPTED_EP5_PKT05={
 "semantic_commit":"46aa705d07df78f63a11428759c97fcdeb1246f3",
 "semantic_tree":"39546d118ddd96d34616906dc8389ecd0504350a",
 "packet_receipt_sha256":"1e7d9529b264f1cbe113e762d89ab58c74b20d4e3b0ace656c5413931ea29212",
 "verification_receipt_sha256":"25d341672b0039d88c15825dd3e51f4eefae299fc5ecddac7ce5e8b1cb8975ce",
 "output_sha256":"6f8b39b2041340c9277f19714d0e88e596e31e4f3714d8f2fd07529ef514476c",
 "acknowledgement_sha256":"28ba3c1b5faa70318039df941c754f6696b5fc0479b5378ce1f274b91cbd2a42",
 "activation_eligibility_sha256":"643fa95bdbcc972776d4f0feb63173bb7b0e24bb6ddb7fd3e65e067b8adbe5d1",
}
POST_ACCEPTANCE_HARDENING={
 "commit":BASELINE_COMMIT,"tree":BASELINE_TREE,"candidate_ci_run_id":35048086619,
 "main_ci_run_id":35048187405,"independent_machine_focused_assertions":323,
 "semantic_state_unchanged":True,
}
ACCEPTED_EP6_PKT05={
 "source_commit":"4fce9d6151baf0909cbe082e871bbcc3e90aa4e4",
 "source_tree":"94b7cb5347c6868cf9dbfbb5d542dd865a1396a0",
 "packet_receipt_sha256":"9da1e69920d1918857db665c47f05e38273c272cac0a4ef1f1de94ee932ec5ba",
 "verification_receipt_sha256":"16966d17e3c97e4efb6f8083e9b2ca04217d3eae1fc65542db402f2d81c580de",
 "output_sha256":"d2bc9d2789159add476496ec7f88eaebc06f75bc3f0f3776653ee9b21c4806a8",
 "activation_readiness_sha256":"8c45f4c8af020d8a6b690df0aa73067430e27b7a2bc0792526e90b18691f61b3",
 "health_sha256":"9c4e682390490d02b332ac8bb0f86774d177521584e22f95983e82c0e71882e7",
 "portability_sha256":"258aac9c7624502cdaa0444f9668b448740bb7fd2cb931c07e753fe0bd41993b",
 "platform_metadata_freshness":"FRESH","activation_eligibility":"NOT_ELIGIBLE",
 "approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE",
 "diagnostic_runtime":"GOVERNED_INACTIVE","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY",
 "clinical_validity":"NOT_INFERRED",
}
REQUIRED_PRECONDITIONS=(
 "source_identity_sha256","provenance_license_sha256","deidentification_attestation_sha256",
 "label_schema_sha256","adjudication_process_sha256","conflict_resolution_sha256",
 "quality_control_sha256","independent_verification_receipt_sha256",
 "governed_admission_authority_receipt_sha256",
)
ADMISSION_STATES=("NOT_ADMITTED","ELIGIBLE_FOR_GOVERNED_REVIEW","BLOCKED","ADMITTED","REVOKED")
REVIEW_REVOCATION_TRIGGERS=(
 "SOURCE_REVOKED","PROVENANCE_REVOKED","LICENSE_REVOKED","DEIDENTIFICATION_REVOKED",
 "ADJUDICATION_REVOKED","QUALITY_CONTROL_REVOKED","EVIDENCE_HASH_DRIFT","SCHEMA_DRIFT",
 "INDEPENDENT_VERIFICATION_REVOKED","ADMISSION_AUTHORITY_REVOKED","PHI_BOUNDARY_BREACH",
 "SYNTHETIC_EVIDENCE_DISCOVERED","FABRICATED_METRIC_DISCOVERED","AUTHORITY_ESCALATION",
)
_H64=re.compile(r"^[a-f0-9]{64}$")
_ID=re.compile(r"^[a-z0-9][a-z0-9._:-]{2,119}$")


def _canonical(value:Any)->bytes:
 return json.dumps(value,sort_keys=True,separators=(",",":")).encode("utf-8")

def digest(value:Any)->str:
 return hashlib.sha256(value if isinstance(value,bytes) else _canonical(value)).hexdigest()

def _clone(value:Any)->Any:
 return json.loads(json.dumps(value))

def _safe_id(value:str,code:str)->str:
 if not isinstance(value,str) or not _ID.fullmatch(value): raise ValueError(code)
 return value

def _hash(value:Any,code:str)->str:
 if not isinstance(value,str) or not _H64.fullmatch(value): raise ValueError(code)
 return value

def _bool(value:Any,code:str)->bool:
 if type(value) is not bool: raise ValueError(code)
 return value

def _validate_metadata(metadata:Mapping[str,Any]|None)->Dict[str,str]:
 if metadata is None: return {}
 if not isinstance(metadata,Mapping): raise ValueError("CANDIDATE_METADATA_INVALID")
 unknown=sorted(set(metadata)-set(REQUIRED_PRECONDITIONS))
 if unknown: raise ValueError("CANDIDATE_METADATA_UNKNOWN:"+unknown[0])
 result={}
 for key,value in metadata.items(): result[key]=_hash(value,"CANDIDATE_METADATA_HASH_INVALID:"+key)
 return result

def _base_truth()->Dict[str,Any]:
 return {
  "evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,
  "metric_maturity":"NOT_REPORTABLE","separate_governed_activation_authority_present":False,
  "activation_eligibility":"NOT_ELIGIBLE","diagnostic_performance_reporting_allowed":False,
  "clinical_accuracy_claimed":False,"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,
  "evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED",
  "clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,
  "credentials_included":False,
 }

def current_admission_status()->Dict[str,Any]:
 body={
  "schema":"ekg-ep5-pkt06-current-admission-status-v1","packet_id":PACKET_ID,
  "packet_sha256":PACKET_SHA256,"baseline_commit":BASELINE_COMMIT,"baseline_tree":BASELINE_TREE,
  "stage2_receipt_sha256":STAGE2_RECEIPT_SHA256,"accepted_ep5_pkt05":_clone(ACCEPTED_EP5_PKT05),
  "post_acceptance_hardening":_clone(POST_ACCEPTANCE_HARDENING),"accepted_ep6_pkt05":_clone(ACCEPTED_EP6_PKT05),
  **_base_truth(),"metadata_only":True,"raw_clinical_payloads_allowed":False,"phi_allowed":False,
  "synthetic_fixtures_can_be_clinical_gold":False,"fabricated_metrics_allowed":False,
  "review_readiness_is_admission":False,"admission_is_activation":False,
  "future_admission_preconditions":list(REQUIRED_PRECONDITIONS),"unmet_preconditions":list(REQUIRED_PRECONDITIONS),
  "immutable":True,
 }
 return {**body,"current_status_sha256":digest(body)}

def validate_current_admission_status(value:Mapping[str,Any])->bool:
 if not isinstance(value,Mapping): return False
 try:
  return _canonical(dict(value))==_canonical(current_admission_status())
 except (TypeError,ValueError): return False

def evaluate_admission_candidate(
 metadata:Mapping[str,Any]|None=None,*,simulation_only:bool=False,synthetic_evidence_attempt:bool=False,
 phi_included:bool=False,raw_clinical_payloads_included:bool=False,fabricated_metrics_attempt:bool=False,
 authority_escalation_attempt:bool=False,quality_control_failed:bool=False,adjudication_conflict:bool=False,
 source_license_mismatch:bool=False,evidence_hash_drift:bool=False,schema_drift:bool=False,
)->Dict[str,Any]:
 md=_validate_metadata(metadata)
 for value,code in [
  (simulation_only,"SIMULATION_BOOLEAN_REQUIRED"),(synthetic_evidence_attempt,"SYNTHETIC_BOOLEAN_REQUIRED"),
  (phi_included,"PHI_BOOLEAN_REQUIRED"),(raw_clinical_payloads_included,"RAW_PAYLOAD_BOOLEAN_REQUIRED"),
  (fabricated_metrics_attempt,"FABRICATED_METRICS_BOOLEAN_REQUIRED"),(authority_escalation_attempt,"AUTHORITY_ESCALATION_BOOLEAN_REQUIRED"),
  (quality_control_failed,"QC_BOOLEAN_REQUIRED"),(adjudication_conflict,"ADJUDICATION_CONFLICT_BOOLEAN_REQUIRED"),
  (source_license_mismatch,"SOURCE_LICENSE_BOOLEAN_REQUIRED"),(evidence_hash_drift,"EVIDENCE_DRIFT_BOOLEAN_REQUIRED"),
  (schema_drift,"SCHEMA_DRIFT_BOOLEAN_REQUIRED")]: _bool(value,code)
 blockers=[]
 missing=[key for key in REQUIRED_PRECONDITIONS if key not in md]
 blockers.extend("MISSING_PRECONDITION:"+key for key in missing)
 if synthetic_evidence_attempt: blockers.append("SYNTHETIC_EVIDENCE_EXCLUDED")
 if phi_included: blockers.append("PHI_INCLUDED")
 if raw_clinical_payloads_included: blockers.append("RAW_CLINICAL_PAYLOAD_INCLUDED")
 if fabricated_metrics_attempt: blockers.append("FABRICATED_METRIC_ATTEMPT")
 if authority_escalation_attempt: blockers.append("AUTHORITY_ESCALATION")
 if quality_control_failed: blockers.append("QUALITY_CONTROL_FAILURE")
 if adjudication_conflict: blockers.append("ADJUDICATION_CONFLICT")
 if source_license_mismatch: blockers.append("SOURCE_LICENSE_MISMATCH")
 if evidence_hash_drift: blockers.append("EVIDENCE_HASH_DRIFT")
 if schema_drift: blockers.append("SCHEMA_DRIFT")
 blockers=sorted(set(blockers))
 review_state="ELIGIBLE_FOR_GOVERNED_REVIEW" if not blockers else "BLOCKED"
 body={
  "schema":"ekg-ep5-pkt06-admission-candidate-evaluation-v1","packet_id":PACKET_ID,
  "candidate_metadata":md,"candidate_metadata_sha256":digest(md),"review_state":review_state,
  "residual_blockers":blockers,"missing_preconditions":missing,"simulation_only":simulation_only,
  "synthetic_evidence_attempt":synthetic_evidence_attempt,"phi_included":phi_included,
  "raw_clinical_payloads_included":raw_clinical_payloads_included,"fabricated_metrics_attempt":fabricated_metrics_attempt,
  "authority_escalation_attempt":authority_escalation_attempt,"quality_control_failed":quality_control_failed,
  "adjudication_conflict":adjudication_conflict,"source_license_mismatch":source_license_mismatch,
  "evidence_hash_drift":evidence_hash_drift,"schema_drift":schema_drift,
  "clinical_gold_admitted":False,"approved_adjudicated_gold_count_delta":0,
  "evidence_admission_state_after":"NOT_ADMITTED","activation_eligibility_after":"NOT_ELIGIBLE",
  "metric_maturity_after":"NOT_REPORTABLE","diagnostic_runtime_after":"GOVERNED_INACTIVE",
  "candidate_active_after":False,"diagnostic_performance_reporting_allowed":False,
  "clinical_accuracy_claimed":False,"clinical_authority_transfer":False,"admission_effect_performed":False,
  "runtime_activation_performed":False,"metadata_only":True,"immutable":True,
 }
 return {**body,"evaluation_sha256":digest(body)}

def validate_candidate_evaluation(value:Mapping[str,Any])->bool:
 if not isinstance(value,Mapping): return False
 try:
  kwargs={k:value[k] for k in ["simulation_only","synthetic_evidence_attempt","phi_included","raw_clinical_payloads_included","fabricated_metrics_attempt","authority_escalation_attempt","quality_control_failed","adjudication_conflict","source_license_mismatch","evidence_hash_drift","schema_drift"]}
  rebuilt=evaluate_admission_candidate(value["candidate_metadata"],**kwargs)
  return _canonical(rebuilt)==_canonical(dict(value))
 except (KeyError,TypeError,ValueError): return False

def admission_review_receipt(evaluation:Mapping[str,Any],*,review_id:str,decision:str="REVIEW_RECORDED")->Dict[str,Any]:
 if not validate_candidate_evaluation(evaluation): raise ValueError("EVALUATION_INVALID")
 review_id=_safe_id(review_id,"REVIEW_ID_INVALID")
 if decision not in ("REVIEW_RECORDED","REVIEW_BLOCKED"): raise ValueError("REVIEW_DECISION_INVALID")
 if decision=="REVIEW_RECORDED" and evaluation["review_state"]!="ELIGIBLE_FOR_GOVERNED_REVIEW": raise ValueError("REVIEW_NOT_ELIGIBLE")
 body={
  "schema":"ekg-ep5-pkt06-admission-review-receipt-v1","packet_id":PACKET_ID,"review_id":review_id,
  "evaluation_sha256":evaluation["evaluation_sha256"],"decision":decision,"append_only":True,
  "clinical_gold_admitted":False,"approved_adjudicated_gold_count_delta":0,"evidence_admission_state_after":"NOT_ADMITTED",
  "activation_eligibility_after":"NOT_ELIGIBLE","diagnostic_runtime_after":"GOVERNED_INACTIVE",
  "diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,
  "clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,
 }
 return {**body,"review_receipt_sha256":digest(body)}

def revoke_admission_review(evaluation:Mapping[str,Any],*,trigger:str,reason:str)->Dict[str,Any]:
 if not validate_candidate_evaluation(evaluation): raise ValueError("EVALUATION_INVALID")
 if trigger not in REVIEW_REVOCATION_TRIGGERS: raise ValueError("REVOCATION_TRIGGER_UNSUPPORTED")
 if not isinstance(reason,str) or not reason.strip() or len(reason.strip())>280: raise ValueError("REVOCATION_REASON_INVALID")
 body={
  "schema":"ekg-ep5-pkt06-admission-review-revocation-v1","packet_id":PACKET_ID,
  "evaluation_sha256":evaluation["evaluation_sha256"],"state":"REVOKED","trigger":trigger,"reason":reason.strip(),
  "append_only":True,"clinical_gold_admitted":False,"evidence_admission_state_after":"NOT_ADMITTED",
  "approved_adjudicated_gold_count_delta":0,"activation_eligibility_after":"NOT_ELIGIBLE",
  "diagnostic_runtime_after":"GOVERNED_INACTIVE","runtime_activation_performed":False,
  "clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,
 }
 return {**body,"revocation_receipt_sha256":digest(body)}

def activation_precondition_status(evaluation:Mapping[str,Any]|None=None)->Dict[str,Any]:
 if evaluation is not None and not validate_candidate_evaluation(evaluation): raise ValueError("EVALUATION_INVALID")
 body={
  "schema":"ekg-ep5-pkt06-activation-precondition-status-v1","packet_id":PACKET_ID,
  "evaluation_sha256":evaluation["evaluation_sha256"] if evaluation else None,
  "review_state":evaluation["review_state"] if evaluation else "NO_CANDIDATE",
  "evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,
  "metric_maturity":"NOT_REPORTABLE","separate_governed_activation_authority_present":False,
  "activation_eligibility":"NOT_ELIGIBLE","activation_blockers":["NO_ADMITTED_GOVERNED_CLINICAL_GOLD","METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY"],
  "review_readiness_satisfies_activation":False,"metadata_freshness_satisfies_activation":False,
  "engineering_release_satisfies_activation":False,"diagnostic_performance_reporting_allowed":False,
  "clinical_accuracy_claimed":False,"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,
  "clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,
 }
 return {**body,"activation_precondition_sha256":digest(body)}

def downstream_evidence_readiness_descriptor(evaluation:Mapping[str,Any]|None=None)->Dict[str,Any]:
 pre=activation_precondition_status(evaluation)
 body={
  "schema":"ekg-ep5-pkt06-downstream-evidence-readiness-v1","packet_id":PACKET_ID,
  "current_status_sha256":current_admission_status()["current_status_sha256"],
  "evaluation_sha256":evaluation["evaluation_sha256"] if evaluation else None,
  "review_state":evaluation["review_state"] if evaluation else "NO_CANDIDATE",
  "evidence_admission_state":"NOT_ADMITTED","unmet_activation_preconditions":list(pre["activation_blockers"]),
  "approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE",
  "diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY",
  "clinical_validity":"NOT_INFERRED","diagnostic_performance_reporting_allowed":False,
  "clinical_accuracy_claimed":False,"clinical_authority_transfer":False,"metadata_only":True,
  "phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False,
 }
 return {**body,"descriptor_sha256":digest(body)}

def git_object_portability(git_blob_bytes:bytes,checkout_bytes:bytes)->Dict[str,Any]:
 if not isinstance(git_blob_bytes,(bytes,bytearray)) or not isinstance(checkout_bytes,(bytes,bytearray)): raise ValueError("PORTABILITY_BYTES_REQUIRED")
 blob=bytes(git_blob_bytes); checkout=bytes(checkout_bytes); normalized=checkout.replace(b"\r\n",b"\n")
 blob_sha=hashlib.sha256(blob).hexdigest(); checkout_sha=hashlib.sha256(checkout).hexdigest(); normalized_sha=hashlib.sha256(normalized).hexdigest()
 body={
  "schema":"ekg-ep5-pkt06-git-object-portability-v1","git_blob_sha256":blob_sha,
  "checkout_sha256":checkout_sha,"normalized_checkout_sha256":normalized_sha,
  "newline_translation_only":checkout_sha!=blob_sha and normalized_sha==blob_sha,
  "repository_content_match":checkout_sha==blob_sha or normalized_sha==blob_sha,
  "authority_basis":"GIT_OBJECT_BYTES","host_path_authoritative":False,"machine_name_authoritative":False,
  "shell_presentation_authoritative":False,"timestamps_authoritative":False,"ui_presentation_authoritative":False,
 }
 return {**body,"portability_sha256":digest(body)}
