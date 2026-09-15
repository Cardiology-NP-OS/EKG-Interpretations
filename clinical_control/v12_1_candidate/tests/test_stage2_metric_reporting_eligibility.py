from __future__ import annotations
import copy, hashlib, json, pathlib, sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
GEN=ROOT/"validation_generated"
sys.path.insert(0,str(GEN))
import metric_reporting_eligibility as m
import adjudication_dataset_contracts as adjudication
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

check("schema",m.SCHEMA=="ekg-ep3-pkt07-metric-reporting-eligibility-v1")
check("baseline_commit",m.BASELINE_COMMIT=="f6fdb0ed70c5d349fe40773df638165e79172fd3")
check("baseline_tree",m.BASELINE_TREE=="dd1cfc1beb05476ac89e1cda4fb2eaedfa0a29ad")
check("stage1",m.STAGE1_RECEIPT_SHA256=="76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")
check("prior",m.PRIOR_PACKET_RECEIPT_SHA256=="d9a29faf5ad7407a30ba2accaffacbfc81cf8054604698ec3c255242615b3e45")
check("registry",evaluation.registry_binding()["sha256"]==evaluation.REGISTRY_SHA256)

# --- metric declaration -----------------------------------------------------
pattern_id=evaluation.registry()["patterns"][0]["id"]
decl=m.metric_declaration(metric_name="SENSITIVITY",pattern_id=pattern_id)
check("decl_not_computed",decl["computed"] is False)
check("decl_value_none",decl["value"] is None)
check("decl_no_accuracy",decl["clinical_accuracy_claimed"] is False)
check("decl_registry_bound",decl["registry_binding"]==evaluation.registry_binding())
check("decl_deterministic",decl==m.metric_declaration(metric_name="SENSITIVITY",pattern_id=pattern_id))
for metric_name in sorted(m.METRIC_TYPES):
    check("metric_type_"+metric_name,m.metric_declaration(metric_name=metric_name,pattern_id=pattern_id)["metric_name"]==metric_name)
expect("unknown_metric_type","METRIC_TYPE_UNKNOWN",lambda:m.metric_declaration(metric_name="MADE_UP_METRIC",pattern_id=pattern_id))
expect("unknown_metric_pattern","METRIC_PATTERN_UNKNOWN",lambda:m.metric_declaration(metric_name="AUROC",pattern_id="not_a_real_pattern"))

# --- hard eligibility gate ---------------------------------------------------
gate_zero=m.reporting_eligibility_gate(approved_adjudicated_gold_count=0,clinical_gold_admission_performed=False)
check("gate_zero_ineligible",gate_zero["clinical_metric_computation_eligible"] is False)
gate_count_only=m.reporting_eligibility_gate(approved_adjudicated_gold_count=5,clinical_gold_admission_performed=False)
check("gate_count_only_ineligible",gate_count_only["clinical_metric_computation_eligible"] is False)
gate_admission_only=m.reporting_eligibility_gate(approved_adjudicated_gold_count=0,clinical_gold_admission_performed=True)
check("gate_admission_only_ineligible",gate_admission_only["clinical_metric_computation_eligible"] is False)
gate_eligible=m.reporting_eligibility_gate(approved_adjudicated_gold_count=5,clinical_gold_admission_performed=True)
check("gate_both_eligible",gate_eligible["clinical_metric_computation_eligible"] is True)
check("gate_deterministic",gate_eligible==m.reporting_eligibility_gate(approved_adjudicated_gold_count=5,clinical_gold_admission_performed=True))
check("gate_hash",len(gate_eligible["gate_sha256"])==64)
expect("gate_count_negative","APPROVED_ADJUDICATED_GOLD_COUNT_TYPE",lambda:m.reporting_eligibility_gate(approved_adjudicated_gold_count=-1,clinical_gold_admission_performed=False))
expect("gate_count_bool","APPROVED_ADJUDICATED_GOLD_COUNT_TYPE",lambda:m.reporting_eligibility_gate(approved_adjudicated_gold_count=True,clinical_gold_admission_performed=False))
expect("gate_count_not_int","APPROVED_ADJUDICATED_GOLD_COUNT_TYPE",lambda:m.reporting_eligibility_gate(approved_adjudicated_gold_count="5",clinical_gold_admission_performed=False))
expect("gate_admission_not_bool","CLINICAL_GOLD_ADMISSION_PERFORMED_TYPE",lambda:m.reporting_eligibility_gate(approved_adjudicated_gold_count=1,clinical_gold_admission_performed="yes"))

