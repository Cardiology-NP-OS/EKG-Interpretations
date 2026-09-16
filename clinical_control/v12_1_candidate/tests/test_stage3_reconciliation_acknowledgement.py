from __future__ import annotations
import copy, importlib.util, json, pathlib
ROOT=pathlib.Path(__file__).resolve().parents[3]
GEN=ROOT/"clinical_control"/"v12_1_candidate"/"validation_generated"
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path); m=importlib.util.module_from_spec(spec); assert spec.loader; spec.loader.exec_module(m); return m
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

# Exact packet and accepted cross-repository identity bindings.
checks={
 "schema":ra.SCHEMA=="ekg-ep5-pkt05-reconciliation-acknowledgement-v1",
 "packet":ra.PACKET_ID=="PKT-EP5-05",
 "packet_sha":ra.PACKET_SHA256=="f6c69d7d7a8d8cc8fc8c8060f14caa69fba582d38b4ce07ae93f54cf0db1e507",
 "baseline_commit":ra.BASELINE_COMMIT=="732eb96b0ee4c3890fe56f0bbd9021af3922d814",
 "baseline_tree":ra.BASELINE_TREE=="105d565019beccae6f134946caa4d9869ee350a2",
 "stage2":ra.STAGE2_RECEIPT_SHA256=="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a",
 "prior_packet":ra.PRIOR_PACKET_RECEIPT_SHA256=="d45178cce21be604dd1049198b3d0650e9cf8e12dcf922c2382208d7ef831405",
 "prior_verify":ra.PRIOR_VERIFICATION_RECEIPT_SHA256=="f23e9de2019a52e0beacd2e7346806fb561d39ea4fa687ea0db9a191487b86cb",
 "prior_auth":ra.PRIOR_AUTHORIZATION_SHA256=="ebe4e9627e4554f877c015e5439dc38a9c6a270de72473e7c8e0581d56d62e0e",
 "prior_challenge":ra.PRIOR_AUTHORIZATION_CHALLENGE_SHA256=="4a50a815270de095f793587c0d36e83ba36513f1cf3fb57185daee886c20ffbf",
 "ep6_commit":ra.EP6_PKT04["source_commit"]=="25975668d8db5d6168de4c37ccaddc9635f5430a",
 "ep6_tree":ra.EP6_PKT04["source_tree"]=="793a4a7307921327e450c2c79d8de435e8fa32ba",
 "ep6_packet":ra.EP6_PKT04["packet_receipt_sha256"]=="8b639cc0d631ca1002df2694096dd2afbea19468396369dc283effe1bab6b609",
 "ep6_verify":ra.EP6_PKT04["verification_receipt_sha256"]=="4957e81b6ec8b0276337233270f4af5cd1724ba2c32905628bd2b6be615f6a0c",
 "ep6_output":ra.EP6_PKT04["output_sha256"]=="6673eacd4ed3bc04c5a2aa7ddad5a12303bbefedcca5810d0e4dcd1cbd96853b",
 "consumption":ra.EP6_PKT04["consumption_sha256"]=="97bfdf9d7449a371b12a888e21466c75e1bef732dcc4266f6c6988ac334d51bf",
 "overlay":ra.EP6_PKT04["overlay_sha256"]=="7687ff1d063d99e12d412bea4d46c8db142a4733a9acc788880531aa3983d38d",
 "continuity":ra.EP6_PKT04["successor_continuity_sha256"]=="0582467d9fd8b923397a1a997a308c3d07db3d1f1916fed1d67006245c3f825f",
 "descriptor":ra.EP6_PKT04["reconciliation_descriptor_sha256"]=="ed8f920996089f8ed20dcd8ebefdf42f663c3a606efc4a53de2e961af83603ea",
 "replay":ra.EP6_PKT04["replay_attempt_sha256"]=="d6010a5c2cae52a7f4a28b244108d4b24bbff282c722286d483dd375eda4d30f",
 "revocation":ra.EP6_PKT04["revocation_sha256"]=="7a5e25fa1090438b6521b4db9619fafe90afdca1e96050abdf48f92904f08c7c",
 "portability":ra.EP6_PKT04["portability_sha256"]=="729e6fc00180c3451a2de409357d0135485a85d8a0c2986ce985066ce5b31949",
 "fresh":ra.EP6_PKT04["freshness_after"]=="FRESH",
 "inactive":ra.EP6_PKT04["diagnostic_runtime"]=="GOVERNED_INACTIVE",
 "evidence_nonruntime":ra.EP6_PKT04["evidence_runtime_authority"]=="NON_RUNTIME_AUTHORITY",
 "validity":ra.EP6_PKT04["clinical_validity"]=="NOT_INFERRED",
}
for n,v in checks.items(): check(n,v)
check("historical pin",ra.HISTORICAL_STAGE2_PIN=={"repository":"Cardiology-NP-OS/EKG-Interpretations","commit":"6fbf1814258813bfb6ff78407e013cf23ff9e07d","tree":"01442274b34bf40ae600ee1ee21de8f15ae3b4de","runtime_status":"GOVERNED_INACTIVE"})
check("active pin",ra.ACTIVE_STAGE3_PIN=={"repository":"Cardiology-NP-OS/EKG-Interpretations","commit":"09ec7010191ecca0336abb9fccf369ce182c89e1","tree":"6f5f1c261816f8cf33001802fdfb4237b80f387b","runtime_status":"GOVERNED_INACTIVE"})
check("activation zero",ra.ACTIVATION_TRUTH["approved_adjudicated_gold_count"]==0)
check("activation maturity",ra.ACTIVATION_TRUTH["metric_maturity"]=="NOT_REPORTABLE")
check("activation eligibility truth",ra.ACTIVATION_TRUTH["activation_eligibility"]=="NOT_ELIGIBLE")
check("activation no authority",ra.ACTIVATION_TRUTH["separate_governed_activation_authority_present"] is False)

