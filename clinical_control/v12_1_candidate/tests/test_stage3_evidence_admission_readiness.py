from __future__ import annotations
import copy,importlib.util,json,pathlib
ROOT=pathlib.Path(__file__).resolve().parents[3]
GEN=ROOT/"clinical_control"/"v12_1_candidate"/"validation_generated"
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path); mod=importlib.util.module_from_spec(spec); assert spec.loader; spec.loader.exec_module(mod); return mod
m=load("evidence_admission_readiness",GEN/"evidence_admission_readiness.py")
fixture=json.loads((GEN/"EP5_PKT06_EVIDENCE_ADMISSION_READINESS_FIXTURES.json").read_text(encoding="utf-8"))
passed=0
def check(name,cond):
 global passed
 if not cond: raise AssertionError(name)
 passed+=1
def raises(name,fn,expected):
 try: fn(); ok=False
 except ValueError as exc: ok=str(exc)==expected
 check(name,ok)

# Exact lineage and immutable accepted truth.
check("schema",m.SCHEMA=="ekg-ep5-pkt06-evidence-admission-readiness-v1");check("packet",m.PACKET_ID=="PKT-EP5-06");check("packet sha",m.PACKET_SHA256=="7e6fa688dba977898a17647495a38a71524d9fb249afe77c5e6a96e586166fb2")
check("baseline commit",m.BASELINE_COMMIT=="db71c98539d7894ea1a3d40d7aa2c9a7b0b24dd4");check("baseline tree",m.BASELINE_TREE=="777f1bd10d59ccecb2e7f4894aea7ca88745b0d2");check("stage2",m.STAGE2_RECEIPT_SHA256=="6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a")
check("p5 semantic",m.ACCEPTED_EP5_PKT05["semantic_commit"]=="46aa705d07df78f63a11428759c97fcdeb1246f3");check("p5 packet",m.ACCEPTED_EP5_PKT05["packet_receipt_sha256"]=="1e7d9529b264f1cbe113e762d89ab58c74b20d4e3b0ace656c5413931ea29212");check("p5 verify",m.ACCEPTED_EP5_PKT05["verification_receipt_sha256"]=="25d341672b0039d88c15825dd3e51f4eefae299fc5ecddac7ce5e8b1cb8975ce")
check("hardening",m.POST_ACCEPTANCE_HARDENING["commit"]==m.BASELINE_COMMIT and m.POST_ACCEPTANCE_HARDENING["semantic_state_unchanged"] is True);check("hardening focused",m.POST_ACCEPTANCE_HARDENING["independent_machine_focused_assertions"]==323)
check("ep6 commit",m.ACCEPTED_EP6_PKT05["source_commit"]=="4fce9d6151baf0909cbe082e871bbcc3e90aa4e4");check("ep6 packet",m.ACCEPTED_EP6_PKT05["packet_receipt_sha256"]=="9da1e69920d1918857db665c47f05e38273c272cac0a4ef1f1de94ee932ec5ba");check("ep6 verify",m.ACCEPTED_EP6_PKT05["verification_receipt_sha256"]=="16966d17e3c97e4efb6f8083e9b2ca04217d3eae1fc65542db402f2d81c580de")
check("ep6 fresh",m.ACCEPTED_EP6_PKT05["platform_metadata_freshness"]=="FRESH");check("ep6 not eligible",m.ACCEPTED_EP6_PKT05["activation_eligibility"]=="NOT_ELIGIBLE");check("ep6 zero gold",m.ACCEPTED_EP6_PKT05["approved_adjudicated_gold_count"]==0);check("ep6 inactive",m.ACCEPTED_EP6_PKT05["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("states",m.ADMISSION_STATES==("NOT_ADMITTED","ELIGIBLE_FOR_GOVERNED_REVIEW","BLOCKED","ADMITTED","REVOKED"));check("required count",len(m.REQUIRED_PRECONDITIONS)==9);check("revocation count",len(m.REVIEW_REVOCATION_TRIGGERS)==14)
check("fixture schema",fixture["schema"]=="ekg-ep5-pkt06-evidence-admission-readiness-fixtures-v1");check("fixture count",len(fixture["scenarios"])==15);check("fixture synthetic",fixture["synthetic_only"] is True)
for k in ["phi_included","raw_clinical_payloads_included","credentials_included","clinical_gold"]: check("fixture false "+k,fixture[k] is False)

# Current truth is immutable NOT_ADMITTED and clinically non-authoritative.
status=m.current_admission_status();check("status valid",m.validate_current_admission_status(status));check("status deterministic",status==m.current_admission_status());check("status state",status["evidence_admission_state"]=="NOT_ADMITTED");check("status zero",status["approved_adjudicated_gold_count"]==0);check("status maturity",status["metric_maturity"]=="NOT_REPORTABLE");check("status no authority",status["separate_governed_activation_authority_present"] is False);check("status not eligible",status["activation_eligibility"]=="NOT_ELIGIBLE");check("status inactive",status["diagnostic_runtime"]=="GOVERNED_INACTIVE" and status["candidate_active"] is False);check("status evidence authority",status["evidence_runtime_authority"]=="NON_RUNTIME_AUTHORITY");check("status validity",status["clinical_validity"]=="NOT_INFERRED");check("status metadata",status["metadata_only"] is True);check("status no raw",status["raw_clinical_payloads_allowed"] is False);check("status no phi",status["phi_allowed"] is False and status["phi_included"] is False);check("status synthetic exclusion",status["synthetic_fixtures_can_be_clinical_gold"] is False);check("status no metrics fabricate",status["fabricated_metrics_allowed"] is False);check("status review != admission",status["review_readiness_is_admission"] is False);check("status admission != activation",status["admission_is_activation"] is False);check("status unmet",status["unmet_preconditions"]==list(m.REQUIRED_PRECONDITIONS));check("status hash",len(status["current_status_sha256"])==64)
check("tampered status invalid",m.validate_current_admission_status({**status,"approved_adjudicated_gold_count":1}) is False)

complete=fixture["scenarios"]["review_ready_metadata_only"]["metadata"]
review=m.evaluate_admission_candidate(complete,simulation_only=True)
check("review valid",m.validate_candidate_evaluation(review));check("review ready",review["review_state"]=="ELIGIBLE_FOR_GOVERNED_REVIEW");check("review no blockers",review["residual_blockers"]==[]);check("review no missing",review["missing_preconditions"]==[]);check("review simulation",review["simulation_only"] is True);check("review not admitted",review["evidence_admission_state_after"]=="NOT_ADMITTED" and review["clinical_gold_admitted"] is False);check("review zero delta",review["approved_adjudicated_gold_count_delta"]==0);check("review not eligible",review["activation_eligibility_after"]=="NOT_ELIGIBLE");check("review not reportable",review["metric_maturity_after"]=="NOT_REPORTABLE");check("review inactive",review["diagnostic_runtime_after"]=="GOVERNED_INACTIVE" and review["candidate_active_after"] is False);check("review no reporting",review["diagnostic_performance_reporting_allowed"] is False and review["clinical_accuracy_claimed"] is False);check("review no authority",review["clinical_authority_transfer"] is False);check("review no effect",review["admission_effect_performed"] is False and review["runtime_activation_performed"] is False);check("review hash",len(review["evaluation_sha256"])==64);check("review deterministic",review==m.evaluate_admission_candidate(complete,simulation_only=True))
# Structurally review-ready non-simulation metadata is still only review-ready and never admitted.
external_shape=m.evaluate_admission_candidate(complete)
check("external shape review ready",external_shape["review_state"]=="ELIGIBLE_FOR_GOVERNED_REVIEW");check("external still not admitted",external_shape["evidence_admission_state_after"]=="NOT_ADMITTED" and external_shape["clinical_gold_admitted"] is False);check("external zero delta",external_shape["approved_adjudicated_gold_count_delta"]==0)

# Missing each governed precondition fails closed.
for key in m.REQUIRED_PRECONDITIONS:
 md={k:v for k,v in complete.items() if k!=key}; x=m.evaluate_admission_candidate(md)
 check("missing blocked "+key,x["review_state"]=="BLOCKED");check("missing reason "+key,"MISSING_PRECONDITION:"+key in x["residual_blockers"]);check("missing list "+key,key in x["missing_preconditions"]);check("missing no admission "+key,x["clinical_gold_admitted"] is False and x["approved_adjudicated_gold_count_delta"]==0);check("missing inactive "+key,x["diagnostic_runtime_after"]=="GOVERNED_INACTIVE");check("missing valid "+key,m.validate_candidate_evaluation(x))

negative={
 "adjudication_conflict":"ADJUDICATION_CONFLICT","source_license_mismatch":"SOURCE_LICENSE_MISMATCH","evidence_hash_drift":"EVIDENCE_HASH_DRIFT","schema_drift":"SCHEMA_DRIFT","qc_failure":"QUALITY_CONTROL_FAILURE","synthetic_evidence_attempt":"SYNTHETIC_EVIDENCE_EXCLUDED","phi_attempt":"PHI_INCLUDED","raw_payload_attempt":"RAW_CLINICAL_PAYLOAD_INCLUDED","fabricated_metric_attempt":"FABRICATED_METRIC_ATTEMPT","authority_escalation":"AUTHORITY_ESCALATION"}
for name,blocker in negative.items():
 args=fixture["scenarios"][name]; md=args.pop("metadata"); x=m.evaluate_admission_candidate(md,**args); args["metadata"]=md
 check(name+" blocked",x["review_state"]=="BLOCKED");check(name+" reason",blocker in x["residual_blockers"]);check(name+" no admission",x["clinical_gold_admitted"] is False and x["approved_adjudicated_gold_count_delta"]==0);check(name+" not eligible",x["activation_eligibility_after"]=="NOT_ELIGIBLE");check(name+" inactive",x["diagnostic_runtime_after"]=="GOVERNED_INACTIVE");check(name+" no authority",x["clinical_authority_transfer"] is False);check(name+" valid",m.validate_candidate_evaluation(x))

# Structural and type failures are rejected rather than coerced.
raises("metadata nonmapping",lambda:m.evaluate_admission_candidate([]),"CANDIDATE_METADATA_INVALID")
raises("unknown metadata",lambda:m.evaluate_admission_candidate({"invented":"0"*64}),"CANDIDATE_METADATA_UNKNOWN:invented")
raises("bad hash",lambda:m.evaluate_admission_candidate({"source_identity_sha256":"short"}),"CANDIDATE_METADATA_HASH_INVALID:source_identity_sha256")
raises("bad simulation bool",lambda:m.evaluate_admission_candidate({},simulation_only="yes"),"SIMULATION_BOOLEAN_REQUIRED")
raises("bad synthetic bool",lambda:m.evaluate_admission_candidate({},synthetic_evidence_attempt="yes"),"SYNTHETIC_BOOLEAN_REQUIRED")
check("tampered eval invalid",m.validate_candidate_evaluation({**review,"clinical_gold_admitted":True}) is False)
check("tampered eval hash invalid",m.validate_candidate_evaluation({**review,"evaluation_sha256":"0"*64}) is False)

# Append-only review receipt records review only, never admission.
receipt=m.admission_review_receipt(review,review_id="review.synthetic.001")
check("receipt schema",receipt["schema"]=="ekg-ep5-pkt06-admission-review-receipt-v1");check("receipt eval",receipt["evaluation_sha256"]==review["evaluation_sha256"]);check("receipt decision",receipt["decision"]=="REVIEW_RECORDED");check("receipt append",receipt["append_only"] is True);check("receipt no gold",receipt["clinical_gold_admitted"] is False and receipt["approved_adjudicated_gold_count_delta"]==0);check("receipt not admitted",receipt["evidence_admission_state_after"]=="NOT_ADMITTED");check("receipt not eligible",receipt["activation_eligibility_after"]=="NOT_ELIGIBLE");check("receipt inactive",receipt["diagnostic_runtime_after"]=="GOVERNED_INACTIVE");check("receipt no authority",receipt["clinical_authority_transfer"] is False);check("receipt hash",len(receipt["review_receipt_sha256"])==64);check("receipt deterministic",receipt==m.admission_review_receipt(review,review_id="review.synthetic.001"))
blocked=m.evaluate_admission_candidate(fixture["scenarios"]["no_evidence"]["metadata"])
raises("blocked review denied",lambda:m.admission_review_receipt(blocked,review_id="review.blocked.001"),"REVIEW_NOT_ELIGIBLE")
raises("bad review id",lambda:m.admission_review_receipt(review,review_id="x"),"REVIEW_ID_INVALID")
raises("bad review decision",lambda:m.admission_review_receipt(review,review_id="review.synthetic.001",decision="ADMITTED"),"REVIEW_DECISION_INVALID")

# Revocation is append-only review revocation, not a clinical-gold state transition.
for trigger in m.REVIEW_REVOCATION_TRIGGERS:
 rv=m.revoke_admission_review(review,trigger=trigger,reason="Synthetic governed review revocation: "+trigger)
 check("rv state "+trigger,rv["state"]=="REVOKED");check("rv trigger "+trigger,rv["trigger"]==trigger);check("rv append "+trigger,rv["append_only"] is True);check("rv no gold "+trigger,rv["clinical_gold_admitted"] is False and rv["approved_adjudicated_gold_count_delta"]==0);check("rv not admitted "+trigger,rv["evidence_admission_state_after"]=="NOT_ADMITTED");check("rv not eligible "+trigger,rv["activation_eligibility_after"]=="NOT_ELIGIBLE");check("rv inactive "+trigger,rv["diagnostic_runtime_after"]=="GOVERNED_INACTIVE" and rv["runtime_activation_performed"] is False);check("rv no authority "+trigger,rv["clinical_authority_transfer"] is False);check("rv hash "+trigger,len(rv["revocation_receipt_sha256"])==64);check("rv deterministic "+trigger,rv==m.revoke_admission_review(review,trigger=trigger,reason="Synthetic governed review revocation: "+trigger))
raises("bad rv trigger",lambda:m.revoke_admission_review(review,trigger="INVENTED",reason="x"),"REVOCATION_TRIGGER_UNSUPPORTED")
raises("bad rv reason",lambda:m.revoke_admission_review(review,trigger="SOURCE_REVOKED",reason=""),"REVOCATION_REASON_INVALID")

# Activation truth cannot be satisfied by review readiness or metadata freshness.
pre=m.activation_precondition_status(review);check("pre review",pre["review_state"]=="ELIGIBLE_FOR_GOVERNED_REVIEW");check("pre not admitted",pre["evidence_admission_state"]=="NOT_ADMITTED");check("pre zero",pre["approved_adjudicated_gold_count"]==0);check("pre maturity",pre["metric_maturity"]=="NOT_REPORTABLE");check("pre no authority",pre["separate_governed_activation_authority_present"] is False);check("pre not eligible",pre["activation_eligibility"]=="NOT_ELIGIBLE");check("pre blockers",pre["activation_blockers"]==["NO_ADMITTED_GOVERNED_CLINICAL_GOLD","METRICS_NOT_REPORTABLE","NO_SEPARATE_GOVERNED_ACTIVATION_AUTHORITY"]);check("pre review not activation",pre["review_readiness_satisfies_activation"] is False);check("pre fresh not activation",pre["metadata_freshness_satisfies_activation"] is False);check("pre release not activation",pre["engineering_release_satisfies_activation"] is False);check("pre inactive",pre["diagnostic_runtime"]=="GOVERNED_INACTIVE" and pre["candidate_active"] is False);check("pre no clinical",pre["clinical_validity"]=="NOT_INFERRED" and pre["clinical_authority_transfer"] is False);check("pre hash",len(pre["activation_precondition_sha256"])==64);check("pre deterministic",pre==m.activation_precondition_status(review))

# Downstream descriptor is owner-readable status only.
desc=m.downstream_evidence_readiness_descriptor(review);check("desc current",desc["current_status_sha256"]==status["current_status_sha256"]);check("desc eval",desc["evaluation_sha256"]==review["evaluation_sha256"]);check("desc review",desc["review_state"]=="ELIGIBLE_FOR_GOVERNED_REVIEW");check("desc not admitted",desc["evidence_admission_state"]=="NOT_ADMITTED");check("desc zero",desc["approved_adjudicated_gold_count"]==0);check("desc maturity",desc["metric_maturity"]=="NOT_REPORTABLE");check("desc not eligible",desc["activation_eligibility"]=="NOT_ELIGIBLE");check("desc inactive",desc["diagnostic_runtime"]=="GOVERNED_INACTIVE" and desc["candidate_active"] is False);check("desc evidence authority",desc["evidence_runtime_authority"]=="NON_RUNTIME_AUTHORITY");check("desc validity",desc["clinical_validity"]=="NOT_INFERRED");check("desc no claims",desc["diagnostic_performance_reporting_allowed"] is False and desc["clinical_accuracy_claimed"] is False);check("desc no authority",desc["clinical_authority_transfer"] is False);check("desc metadata",desc["metadata_only"] is True);check("desc safe",desc["phi_included"] is False and desc["raw_clinical_payloads_included"] is False and desc["credentials_included"] is False);check("desc hash",len(desc["descriptor_sha256"])==64)

# Cross-host portability is based on Git object bytes, not local presentation.
lf=b"alpha\nbeta\n";crlf=b"alpha\r\nbeta\r\n";drift=b"alpha\ngamma\n"
port=m.git_object_portability(lf,crlf);check("port match",port["repository_content_match"] is True);check("port newline",port["newline_translation_only"] is True);check("port authority",port["authority_basis"]=="GIT_OBJECT_BYTES");check("port nonauthority",all(port[k] is False for k in ["host_path_authoritative","machine_name_authoritative","shell_presentation_authoritative","timestamps_authoritative","ui_presentation_authoritative"]));check("port hash",len(port["portability_sha256"])==64)
check("port drift",m.git_object_portability(lf,drift)["repository_content_match"] is False)
raises("port bytes",lambda:m.git_object_portability("x",lf),"PORTABILITY_BYTES_REQUIRED")

# Packet 6 exposes no callable that admits clinical gold or activates runtime.
check("no admission callable",not hasattr(m,"admit_clinical_gold") and not hasattr(m,"activate_runtime") and not hasattr(m,"admit_candidate"))
result={"schema":"ekg-ep5-pkt06-evidence-admission-readiness-tests-v1","packet_id":m.PACKET_ID,"pass":True,"passed":passed,"total":passed,"baseline_commit":m.BASELINE_COMMIT,"baseline_tree":m.BASELINE_TREE,"evidence_admission_state":"NOT_ADMITTED","review_state":review["review_state"],"approved_adjudicated_gold_count":0,"metric_maturity":"NOT_REPORTABLE","activation_eligibility":"NOT_ELIGIBLE","diagnostic_runtime":"GOVERNED_INACTIVE","candidate_active":False,"evidence_runtime_authority":"NON_RUNTIME_AUTHORITY","clinical_validity":"NOT_INFERRED","clinical_authority_transfer":False,"phi_included":False,"raw_clinical_payloads_included":False,"synthetic_fixtures_can_be_clinical_gold":False,"admission_effect_performed":False,"runtime_activation_performed":False,"current_status_sha256":status["current_status_sha256"],"review_evaluation_sha256":review["evaluation_sha256"],"activation_precondition_sha256":pre["activation_precondition_sha256"],"descriptor_sha256":desc["descriptor_sha256"]}
print(json.dumps(result,sort_keys=True))