# --- evidence maturity -------------------------------------------------------
maturity_zero=m.evidence_maturity_state(gate=gate_zero,sufficient_support=False,endpoint_reconciled=False,freeze_verified=False,cohort_independent=False)
check("maturity_zero_not_reportable",maturity_zero["maturity_state"]=="NOT_REPORTABLE")
check("maturity_zero_not_clinical",maturity_zero["clinical_metric_reportable"] is False)
maturity_count_only=m.evidence_maturity_state(gate=gate_count_only,sufficient_support=True,endpoint_reconciled=True,freeze_verified=True,cohort_independent=True)
check("maturity_count_only_not_reportable",maturity_count_only["maturity_state"]=="NOT_REPORTABLE")
maturity_preliminary=m.evidence_maturity_state(gate=gate_eligible,sufficient_support=False,endpoint_reconciled=True,freeze_verified=True,cohort_independent=True)
check("maturity_preliminary",maturity_preliminary["maturity_state"]=="PRELIMINARY_INSUFFICIENT_SUPPORT")
maturity_engineering=m.evidence_maturity_state(gate=gate_eligible,sufficient_support=True,endpoint_reconciled=True,freeze_verified=True,cohort_independent=True,engineering_conformance_only=True)
check("maturity_engineering",maturity_engineering["maturity_state"]=="ENGINEERING_CONFORMANCE_ONLY")
maturity_eligible=m.evidence_maturity_state(gate=gate_eligible,sufficient_support=True,endpoint_reconciled=True,freeze_verified=True,cohort_independent=True)
check("maturity_clinically_eligible",maturity_eligible["maturity_state"]=="CLINICALLY_ELIGIBLE")
check("maturity_clinically_eligible_flag",maturity_eligible["clinical_metric_reportable"] is True)
check("maturity_valid_zero",m.validate_evidence_maturity(maturity_zero) is True)
check("maturity_valid_eligible",m.validate_evidence_maturity(maturity_eligible) is True)
tampered_maturity=dict(maturity_eligible); tampered_maturity["maturity_state"]="CLINICALLY_ELIGIBLE"; tampered_maturity["sufficient_support"]=False
check("maturity_tamper_rejected",m.validate_evidence_maturity(tampered_maturity) is False)
expect("maturity_gate_integrity","ELIGIBILITY_GATE_INTEGRITY",lambda:m.evidence_maturity_state(
    gate={**gate_eligible,"approved_adjudicated_gold_count":999},sufficient_support=True,
    endpoint_reconciled=True,freeze_verified=True,cohort_independent=True))
expect("maturity_support_type","SUFFICIENT_SUPPORT_TYPE",lambda:m.evidence_maturity_state(
    gate=gate_eligible,sufficient_support="yes",endpoint_reconciled=True,freeze_verified=True,cohort_independent=True))

# --- subgroup support / confidence strata (fail closed) ---------------------
sub_ok=m.subgroup_support_check(subgroup_id="age-65-plus",evaluated_count=m.MIN_SUBGROUP_SUPPORT)
check("subgroup_at_minimum_sufficient",sub_ok["sufficient_support"] is True)
check("subgroup_at_minimum_state",sub_ok["state"]=="SUFFICIENT_SUPPORT")
sub_low=m.subgroup_support_check(subgroup_id="age-65-plus",evaluated_count=m.MIN_SUBGROUP_SUPPORT-1)
check("subgroup_below_minimum_insufficient",sub_low["sufficient_support"] is False)
check("subgroup_below_minimum_fail_closed",sub_low["state"]=="INSUFFICIENT_SUPPORT_FAIL_CLOSED")
check("subgroup_not_reportable",sub_low["subgroup_performance_reportable"] is False)
expect("subgroup_id_required","SUBGROUP_ID_REQUIRED",lambda:m.subgroup_support_check(subgroup_id="",evaluated_count=10))
expect("subgroup_count_type","SUBGROUP_EVALUATED_COUNT_TYPE",lambda:m.subgroup_support_check(subgroup_id="x",evaluated_count=-1))
for stratum_id in sorted(m.CONFIDENCE_STRATA):
    s=m.confidence_stratum(stratum_id=stratum_id,evaluated_count=m.MIN_SUBGROUP_SUPPORT)
    check("stratum_"+stratum_id,s["sufficient_support"] is True)