# Fixture safety and coverage.
check("fixture schema",fixture["schema"]=="ekg-ep5-pkt05-reconciliation-acknowledgement-fixtures-v1")
check("fixture packet",fixture["packet_id"]==ra.PACKET_ID)
check("fixture synthetic",fixture["synthetic_only"] is True)
for k in ["phi_included","raw_clinical_payloads_included","credentials_included","clinical_gold"]: check("fixture false "+k,fixture[k] is False)
check("fixture scenario count",len(fixture["scenarios"])==19)

# Accepted acknowledgement locks FRESH metadata while preserving non-clinical truth.
ack=ra.create_acknowledgement(**fixture["scenarios"]["accepted"])
check("ack state",ack["state"]=="ACKNOWLEDGED")
check("ack blockers",ack["residual_blockers"]==[])
check("ack valid",ra.validate_acknowledgement(ack) is True)
check("ack deterministic",ack==ra.create_acknowledgement())
check("ack hash",len(ack["acknowledgement_sha256"])==64)
check("ack historical pin",ack["historical_stage2_pin"]==ra.HISTORICAL_STAGE2_PIN)
check("ack active pin",ack["active_stage3_pin"]==ra.ACTIVE_STAGE3_PIN)
check("ack fresh",ack["platform_metadata_freshness"]=="FRESH")
check("ack immutable",ack["historical_stage2_pin_immutable"] is True)
check("ack not rewritten",ack["historical_stage2_pin_rewritten"] is False)
check("ack single-use",ack["single_use_consumption_confirmed"] is True)
check("ack replay blocked",ack["reconciliation_replay_blocked"] is True)
check("ack continuity unchanged",ack["continuity_history_mutated"] is False)
check("ack replay false",ack["replay_accepted"] is False)
check("ack portability",ack["portability_verified"] is True)
check("ack not revoked",ack["reconciliation_revoked"] is False)
check("ack runtime",ack["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("ack inactive",ack["candidate_active"] is False)
check("ack evidence",ack["evidence_runtime_authority"]=="NON_RUNTIME_AUTHORITY")
check("ack validity",ack["clinical_validity"]=="NOT_INFERRED")
check("ack freshness not validity",ack["freshness_is_clinical_validity"] is False)
check("ack no performance",ack["diagnostic_performance_reporting_allowed"] is False)
check("ack no accuracy",ack["clinical_accuracy_claimed"] is False)
check("ack no authority",ack["clinical_authority_transfer"] is False)
check("ack no substitution",ack["source_substitution_performed"] is False)
check("ack no activation",ack["runtime_activation_performed"] is False)
check("ack zero gold",ack["approved_adjudicated_gold_count"]==0)
check("ack not reportable",ack["metric_maturity"]=="NOT_REPORTABLE")
check("ack no activation authority",ack["separate_governed_activation_authority_present"] is False)
check("ack not eligible",ack["activation_eligibility"]=="NOT_ELIGIBLE")
check("ack no phi",ack["phi_included"] is False)
check("ack no raw",ack["raw_clinical_payloads_included"] is False)
check("ack no creds",ack["credentials_included"] is False)
check("ack bindings exact",ack["ep6_reconciliation_bindings"]==ra.expected_bindings())

# Every governed fixture fails closed with the expected blocker while remaining valid evidence.
expected={
 "consumption_mismatch":"EP6_PROOF_MISMATCH:consumption_sha256",
 "overlay_drift":"EP6_PROOF_MISMATCH:overlay_sha256",
 "continuity_mismatch":"EP6_PROOF_MISMATCH:successor_continuity_sha256",
 "descriptor_mismatch":"EP6_PROOF_MISMATCH:reconciliation_descriptor_sha256",
 "replay_proof_mismatch":"EP6_PROOF_MISMATCH:replay_attempt_sha256",
 "revocation_proof_mismatch":"EP6_PROOF_MISMATCH:revocation_sha256",
 "portability_hash_mismatch":"EP6_PROOF_MISMATCH:portability_sha256",
 "historical_pin_rewrite":"HISTORICAL_PIN_REWRITE",
 "continuity_mutation":"CONTINUITY_MUTATION",
 "replay_accepted":"REPLAY_ACCEPTED",
 "portability_failure":"PORTABILITY_FAILURE",
 "reconciliation_revoked":"RECONCILIATION_REVOKED",
 "fabricated_gold":"FABRICATED_CLINICAL_GOLD",
 "activation_attempt":"RUNTIME_ACTIVATION_ATTEMPT",
 "source_substitution":"SOURCE_SUBSTITUTION",
 "authority_escalation":"CLINICAL_AUTHORITY_ESCALATION",
 "clinical_validity_escalation":"CLINICAL_VALIDITY_ESCALATION",
 "stale_freshness":"PLATFORM_FRESHNESS_MISMATCH",
}
for name,blocker in expected.items():
 rec=ra.create_acknowledgement(**fixture["scenarios"][name])
 check(name+" blocked",rec["state"]=="BLOCKED")
 check(name+" blocker",blocker in rec["residual_blockers"])
 check(name+" valid evidence",ra.validate_acknowledgement(rec) is True)
 check(name+" runtime",rec["diagnostic_runtime"]=="GOVERNED_INACTIVE")
 check(name+" inactive",rec["candidate_active"] is False)
 check(name+" zero gold",rec["approved_adjudicated_gold_count"]==0)
 check(name+" no performance",rec["diagnostic_performance_reporting_allowed"] is False)
 check(name+" no authority",rec["clinical_authority_transfer"] is False)
 check(name+" no phi",rec["phi_included"] is False)

# Structural and tamper checks.
raises("bindings invalid",lambda:ra.create_acknowledgement(bindings=[]),"BINDINGS_INVALID")
raises("binding unknown",lambda:ra.create_acknowledgement(bindings={"invented":"0"*64}),"BINDING_UNKNOWN:invented")
raises("bad binding hash",lambda:ra.create_acknowledgement(bindings={"overlay_sha256":"short"}),"BINDING_HASH_INVALID:overlay_sha256")
raises("bad ep6 commit",lambda:ra.create_acknowledgement(bindings={"ep6_source_commit":"short"}),"EP6_COMMIT_INVALID")
raises("bad boolean",lambda:ra.create_acknowledgement(replay_accepted="yes"),"BOOLEAN_FLAG_REQUIRED")
for key,value in [("clinical_accuracy_claimed",True),("candidate_active",True),("historical_stage2_pin",{}),("active_stage3_pin",{}),("acknowledgement_sha256","0"*64),("approved_adjudicated_gold_count",1)]:
 t=copy.deepcopy(ack); t[key]=value; check("tamper "+key,ra.validate_acknowledgement(t) is False)

# Activation eligibility is always NOT_ELIGIBLE from accepted governed evidence.
elig=ra.activation_eligibility(ack)
check("elig valid",ra.validate_activation_eligibility(elig,ack) is True)
check("elig deterministic",elig==ra.activation_eligibility(ack))
check("elig state",elig["eligibility"]=="NOT_ELIGIBLE")
check("elig base blockers",set(["NO_GOVERNED_CLINICAL_GOLD","METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY"]).issubset(elig["blockers"]))
check("elig fresh",elig["platform_metadata_freshness"]=="FRESH")
check("elig freshness not activation",elig["metadata_freshness_satisfies_activation"] is False)
check("elig repin not activation",elig["repin_consumption_satisfies_activation"] is False)
check("elig needs clinical",elig["requires_genuine_governed_clinical_evidence"] is True)
check("elig needs separate authority",elig["requires_separate_governed_activation_authority"] is True)
check("elig observed gold",elig["observed_approved_adjudicated_gold_count"]==0)
check("elig observed maturity",elig["observed_metric_maturity"]=="NOT_REPORTABLE")
check("elig observed authority",elig["observed_separate_governed_activation_authority_present"] is False)
check("elig observed reporting",elig["observed_diagnostic_performance_reporting_allowed"] is False)
check("elig safe gold",elig["approved_adjudicated_gold_count"]==0)
check("elig safe maturity",elig["metric_maturity"]=="NOT_REPORTABLE")
check("elig no reporting",elig["diagnostic_performance_reporting_allowed"] is False)
check("elig no accuracy",elig["clinical_accuracy_claimed"] is False)
check("elig inactive",elig["diagnostic_runtime"]=="GOVERNED_INACTIVE" and elig["candidate_active"] is False)
check("elig validity",elig["clinical_validity"]=="NOT_INFERRED")
check("elig no authority",elig["clinical_authority_transfer"] is False)
check("elig no phi",elig["phi_included"] is False and elig["raw_clinical_payloads_included"] is False)
check("elig hash",len(elig["eligibility_sha256"])==64)

# Unsupported claims remain blockers and never upgrade safe outputs.
for kwargs,blocker in [
 ({"approved_adjudicated_gold_count":1},"UNAUTHORIZED_CLINICAL_GOLD"),
 ({"metric_maturity":"REPORTABLE"},"UNAUTHORIZED_METRIC_MATURITY"),
 ({"separate_governed_activation_authority_present":True},"UNVERIFIED_ACTIVATION_AUTHORITY"),
 ({"diagnostic_performance_reporting_allowed":True},"UNAUTHORIZED_PERFORMANCE_REPORTING"),
]:
 e=ra.activation_eligibility(ack,**kwargs)
 check("elig blocker "+blocker,blocker in e["blockers"])
 check("elig remains no",e["eligibility"]=="NOT_ELIGIBLE")
 check("elig remains inactive "+blocker,e["diagnostic_runtime"]=="GOVERNED_INACTIVE")
 check("elig safe gold "+blocker,e["approved_adjudicated_gold_count"]==0)
 check("elig safe maturity "+blocker,e["metric_maturity"]=="NOT_REPORTABLE")
 check("elig valid "+blocker,ra.validate_activation_eligibility(e,ack) is True)
blocked_ack=ra.create_acknowledgement(runtime_activation_attempt=True)
blocked_elig=ra.activation_eligibility(blocked_ack)
check("blocked ack eligibility blocker","RECONCILIATION_NOT_ACKNOWLEDGED" in blocked_elig["blockers"])
check("blocked ack still no",blocked_elig["eligibility"]=="NOT_ELIGIBLE")
raises("gold negative",lambda:ra.activation_eligibility(ack,approved_adjudicated_gold_count=-1),"GOLD_COUNT_INVALID")
raises("gold bool",lambda:ra.activation_eligibility(ack,approved_adjudicated_gold_count=True),"GOLD_COUNT_INVALID")
raises("activation bool",lambda:ra.activation_eligibility(ack,separate_governed_activation_authority_present="yes"),"ACTIVATION_BOOLEAN_REQUIRED")

# Forged eligibility cannot produce a release descriptor.
forged=copy.deepcopy(elig); forged["blockers"]=[]
check("forged eligibility invalid",ra.validate_activation_eligibility(forged,ack) is False)
forged2=copy.deepcopy(elig); forged2["eligibility_sha256"]="0"*64
check("forged eligibility hash invalid",ra.validate_activation_eligibility(forged2,ack) is False)
raises("descriptor forged eligibility",lambda:ra.release_consistency_descriptor(ack,forged),"ELIGIBILITY_INVALID")
raises("descriptor blocked ack",lambda:ra.release_consistency_descriptor(blocked_ack,blocked_elig),"ACKNOWLEDGEMENT_NOT_ACCEPTED")

# Accepted release consistency freezes the post-reconciliation state without clinical activation.
desc=ra.release_consistency_descriptor(ack,elig)
check("desc schema",desc["schema"]=="ekg-ep5-pkt05-release-consistency-v1")
check("desc ack",desc["acknowledgement_sha256"]==ack["acknowledgement_sha256"])
check("desc elig",desc["activation_eligibility_sha256"]==elig["eligibility_sha256"])
check("desc historical",desc["historical_stage2_pin"]==ra.HISTORICAL_STAGE2_PIN)
check("desc active",desc["active_stage3_pin"]==ra.ACTIVE_STAGE3_PIN)
check("desc fresh",desc["platform_metadata_freshness"]=="FRESH")
check("desc reconciled",desc["cross_repo_reconciliation_acknowledged"] is True)
check("desc immutable",desc["historical_stage2_pin_immutable"] is True)
check("desc inactive",desc["diagnostic_runtime"]=="GOVERNED_INACTIVE" and desc["candidate_active"] is False)
check("desc evidence",desc["evidence_runtime_authority"]=="NON_RUNTIME_AUTHORITY")
check("desc not eligible",desc["activation_eligibility"]=="NOT_ELIGIBLE")
check("desc zero gold",desc["approved_adjudicated_gold_count"]==0)
check("desc maturity",desc["metric_maturity"]=="NOT_REPORTABLE")
check("desc validity",desc["clinical_validity"]=="NOT_INFERRED")
check("desc no reporting",desc["diagnostic_performance_reporting_allowed"] is False)
check("desc no accuracy",desc["clinical_accuracy_claimed"] is False)
check("desc no authority",desc["clinical_authority_transfer"] is False)
check("desc no phi",desc["phi_included"] is False and desc["raw_clinical_payloads_included"] is False and desc["credentials_included"] is False)
check("desc limitations",len(desc["limitations"])==4)
check("desc hash",len(desc["descriptor_sha256"])==64)
check("desc deterministic",desc==ra.release_consistency_descriptor(ack,elig))

result={"schema":"ekg-ep5-pkt05-reconciliation-acknowledgement-tests-v1","packet_id":ra.PACKET_ID,"pass":True,"passed":passed,"total":passed,"baseline_commit":ra.BASELINE_COMMIT,"baseline_tree":ra.BASELINE_TREE,"acknowledgement_state":ack["state"],"acknowledgement_sha256":ack["acknowledgement_sha256"],"activation_eligibility":elig["eligibility"],"activation_eligibility_sha256":elig["eligibility_sha256"],"release_descriptor_sha256":desc["descriptor_sha256"],"platform_metadata_freshness":"FRESH","historical_stage2_pin_commit":ra.HISTORICAL_STAGE2_PIN["commit"],"active_stage3_pin_commit":ra.ACTIVE_STAGE3_PIN["commit"],"single_use_consumption_confirmed":True,"reconciliation_replay_blocked":True,"diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","diagnostic_performance_reporting_allowed":False,"clinical_accuracy_claimed":False,"clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"credentials_included":False}
print(json.dumps(result,sort_keys=True))
