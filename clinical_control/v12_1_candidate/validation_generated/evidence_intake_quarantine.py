"""EP5 Packet 8 governed external evidence intake/quarantine envelope.

This module validates content-addressed metadata only. It cannot admit clinical
gold, report diagnostic performance, or activate EKG runtime.
"""
from __future__ import annotations
import hashlib,json,re
from typing import Any,Mapping,Sequence

SCHEMA="ekg-ep5-pkt08-evidence-intake-v1"
PACKET_ID="PKT-EP5-08"
PACKET_SHA256="af733f122378f0e9334bde639fd4e7b4cd65fbe2aba48353058341ef8df28404"
BASELINE_COMMIT="738b683d0526588eb7993985d013d5964c201601"
BASELINE_TREE="f8f55ad3448b39035f5f38e6be3ecc961790f038"
STAGE2_RECEIPT="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a"
ACCEPTED_EP5_PKT07={"packet_receipt_sha256":"39351cf862e72709dde205d431ddd0d802ef791ab5e0fd31ae5e7566ab5134ff","verification_receipt_sha256":"d2314268523a92e6c85d55d423de38f6bc5b8a105d62f61166c4ebba5be6f50f","output_sha256":"9a82ee9c35aa32a5c8c52bb275df3050a7ce43dd58fab004057b75b0d2c74f71","release_candidate_sha256":"1ad0dfb386a811c2d4de8ce851cac97234b4efb7ddb50cf5e66961c4c10c33af","manifest_identity_sha256":"b4600e178302de9f86c7ea1d599c05efc995a5a463e9dca43af628e97d1bb072","release_state":"ENGINEERING_READY_INACTIVE","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED"}
ACCEPTED_EP6_PKT07={"source_commit":"b257342a1f95097e1454e40b47ddeab4d51be5b3","source_tree":"f99327e90706d0348870c2f79e35e35a0a6f6e8a","packet_receipt_sha256":"c3b52f5a426259533fbc2c5cb6e0566886e9e0a9230536adb0ef374802b90fb5","verification_receipt_sha256":"5897bacfffccf885bea01e6daeb67938cb8f6ac7407b9faf36a4a1ea75764dca","output_sha256":"26ed13377a32f0a275b75abed7d92134e522e3c5137846390a00aa3bcc738939","status_sha256":"bbade5895aba149eb04a21702743dd843cbc79c4f3837a84f683a6b7145918e3","health_sha256":"1986caeb56a12214b07bcb14068f3b7102e367747c9de906cfd3243e6ea4038d","release_state":"ENGINEERING_READY_INACTIVE","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED"}
REQUIRED_IDENTITIES=("candidate_identity","source_provenance_identity","license_usage_authority_identity","deidentification_attestation_identity","label_schema_identity","adjudication_process_identity","conflict_resolution_policy_identity","quality_control_identity","verification_identity","content_hashes_identity")
QUARANTINE_BLOCKERS=("MISSING_OR_MALFORMED_PROVENANCE","UNSUPPORTED_LICENSE","MISSING_DEIDENTIFICATION_ATTESTATION","LABEL_SCHEMA_DRIFT","ADJUDICATION_CONFLICT","UNRESOLVED_LABEL_CONFLICT","QUALITY_CONTROL_FAILURE","VERIFICATION_FAILURE","CONTENT_HASH_DRIFT","DUPLICATE_OR_REPLAY_CANDIDATE","SOURCE_SUBSTITUTION","FABRICATED_METRIC_CLAIM","SYNTHETIC_EVIDENCE_AS_LIVE_ATTEMPT","PHI_OR_RAW_PAYLOAD_ATTEMPT")
INTAKE_STATES=("NONE","QUARANTINED","ELIGIBLE_FOR_GOVERNED_ADMISSION_REVIEW","BLOCKED","WITHDRAWN","REVOKED")
HEX64=re.compile(r"^[0-9a-f]{64}$")
ID=re.compile(r"^[a-z0-9][a-z0-9._:-]{2,119}$")

def _stable(v:Any)->Any:
 if isinstance(v,dict):return {k:_stable(v[k]) for k in sorted(v)}
 if isinstance(v,(list,tuple)):return [_stable(x) for x in v]
 return v
def _canon(v:Any)->bytes:return json.dumps(_stable(v),separators=(",",":"),ensure_ascii=False).encode()
def digest(v:Any)->str:return hashlib.sha256(v if isinstance(v,(bytes,bytearray)) else _canon(v)).hexdigest()
def _clone(v:Any)->Any:return json.loads(json.dumps(v))
def _hex(v:Any)->bool:return isinstance(v,str) and HEX64.fullmatch(v) is not None