stratum_low=m.confidence_stratum(stratum_id="LOW_CONFIDENCE",evaluated_count=1)
check("stratum_low_support_not_reportable",stratum_low["stratum_reportable"] is False)
expect("stratum_unknown","CONFIDENCE_STRATUM_UNKNOWN",lambda:m.confidence_stratum(stratum_id="MADE_UP",evaluated_count=100))

# --- exact endpoint/denominator reconciliation ------------------------------
recon_ok=m.endpoint_reconciliation(declared_denominator=100,evaluated_count=80,excluded_count=20,
    exclusion_reasons={"gold_indeterminate":15,"prediction_unsupported":5})
check("reconciliation_reconciled",recon_ok["reconciled"] is True)
check("reconciliation_state",recon_ok["state"]=="RECONCILED")
recon_bad=m.endpoint_reconciliation(declared_denominator=100,evaluated_count=80,excluded_count=15,
    exclusion_reasons={"gold_indeterminate":15})
check("reconciliation_mismatch",recon_bad["reconciled"] is False)
check("reconciliation_mismatch_state",recon_bad["state"]=="DENOMINATOR_MISMATCH_REJECTED")
recon_reason_mismatch=m.endpoint_reconciliation(declared_denominator=100,evaluated_count=80,excluded_count=20,
    exclusion_reasons={"gold_indeterminate":5})
check("reconciliation_reason_total_mismatch",recon_reason_mismatch["reconciled"] is False)
expect("reconciliation_denominator_type","DECLARED_DENOMINATOR_TYPE",lambda:m.endpoint_reconciliation(
    declared_denominator=-1,evaluated_count=0,excluded_count=0,exclusion_reasons={}))
expect("reconciliation_reasons_shape","EXCLUSION_REASONS_SHAPE",lambda:m.endpoint_reconciliation(
    declared_denominator=10,evaluated_count=10,excluded_count=0,exclusion_reasons={"x":-1}))

# --- endpoint cohort policy / inherited Packet-6 leakage fences -------------
def source(**changes):
    args=dict(
        source_artifact_sha256="1"*64,tracing_identity_sha256="2"*64,
        rights_status="APPROVED_FOR_EVALUATION",usage_status="AUTHORIZED",
        privacy_status="CLEARED_NON_SENSITIVE",source_identity_state="ELIGIBLE",
        native_dataset_annotation_as_gold=False,synthetic_fixture=False)
    args.update(changes)
    return adjudication.source_eligibility(**args)

def review(which):
    return adjudication.review_submission_ref(
        submission_id=f"rsub_{which}",submission_sha256=(str(which) if str(which).isdigit() else "3")*64,
        reviewer_actor_id=f"reviewer-{which}",reviewer_principal_sha256=principal(f"reviewer-{which}"),
        reviewer_session_id=f"session-{which}")

adj=adjudication.adjudicator_descriptor(actor_id="adjudicator-1",principal_sha256=principal("adjudicator-1"),session_id="adj-session-1")
final_case=adjudication.create_adjudication_case(
    case_key="case-final",source=source(),review_submissions=[review(3),review(4)],
    candidate_reconciliation_sha256="7"*64,state="FINAL_HUMAN_ADJUDICATED",
    final_adjudicator=adj,final_pattern_labels={pattern_id:"POSITIVE"},
    rationale="Independent human adjudication based on governed source evidence.")
