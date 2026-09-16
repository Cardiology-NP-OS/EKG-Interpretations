"""EP5 Packet 7 engineering-ready inactive EKG release candidate.

Engineering release metadata only. No function in this module can admit clinical
gold, claim diagnostic performance, or activate EKG runtime.
"""
from __future__ import annotations
import hashlib,json,re
from typing import Any,Dict,Mapping,Sequence

SCHEMA="ekg-ep5-pkt07-release-candidate-v1"
PACKET_ID="PKT-EP5-07"
PACKET_SHA256="f542e48060490806f632eadd8f823c2433d20c171d00e7b2e743429245b11aef"
BASELINE_COMMIT="5a111da7a116327b717f85fa153a71f1606564da"
BASELINE_TREE="e14b3bdc25005b3c5e4624bb852bd6638200ac86"
STAGE2_RECEIPT="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a"
ACCEPTED_EP5_PKT06={"source_commit":BASELINE_COMMIT,"source_tree":BASELINE_TREE,"packet_receipt_sha256":"c9811852cb5341a75f2bcb0182fb299cf2976b7289adf48e7e62b7ef58bd096c","verification_receipt_sha256":"c79206774c98388f208699a916984cf43806631f92eb4a9fac32b6ea1ec1d724","output_sha256":"ffdd240b51a03703eae95095eb45cd7dad5dfc49c6aa967d5c90e622365f7e10","current_status_sha256":"5aea6dca62004e569f0b0d96bc42b14e7b6a2e042fb9f3e55fc730c4380ae57a","review_evaluation_sha256":"e396f2388ef4cbd1d0dcb345b49a4ca70d1c027e5541c5e837c90c08619c8046","activation_precondition_sha256":"ea1975e6c59fa247ae96d01bae07cd5bd562d490e9cd656983d9cbb95004389c","descriptor_sha256":"fe1cd93ccd2ec7636ebc15c9a1aef2c8b67b72fa89f2f31f401b68e2f90710a2","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED"}
ACCEPTED_EP6_PKT06={"source_commit":"b9a511319eaae9b04eafa319b25ac4f549a45081","source_tree":"b25f72da931eeca3c09ce5ddec4bfb0515b3e281","packet_receipt_sha256":"5bbc2713c016dfbe50ff0723bfab745624e35de96063d402bb66d4e4c23e6125","verification_receipt_sha256":"d7b1773fc184402171de0aee300c0330cf5ce3be711c9de2293e4c07d563a93a","output_sha256":"8dfebff420c3c9fc5ea2990a674068249d62a8d7a8cb8ea4a43c3bf4ff0b2797","status_sha256":"11f77d778ed5879be4d99557070227ccf83c616a6e5839529b199f8153879e25","health_sha256":"8b3a8019722033734d0bfb5b70541c8857b9d6a5f93b6ad05b52f9bda2b3e25d","live_evidence_candidate_state":"NONE","evidence_admission_state":"NOT_ADMITTED","review_workflow_capability":"AVAILABLE","review_capability_proof_is_simulation":True,"approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED"}
ACTIVATION_BLOCKERS=("NO_ADMITTED_GOVERNED_CLINICAL_GOLD","METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY")
LIMITATIONS=("NO_ADMITTED_GOVERNED_CLINICAL_GOLD","DIAGNOSTIC_METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY","DIAGNOSTIC_RUNTIME_GOVERNED_INACTIVE","CLINICAL_VALIDITY_NOT_INFERRED","ENGINEERING_READINESS_IS_NOT_CLINICAL_VALIDITY")
RELEASE_STATES=("ENGINEERING_READY_INACTIVE","BLOCKED","REVOKED")
REVOCATION_TRIGGERS=("RECEIPT_DRIFT","EVIDENCE_STATE_DRIFT","GOLD_COUNT_DRIFT","METRIC_MATURITY_DRIFT","ACTIVATION_AUTHORITY_DRIFT","RUNTIME_ACTIVATION_ATTEMPT","SOURCE_SUBSTITUTION","CLINICAL_VALIDITY_ESCALATION","PROVENANCE_TAMPER","MANIFEST_TAMPER")
_ID=re.compile(r"^[a-z0-9][a-z0-9._:-]{2,119}$")

def _canonical(v:Any)->bytes:return json.dumps(v,sort_keys=True,separators=(",",":")).encode()
def digest(v:Any)->str:return hashlib.sha256(v if isinstance(v,bytes) else _canonical(v)).hexdigest()
def _clone(v:Any)->Any:return json.loads(json.dumps(v))
def _bool(v:Any,code:str)->bool:
 if type(v) is not bool:raise ValueError(code)
 return v

