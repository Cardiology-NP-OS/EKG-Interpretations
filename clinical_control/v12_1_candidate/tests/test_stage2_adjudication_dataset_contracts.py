from __future__ import annotations
import copy, hashlib, json, pathlib, sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
GEN=ROOT/"validation_generated"
sys.path.insert(0,str(GEN))
import adjudication_dataset_contracts as a
import evaluation_engine as evaluation

passed=0
def check(name,value):
    global passed
    assert value,name
    passed+=1
    print("PASS",name)

def expect(name,code,fn):
    global passed
    try: fn()
    except (ValueError,TypeError,KeyError) as exc:
        assert code in str(exc),(name,exc)
    else: raise AssertionError(name)
    passed+=1
    print("PASS",name)
def principal(name):
    return hashlib.sha256(name.encode()).hexdigest()

def source(**changes):
    args=dict(
        source_artifact_sha256="1"*64,
        tracing_identity_sha256="2"*64,
        rights_status="APPROVED_FOR_EVALUATION",
        usage_status="AUTHORIZED",
        privacy_status="CLEARED_NON_SENSITIVE",
        source_identity_state="ELIGIBLE",
        native_dataset_annotation_as_gold=False,
        synthetic_fixture=False,
    )
    args.update(changes)
    return a.source_eligibility(**args)

def review(which):
    return a.review_submission_ref(
        submission_id=f"rsub_{which}",
        submission_sha256=(str(which) if str(which).isdigit() else "3")*64,
        reviewer_actor_id=f"reviewer-{which}",
        reviewer_principal_sha256=principal(f"reviewer-{which}"),
        reviewer_session_id=f"session-{which}",
    )

def pending(**changes):
    args=dict(
        case_key="case-001",source=source(),
        review_submissions=[review(3),review(4)],
        candidate_reconciliation_sha256="7"*64,
    )
    args.update(changes)
    return a.create_adjudication_case(**args)
check("schema",a.SCHEMA=="ekg-ep3-pkt06-adjudication-dataset-v1")
check("baseline_commit",a.BASELINE_COMMIT=="047adf472ab76430ed683d6ae0b41154fbd13885")
check("baseline_tree",a.BASELINE_TREE=="7795590c2fd1714c726b3806d807b6ffb7e8b0d7")
check("stage1",a.STAGE1_RECEIPT_SHA256=="76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")
check("prior",a.PRIOR_PACKET_RECEIPT_SHA256=="46a40cdb1095a6f401c3611abc4628986f44d682130db2c7f0449610f7b80895")
check("registry",evaluation.registry_binding()["sha256"]==evaluation.REGISTRY_SHA256)

s=source()
check("source_eligible",s["eligible_for_adjudication"] is True)
check("source_native_not_gold",s["native_dataset_annotation_as_gold"] is False)
check("source_synthetic_false",s["synthetic_fixture"] is False)
check("source_hash",len(s["eligibility_sha256"])==64)
check("source_rights_gate",source(rights_status="UNKNOWN")["eligible_for_adjudication"] is False)
check("source_usage_gate",source(usage_status="UNKNOWN")["eligible_for_adjudication"] is False)
check("source_privacy_gate",source(privacy_status="UNKNOWN")["eligible_for_adjudication"] is False)
check("source_identity_gate",source(source_identity_state="CONFLICT")["eligible_for_adjudication"] is False)
check("synthetic_never_eligible",source(synthetic_fixture=True)["eligible_for_adjudication"] is False)
expect("native_label_as_gold","NATIVE_DATASET_LABEL_CANNOT_BE_PROJECT_GOLD",lambda:source(native_dataset_annotation_as_gold=True))
r1=review(3); r2=review(4)
check("review_blinded",r1["blinded"] is True)
check("review_non_gold",r1["clinical_gold"] is False)
check("review_unadjudicated",r1["adjudicated"] is False)
check("review_hash",len(r1["ref_sha256"])==64)
expect("unblinded_review","REVIEW_NOT_BLINDED",lambda:a.review_submission_ref(
    submission_id="rsub-x",submission_sha256="3"*64,
    reviewer_actor_id="reviewer-x",reviewer_principal_sha256=principal("reviewer-x"),
    reviewer_session_id="session-x",blinded=False))