ref1=adjudication.admitted_case_ref(
    case_id="adjcase-001",case_version=1,case_sha256=final_case["case_sha256"],
    admission_receipt_sha256="b"*64,partition="TEST",
    case_family_id="family-001",subject_group_id="subject-001")
ref2=adjudication.admitted_case_ref(
    case_id="adjcase-002",case_version=1,case_sha256="c"*64,
    admission_receipt_sha256="d"*64,partition="TEST",
    case_family_id="family-002",subject_group_id="subject-002")
manifest=adjudication.evaluation_dataset_manifest(dataset_key="dataset-001",admitted_case_refs=[ref2,ref1])
check("manifest_valid_for_policy",adjudication.validate_dataset_manifest(manifest) is True)
policy=m.endpoint_cohort_policy_from_manifest(manifest)
check("policy_manifest_bound",policy["dataset_manifest_sha256"]==manifest["manifest_sha256"])
check("policy_leakage_fence_verified",policy["partition_leakage_fence_verified"] is True and policy["case_family_leakage_fence_verified"] is True)
check("policy_native_not_gold",policy["native_dataset_annotations_are_project_gold"] is False)
check("policy_synth_not_gold",policy["synthetic_fixtures_are_clinical_gold"] is False)
check("policy_deterministic",policy==m.endpoint_cohort_policy_from_manifest(manifest))
expect("policy_invalid_manifest","DATASET_MANIFEST_INVALID",lambda:m.endpoint_cohort_policy_from_manifest({**manifest,"approved_adjudicated_gold_count":99}))
expect("policy_native_gold_forbidden","NATIVE_DATASET_LABEL_CANNOT_BE_PROJECT_GOLD",lambda:m.endpoint_cohort_policy(
    dataset_manifest_sha256=manifest["manifest_sha256"],approved_adjudicated_gold_count=2,
    native_dataset_annotations_are_project_gold=True,synthetic_fixtures_are_clinical_gold=False))
expect("policy_synth_gold_forbidden","SYNTHETIC_FIXTURE_CANNOT_BE_CLINICAL_GOLD",lambda:m.endpoint_cohort_policy(
    dataset_manifest_sha256=manifest["manifest_sha256"],approved_adjudicated_gold_count=2,
    native_dataset_annotations_are_project_gold=False,synthetic_fixtures_are_clinical_gold=True))
expect("policy_leakage_fence_forbidden","LEAKAGE_FENCE_NOT_VERIFIED",lambda:m.endpoint_cohort_policy(
    dataset_manifest_sha256=manifest["manifest_sha256"],approved_adjudicated_gold_count=2,
    native_dataset_annotations_are_project_gold=False,synthetic_fixtures_are_clinical_gold=False,
    partition_leakage_fence_verified=False))
leak_ref=adjudication.admitted_case_ref(
    case_id="adjcase-003",case_version=1,case_sha256="e"*64,
    admission_receipt_sha256="f"*64,partition="TRAIN",
    case_family_id="family-003",subject_group_id="subject-001")
expect("manifest_leakage_caught_upstream","SUBJECT_OR_SERIAL_SPLIT_LEAKAGE",lambda:adjudication.evaluation_dataset_manifest(
    dataset_key="dataset-leak",admitted_case_refs=[ref1,leak_ref]))

# --- cohort independence -----------------------------------------------------
indep=m.cohort_independence_declaration(evaluation_partition="TEST",training_partitions=["TRAIN","VALIDATION"])
check("cohort_independent",indep["cohort_independent"] is True)
check("cohort_training_sorted",indep["training_partitions"]==["TRAIN","VALIDATION"])
expect("cohort_not_independent","COHORT_NOT_INDEPENDENT",lambda:m.cohort_independence_declaration(
    evaluation_partition="TEST",training_partitions=["TRAIN","TEST"]))
expect("cohort_partition_state","EVALUATION_PARTITION_STATE",lambda:m.cohort_independence_declaration(
    evaluation_partition="MADE_UP",training_partitions=["TRAIN"]))

# --- evaluation freeze + prediction-artifact integrity ----------------------
freeze=m.evaluation_freeze_contract(dataset_manifest_sha256=manifest["manifest_sha256"],
    prediction_artifact_sha256s=["a"*64,"b"*64,"a"*64])
