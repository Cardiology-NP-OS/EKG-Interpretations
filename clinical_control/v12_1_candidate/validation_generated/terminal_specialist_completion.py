"""EP5 Packet 9 terminal specialist completion freeze.

Final Stage-3 EKG engineering handoff. This module preserves an inactive,
non-clinical specialist completion state and cannot activate runtime, admit
clinical evidence, or claim diagnostic performance.
"""
from __future__ import annotations
import hashlib,json,re
from typing import Any,Mapping
SCHEMA="ekg-ep5-pkt09-terminal-specialist-v1"
PACKET_ID="PKT-EP5-09"
PACKET_SHA256="19773ef88d1f794bf06de59f0d485bc5df9d2b7f4c9fb23ed3ac7a8fbaba2cba"
BASELINE_COMMIT="ff527ae72fc93931ae316f321b3a4ea86fb9ce42"
BASELINE_TREE="dcda3b0002d408237441230e8ee272851dab5ad7"
STAGE2_RECEIPT="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a"
ACCEPTED_EP5_PKT08={"source_commit":BASELINE_COMMIT,"source_tree":BASELINE_TREE,"packet_receipt_sha256":"654d6895d4b38f70b5b4d6473958944f6ff073c73c238446067750b01bb0c985","verification_receipt_sha256":"79f8e360d37b825cbab8ea300709fd3f3f3510a2c95d40d62d392e4c86907397","output_sha256":"2bd3690ca07c6f3f81d367ee79a323b211acf56b7a378c16af9ff58133c8c57e","current_status_sha256":"3ba5ae917a46fed1842479f897ee0a732513ecbe1122e2d52a15c37f9f524014","eligible_intake_sha256":"248863c6e956e523f57a3aba43ba0cd067cf0b24dbe3e08d2a9d91deebbea266","descriptor_sha256":"bd0f267a2c87a6dc66e09b42efdb483aadd8d3916decfc194e9b00e8857e2f86","live_candidate_state":"NONE","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED"}
ACCEPTED_EP6_PKT08={"source_commit":"eaf9e95d4adce66200e4457a006aa7b5dafc4989","source_tree":"9163934dcb041bd4256bec9b3b5ca36c6369af2e","original_packet_receipt_sha256":"c9c7d208d18763f198f858bf594d8789c3a8dd4a2b4bb0e2323eacd8afa8afab","original_verification_receipt_sha256":"9a269000c8b4ad1c2930281bddce983a743bd78faf3889dc25902c599d4e24f5","correction_receipt_sha256":"e44f6c613355aeeaef6a4118031a546f39021419041249e196db877147484a3c","corrected_output_sha256":"716081121830c5052ccceb981d2b82819a9eb00888ff5aa49e5e1d614272e479","live_candidate_state":"NONE","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED"}
EP5_PKT02_CORRECTION_RECEIPT="10feb50167e9bcb8f72cc2781216bee960c983ff69ada10c4bf94ff349d326ad"
EP5_ACCEPTED_LINEAGE=(
("PKT-EP5-01","f6cbd29dba1dffe7324dac8084317231aab8f531b37206c30d87adc7235a066d","3020d3e43cf1040470c356e2d767a80276ea0a65b0519c7406e62577208e7bdb","8fcb157e6f1d997e24ef53b1d552c3e73d579a9e75690551c396c2bbeca1dbac"),
("PKT-EP5-02","8e630eeba354dcb86e4e6304b9e4f2a31376b50c2b9c964c0ae42f45df8df7be","be099b6f5a1e86ecbcb1b931d40dcf43fbfec3a7a5bb61040be0be2d02f388db","9f0fafdaa3fc88bfc3a9e6fdfaa243d3b61a833d516547c6a27e9e45f90406e7"),
("PKT-EP5-03","bf21e05a214a7331c3396aa567443c74943d72ac809bede01293e9c1397cfb62","c5ed10f3720743fb9379860512c18f779531449ffd79f2259a8b3fabd4303f98","3341639fb421086de677e042c0acfc334a812ca1da1e5595dc340bc4337909c5"),
("PKT-EP5-04","d45178cce21be604dd1049198b3d0650e9cf8e12dcf922c2382208d7ef831405","f23e9de2019a52e0beacd2e7346806fb561d39ea4fa687ea0db9a191487b86cb","dcbe5740121021b52730fa358f2a30363abf442d78305fe973ab66651383a054"),
("PKT-EP5-05","1e7d9529b264f1cbe113e762d89ab58c74b20d4e3b0ace656c5413931ea29212","25d341672b0039d88c15825dd3e51f4eefae299fc5ecddac7ce5e8b1cb8975ce","6f8b39b2041340c9277f19714d0e88e596e31e4f3714d8f2fd07529ef514476c"),
("PKT-EP5-06","c9811852cb5341a75f2bcb0182fb299cf2976b7289adf48e7e62b7ef58bd096c","c79206774c98388f208699a916984cf43806631f92eb4a9fac32b6ea1ec1d724","ffdd240b51a03703eae95095eb45cd7dad5dfc49c6aa967d5c90e622365f7e10"),
("PKT-EP5-07","39351cf862e72709dde205d431ddd0d802ef791ab5e0fd31ae5e7566ab5134ff","d2314268523a92e6c85d55d423de38f6bc5b8a105d62f61166c4ebba5be6f50f","9a82ee9c35aa32a5c8c52bb275df3050a7ce43dd58fab004057b75b0d2c74f71"),
("PKT-EP5-08","654d6895d4b38f70b5b4d6473958944f6ff073c73c238446067750b01bb0c985","79f8e360d37b825cbab8ea300709fd3f3f3510a2c95d40d62d392e4c86907397","2bd3690ca07c6f3f81d367ee79a323b211acf56b7a378c16af9ff58133c8c57e"),)
ACTIVATION_BLOCKERS=("NO_ADMITTED_GOVERNED_CLINICAL_GOLD","METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY")
LIMITATIONS=("NO_ADMITTED_GOVERNED_CLINICAL_GOLD","DIAGNOSTIC_METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY","DIAGNOSTIC_RUNTIME_GOVERNED_INACTIVE","CLINICAL_VALIDITY_NOT_INFERRED","ENGINEERING_COMPLETION_IS_NOT_CLINICAL_VALIDITY")
TERMINAL_EVENTS=("COMPLETION_MANIFEST_VIEWED","LINEAGE_VIEWED","LIMITATIONS_VIEWED","BLOCKERS_VIEWED","DOWNSTREAM_HANDOFF_VIEWED","REVOCATION_VIEWED","INVALID_TRANSITION_BLOCKED","FINAL_SAFE_STATUS_RETURNED")
REVOCATION_TRIGGERS=("RECEIPT_DRIFT","CORRECTION_OMISSION","CORRECTED_OUTPUT_DRIFT","SOURCE_IDENTITY_DRIFT","LINEAGE_TAMPER","HANDOFF_TAMPER","BLOCKER_DRIFT","FABRICATED_GOLD_OR_METRIC","SOURCE_SUBSTITUTION","PHI_OR_RAW_PAYLOAD_ATTEMPT","CLINICAL_VALIDITY_ESCALATION","RUNTIME_ACTIVATION_ATTEMPT")
_ID=re.compile(r"^[a-z0-9][a-z0-9._:-]{2,119}$")
def _stable(v:Any)->Any:
 if isinstance(v,dict): return {k:_stable(v[k]) for k in sorted(v)}
 if isinstance(v,(list,tuple)): return [_stable(x) for x in v]
 return v
