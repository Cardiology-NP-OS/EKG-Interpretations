from __future__ import annotations
import copy,importlib.util,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[3]
GEN=ROOT/"clinical_control"/"v12_1_candidate"/"validation_generated"
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path); m=importlib.util.module_from_spec(spec); assert spec.loader is not None; spec.loader.exec_module(m); return m
ra=load("reconciliation_acknowledgement",GEN/"reconciliation_acknowledgement.py")
fixture=json.loads((GEN/"EP5_PKT05_RECONCILIATION_ACK_FIXTURES.json").read_text(encoding="utf-8"))
passed=0
def check(name,cond):
 global passed
 if not cond: raise AssertionError(name)
 passed+=1
def raises(name,fn,expected):
 try: fn(); ok=False
 except ValueError as exc: ok=str(exc)==expected
 check(name,ok)

# Exact identity and accepted cross-repo bindings.
expected_constants={
 "SCHEMA":"ekg-ep5-pkt05-reconciliation-acknowledgement-v1","PACKET_ID":"PKT-EP5-05",
 "PACKET_SHA256":"f6c69d7d7a8d8cc8fc8c8060f14caa69fba582d38b4ce07ae93f54cf0db1e507",
 "BASELINE_COMMIT":"732eb96b0ee4c3890fe56f0bbd9021af3922d814","BASELINE_TREE":"105d565019beccae6f134946caa4d9869ee350a2",
 "STAGE2_RECEIPT_SHA256":"6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a",
 "PRIOR_PACKET_RECEIPT_SHA256":"d45178cce21be604dd1049198b3d0650e9cf8e12dcf922c2382208d7ef831405",
 "PRIOR_VERIFICATION_RECEIPT_SHA256":"f23e9de2019a52e0beacd2e7346806fb561d39ea4fa687ea0db9a191487b86cb",
 "PRIOR_AUTHORIZATION_SHA256":"ebe4e9627e4554f877c015e5439dc38a9c6a270de72473e7c8e0581d56d62e0e",
 "PRIOR_AUTHORIZATION_CHALLENGE_SHA256":"4a50a815270de095f793587c0d36e83ba36513f1cf3fb57185daee886c20ffbf"}
for key,value in expected_constants.items(): check("const_"+key,getattr(ra,key)==value)
expected_ep6={
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
 "freshness_after":"FRESH","diagnostic_runtime":"GOVERNED_INACTIVE","evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED"}