def no_live_candidate_status()->dict[str,Any]:
 body={"schema":"ekg-ep5-pkt08-current-intake-status-v1","packet_id":PACKET_ID,"live_candidate_state":"NONE","live_candidate_present":False,"evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","raw_clinical_payloads_included":False,"phi_included":False,"credentials_included":False,"clinical_authority_transfer":False}
 return {**body,"status_sha256":digest(body)}

def evaluate_intake_candidate(metadata:Mapping[str,Any],known_candidate_ids:Sequence[str]=())->dict[str,Any]:
 if not isinstance(metadata,Mapping):raise ValueError("INTAKE_METADATA_REQUIRED")
 known=list(known_candidate_ids)
 if any(not _hex(x) for x in known):raise ValueError("KNOWN_CANDIDATE_ID_INVALID")
 blockers=[]
 ids={k:metadata.get(k) for k in REQUIRED_IDENTITIES}
 if not _hex(ids["candidate_identity"]):blockers.append("MISSING_OR_MALFORMED_PROVENANCE")
 for k in REQUIRED_IDENTITIES[1:]:
  if not _hex(ids[k]):blockers.append("MISSING_OR_MALFORMED_PROVENANCE")
 if metadata.get("provenance_valid") is not True:blockers.append("MISSING_OR_MALFORMED_PROVENANCE")
 if metadata.get("license_supported") is not True:blockers.append("UNSUPPORTED_LICENSE")
 if metadata.get("deidentification_attested") is not True:blockers.append("MISSING_DEIDENTIFICATION_ATTESTATION")
 if metadata.get("label_schema_valid") is not True:blockers.append("LABEL_SCHEMA_DRIFT")
 if metadata.get("adjudication_process_valid") is not True:blockers.append("ADJUDICATION_CONFLICT")
 if metadata.get("label_conflicts_resolved") is not True:blockers.append("UNRESOLVED_LABEL_CONFLICT")
 if metadata.get("quality_control_pass") is not True:blockers.append("QUALITY_CONTROL_FAILURE")
 if metadata.get("verification_pass") is not True:blockers.append("VERIFICATION_FAILURE")
 if metadata.get("content_hash_match") is not True:blockers.append("CONTENT_HASH_DRIFT")
 if _hex(ids.get("candidate_identity")) and ids["candidate_identity"] in set(known):blockers.append("DUPLICATE_OR_REPLAY_CANDIDATE")
 if metadata.get("source_substitution_attempt") is True:blockers.append("SOURCE_SUBSTITUTION")
 if metadata.get("fabricated_metric_claim") is True:blockers.append("FABRICATED_METRIC_CLAIM")
 if metadata.get("synthetic_or_test_evidence") is True:blockers.append("SYNTHETIC_EVIDENCE_AS_LIVE_ATTEMPT")
 if metadata.get("contains_phi") is True or metadata.get("raw_clinical_payloads_included") is True or metadata.get("patient_identifiers_included") is True or metadata.get("raw_patient_level_labels_included") is True:blockers.append("PHI_OR_RAW_PAYLOAD_ATTEMPT")
 blockers=sorted(set(blockers),key=lambda x:QUARANTINE_BLOCKERS.index(x))
 state="ELIGIBLE_FOR_GOVERNED_ADMISSION_REVIEW" if not blockers else "QUARANTINED"
 safe_ids={k:(v if _hex(v) else None) for k,v in ids.items()}
 body={"schema":SCHEMA,"packet_id":PACKET_ID,"packet_sha256":PACKET_SHA256,"baseline_commit":BASELINE_COMMIT,"baseline_tree":BASELINE_TREE,"stage2_receipt_sha256":STAGE2_RECEIPT,"accepted_ep5_pkt07":_clone(ACCEPTED_EP5_PKT07),"accepted_ep6_pkt07":_clone(ACCEPTED_EP6_PKT07),"state":state,"candidate_identity":safe_ids["candidate_identity"],"metadata_identities":safe_ids,"blockers":blockers,"metadata_complete":all(_hex(v) for v in ids.values()),"provenance_valid":metadata.get("provenance_valid") is True,"license_supported":metadata.get("license_supported") is True,"deidentification_attested":metadata.get("deidentification_attested") is True,"label_schema_valid":metadata.get("label_schema_valid") is True,"adjudication_process_valid":metadata.get("adjudication_process_valid") is True,"label_conflicts_resolved":metadata.get("label_conflicts_resolved") is True,"quality_control_pass":metadata.get("quality_control_pass") is True,"verification_pass":metadata.get("verification_pass") is True,"content_hash_match":metadata.get("content_hash_match") is True,"review_eligible":state=="ELIGIBLE_FOR_GOVERNED_ADMISSION_REVIEW","review_eligibility_is_admission":False,"intake_is_admission":False,"intake_is_activation":False,"evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_validity":"NOT_INFERRED","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","source_substitution_allowed":False,"automatic_previous_version_fallback_allowed":False,"clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False,"repository_artifact_metadata_only":True}
 return {**body,"intake_sha256":digest(body)}

def validate_intake(v:Mapping[str,Any])->bool:
 if not isinstance(v,Mapping):return False
 declared=v.get("intake_sha256"); material=dict(v); material.pop("intake_sha256",None)
 return _hex(declared) and declared==digest(material)

def intake_receipt(candidate:Mapping[str,Any],event_id:str)->dict[str,Any]:
 if not validate_intake(candidate):raise ValueError("INTAKE_INTEGRITY_FAILED")
 if not isinstance(event_id,str) or ID.fullmatch(event_id) is None:raise ValueError("EVENT_ID_INVALID")
 body={"schema":"ekg-ep5-pkt08-intake-receipt-v1","packet_id":PACKET_ID,"event_id":event_id,"candidate_identity":candidate.get("candidate_identity"),"intake_sha256":candidate["intake_sha256"],"state":candidate["state"],"blockers":list(candidate["blockers"]),"append_only":True,"evidence_admission_state_after":"NOT_ADMITTED","approved_adjudicated_gold_count_delta":0,"metric_maturity_after":"NOT_REPORTABLE","activation_eligibility_after":"NOT_ELIGIBLE","runtime_activation_performed":False,"clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False}
 return {**body,"receipt_sha256":digest(body)}

def lifecycle_receipt(candidate:Mapping[str,Any],*,state:str,event_id:str,reason:str)->dict[str,Any]:
 if not validate_intake(candidate):raise ValueError("INTAKE_INTEGRITY_FAILED")
 if state not in {"WITHDRAWN","REVOKED"}:raise ValueError("LIFECYCLE_STATE_UNSUPPORTED")
 if not isinstance(event_id,str) or ID.fullmatch(event_id) is None:raise ValueError("EVENT_ID_INVALID")
 if not isinstance(reason,str) or not reason.strip() or len(reason.strip())>280:raise ValueError("REASON_INVALID")
 body={"schema":"ekg-ep5-pkt08-lifecycle-receipt-v1","packet_id":PACKET_ID,"candidate_identity":candidate.get("candidate_identity"),"intake_sha256":candidate["intake_sha256"],"event_id":event_id,"state":state,"reason":reason.strip(),"append_only":True,"historical_candidate_preserved":True,"evidence_admission_state_after":"NOT_ADMITTED","approved_adjudicated_gold_count_delta":0,"runtime_activation_performed":False,"candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False}
 return {**body,"receipt_sha256":digest(body)}

def downstream_candidate_descriptor(candidate:Mapping[str,Any])->dict[str,Any]:
 if not validate_intake(candidate):raise ValueError("INTAKE_INTEGRITY_FAILED")
 body={"schema":"ekg-ep5-pkt08-downstream-candidate-descriptor-v1","packet_id":PACKET_ID,"candidate_identity":candidate.get("candidate_identity"),"intake_sha256":candidate["intake_sha256"],"intake_state":candidate["state"],"blockers":list(candidate["blockers"]),"metadata_complete":candidate["metadata_complete"],"review_eligible":candidate["review_eligible"],"review_eligibility_is_admission":False,"evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False,"repository_artifact_metadata_only":True}
 return {**body,"descriptor_sha256":digest(body)}

def git_object_portability(git_blob_bytes:bytes,checkout_bytes:bytes)->dict[str,Any]:
 if not isinstance(git_blob_bytes,(bytes,bytearray)) or not isinstance(checkout_bytes,(bytes,bytearray)):raise ValueError("PORTABILITY_BYTES_REQUIRED")
 blob=bytes(git_blob_bytes); checkout=bytes(checkout_bytes); normalized=checkout.replace(b"\r\n",b"\n")
 bs=hashlib.sha256(blob).hexdigest(); cs=hashlib.sha256(checkout).hexdigest(); ns=hashlib.sha256(normalized).hexdigest()
 body={"schema":"ekg-ep5-pkt08-git-object-portability-v1","git_blob_sha256":bs,"checkout_sha256":cs,"normalized_checkout_sha256":ns,"newline_translation_only":cs!=bs and ns==bs,"repository_content_match":cs==bs or ns==bs,"authority_basis":"GIT_OBJECT_BYTES","host_path_authoritative":False,"machine_name_authoritative":False,"shell_presentation_authoritative":False,"timestamps_authoritative":False,"ui_presentation_authoritative":False}
 return {**body,"portability_sha256":digest(body)}