def _canon(v:Any)->bytes:return json.dumps(_stable(v),separators=(",",":"),ensure_ascii=False).encode()
def digest(v:Any)->str:return hashlib.sha256(v if isinstance(v,(bytes,bytearray)) else _canon(v)).hexdigest()
def _clone(v:Any)->Any:return json.loads(json.dumps(v))
def lineage_digest()->dict[str,Any]:
 body={"schema":"ekg-ep5-pkt09-lineage-digest-v1","packet_id":PACKET_ID,"stage2_receipt_sha256":STAGE2_RECEIPT,"accepted_packet_history":[{"packet_id":a,"packet_receipt_sha256":b,"verification_receipt_sha256":c,"output_sha256":d} for a,b,c,d in EP5_ACCEPTED_LINEAGE],"ep5_pkt02_correction_receipt_sha256":EP5_PKT02_CORRECTION_RECEIPT,"ep5_pkt08":_clone(ACCEPTED_EP5_PKT08),"ep6_pkt08":_clone(ACCEPTED_EP6_PKT08),"activation_blockers":list(ACTIVATION_BLOCKERS),"limitations":list(LIMITATIONS),"correction_required":True,"correction_receipt_sha256":ACCEPTED_EP6_PKT08["correction_receipt_sha256"],"corrected_output_sha256":ACCEPTED_EP6_PKT08["corrected_output_sha256"],"acceptance_history_rewritten":False,"replay_prior_packets":False,"source_substitution_performed":False}
 return {**body,"lineage_sha256":digest(body)}
