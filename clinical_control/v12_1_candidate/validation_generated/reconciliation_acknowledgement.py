"""EP5 Packet 5 post-reconciliation acknowledgement and activation-ineligibility lock.

Governance/evidence metadata only. FRESH Platform metadata is not clinical evidence.
This module cannot activate EKG runtime and does not admit clinical gold.
"""
from __future__ import annotations
import hashlib,json,re
from typing import Any,Mapping

SCHEMA="ekg-ep5-pkt05-reconciliation-acknowledgement-v1"
PACKET_ID="PKT-EP5-05"
PACKET_SHA256="f6c69d7d7a8d8cc8fc8c8060f14caa69fba582d38b4ce07ae93f54cf0db1e507"
BASELINE_COMMIT="732eb96b0ee4c3890fe56f0bbd9021af3922d814"
BASELINE_TREE="105d565019beccae6f134946caa4d9869ee350a2"
STAGE2_RECEIPT_SHA256="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a"
PRIOR_PACKET_RECEIPT_SHA256="d45178cce21be604dd1049198b3d0650e9cf8e12dcf922c2382208d7ef831405"
PRIOR_VERIFICATION_RECEIPT_SHA256="f23e9de2019a52e0beacd2e7346806fb561d39ea4fa687ea0db9a191487b86cb"
PRIOR_AUTHORIZATION_SHA256="ebe4e9627e4554f877c015e5439dc38a9c6a270de72473e7c8e0581d56d62e0e"
PRIOR_AUTHORIZATION_CHALLENGE_SHA256="4a50a815270de095f793587c0d36e83ba36513f1cf3fb57185daee886c20ffbf"

EP6_PKT04={
 "source_commit":"25975668d8db5d6168de4c37ccaddc9635f5430a","source_tree":"793a4a7307921327e450c2c79d8de435e8fa32ba",
 "packet_receipt_sha256":"8b639cc0d631ca1002df2694096dd2afbea19468396369dc283effe1bab6b609",
 "verification_receipt_sha256":"4957e81b6ec8b0276337233270f4af5cd1724ba2c32905628bd2b6be615f6a0c",
 "output_sha256":"6673eacd4ed3bc04c5a2aa7ddad5a12303bbefedcca5810d0e4dcd1cbd96853b",
 "consumption_sha256":"97bfdf9d7449a371b12a888e21466c75e1bef732dcc4266f6c6988ac334d51bf",
 "overlay_sha256":"7687ff1d063d99e12d412bea4d46c8db142a4733a9acc788880531aa3983d38d",
 "successor_continuity_sha256":"0582467d9fd8b923397a1a997a308c3d07db3d1f1916fed1d67006245c3f825f",
 "reconciliation_descriptor_sha256":"ed8f920996089f8ed20dcd8ebefdf42f663c3a606efc4a53de2e961af83603ea",
 "replay_attempt_sha256":"d6010a5c2cae52a7f4a28b244108d4b24bbff282c722286d483dd375eda4d30f",
 "revocation_sha256":"7a5e25fa1090438b6521b4db9619fafe90afdca1e96050abdf48f92904f08c7c",
 "portability_sha256":"729e6fc00180c3451a2de409357d0135485a85d8a0c2986ce985066ce5b31949",
 "freshness_after":"FRESH","diagnostic_runtime":"GOVERNED_INACTIVE","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED"
}
ACTIVATION_TRUTH={
 "approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,
 "clinical_accuracy_claimed":False,"separate_governed_activation_authority_present":False,"activation_eligibility":"NOT_ELIGIBLE",
 "diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False
}
HISTORICAL_STAGE2_PIN={
 "repository":"Cardiology-NP-OS/EKG-Interpretations","commit":"6fbf1814258813bfb6ff78407e013cf23ff9e07d",
 "tree":"01442274b34bf40ae600ee1ee21de8f15ae3b4de","runtime_status":"GOVERNED_INACTIVE"
}
ACTIVE_STAGE3_PIN={
 "repository":"Cardiology-NP-OS/EKG-Interpretations","commit":"09ec7010191ecca0336abb9fccf369ce182c89e1",
 "tree":"6f5f1c261816f8cf33001802fdfb4237b80f387b","runtime_status":"GOVERNED_INACTIVE"
}
H64=re.compile(r"^[a-f0-9]{64}$");H40=re.compile(r"^[a-f0-9]{40}$")
def canonical(v:Any)->bytes:return json.dumps(v,sort_keys=True,separators=(",",":")).encode()
def digest(v:Any)->str:return hashlib.sha256(v if isinstance(v,bytes) else canonical(v)).hexdigest()
def clone(v:Any)->Any:return json.loads(json.dumps(v))
def h(v:str,n:int,code:str)->str:
 if not isinstance(v,str) or not (H40 if n==40 else H64).fullmatch(v):raise ValueError(code)
 return v