def create_release_candidate(*,receipt_drift=False,evidence_state_drift=False,gold_count_drift=False,metric_maturity_drift=False,activation_authority_drift=False,runtime_activation_attempt=False,source_substitution_attempt=False,clinical_validity_escalation_attempt=False,provenance_tamper=False,manifest_tamper=False)->Dict[str,Any]:
 flags={"receipt_drift":receipt_drift,"evidence_state_drift":evidence_state_drift,"gold_count_drift":gold_count_drift,"metric_maturity_drift":metric_maturity_drift,"activation_authority_drift":activation_authority_drift,"runtime_activation_attempt":runtime_activation_attempt,"source_substitution_attempt":source_substitution_attempt,"clinical_validity_escalation_attempt":clinical_validity_escalation_attempt,"provenance_tamper":provenance_tamper,"manifest_tamper":manifest_tamper}
 for k,v in flags.items():_bool(v,k.upper()+"_BOOLEAN_REQUIRED")
 mapping={"receipt_drift":"RECEIPT_DRIFT","evidence_state_drift":"EVIDENCE_STATE_DRIFT","gold_count_drift":"GOLD_COUNT_DRIFT","metric_maturity_drift":"METRIC_MATURITY_DRIFT","activation_authority_drift":"ACTIVATION_AUTHORITY_DRIFT","runtime_activation_attempt":"RUNTIME_ACTIVATION_ATTEMPT","source_substitution_attempt":"SOURCE_SUBSTITUTION","clinical_validity_escalation_attempt":"CLINICAL_VALIDITY_ESCALATION","provenance_tamper":"PROVENANCE_TAMPER","manifest_tamper":"MANIFEST_TAMPER"}
 invalidations=sorted(mapping[k] for k,v in flags.items() if v)
 state="ENGINEERING_READY_INACTIVE" if not invalidations else "BLOCKED"
 blocker_set=list(ACTIVATION_BLOCKERS)
 identity={"packet_id":PACKET_ID,"packet_sha256":PACKET_SHA256,"baseline_commit":BASELINE_COMMIT,"baseline_tree":BASELINE_TREE,"stage2_receipt_sha256":STAGE2_RECEIPT,"ep5_pkt06_packet_receipt_sha256":ACCEPTED_EP5_PKT06["packet_receipt_sha256"],"ep5_pkt06_verification_receipt_sha256":ACCEPTED_EP5_PKT06["verification_receipt_sha256"],"ep6_pkt06_packet_receipt_sha256":ACCEPTED_EP6_PKT06["packet_receipt_sha256"],"ep6_pkt06_verification_receipt_sha256":ACCEPTED_EP6_PKT06["verification_receipt_sha256"]}
 body={"schema":SCHEMA,**identity,"accepted_ep5_pkt06":_clone(ACCEPTED_EP5_PKT06),"accepted_ep6_pkt06":_clone(ACCEPTED_EP6_PKT06),"state":state,"invalidations":invalidations,"activation_blockers":blocker_set,"limitations":list(LIMITATIONS),"manifest_identity_sha256":digest({"identity":identity,"blockers":blocker_set,"limitations":list(LIMITATIONS)}),"engineering_release_ready":state=="ENGINEERING_READY_INACTIVE","integration_ready":state=="ENGINEERING_READY_INACTIVE","activation_authorized":False,"runtime_activation_performed":False,"candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE","evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","separate_governed_activation_authority_present":False,"diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_validity":"NOT_INFERRED","engineering_release_is_clinical_validity":False,"metadata_freshness_is_clinical_validity":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","source_substitution_allowed":False,"automatic_previous_version_fallback_allowed":False,"clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False,"immutable":True,**flags}
 return {**body,"release_candidate_sha256":digest(body)}

def validate_release_candidate(v:Mapping[str,Any])->bool:
 if not isinstance(v,Mapping):return False
 try:
  flags={k:v[k] for k in ["receipt_drift","evidence_state_drift","gold_count_drift","metric_maturity_drift","activation_authority_drift","runtime_activation_attempt","source_substitution_attempt","clinical_validity_escalation_attempt","provenance_tamper","manifest_tamper"]}
  return _canonical(create_release_candidate(**flags))==_canonical(dict(v))
 except (KeyError,TypeError,ValueError):return False