def create_terminal_manifest(**flags:Any)->dict[str,Any]:
 names=("receipt_drift","correction_omission","corrected_output_drift","source_identity_drift","lineage_tamper","handoff_tamper","blocker_drift","fabricated_gold_metric","source_substitution_attempt","phi_raw_payload_attempt","clinical_validity_escalation","runtime_activation_attempt")
 unknown=sorted(set(flags)-set(names))
 if unknown: raise ValueError("UNKNOWN_TERMINAL_FLAG:"+unknown[0])
 normalized={}
 for n in names:
  v=flags.get(n,False)
  if type(v) is not bool: raise ValueError(n.upper()+"_BOOLEAN_REQUIRED")
  normalized[n]=v
 reasons={"receipt_drift":"RECEIPT_DRIFT","correction_omission":"CORRECTION_OMISSION","corrected_output_drift":"CORRECTED_OUTPUT_DRIFT","source_identity_drift":"SOURCE_IDENTITY_DRIFT","lineage_tamper":"LINEAGE_TAMPER","handoff_tamper":"HANDOFF_TAMPER","blocker_drift":"BLOCKER_DRIFT","fabricated_gold_metric":"FABRICATED_GOLD_OR_METRIC","source_substitution_attempt":"SOURCE_SUBSTITUTION","phi_raw_payload_attempt":"PHI_OR_RAW_PAYLOAD_ATTEMPT","clinical_validity_escalation":"CLINICAL_VALIDITY_ESCALATION","runtime_activation_attempt":"RUNTIME_ACTIVATION_ATTEMPT"}
 invalidations=sorted(reasons[k] for k,v in normalized.items() if v)
 lineage=lineage_digest(); state="SPECIALIST_COMPLETE_INACTIVE" if not invalidations else "BLOCKED"
 body={"schema":SCHEMA,"packet_id":PACKET_ID,"packet_sha256":PACKET_SHA256,"baseline_commit":BASELINE_COMMIT,"baseline_tree":BASELINE_TREE,"stage2_receipt_sha256":STAGE2_RECEIPT,"accepted_ep5_pkt08":_clone(ACCEPTED_EP5_PKT08),"accepted_ep6_pkt08":_clone(ACCEPTED_EP6_PKT08),"lineage_sha256":lineage["lineage_sha256"],"completion_state":state,"engineering_handoff_complete":state=="SPECIALIST_COMPLETE_INACTIVE","terminal":True,"invalidations":invalidations,"activation_blockers":list(ACTIVATION_BLOCKERS),"limitations":list(LIMITATIONS),"live_candidate_state":"NONE","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","activation_authorized":False,"candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"evidence_admission_allowed":False,"runtime_activation_allowed":False,"source_substitution_allowed":False,"automatic_previous_version_fallback_allowed":False,"clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False,"correction_required":True,"correction_receipt_sha256":ACCEPTED_EP6_PKT08["correction_receipt_sha256"],"corrected_output_sha256":ACCEPTED_EP6_PKT08["corrected_output_sha256"],**normalized}
 return {**body,"completion_manifest_sha256":digest(body)}
def validate_terminal_manifest(v:Mapping[str,Any])->bool:
 if not isinstance(v,Mapping): return False
 try:
  names=("receipt_drift","correction_omission","corrected_output_drift","source_identity_drift","lineage_tamper","handoff_tamper","blocker_drift","fabricated_gold_metric","source_substitution_attempt","phi_raw_payload_attempt","clinical_validity_escalation","runtime_activation_attempt")
  return _canon(create_terminal_manifest(**{n:v[n] for n in names}))==_canon(dict(v))
 except (KeyError,TypeError,ValueError): return False
def downstream_handoff(manifest:Mapping[str,Any])->dict[str,Any]:
 if not validate_terminal_manifest(manifest): raise ValueError("TERMINAL_MANIFEST_INVALID")
 body={"schema":"ekg-ep5-pkt09-downstream-handoff-v1","packet_id":PACKET_ID,"completion_manifest_sha256":manifest["completion_manifest_sha256"],"lineage_sha256":manifest["lineage_sha256"],"completion_state":manifest["completion_state"],"engineering_handoff_complete":manifest["engineering_handoff_complete"],"activation_blockers":list(ACTIVATION_BLOCKERS),"limitations":list(LIMITATIONS),"correction_receipt_sha256":ACCEPTED_EP6_PKT08["correction_receipt_sha256"],"corrected_output_sha256":ACCEPTED_EP6_PKT08["corrected_output_sha256"],"live_candidate_state":"NONE","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED","status_metadata_only":True,"raw_clinical_payloads_included":False,"clinical_authority_transfer":False,"platform_owner_shell_authority_preserved":True}
 return {**body,"handoff_sha256":digest(body)}