def expected_bindings()->dict[str,str]:
 return {"ep6_source_commit":EP6_PKT04["source_commit"],"ep6_source_tree":EP6_PKT04["source_tree"],"ep6_packet_receipt_sha256":EP6_PKT04["packet_receipt_sha256"],"ep6_verification_receipt_sha256":EP6_PKT04["verification_receipt_sha256"],"ep6_output_sha256":EP6_PKT04["output_sha256"],"consumption_sha256":EP6_PKT04["consumption_sha256"],"overlay_sha256":EP6_PKT04["overlay_sha256"],"successor_continuity_sha256":EP6_PKT04["successor_continuity_sha256"],"reconciliation_descriptor_sha256":EP6_PKT04["reconciliation_descriptor_sha256"],"replay_attempt_sha256":EP6_PKT04["replay_attempt_sha256"],"revocation_sha256":EP6_PKT04["revocation_sha256"],"portability_sha256":EP6_PKT04["portability_sha256"]}

def create_acknowledgement(*,bindings:Mapping[str,str]|None=None,platform_freshness:str="FRESH",historical_stage2_pin_rewritten:bool=False,continuity_mutated:bool=False,replay_accepted:bool=False,portability_pass:bool=True,reconciliation_revoked:bool=False,fabricated_clinical_gold_attempt:bool=False,runtime_activation_attempt:bool=False,source_substitution_attempt:bool=False,clinical_authority_escalation_attempt:bool=False,clinical_validity_escalation_attempt:bool=False)->dict[str,Any]:
 b=dict(expected_bindings());
 if bindings is not None:
  if not isinstance(bindings,Mapping):raise ValueError("BINDINGS_INVALID")
  for k,v in bindings.items():
   if k not in b:raise ValueError("BINDING_UNKNOWN:"+str(k))
   b[k]=v
 h(b["ep6_source_commit"],40,"EP6_COMMIT_INVALID");h(b["ep6_source_tree"],40,"EP6_TREE_INVALID")
 for k,v in b.items():
  if k not in {"ep6_source_commit","ep6_source_tree"}:h(v,64,"BINDING_HASH_INVALID:"+k)
 flags={"historical_stage2_pin_rewritten":historical_stage2_pin_rewritten,"continuity_mutated":continuity_mutated,"replay_accepted":replay_accepted,"portability_pass":portability_pass,"reconciliation_revoked":reconciliation_revoked,"fabricated_clinical_gold_attempt":fabricated_clinical_gold_attempt,"runtime_activation_attempt":runtime_activation_attempt,"source_substitution_attempt":source_substitution_attempt,"clinical_authority_escalation_attempt":clinical_authority_escalation_attempt,"clinical_validity_escalation_attempt":clinical_validity_escalation_attempt}
 if any(type(v) is not bool for v in flags.values()):raise ValueError("BOOLEAN_FLAG_REQUIRED")
 blockers=[]
 for k,v in expected_bindings().items():
  if b[k]!=v:blockers.append("EP6_PROOF_MISMATCH:"+k)
 if platform_freshness!="FRESH":blockers.append("PLATFORM_FRESHNESS_MISMATCH")
 if historical_stage2_pin_rewritten:blockers.append("HISTORICAL_PIN_REWRITE")
 if continuity_mutated:blockers.append("CONTINUITY_MUTATION")
 if replay_accepted:blockers.append("REPLAY_ACCEPTED")
 if not portability_pass:blockers.append("PORTABILITY_FAILURE")
 if reconciliation_revoked:blockers.append("RECONCILIATION_REVOKED")
 if fabricated_clinical_gold_attempt:blockers.append("FABRICATED_CLINICAL_GOLD")
 if runtime_activation_attempt:blockers.append("RUNTIME_ACTIVATION_ATTEMPT")
 if source_substitution_attempt:blockers.append("SOURCE_SUBSTITUTION")
 if clinical_authority_escalation_attempt:blockers.append("CLINICAL_AUTHORITY_ESCALATION")
 if clinical_validity_escalation_attempt:blockers.append("CLINICAL_VALIDITY_ESCALATION")
 blockers=sorted(set(blockers))
 body={"schema":SCHEMA,"packet_id":PACKET_ID,"packet_sha256":PACKET_SHA256,"baseline_commit":BASELINE_COMMIT,"baseline_tree":BASELINE_TREE,"stage2_receipt_sha256":STAGE2_RECEIPT_SHA256,"prior_packet_receipt_sha256":PRIOR_PACKET_RECEIPT_SHA256,"prior_verification_receipt_sha256":PRIOR_VERIFICATION_RECEIPT_SHA256,"prior_authorization_sha256":PRIOR_AUTHORIZATION_SHA256,"prior_authorization_challenge_sha256":PRIOR_AUTHORIZATION_CHALLENGE_SHA256,"ep6_reconciliation_bindings":b,"state":"ACKNOWLEDGED" if not blockers else "BLOCKED","residual_blockers":blockers,"historical_stage2_pin":clone(HISTORICAL_STAGE2_PIN),"active_stage3_pin":clone(ACTIVE_STAGE3_PIN),"platform_metadata_freshness":platform_freshness,"historical_stage2_pin_immutable":True,"historical_stage2_pin_rewritten":historical_stage2_pin_rewritten,"single_use_consumption_confirmed":True,"reconciliation_replay_blocked":not replay_accepted,"continuity_history_mutated":continuity_mutated,"replay_accepted":replay_accepted,"portability_verified":portability_pass,"reconciliation_revoked":reconciliation_revoked,"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED","freshness_is_clinical_validity":False,"diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_authority_transfer":False,"source_substitution_performed":False,"runtime_activation_performed":False,"approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","separate_governed_activation_authority_present":False,"activation_eligibility":"NOT_ELIGIBLE","phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False}
 return {**body,"acknowledgement_sha256":digest(body)}

def validate_acknowledgement(v:Mapping[str,Any])->bool:
 try:
  if not isinstance(v,Mapping):return False
  kwargs={"bindings":v["ep6_reconciliation_bindings"],"platform_freshness":v["platform_metadata_freshness"],"historical_stage2_pin_rewritten":v["historical_stage2_pin_rewritten"],"continuity_mutated":v["continuity_history_mutated"],"replay_accepted":v["replay_accepted"],"portability_pass":v["portability_verified"],"reconciliation_revoked":v["reconciliation_revoked"],"fabricated_clinical_gold_attempt":"FABRICATED_CLINICAL_GOLD" in v["residual_blockers"],"runtime_activation_attempt":"RUNTIME_ACTIVATION_ATTEMPT" in v["residual_blockers"],"source_substitution_attempt":"SOURCE_SUBSTITUTION" in v["residual_blockers"],"clinical_authority_escalation_attempt":"CLINICAL_AUTHORITY_ESCALATION" in v["residual_blockers"],"clinical_validity_escalation_attempt":"CLINICAL_VALIDITY_ESCALATION" in v["residual_blockers"]}
  return canonical(create_acknowledgement(**kwargs))==canonical(dict(v))
 except (KeyError,TypeError,ValueError):return False

def activation_eligibility(ack:Mapping[str,Any],*,approved_adjudicated_gold_count:int=0,metric_maturity:str="NOT_REPORTABLE",separate_governed_activation_authority_present:bool=False,diagnostic_performance_reporting_allowed:bool=False)->dict[str,Any]:
 if not validate_acknowledgement(ack):raise ValueError("ACKNOWLEDGEMENT_INVALID")
 if not isinstance(approved_adjudicated_gold_count,int) or isinstance(approved_adjudicated_gold_count,bool) or approved_adjudicated_gold_count<0:raise ValueError("GOLD_COUNT_INVALID")
 if type(separate_governed_activation_authority_present) is not bool or type(diagnostic_performance_reporting_allowed) is not bool:raise ValueError("ACTIVATION_BOOLEAN_REQUIRED")
 blockers=[]
 if ack["state"]!="ACKNOWLEDGED":blockers.append("RECONCILIATION_NOT_ACKNOWLEDGED")
 if approved_adjudicated_gold_count!=0:blockers.append("UNAUTHORIZED_CLINICAL_GOLD")
 if metric_maturity!="NOT_REPORTABLE":blockers.append("UNAUTHORIZED_METRIC_MATURITY")
 if separate_governed_activation_authority_present:blockers.append("UNVERIFIED_ACTIVATION_AUTHORITY")
 if diagnostic_performance_reporting_allowed:blockers.append("UNAUTHORIZED_PERFORMANCE_REPORTING")
 blockers += ["NO_GOVERNED_CLINICAL_GOLD","METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY"]
 blockers=sorted(set(blockers))
 body={"schema":"ekg-ep5-pkt05-activation-eligibility-v1","packet_id":PACKET_ID,"acknowledgement_sha256":ack["acknowledgement_sha256"],"eligibility":"NOT_ELIGIBLE","blockers":blockers,"platform_metadata_freshness":ack["platform_metadata_freshness"],"metadata_freshness_satisfies_activation":False,"repin_consumption_satisfies_activation":False,"requires_genuine_governed_clinical_evidence":True,"requires_separate_governed_activation_authority":True,"observed_approved_adjudicated_gold_count":approved_adjudicated_gold_count,"observed_metric_maturity":metric_maturity,"observed_separate_governed_activation_authority_present":separate_governed_activation_authority_present,"observed_diagnostic_performance_reporting_allowed":diagnostic_performance_reporting_allowed,"approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False}
 return {**body,"eligibility_sha256":digest(body)}

def validate_activation_eligibility(v:Mapping[str,Any],ack:Mapping[str,Any])->bool:
 try:
  if not isinstance(v,Mapping) or not validate_acknowledgement(ack):return False
  rebuilt=activation_eligibility(ack,approved_adjudicated_gold_count=v["observed_approved_adjudicated_gold_count"],metric_maturity=v["observed_metric_maturity"],separate_governed_activation_authority_present=v["observed_separate_governed_activation_authority_present"],diagnostic_performance_reporting_allowed=v["observed_diagnostic_performance_reporting_allowed"])
  return canonical(rebuilt)==canonical(dict(v))
 except (KeyError,TypeError,ValueError):return False

def release_consistency_descriptor(ack:Mapping[str,Any],elig:Mapping[str,Any])->dict[str,Any]:
 if not validate_acknowledgement(ack):raise ValueError("ACKNOWLEDGEMENT_INVALID")
 if ack.get("state")!="ACKNOWLEDGED":raise ValueError("ACKNOWLEDGEMENT_NOT_ACCEPTED")
 if not validate_activation_eligibility(elig,ack):raise ValueError("ELIGIBILITY_INVALID")
 if elig.get("eligibility")!="NOT_ELIGIBLE":raise ValueError("ELIGIBILITY_INVALID")
 body={"schema":"ekg-ep5-pkt05-release-consistency-v1","packet_id":PACKET_ID,"acknowledgement_sha256":ack["acknowledgement_sha256"],"activation_eligibility_sha256":elig["eligibility_sha256"],"historical_stage2_pin":clone(HISTORICAL_STAGE2_PIN),"active_stage3_pin":clone(ACTIVE_STAGE3_PIN),"platform_metadata_freshness":ack["platform_metadata_freshness"],"cross_repo_reconciliation_acknowledged":True,"historical_stage2_pin_immutable":True,"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","activation_eligibility":"NOT_ELIGIBLE","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","clinical_validity":"NOT_INFERRED","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False,"limitations":["FRESH describes metadata provenance/freshness only.","No governed clinical gold has been admitted.","Diagnostic performance remains non-reportable.","A separate governed activation authority is still required."]}
 return {**body,"descriptor_sha256":digest(body)}