expect("bad_review_state","REVIEW_STATE",lambda:a.review_submission_ref(
    submission_id="rsub-y",submission_sha256="3"*64,
    reviewer_actor_id="reviewer-y",reviewer_principal_sha256=principal("reviewer-y"),
    reviewer_session_id="session-y",review_state="TRUSTED"))

x=pending()
check("pending_valid",a.validate_adjudication_case(x) is True)
check("pending_state",x["state"]=="PENDING_HUMAN_ADJUDICATION")
check("case_id_hash",x["case_id"]=="adjcase_"+x["case_sha256"][:24])
check("case_v1",x["case_version"]==1 and x["predecessor_case_sha256"] is None)
check("repo_bound",x["repository_binding"]["commit"]==a.BASELINE_COMMIT and x["repository_binding"]["tree"]==a.BASELINE_TREE)
check("case_not_gold",x["clinical_gold"] is False and x["clinical_gold_admission_performed"] is False)
check("case_runtime_inactive",x["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("case_candidate_inactive",x["candidate_active"] is False)
check("case_reporting_blocked",x["diagnostic_performance_reporting_allowed"] is False)
check("case_no_accuracy",x["clinical_accuracy_claimed"] is False)
check("case_no_raw",x["raw_clinical_payload_included"] is False)
check("case_no_rewrite",x["authority_rewritten"] is False)
check("case_no_fallback",x["silent_fallback_allowed"] is False)
check("case_deterministic",x==pending())
expect("single_review","DUAL_REVIEW_SUBMISSIONS_REQUIRED",lambda:pending(review_submissions=[r1]))
dup_actor=a.review_submission_ref(
    submission_id="rsub-dup-actor",submission_sha256="5"*64,
    reviewer_actor_id=r1["reviewer_actor_id"],reviewer_principal_sha256=principal("reviewer-dup"),
    reviewer_session_id="session-dup")
expect("duplicate_reviewer_actor","REVIEWER_ACTOR_NOT_INDEPENDENT",lambda:pending(review_submissions=[r1,dup_actor]))
contam=a.review_submission_ref(
    submission_id="rsub-c",submission_sha256="5"*64,
    reviewer_actor_id="reviewer-c",reviewer_principal_sha256=principal("reviewer-c"),
    reviewer_session_id="session-c",review_state="CONTAMINATED")
expect("contaminated_rejected","REVIEW_SUBMISSION_NOT_CLEAN",lambda:pending(review_submissions=[r1,contam]))
expect("root_predecessor","ROOT_CASE_PREDECESSOR_FORBIDDEN",lambda:pending(predecessor_case_sha256="9"*64))
expect("final_fields_pending","FINAL_FIELDS_FOR_NONFINAL_CASE",lambda:pending(rationale="not final"))

adj=a.adjudicator_descriptor(actor_id="adjudicator-1",principal_sha256=principal("adjudicator-1"),session_id="adj-session-1")
check("adjudicator_human_role",adj["role"]=="HUMAN_ADJUDICATOR")
check("adjudicator_no_runtime_authority",adj["diagnostic_runtime_authority"] is False)
final=a.create_adjudication_case(
    case_key="case-final",source=s,review_submissions=[r1,r2],
    candidate_reconciliation_sha256="7"*64,state="FINAL_HUMAN_ADJUDICATED",
    final_adjudicator=adj,final_pattern_labels={"left_axis":"POSITIVE"},
    rationale="Independent human adjudication based on governed source evidence.",
    measurement_ground_truth_refs=["8"*64])
check("final_valid",a.validate_adjudication_case(final) is True)
check("final_state",final["state"]=="FINAL_HUMAN_ADJUDICATED")
check("final_human",final["final_adjudication"]["human_adjudicated"] is True)
check("no_auto_adjudication",final["final_adjudication"]["automatic_adjudication"] is False)
check("machine_not_truth",final["final_adjudication"]["machine_label_used_as_truth"] is False)
check("label_registry_bound",final["registry_binding"]==evaluation.registry_binding())
check("measurement_separate",final["measurement_ground_truth_refs"]==["8"*64])
check("final_still_not_gold",final["clinical_gold"] is False)
expect("final_missing_adjudicator","FINAL_HUMAN_ADJUDICATION_REQUIRED",lambda:a.create_adjudication_case(
    case_key="case-bad",source=s,review_submissions=[r1,r2],
    candidate_reconciliation_sha256="7"*64,state="FINAL_HUMAN_ADJUDICATED"))
expect("final_bad_pattern","FINAL_PATTERN_LABEL_UNKNOWN",lambda:a.create_adjudication_case(
    case_key="case-bad2",source=s,review_submissions=[r1,r2],
    candidate_reconciliation_sha256="7"*64,state="FINAL_HUMAN_ADJUDICATED",
    final_adjudicator=adj,final_pattern_labels={"fake_pattern":"POSITIVE"},rationale="human"))
contract=a.gold_admission_contract(final)
check("admission_ready_contract",contract["state"]=="ADMISSION_READY")
check("admission_requires_receipt",contract["governed_admission_receipt_required"] is True)
check("contract_not_admission",contract["clinical_gold"] is False and contract["clinical_gold_admission_performed"] is False)
check("contract_zero_delta",contract["approved_adjudicated_gold_count_delta"]==0)
check("contract_native_never_satisfies",contract["native_dataset_annotations_can_satisfy_admission"] is False)
check("contract_machine_never_satisfies",contract["ocr_or_machine_labels_can_satisfy_admission"] is False)
check("contract_synth_never_satisfies",contract["synthetic_fixture_can_satisfy_admission"] is False)
check("contract_no_auto_adjudication",contract["automatic_adjudication_allowed"] is False)
check("contract_no_activation",contract["diagnostic_runtime_activation_allowed"] is False)
check("contract_no_reporting",contract["diagnostic_performance_reporting_allowed"] is False)
check("pending_not_ready",a.gold_admission_contract(x)["state"]=="NOT_ADMISSION_READY")

succ=a.create_case_successor(x,state="BLOCKED")
check("successor_v2",succ["case_version"]==2)
check("successor_predecessor",succ["predecessor_case_sha256"]==x["case_sha256"])
check("successor_same_key",succ["case_key"]==x["case_key"])
check("successor_valid",a.validate_adjudication_case(succ) is True)
ref1=a.admitted_case_ref(
    case_id="adjcase-001",case_version=1,case_sha256="a"*64,
    admission_receipt_sha256="b"*64,partition="TEST",
    case_family_id="family-001",subject_group_id="subject-001")
ref2=a.admitted_case_ref(
    case_id="adjcase-002",case_version=1,case_sha256="c"*64,
    admission_receipt_sha256="d"*64,partition="TEST",
    case_family_id="family-002",subject_group_id="subject-002")
check("admitted_ref_receipt",ref1["governed_admission_receipt_verified"] is True)
check("admitted_ref_human",ref1["human_adjudicated"] is True)
manifest=a.evaluation_dataset_manifest(dataset_key="dataset-001",admitted_case_refs=[ref2,ref1],exclusions=["indeterminate"])
check("manifest_valid",a.validate_dataset_manifest(manifest) is True)
check("manifest_count",manifest["approved_adjudicated_gold_count"]==2)
check("manifest_deterministic_order",manifest["admitted_case_refs"][0]["case_id"]=="adjcase-001")
check("manifest_no_raw",manifest["raw_clinical_payload_included"] is False)
check("manifest_no_phi",manifest["phi_included"] is False)
check("manifest_native_not_gold",manifest["native_dataset_annotations_are_project_gold"] is False)
check("manifest_synth_not_gold",manifest["synthetic_fixtures_are_clinical_gold"] is False)
check("manifest_no_activation",manifest["diagnostic_runtime_activation_allowed"] is False)
check("manifest_no_accuracy",manifest["clinical_accuracy_claimed"] is False)
expect("duplicate_case_version","DUPLICATE_CASE_VERSION",lambda:a.evaluation_dataset_manifest(dataset_key="dataset-dup",admitted_case_refs=[ref1,ref1]))
leak=a.admitted_case_ref(
    case_id="adjcase-003",case_version=1,case_sha256="e"*64,
    admission_receipt_sha256="f"*64,partition="TRAIN",
    case_family_id="family-003",subject_group_id="subject-001")
expect("subject_split_leak","SUBJECT_OR_SERIAL_SPLIT_LEAKAGE",lambda:a.evaluation_dataset_manifest(dataset_key="dataset-leak",admitted_case_refs=[ref1,leak]))
family_leak=a.admitted_case_ref(
    case_id="adjcase-004",case_version=1,case_sha256="0"*64,
    admission_receipt_sha256="1"*64,partition="TRAIN",
    case_family_id="family-001",subject_group_id="subject-004")
expect("family_split_leak","CASE_FAMILY_SPLIT_LEAKAGE",lambda:a.evaluation_dataset_manifest(dataset_key="dataset-family-leak",admitted_case_refs=[ref1,family_leak]))

pred=a.prediction_binding(
    case_id=ref1["case_id"],case_version=1,
    dataset_manifest_sha256=manifest["manifest_sha256"],
    candidate_reconciliation_sha256="7"*64,
    configuration_sha256="8"*64)
check("prediction_manifest_bound",pred["dataset_manifest_sha256"]==manifest["manifest_sha256"])
check("prediction_candidate_bound",pred["candidate_reconciliation_sha256"]=="7"*64)
check("prediction_config_bound",pred["configuration_sha256"]=="8"*64)
check("prediction_commit_bound",pred["engine_commit"]==a.BASELINE_COMMIT)
check("prediction_tree_bound",pred["engine_tree"]==a.BASELINE_TREE)
check("prediction_registry_bound",pred["registry_binding"]==evaluation.registry_binding())
check("prediction_no_accuracy",pred["clinical_accuracy_claimed"] is False)
check("prediction_no_activation",pred["diagnostic_runtime_activation_allowed"] is False)
zero=a.current_zero_gold_state()
check("zero_gold",zero["approved_adjudicated_gold_count"]==0)
check("zero_reporting_blocked",zero["diagnostic_performance_reporting_allowed"] is False)
check("zero_promotion_blocked",zero["clinical_accuracy_promotion_allowed"] is False)
check("zero_candidate_inactive",zero["candidate_active"] is False)
check("zero_runtime_inactive",zero["diagnostic_runtime"]=="GOVERNED_INACTIVE")

fixture=json.loads((GEN/"EP3_PKT06_ADJUDICATION_DATASET_FIXTURES.json").read_text())
check("fixture_no_phi",fixture["phi"] is False)
check("fixture_no_raw",fixture["raw_clinical_payloads_included"] is False)
check("fixture_zero",fixture["approved_adjudicated_gold_count"]==0)
check("fixture_no_admission",fixture["clinical_gold_admission_performed"] is False)
check("fixture_inactive",fixture["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("fixture_reporting_blocked",fixture["diagnostic_performance_reporting_allowed"] is False)
check("fixture_synth_not_gold",fixture["synthetic_fixtures_are_clinical_gold"] is False)
check("fixture_scenarios",len(fixture["scenarios"])==18)

release=a.release_contract()
check("release_packet",release["packet_id"]=="PKT-EP3-06")
check("release_baseline",release["baseline_commit"]==a.BASELINE_COMMIT and release["baseline_tree"]==a.BASELINE_TREE)
check("release_zero",release["approved_adjudicated_gold_count"]==0)
check("release_no_admission",release["clinical_gold_admission_performed"] is False)
check("release_runtime_inactive",release["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("release_reporting_blocked",release["diagnostic_performance_reporting_allowed"] is False)
check("release_no_accuracy",release["clinical_accuracy_claimed"] is False)
check("release_native_not_gold",release["native_dataset_annotations_are_project_gold"] is False)
check("release_machine_not_gold",release["machine_interpretations_are_project_gold"] is False)
check("release_synth_not_gold",release["synthetic_fixtures_are_clinical_gold"] is False)
check("release_no_raw",release["raw_clinical_waveform_or_image_bytes_included"] is False)
check("release_no_rewrite",release["authority_rewritten"] is False)
check("release_no_fallback",release["silent_fallback_allowed"] is False)
check("release_proof_required",release["independent_machine_verification_required"] is True and release["github_ci_required"] is True)

print(json.dumps({
    "schema":"ekg-ep3-pkt06-adjudication-dataset-tests-v1",
    "pass":True,"passed":passed,"total":passed,
    "approved_adjudicated_gold_count":0,
    "clinical_gold_admission_performed":False,
    "candidate_active":False,
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "synthetic_fixtures_are_clinical_gold":False,
},sort_keys=True))