def restart_recovery(manifest:Mapping[str,Any])->dict[str,Any]:
 if not validate_terminal_manifest(manifest): raise ValueError("TERMINAL_MANIFEST_INVALID")
 if manifest["completion_state"]!="SPECIALIST_COMPLETE_INACTIVE": raise ValueError("TERMINAL_STATE_NOT_RECOVERABLE")
 rebuilt=create_terminal_manifest(); body={"schema":"ekg-ep5-pkt09-restart-recovery-v1","packet_id":PACKET_ID,"source_manifest_sha256":manifest["completion_manifest_sha256"],"recovered_manifest_sha256":rebuilt["completion_manifest_sha256"],"lineage_sha256":rebuilt["lineage_sha256"],"exact_reproduction":_canon(rebuilt)==_canon(manifest),"replay_prior_packets":False,"source_substitution_performed":False,"evidence_admission_performed":False,"runtime_activation_performed":False,"diagnostic_runtime":"GOVERNED_INACTIVE","clinical_authority_transfer":False}
 return {**body,"recovery_sha256":digest(body)}
def revoke_handoff(manifest:Mapping[str,Any],*,trigger:str,reason:str)->dict[str,Any]:
 if not validate_terminal_manifest(manifest): raise ValueError("TERMINAL_MANIFEST_INVALID")
 if trigger not in REVOCATION_TRIGGERS: raise ValueError("REVOCATION_TRIGGER_UNSUPPORTED")
 if not isinstance(reason,str) or not reason.strip() or len(reason.strip())>280: raise ValueError("REVOCATION_REASON_INVALID")
 body={"schema":"ekg-ep5-pkt09-terminal-revocation-v1","packet_id":PACKET_ID,"completion_manifest_sha256":manifest["completion_manifest_sha256"],"lineage_sha256":manifest["lineage_sha256"],"state":"REVOKED","trigger":trigger,"reason":reason.strip(),"append_only":True,"accepted_history_preserved":True,"task_completion_preserved":True,"engineering_handoff_complete":False,"evidence_admission_performed":False,"runtime_activation_performed":False,"diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False}
 return {**body,"revocation_receipt_sha256":digest(body)}
def completion_observability_receipt(manifest:Mapping[str,Any],*,event:str,event_id:str)->dict[str,Any]:
 if not validate_terminal_manifest(manifest): raise ValueError("TERMINAL_MANIFEST_INVALID")
 if event not in TERMINAL_EVENTS: raise ValueError("OBSERVABILITY_EVENT_UNSUPPORTED")
 if not isinstance(event_id,str) or not _ID.fullmatch(event_id): raise ValueError("EVENT_ID_INVALID")
 body={"schema":"ekg-ep5-pkt09-observability-receipt-v1","packet_id":PACKET_ID,"completion_manifest_sha256":manifest["completion_manifest_sha256"],"lineage_sha256":manifest["lineage_sha256"],"event":event,"event_id":event_id,"append_only":True,"completion_state":manifest["completion_state"],"evidence_admission_performed":False,"runtime_activation_performed":False,"clinical_action_performed":False,"source_substitution_performed":False,"clinical_authority_transfer":False,"no_phi":True,"raw_clinical_payloads_included":False}
 return {**body,"observability_receipt_sha256":digest(body)}
def git_object_portability(git_blob_bytes:bytes,checkout_bytes:bytes)->dict[str,Any]:
 if not isinstance(git_blob_bytes,(bytes,bytearray)) or not isinstance(checkout_bytes,(bytes,bytearray)): raise ValueError("PORTABILITY_BYTES_REQUIRED")
 blob=bytes(git_blob_bytes); checkout=bytes(checkout_bytes); normalized=checkout.replace(b"\r\n",b"\n"); bs=hashlib.sha256(blob).hexdigest(); cs=hashlib.sha256(checkout).hexdigest(); ns=hashlib.sha256(normalized).hexdigest()
 body={"schema":"ekg-ep5-pkt09-git-object-portability-v1","git_blob_sha256":bs,"checkout_sha256":cs,"normalized_checkout_sha256":ns,"newline_translation_only":cs!=bs and ns==bs,"repository_content_match":cs==bs or ns==bs,"authority_basis":"GIT_OBJECT_BYTES","host_path_authoritative":False,"machine_name_authoritative":False,"shell_presentation_authoritative":False,"timestamps_authoritative":False,"ui_presentation_authoritative":False,"cache_state_authoritative":False,"filesystem_metadata_authoritative":False}
 return {**body,"portability_sha256":digest(body)}