def restart_recovery_candidate(candidate:Mapping[str,Any])->Dict[str,Any]:
 if not validate_release_candidate(candidate):raise ValueError("RELEASE_CANDIDATE_INVALID")
 if candidate["state"]!="ENGINEERING_READY_INACTIVE":raise ValueError("RELEASE_CANDIDATE_NOT_RECOVERABLE")
 rebuilt=create_release_candidate()
 body={"schema":"ekg-ep5-pkt07-restart-recovery-v1","packet_id":PACKET_ID,"source_release_candidate_sha256":candidate["release_candidate_sha256"],"recovered_release_candidate_sha256":rebuilt["release_candidate_sha256"],"state":"RECOVERED_INACTIVE","exact_reproduction":rebuilt==candidate,"replay_prior_packets":False,"raw_clinical_payloads_loaded":False,"runtime_activation_performed":False,"diagnostic_runtime":"GOVERNED_INACTIVE","clinical_authority_transfer":False}
 return {**body,"recovery_sha256":digest(body)}

def revoke_release_candidate(candidate:Mapping[str,Any],*,trigger:str,reason:str)->Dict[str,Any]:
 if not validate_release_candidate(candidate):raise ValueError("RELEASE_CANDIDATE_INVALID")
 if trigger not in REVOCATION_TRIGGERS:raise ValueError("REVOCATION_TRIGGER_UNSUPPORTED")
 if not isinstance(reason,str) or not reason.strip() or len(reason.strip())>280:raise ValueError("REVOCATION_REASON_INVALID")
 body={"schema":"ekg-ep5-pkt07-release-revocation-v1","packet_id":PACKET_ID,"release_candidate_sha256":candidate["release_candidate_sha256"],"state":"REVOKED","trigger":trigger,"reason":reason.strip(),"append_only":True,"historical_candidate_preserved":True,"runtime_activation_performed":False,"candidate_active":False,"diagnostic_runtime":"GOVERNED_INACTIVE","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False}
 return {**body,"revocation_receipt_sha256":digest(body)}

def downstream_release_descriptor(candidate:Mapping[str,Any],revocation:Mapping[str,Any]|None=None)->Dict[str,Any]:
 if not validate_release_candidate(candidate):raise ValueError("RELEASE_CANDIDATE_INVALID")
 state=candidate["state"]
 if revocation is not None:
  if not isinstance(revocation,Mapping) or revocation.get("release_candidate_sha256")!=candidate["release_candidate_sha256"] or revocation.get("state")!="REVOKED":raise ValueError("REVOCATION_INVALID")
  check=dict(revocation); declared=check.pop("revocation_receipt_sha256",None)
  if declared!=digest(check):raise ValueError("REVOCATION_INVALID")
  state="REVOKED"
 body={"schema":"ekg-ep5-pkt07-downstream-release-descriptor-v1","packet_id":PACKET_ID,"release_candidate_sha256":candidate["release_candidate_sha256"],"state":state,"engineering_release_ready":candidate["engineering_release_ready"] and state=="ENGINEERING_READY_INACTIVE","integration_ready":candidate["integration_ready"] and state=="ENGINEERING_READY_INACTIVE","activation_blockers":list(candidate["activation_blockers"]),"limitations":list(candidate["limitations"]),"evidence_admission_state":"NOT_ADMITTED","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","activation_authorized":False,"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False,"platform_owner_shell_authority_preserved":True}
 return {**body,"descriptor_sha256":digest(body)}

def git_object_portability(git_blob_bytes:bytes,checkout_bytes:bytes)->Dict[str,Any]:
 if not isinstance(git_blob_bytes,(bytes,bytearray)) or not isinstance(checkout_bytes,(bytes,bytearray)):raise ValueError("PORTABILITY_BYTES_REQUIRED")
 blob=bytes(git_blob_bytes); checkout=bytes(checkout_bytes); normalized=checkout.replace(b"\r\n",b"\n")
 bs=hashlib.sha256(blob).hexdigest(); cs=hashlib.sha256(checkout).hexdigest(); ns=hashlib.sha256(normalized).hexdigest()
 body={"schema":"ekg-ep5-pkt07-git-object-portability-v1","git_blob_sha256":bs,"checkout_sha256":cs,"normalized_checkout_sha256":ns,"newline_translation_only":cs!=bs and ns==bs,"repository_content_match":cs==bs or ns==bs,"authority_basis":"GIT_OBJECT_BYTES","host_path_authoritative":False,"machine_name_authoritative":False,"shell_presentation_authoritative":False,"timestamps_authoritative":False,"ui_presentation_authoritative":False}
 return {**body,"portability_sha256":digest(body)}