for key,value in expected_ep6.items(): check("ep6_"+key,ra.EP6_PKT04[key]==value)
check("activation_truth_zero",ra.ACTIVATION_TRUTH["approved_adjudicated_gold_count"]==0)
check("activation_truth_maturity",ra.ACTIVATION_TRUTH["metric_maturity"]=="NOT_REPORTABLE")
check("activation_truth_no_report",ra.ACTIVATION_TRUTH["diagnostic_performance_reporting_allowed"] is False)
check("activation_truth_no_accuracy",ra.ACTIVATION_TRUTH["clinical_accuracy_claimed"] is False)
check("activation_truth_no_authority",ra.ACTIVATION_TRUTH["separate_governed_activation_authority_present"] is False)
check("activation_truth_ineligible",ra.ACTIVATION_TRUTH["activation_eligibility"]=="NOT_ELIGIBLE")
check("activation_truth_runtime",ra.ACTIVATION_TRUTH["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("activation_truth_candidate",ra.ACTIVATION_TRUTH["candidate_active"] is False)

# Fixture safety and expected matrix.
check("fixture_schema",fixture["schema"]=="ekg-ep5-pkt05-reconciliation-acknowledgement-fixtures-v1")
check("fixture_packet",fixture["packet_id"]==ra.PACKET_ID)
check("fixture_synthetic",fixture["synthetic_only"] is True)
for key in ["phi_included","raw_clinical_payloads_included","credentials_included","clinical_gold"]: check("fixture_false_"+key,fixture[key] is False)
check("fixture_count",len(fixture["scenarios"])==19)

# Accepted acknowledgement is exact, deterministic, and clinically non-authoritative.
ack=ra.create_acknowledgement(**fixture["scenarios"]["accepted"])
check("ack_state",ack["state"]=="ACKNOWLEDGED")
check("ack_blockers",ack["residual_blockers"]==[])
check("ack_valid",ra.validate_acknowledgement(ack) is True)
check("ack_deterministic",ack==ra.create_acknowledgement())
check("ack_hash",len(ack["acknowledgement_sha256"])==64)
check("ack_packet",ack["packet_id"]==ra.PACKET_ID and ack["packet_sha256"]==ra.PACKET_SHA256)
check("ack_baseline",ack["baseline_commit"]==ra.BASELINE_COMMIT and ack["baseline_tree"]==ra.BASELINE_TREE)
check("ack_prior",ack["prior_packet_receipt_sha256"]==ra.PRIOR_PACKET_RECEIPT_SHA256 and ack["prior_verification_receipt_sha256"]==ra.PRIOR_VERIFICATION_RECEIPT_SHA256)
check("ack_authorization",ack["prior_authorization_sha256"]==ra.PRIOR_AUTHORIZATION_SHA256 and ack["prior_authorization_challenge_sha256"]==ra.PRIOR_AUTHORIZATION_CHALLENGE_SHA256)
check("ack_bindings",ack["ep6_reconciliation_bindings"]==ra.expected_bindings())
check("ack_fresh",ack["platform_metadata_freshness"]=="FRESH")
check("ack_history",ack["historical_stage2_pin_immutable"] is True and ack["historical_stage2_pin_rewritten"] is False)
check("ack_continuity",ack["continuity_history_mutated"] is False)
check("ack_replay",ack["replay_accepted"] is False)
check("ack_portability",ack["portability_verified"] is True)
check("ack_revocation",ack["reconciliation_revoked"] is False)
check("ack_runtime",ack["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("ack_candidate",ack["candidate_active"] is False)
check("ack_evidence",ack["evidence_runtime_authority"]=="NON_RUNTIME_AUTHORITY")
check("ack_validity",ack["clinical_validity"]=="NOT_INFERRED" and ack["freshness_is_clinical_validity"] is False)
check("ack_no_report",ack["diagnostic_performance_reporting_allowed"] is False)
check("ack_no_accuracy",ack["clinical_accuracy_claimed"] is False)
check("ack_no_authority",ack["clinical_authority_transfer"] is False)
check("ack_no_substitution",ack["source_substitution_performed"] is False)
check("ack_no_activation",ack["runtime_activation_performed"] is False)
check("ack_zero_gold",ack["approved_adjudicated_gold_count"]==0)
check("ack_maturity",ack["metric_maturity"]=="NOT_REPORTABLE")
check("ack_no_activation_authority",ack["separate_governed_activation_authority_present"] is False)
check("ack_ineligible",ack["activation_eligibility"]=="NOT_ELIGIBLE")
check("ack_no_phi",ack["phi_included"] is False and ack["raw_clinical_payloads_included"] is False and ack["credentials_included"] is False)

# Every negative fixture produces a valid BLOCKED evidence record and exact reason.
expected={
 "consumption_mismatch":"EP6_PROOF_MISMATCH:consumption_sha256","overlay_drift":"EP6_PROOF_MISMATCH:overlay_sha256",
 "continuity_mismatch":"EP6_PROOF_MISMATCH:successor_continuity_sha256","descriptor_mismatch":"EP6_PROOF_MISMATCH:reconciliation_descriptor_sha256",
 "replay_proof_mismatch":"EP6_PROOF_MISMATCH:replay_attempt_sha256","revocation_proof_mismatch":"EP6_PROOF_MISMATCH:revocation_sha256",
 "portability_hash_mismatch":"EP6_PROOF_MISMATCH:portability_sha256","historical_pin_rewrite":"HISTORICAL_PIN_REWRITE",
 "continuity_mutation":"CONTINUITY_MUTATION","replay_accepted":"REPLAY_ACCEPTED","portability_failure":"PORTABILITY_FAILURE",
 "reconciliation_revoked":"RECONCILIATION_REVOKED","fabricated_gold":"FABRICATED_CLINICAL_GOLD",
 "activation_attempt":"RUNTIME_ACTIVATION_ATTEMPT","source_substitution":"SOURCE_SUBSTITUTION",
 "authority_escalation":"CLINICAL_AUTHORITY_ESCALATION","clinical_validity_escalation":"CLINICAL_VALIDITY_ESCALATION",
 "stale_freshness":"PLATFORM_FRESHNESS_MISMATCH"}
for name,blocker in expected.items():
 record=ra.create_acknowledgement(**fixture["scenarios"][name])
 check(name+"_state",record["state"]=="BLOCKED")
 check(name+"_reason",blocker in record["residual_blockers"])
 check(name+"_valid",ra.validate_acknowledgement(record) is True)
 check(name+"_runtime",record["diagnostic_runtime"]=="GOVERNED_INACTIVE")
 check(name+"_candidate",record["candidate_active"] is False)
 check(name+"_no_authority",record["clinical_authority_transfer"] is False)
 check(name+"_zero_gold",record["approved_adjudicated_gold_count"]==0)
 check(name+"_no_phi",record["phi_included"] is False)

# Structural input fences.
raises("bindings invalid",lambda:ra.create_acknowledgement(bindings=[]),"BINDINGS_INVALID")
raises("binding unknown",lambda:ra.create_acknowledgement(bindings={"invented":"0"*64}),"BINDING_UNKNOWN:invented")
raises("commit invalid",lambda:ra.create_acknowledgement(bindings={"ep6_source_commit":"short"}),"EP6_COMMIT_INVALID")
raises("binding hash invalid",lambda:ra.create_acknowledgement(bindings={"consumption_sha256":"short"}),"BINDING_HASH_INVALID:consumption_sha256")
raises("boolean required",lambda:ra.create_acknowledgement(replay_accepted="yes"),"BOOLEAN_FLAG_REQUIRED")

# Tamper resistance.
for name,mut in [
 ("ack hash",lambda x:x.__setitem__("acknowledgement_sha256","0"*64)),
 ("clinical accuracy",lambda x:x.__setitem__("clinical_accuracy_claimed",True)),
 ("gold",lambda x:x.__setitem__("approved_adjudicated_gold_count",1)),
 ("runtime",lambda x:x.__setitem__("diagnostic_runtime","ACTIVE")),
 ("blockers",lambda x:x.__setitem__("residual_blockers",["INVENTED"]))]:
 x=copy.deepcopy(ack); mut(x); check("tamper_"+name,ra.validate_acknowledgement(x) is False)

# Activation is permanently fail-closed under current evidence.
elig=ra.activation_eligibility(ack)
check("elig_state",elig["eligibility"]=="NOT_ELIGIBLE")
check("elig_ack",elig["acknowledgement_sha256"]==ack["acknowledgement_sha256"])
for blocker in ["NO_GOVERNED_CLINICAL_GOLD","METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY"]: check("elig_blocker_"+blocker,blocker in elig["blockers"])
check("elig_fresh",elig["platform_metadata_freshness"]=="FRESH")
check("elig_fresh_not_activation",elig["metadata_freshness_satisfies_activation"] is False)
check("elig_repin_not_activation",elig["repin_consumption_satisfies_activation"] is False)
check("elig_requires_evidence",elig["requires_genuine_governed_clinical_evidence"] is True)
check("elig_requires_authority",elig["requires_separate_governed_activation_authority"] is True)
check("elig_zero_gold",elig["approved_adjudicated_gold_count"]==0)
check("elig_maturity",elig["metric_maturity"]=="NOT_REPORTABLE")
check("elig_no_report",elig["diagnostic_performance_reporting_allowed"] is False)
check("elig_no_accuracy",elig["clinical_accuracy_claimed"] is False)
check("elig_runtime",elig["diagnostic_runtime"]=="GOVERNED_INACTIVE" and elig["candidate_active"] is False)
check("elig_validity",elig["clinical_validity"]=="NOT_INFERRED")
check("elig_no_authority",elig["clinical_authority_transfer"] is False)
check("elig_no_phi",elig["phi_included"] is False and elig["raw_clinical_payloads_included"] is False)
check("elig_hash",len(elig["eligibility_sha256"])==64)
check("elig_deterministic",elig==ra.activation_eligibility(ack))
# Attempts to inject non-governed evidence only add blockers; they cannot change the locked outputs.
for kwargs,blocker in [
 ({"approved_adjudicated_gold_count":1},"UNAUTHORIZED_CLINICAL_GOLD"),
 ({"metric_maturity":"REPORTABLE"},"UNAUTHORIZED_METRIC_MATURITY"),
 ({"separate_governed_activation_authority_present":True},"UNVERIFIED_ACTIVATION_AUTHORITY"),
 ({"diagnostic_performance_reporting_allowed":True},"UNAUTHORIZED_PERFORMANCE_REPORTING")]:
 x=ra.activation_eligibility(ack,**kwargs)
 check("attempt_blocker_"+blocker,blocker in x["blockers"])
 check("attempt_still_ineligible_"+blocker,x["eligibility"]=="NOT_ELIGIBLE")
 check("attempt_zero_gold_"+blocker,x["approved_adjudicated_gold_count"]==0)
 check("attempt_not_reportable_"+blocker,x["metric_maturity"]=="NOT_REPORTABLE")
 check("attempt_runtime_"+blocker,x["diagnostic_runtime"]=="GOVERNED_INACTIVE")
raises("gold invalid",lambda:ra.activation_eligibility(ack,approved_adjudicated_gold_count=-1),"GOLD_COUNT_INVALID")
raises("activation bool invalid",lambda:ra.activation_eligibility(ack,separate_governed_activation_authority_present="yes"),"ACTIVATION_BOOLEAN_REQUIRED")
blocked=ra.create_acknowledgement(**fixture["scenarios"]["reconciliation_revoked"])
blocked_elig=ra.activation_eligibility(blocked)
check("blocked ack blocker", "RECONCILIATION_NOT_ACKNOWLEDGED" in blocked_elig["blockers"])
check("blocked ack ineligible", blocked_elig["eligibility"]=="NOT_ELIGIBLE")

# Release consistency descriptor is owner-visible, FRESH metadata but still clinically locked.
desc=ra.release_consistency_descriptor(ack,elig)
check("desc_schema",desc["schema"]=="ekg-ep5-pkt05-release-consistency-v1")
check("desc_ack",desc["acknowledgement_sha256"]==ack["acknowledgement_sha256"])
check("desc_elig",desc["activation_eligibility_sha256"]==elig["eligibility_sha256"])
check("desc_fresh",desc["platform_metadata_freshness"]=="FRESH")
check("desc_crossrepo",desc["cross_repo_reconciliation_acknowledged"] is True)
check("desc_history",desc["historical_stage2_pin_immutable"] is True)
check("desc_runtime",desc["diagnostic_runtime"]=="GOVERNED_INACTIVE" and desc["candidate_active"] is False)
check("desc_evidence",desc["evidence_runtime_authority"]=="NON_RUNTIME_AUTHORITY")
check("desc_ineligible",desc["activation_eligibility"]=="NOT_ELIGIBLE")
check("desc_zero_gold",desc["approved_adjudicated_gold_count"]==0)
check("desc_maturity",desc["metric_maturity"]=="NOT_REPORTABLE")
check("desc_validity",desc["clinical_validity"]=="NOT_INFERRED")
check("desc_no_report",desc["diagnostic_performance_reporting_allowed"] is False)
check("desc_no_accuracy",desc["clinical_accuracy_claimed"] is False)
check("desc_no_authority",desc["clinical_authority_transfer"] is False)
check("desc_no_phi",desc["phi_included"] is False and desc["raw_clinical_payloads_included"] is False and desc["credentials_included"] is False)
check("desc_limit_count",len(desc["limitations"])==4)
check("desc_hash",len(desc["descriptor_sha256"])==64)
check("desc_deterministic",desc==ra.release_consistency_descriptor(ack,elig))
invalid_elig=copy.deepcopy(elig); invalid_elig["eligibility"]="ELIGIBLE"
raises("desc eligibility invalid",lambda:ra.release_consistency_descriptor(ack,invalid_elig),"ELIGIBILITY_INVALID")

result={"schema":"ekg-ep5-pkt05-reconciliation-acknowledgement-tests-v1","packet_id":ra.PACKET_ID,"pass":True,"passed":passed,"total":passed,"baseline_commit":ra.BASELINE_COMMIT,"baseline_tree":ra.BASELINE_TREE,"acknowledgement_state":ack["state"],"acknowledgement_sha256":ack["acknowledgement_sha256"],"activation_eligibility":elig["eligibility"],"activation_eligibility_sha256":elig["eligibility_sha256"],"release_consistency_descriptor_sha256":desc["descriptor_sha256"],"platform_metadata_freshness":"FRESH","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"separate_governed_activation_authority_present":False,"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False}
print(json.dumps(result,sort_keys=True))