check("freeze_frozen",freeze["frozen"] is True)
check("freeze_dedup_sorted",freeze["prediction_artifact_sha256s"]==["a"*64,"b"*64])
check("freeze_no_post_modification",freeze["post_freeze_modification_allowed"] is False)
expect("freeze_required","EVALUATION_FREEZE_REQUIRED",lambda:m.evaluation_freeze_contract(
    dataset_manifest_sha256=manifest["manifest_sha256"],prediction_artifact_sha256s=[],frozen=False))

# --- bound prediction scoring -------------------------------------------------
pred_binding=adjudication.prediction_binding(
    case_id=ref1["case_id"],case_version=1,dataset_manifest_sha256=manifest["manifest_sha256"],
    candidate_reconciliation_sha256="7"*64,configuration_sha256="8"*64)
score=m.bound_prediction_score(prediction_binding=pred_binding,case_id=ref1["case_id"],case_version=1,
    gold_label="POSITIVE",predicted_label="POSITIVE")
check("score_case_bound",score["case_id"]==ref1["case_id"])
check("score_binding_bound",score["prediction_binding_sha256"]==pred_binding["binding_sha256"])
check("score_no_accuracy",score["clinical_accuracy_claimed"] is False)
expect("score_binding_integrity","PREDICTION_BINDING_INTEGRITY",lambda:m.bound_prediction_score(
    prediction_binding={**pred_binding,"case_version":2},case_id=ref1["case_id"],case_version=1,
    gold_label="POSITIVE",predicted_label="POSITIVE"))
expect("score_case_identity_mismatch","PREDICTION_CASE_IDENTITY_MISMATCH",lambda:m.bound_prediction_score(
    prediction_binding=pred_binding,case_id="wrong-case",case_version=1,
    gold_label="POSITIVE",predicted_label="POSITIVE"))
expect("score_gold_label_state","GOLD_LABEL_STATE",lambda:m.bound_prediction_score(
    prediction_binding=pred_binding,case_id=ref1["case_id"],case_version=1,
    gold_label="MADE_UP",predicted_label="POSITIVE"))
expect("score_predicted_label_state","PREDICTED_LABEL_STATE",lambda:m.bound_prediction_score(
    prediction_binding=pred_binding,case_id=ref1["case_id"],case_version=1,
    gold_label="POSITIVE",predicted_label="MADE_UP"))

# --- selective-safety / abstention mechanics (engineering-only) ------------
abstain=m.abstention_declaration(pattern_id=pattern_id,abstained_count=5,evaluated_count=95)
check("abstention_engineering_only",abstain["engineering_conformance_only"] is True)
check("abstention_no_safety_claim",abstain["clinical_selective_safety_claimed"] is False)
check("abstention_no_runtime_influence",abstain["diagnostic_runtime_influence_allowed"] is False)
check("abstention_rate_value",abstain["abstention_rate"]["value"]==0.05)
expect("abstention_pattern_unknown","ABSTENTION_PATTERN_UNKNOWN",lambda:m.abstention_declaration(
    pattern_id="not_a_real_pattern",abstained_count=1,evaluated_count=1))

# --- claim gating -------------------------------------------------------------
claim_blocked=m.claim_gate(maturity=maturity_zero)
check("claim_blocked_not_reportable",claim_blocked["maturity_state"]=="NOT_REPORTABLE")
check("claim_blocked_promotion",claim_blocked["clinical_accuracy_promotion_allowed"] is False)
check("claim_blocked_performance_promotion",claim_blocked["diagnostic_performance_promotion_allowed"] is False)
check("claim_blocked_runtime_influence",claim_blocked["diagnostic_runtime_influence_allowed"] is False)
claim_eligible=m.claim_gate(maturity=maturity_eligible)
check("claim_eligible_promotion",claim_eligible["clinical_accuracy_promotion_allowed"] is True)
check("claim_eligible_performance_promotion",claim_eligible["diagnostic_performance_promotion_allowed"] is True)
check("claim_eligible_no_runtime_influence",claim_eligible["diagnostic_runtime_influence_allowed"] is False)
check("claim_eligible_no_accuracy_claim",claim_eligible["clinical_accuracy_claimed"] is False)
claim_engineering=m.claim_gate(maturity=maturity_engineering)
check("claim_engineering_blocked",claim_engineering["clinical_accuracy_promotion_allowed"] is False)
expect("claim_gate_maturity_integrity","MATURITY_CONTRACT_INTEGRITY",lambda:m.claim_gate(maturity={"schema":m.MATURITY_SCHEMA,"maturity_state":"CLINICALLY_ELIGIBLE"}))

# --- protected metric envelope ------------------------------------------------
envelope_zero=m.protected_metric_envelope(
    metric_name="SENSITIVITY",pattern_id=pattern_id,gate=gate_zero,maturity=maturity_zero,
    cohort_policy=policy,prediction_binding_sha256=pred_binding["binding_sha256"])
check("envelope_zero_not_reportable",envelope_zero["value_state"]=="NOT_REPORTABLE")
check("envelope_zero_value_none",envelope_zero["value"] is None)
check("envelope_zero_not_clinical",envelope_zero["clinical_metric_reportable"] is False)
check("envelope_zero_no_accuracy",envelope_zero["clinical_accuracy_claimed"] is False)
check("envelope_zero_no_reporting",envelope_zero["diagnostic_performance_reporting_allowed"] is False)
check("envelope_zero_no_activation",envelope_zero["diagnostic_runtime_activation_allowed"] is False)
check("envelope_id_hash",envelope_zero["envelope_id"]=="metricenv_"+envelope_zero["envelope_sha256"][:24])
check("envelope_valid",m.validate_protected_metric_envelope(envelope_zero) is True)
check("envelope_deterministic",envelope_zero==m.protected_metric_envelope(
    metric_name="SENSITIVITY",pattern_id=pattern_id,gate=gate_zero,maturity=maturity_zero,
    cohort_policy=policy,prediction_binding_sha256=pred_binding["binding_sha256"]))
envelope_eligible_mechanics=m.protected_metric_envelope(
    metric_name="AUROC",pattern_id=pattern_id,gate=gate_eligible,maturity=maturity_eligible,
    cohort_policy=policy,prediction_binding_sha256=pred_binding["binding_sha256"],
    confidence_stratum_ids=["HIGH_CONFIDENCE","HIGH_CONFIDENCE","LOW_CONFIDENCE"])
check("envelope_eligible_still_unavailable",envelope_eligible_mechanics["value_state"]=="UNAVAILABLE")
check("envelope_eligible_value_none",envelope_eligible_mechanics["value"] is None)
check("envelope_eligible_reportable_flag",envelope_eligible_mechanics["clinical_metric_reportable"] is True)
check("envelope_strata_dedup_sorted",envelope_eligible_mechanics["confidence_stratum_ids"]==["HIGH_CONFIDENCE","LOW_CONFIDENCE"])
check("envelope_valid_eligible",m.validate_protected_metric_envelope(envelope_eligible_mechanics) is True)
tampered_envelope=dict(envelope_zero); tampered_envelope["value_state"]="REPORTED"
check("envelope_tamper_rejected",m.validate_protected_metric_envelope(tampered_envelope) is False)
expect("envelope_gate_integrity","ELIGIBILITY_GATE_INTEGRITY",lambda:m.protected_metric_envelope(
    metric_name="SENSITIVITY",pattern_id=pattern_id,gate={**gate_zero,"approved_adjudicated_gold_count":9},
    maturity=maturity_zero,cohort_policy=policy,prediction_binding_sha256=pred_binding["binding_sha256"]))
expect("envelope_maturity_gate_binding","MATURITY_GATE_BINDING_MISMATCH",lambda:m.protected_metric_envelope(
    metric_name="SENSITIVITY",pattern_id=pattern_id,gate=gate_eligible,maturity=maturity_zero,
    cohort_policy=policy,prediction_binding_sha256=pred_binding["binding_sha256"]))
expect("envelope_cohort_policy_integrity","COHORT_POLICY_INTEGRITY",lambda:m.protected_metric_envelope(
    metric_name="SENSITIVITY",pattern_id=pattern_id,gate=gate_zero,maturity=maturity_zero,
    cohort_policy={**policy,"approved_adjudicated_gold_count":999},prediction_binding_sha256=pred_binding["binding_sha256"]))
expect("envelope_confidence_stratum_unknown","CONFIDENCE_STRATUM_UNKNOWN",lambda:m.protected_metric_envelope(
    metric_name="SENSITIVITY",pattern_id=pattern_id,gate=gate_zero,maturity=maturity_zero,
    cohort_policy=policy,prediction_binding_sha256=pred_binding["binding_sha256"],
    confidence_stratum_ids=["NOT_A_STRATUM"]))

# --- current zero-gold governed state / release contract --------------------
zero=m.current_zero_gold_reporting_state()
check("zero_gold_count",zero["approved_adjudicated_gold_count"]==0)
check("zero_gold_no_admission",zero["clinical_gold_admission_performed"] is False)
check("zero_gold_ineligible",zero["clinical_metric_computation_eligible"] is False)
check("zero_gold_maturity",zero["maturity_state"]=="NOT_REPORTABLE")
check("zero_gold_reporting_blocked",zero["diagnostic_performance_reporting_allowed"] is False)
check("zero_gold_promotion_blocked",zero["clinical_accuracy_promotion_allowed"] is False)
check("zero_gold_candidate_inactive",zero["candidate_active"] is False)
check("zero_gold_runtime_inactive",zero["diagnostic_runtime"]=="GOVERNED_INACTIVE")

release=m.release_contract()
check("release_packet",release["packet_id"]=="PKT-EP3-07")
check("release_baseline",release["baseline_commit"]==m.BASELINE_COMMIT and release["baseline_tree"]==m.BASELINE_TREE)
check("release_zero",release["approved_adjudicated_gold_count"]==0)
check("release_maturity",release["maturity_state"]=="NOT_REPORTABLE")
check("release_reporting_blocked",release["diagnostic_performance_reporting_allowed"] is False)
check("release_no_accuracy",release["clinical_accuracy_claimed"] is False)
check("release_native_not_gold",release["native_dataset_annotations_are_project_gold"] is False)
check("release_machine_not_gold",release["machine_interpretations_are_project_gold"] is False)
check("release_synth_not_gold",release["synthetic_fixtures_are_clinical_gold"] is False)
check("release_no_raw",release["raw_clinical_waveform_or_image_bytes_included"] is False)
check("release_no_rewrite",release["authority_rewritten"] is False)
check("release_no_fallback",release["silent_fallback_allowed"] is False)
check("release_proof_required",release["independent_machine_verification_required"] is True and release["github_ci_required"] is True)

# --- fixtures ------------------------------------------------------------------
fixture=json.loads((GEN/"EP3_PKT07_METRIC_REPORTING_FIXTURES.json").read_text())
check("fixture_no_phi",fixture["phi"] is False)
check("fixture_no_raw",fixture["raw_clinical_payloads_included"] is False)
check("fixture_zero",fixture["approved_adjudicated_gold_count"]==0)
check("fixture_no_admission",fixture["clinical_gold_admission_performed"] is False)
check("fixture_maturity",fixture["maturity_state"]=="NOT_REPORTABLE")
check("fixture_runtime_inactive",fixture["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("fixture_reporting_blocked",fixture["diagnostic_performance_reporting_allowed"] is False)
check("fixture_synth_not_gold",fixture["synthetic_fixtures_are_clinical_gold"] is False)
check("fixture_scenarios",len(fixture["scenarios"])==20)

print(json.dumps({
    "schema":"ekg-ep3-pkt07-metric-reporting-eligibility-tests-v1",
    "pass":True,"passed":passed,"total":passed,
    "approved_adjudicated_gold_count":0,
    "clinical_gold_admission_performed":False,
    "candidate_active":False,
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "maturity_state":"NOT_REPORTABLE",
    "synthetic_fixtures_are_clinical_gold":False,
},sort_keys=True))
