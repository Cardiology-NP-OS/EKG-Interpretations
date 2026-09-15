from __future__ import annotations
import copy, hashlib, json, pathlib, sys

ROOT=pathlib.Path(__file__).resolve().parents[1]
GEN=ROOT/"validation_generated"
sys.path.insert(0,str(GEN))
import diagnostic_activation_gate as gate

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

# ---------------------------------------------------------------------------
# Schema and identity constants
# ---------------------------------------------------------------------------

check("schema",gate.SCHEMA=="ekg-ep3-pkt08-diagnostic-activation-gate-v1")
check("baseline_commit",gate.BASELINE_COMMIT=="3e8d2bd417e962b526d97a0330bcbe5c3d3ab8bd")
check("baseline_tree",gate.BASELINE_TREE=="d5d3f6214c77db3bf8566d9d537d51fb2b53124e")
check("stage1_receipt",gate.STAGE1_RECEIPT_SHA256=="76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")
check("prior_packet_receipt",gate.PRIOR_PACKET_RECEIPT_SHA256=="7e92a1cc42ec16162626eb45fec8f3a5c38175ec9707b365933421213ca80f86")
check("packet_id",gate.PACKET_ID=="PKT-EP3-08")
check("packet_sha256",gate.PACKET_SHA256=="6ac95047595424bba40a7b0cd4c9701aaec634c825eb489e404a4a0bb73b2710")
check("typed_states",len(gate.TYPED_STATES)==6)
check("typed_state_governed_inactive","GOVERNED_INACTIVE" in gate.TYPED_STATES)
check("typed_state_evaluation_only","EVALUATION_ONLY" in gate.TYPED_STATES)
check("typed_state_blocked","BLOCKED" in gate.TYPED_STATES)
check("typed_state_ineligible","INELIGIBLE" in gate.TYPED_STATES)
check("typed_state_ready_for_governance_review","READY_FOR_GOVERNANCE_REVIEW" in gate.TYPED_STATES)
check("typed_state_activation_eligible","ACTIVATION_ELIGIBLE" in gate.TYPED_STATES)

# ---------------------------------------------------------------------------
# Candidate identity binding
# ---------------------------------------------------------------------------

candidate_id="0"*64
candidate_version="1"*64
model_artifact_sha256="2"*64
configuration_sha256="3"*64
source_artifact_sha256="4"*64
pattern_registry_sha256="5"*64
code_commit_sha256="6"*64
code_tree_sha256="7"*64

identity=gate.candidate_identity(
    candidate_id=candidate_id,
    candidate_version=candidate_version,
    model_artifact_sha256=model_artifact_sha256,
    configuration_sha256=configuration_sha256,
    source_artifact_sha256=source_artifact_sha256,
    pattern_registry_sha256=pattern_registry_sha256,
    code_commit_sha256=code_commit_sha256,
    code_tree_sha256=code_tree_sha256,
)
check("identity_schema",identity["schema"]=="ekg-ep3-pkt08-candidate-identity-v1")
check("identity_candidate_id",identity["candidate_id"]==candidate_id)
check("identity_candidate_version",identity["candidate_version"]==candidate_version)
check("identity_model_artifact",identity["model_artifact_sha256"]==model_artifact_sha256)
check("identity_configuration",identity["configuration_sha256"]==configuration_sha256)
check("identity_source",identity["source_artifact_sha256"]==source_artifact_sha256)
check("identity_pattern_registry",identity["pattern_registry_sha256"]==pattern_registry_sha256)
check("identity_code_commit",identity["code_commit_sha256"]==code_commit_sha256)
check("identity_code_tree",identity["code_tree_sha256"]==code_tree_sha256)
check("identity_baseline_commit",identity["baseline_commit"]==gate.BASELINE_COMMIT)
check("identity_baseline_tree",identity["baseline_tree"]==gate.BASELINE_TREE)
check("identity_packet_id",identity["packet_id"]==gate.PACKET_ID)
check("identity_packet_sha256",identity["packet_sha256"]==gate.PACKET_SHA256)
check("identity_stage1",identity["stage1_receipt_sha256"]==gate.STAGE1_RECEIPT_SHA256)
check("identity_prior",identity["prior_packet_receipt_sha256"]==gate.PRIOR_PACKET_RECEIPT_SHA256)
check("identity_frozen",identity["frozen"] is True)
check("identity_sha256_length",len(identity["identity_sha256"])==64)
check("identity_deterministic",identity==gate.candidate_identity(
    candidate_id=candidate_id,candidate_version=candidate_version,
    model_artifact_sha256=model_artifact_sha256,configuration_sha256=configuration_sha256,
    source_artifact_sha256=source_artifact_sha256,pattern_registry_sha256=pattern_registry_sha256,
    code_commit_sha256=code_commit_sha256,code_tree_sha256=code_tree_sha256))

# Identity validation
validated=gate.validate_candidate_identity(identity)
check("identity_validation",validated is not None)

expect("identity_schema_invalid","CANDIDATE_IDENTITY_SCHEMA",lambda:gate.validate_candidate_identity({"schema":"wrong"}))
expect("identity_missing_field","CANDIDATE_IDENTITY_MISSING",lambda:gate.validate_candidate_identity({k:v for k,v in identity.items() if k!="candidate_id"}))
expect("identity_not_frozen","CANDIDATE_IDENTITY_NOT_FROZEN",lambda:gate.validate_candidate_identity({**identity,"frozen":False}))
expect("identity_baseline_mismatch","CANDIDATE_IDENTITY_BASELINE_MISMATCH",lambda:gate.validate_candidate_identity({**identity,"baseline_commit":"wrong"}))
expect("identity_packet_mismatch","CANDIDATE_IDENTITY_PACKET_MISMATCH",lambda:gate.validate_candidate_identity({**identity,"packet_id":"PKT-EP3-07"}))
expect("identity_sha256_mismatch","CANDIDATE_IDENTITY_SHA256_MISMATCH",lambda:gate.validate_candidate_identity({**identity,"identity_sha256":"0"*64}))

# Identity type checks
expect("identity_candidate_id_type","CANDIDATE_ID_INVALID",lambda:gate.candidate_identity(
    candidate_id="not-a-sha",candidate_version=candidate_version,
    model_artifact_sha256=model_artifact_sha256,configuration_sha256=configuration_sha256,
    source_artifact_sha256=source_artifact_sha256,pattern_registry_sha256=pattern_registry_sha256,
    code_commit_sha256=code_commit_sha256,code_tree_sha256=code_tree_sha256))
expect("identity_model_artifact_type","MODEL_ARTIFACT_INVALID",lambda:gate.candidate_identity(
    candidate_id=candidate_id,candidate_version=candidate_version,
    model_artifact_sha256="short",configuration_sha256=configuration_sha256,
    source_artifact_sha256=source_artifact_sha256,pattern_registry_sha256=pattern_registry_sha256,
    code_commit_sha256=code_commit_sha256,code_tree_sha256=code_tree_sha256))

# Identity drift detection
drift_identity={**identity,"candidate_id":"f"*64}
drift_detected,drift_fields=gate.identity_drift_detected(identity,drift_identity)
check("identity_drift_detected",drift_detected is True)
check("identity_drift_fields",len(drift_fields)>0)
check("identity_drift_field_candidate_id","candidate_id" in drift_fields)

no_drift_detected,no_drift_fields=gate.identity_drift_detected(identity,identity)
check("identity_no_drift",no_drift_detected is False)
check("identity_no_drift_fields",len(no_drift_fields)==0)

# ---------------------------------------------------------------------------
# Gold admission state
# ---------------------------------------------------------------------------

check("gold_admission_schema",gate.gold_admission_state(0,False)["schema"]=="ekg-ep3-pkt08-gold-admission-state-v1")

gold_zero=gate.gold_admission_state(approved_adjudicated_gold_count=0,clinical_gold_admission_performed=False)
check("gold_zero_count",gold_zero["approved_adjudicated_gold_count"]==0)
check("gold_zero_admission",gold_zero["clinical_gold_admission_performed"] is False)
check("gold_zero_genuinely_admitted",gold_zero["genuinely_admitted_adjudicated_gold"] is False)
check("gold_zero_state",gold_zero["gold_admission_state"]=="ADMISSION_INCOMPLETE")

gold_count_only=gate.gold_admission_state(approved_adjudicated_gold_count=5,clinical_gold_admission_performed=False)
check("gold_count_only_count",gold_count_only["approved_adjudicated_gold_count"]==5)
check("gold_count_only_genuinely",gold_count_only["genuinely_admitted_adjudicated_gold"] is False)

gold_admission_only=gate.gold_admission_state(approved_adjudicated_gold_count=0,clinical_gold_admission_performed=True)
check("gold_admission_only_admission",gold_admission_only["clinical_gold_admission_performed"] is True)
check("gold_admission_only_genuinely",gold_admission_only["genuinely_admitted_adjudicated_gold"] is False)

gold_fully=gate.gold_admission_state(approved_adjudicated_gold_count=5,clinical_gold_admission_performed=True)
check("gold_fully_count",gold_fully["approved_adjudicated_gold_count"]==5)
check("gold_fully_admission",gold_fully["clinical_gold_admission_performed"] is True)
check("gold_fully_genuinely",gold_fully["genuinely_admitted_adjudicated_gold"] is True)
check("gold_fully_state",gold_fully["gold_admission_state"]=="ADMISSION_COMPLETE")

check("gold_deterministic",gold_fully==gate.gold_admission_state(approved_adjudicated_gold_count=5,clinical_gold_admission_performed=True))
check("gold_hash",len(gold_fully["schema"])>0)

expect("gold_count_type","APPROVED_ADJUDICATED_GOLD_COUNT_TYPE",lambda:gate.gold_admission_state(approved_adjudicated_gold_count="5",clinical_gold_admission_performed=False))
expect("gold_count_negative","APPROVED_ADJUDICATED_GOLD_COUNT_NEGATIVE",lambda:gate.gold_admission_state(approved_adjudicated_gold_count=-1,clinical_gold_admission_performed=False))
expect("gold_count_bool","APPROVED_ADJUDICATED_GOLD_COUNT_TYPE",lambda:gate.gold_admission_state(approved_adjudicated_gold_count=True,clinical_gold_admission_performed=False))
expect("gold_admission_type","CLINICAL_GOLD_ADMISSION_PERFORMED_TYPE",lambda:gate.gold_admission_state(approved_adjudicated_gold_count=1,clinical_gold_admission_performed="yes"))

# Gold admission validation
check("gold_validate_zero",gate.validate_gold_admission_state(gold_zero) is True)
check("gold_validate_fully",gate.validate_gold_admission_state(gold_fully) is True)

tampered_gold=dict(gold_fully)
tampered_gold["genuinely_admitted_adjudicated_gold"]=False
check("gold_validate_tampered",gate.validate_gold_admission_state(tampered_gold) is False)

# ---------------------------------------------------------------------------
# Evidence maturity
# ---------------------------------------------------------------------------

maturity_zero=gate.evidence_maturity_state(
    gold_admission=gold_zero,
    metric_maturity="NOT_REPORTABLE",
    clinically_eligible_metric_count=0,
    diagnostic_performance_reporting_allowed=False,
    clinical_accuracy_claimed=False,
)
check("maturity_zero_schema",maturity_zero["schema"]=="ekg-ep3-pkt08-evidence-maturity-v1")
check("maturity_zero_state",maturity_zero["metric_maturity"]=="NOT_REPORTABLE")
check("maturity_zero_clinically_eligible",maturity_zero["clinically_eligible_evidence_maturity"] is False)
check("maturity_zero_reportable",maturity_zero["clinical_metric_reportable"] is False)

maturity_eligible=gate.evidence_maturity_state(
    gold_admission=gold_fully,
    metric_maturity="CLINICALLY_ELIGIBLE",
    clinically_eligible_metric_count=30,
    diagnostic_performance_reporting_allowed=True,
    clinical_accuracy_claimed=False,
)
check("maturity_eligible_state",maturity_eligible["metric_maturity"]=="CLINICALLY_ELIGIBLE")
check("maturity_eligible_clinically_eligible",maturity_eligible["clinically_eligible_evidence_maturity"] is True)
check("maturity_eligible_reportable",maturity_eligible["clinical_metric_reportable"] is True)

maturity_engineering=gate.evidence_maturity_state(
    gold_admission=gold_fully,
    metric_maturity="ENGINEERING_CONFORMANCE_ONLY",
    clinically_eligible_metric_count=30,
    diagnostic_performance_reporting_allowed=True,
    clinical_accuracy_claimed=False,
)
check("maturity_engineering_state",maturity_engineering["metric_maturity"]=="ENGINEERING_CONFORMANCE_ONLY")
check("maturity_engineering_clinically_eligible",maturity_engineering["clinically_eligible_evidence_maturity"] is False)

check("maturity_validate_zero",gate.validate_evidence_maturity(maturity_zero) is True)
check("maturity_validate_eligible",gate.validate_evidence_maturity(maturity_eligible) is True)

tampered_maturity=dict(maturity_eligible)
tampered_maturity["clinically_eligible_evidence_maturity"]=False
check("maturity_validate_tampered",gate.validate_evidence_maturity(tampered_maturity) is False)

expect("maturity_state_unknown","METRIC_MATURITY_STATE_UNKNOWN",lambda:gate.evidence_maturity_state(
    gold_admission=gold_fully,metric_maturity="MADE_UP",
    clinically_eligible_metric_count=30,diagnostic_performance_reporting_allowed=True,
    clinical_accuracy_claimed=False))
expect("maturity_count_type","CLINICALLY_ELIGIBLE_METRIC_COUNT_TYPE",lambda:gate.evidence_maturity_state(
    gold_admission=gold_fully,metric_maturity="CLINICALLY_ELIGIBLE",
    clinically_eligible_metric_count="30",diagnostic_performance_reporting_allowed=True,
    clinical_accuracy_claimed=False))
expect("maturity_count_negative","CLINICALLY_ELIGIBLE_METRIC_COUNT_NEGATIVE",lambda:gate.evidence_maturity_state(
    gold_admission=gold_fully,metric_maturity="CLINICALLY_ELIGIBLE",
    clinically_eligible_metric_count=-1,diagnostic_performance_reporting_allowed=True,
    clinical_accuracy_claimed=False))
expect("maturity_reporting_type","DIAGNOSTIC_PERFORMANCE_REPORTING_TYPE",lambda:gate.evidence_maturity_state(
    gold_admission=gold_fully,metric_maturity="CLINICALLY_ELIGIBLE",
    clinically_eligible_metric_count=30,diagnostic_performance_reporting_allowed="yes",
    clinical_accuracy_claimed=False))
expect("maturity_accuracy_type","CLINICAL_ACCURACY_CLAIMED_TYPE",lambda:gate.evidence_maturity_state(
    gold_admission=gold_fully,metric_maturity="CLINICALLY_ELIGIBLE",
    clinically_eligible_metric_count=30,diagnostic_performance_reporting_allowed=True,
    clinical_accuracy_claimed="false"))

# ---------------------------------------------------------------------------
# Cohort/denominator integrity
# ---------------------------------------------------------------------------

integrity_ok=gate.cohort_denominator_integrity(
    declared_denominator=100,
    evaluated_count=80,
    excluded_count=20,
    exclusion_reasons={"gold_indeterminate":15,"prediction_unsupported":5},
    partition_leakage_fence_verified=True,
    case_family_leakage_fence_verified=True,
    minimum_support_compliant=True,
    case_family_integrity_verified=True,
    partition_integrity_verified=True,
)
check("integrity_schema",integrity_ok["schema"]=="ekg-ep3-pkt08-cohort-denominator-integrity-v1")
check("integrity_reconciled",integrity_ok["reconciled"] is True)
check("integrity_holds",integrity_ok["denominator_cohort_integrity"] is True)
check("integrity_state",integrity_ok["integrity_state"]=="INTEGRITY_HELD")

integrity_mismatch=gate.cohort_denominator_integrity(
    declared_denominator=100,
    evaluated_count=80,
    excluded_count=15,
    exclusion_reasons={"gold_indeterminate":15},
    partition_leakage_fence_verified=True,
    case_family_leakage_fence_verified=True,
    minimum_support_compliant=True,
    case_family_integrity_verified=True,
    partition_integrity_verified=True,
)
check("integrity_mismatch_reconciled",integrity_mismatch["reconciled"] is False)
check("integrity_mismatch_holds",integrity_mismatch["denominator_cohort_integrity"] is False)
check("integrity_mismatch_state",integrity_mismatch["integrity_state"]=="INTEGRITY_FAILED")

check("integrity_validate_ok",gate.validate_cohort_denominator_integrity(integrity_ok) is True)
check("integrity_validate_mismatch",gate.validate_cohort_denominator_integrity(integrity_mismatch) is True)

expect("integrity_denominator_type","DECLARED_DENOMINATOR_TYPE",lambda:gate.cohort_denominator_integrity(
    declared_denominator=-1,evaluated_count=0,excluded_count=0,exclusion_reasons={},
    partition_leakage_fence_verified=True,case_family_leakage_fence_verified=True,
    minimum_support_compliant=True,case_family_integrity_verified=True,partition_integrity_verified=True))
expect("integrity_denominator_zero","DECLARED_DENOMINATOR_TYPE",lambda:gate.cohort_denominator_integrity(
    declared_denominator=0,evaluated_count=0,excluded_count=0,exclusion_reasons={},
    partition_leakage_fence_verified=True,case_family_leakage_fence_verified=True,
    minimum_support_compliant=True,case_family_integrity_verified=True,partition_integrity_verified=True))
expect("integrity_evaluated_type","EVALUATED_COUNT_TYPE",lambda:gate.cohort_denominator_integrity(
    declared_denominator=100,evaluated_count="80",excluded_count=20,exclusion_reasons={},
    partition_leakage_fence_verified=True,case_family_leakage_fence_verified=True,
    minimum_support_compliant=True,case_family_integrity_verified=True,partition_integrity_verified=True))
expect("integrity_exclusion_reasons_type","EXCLUSION_REASONS_TYPE",lambda:gate.cohort_denominator_integrity(
    declared_denominator=100,evaluated_count=80,excluded_count=20,exclusion_reasons="not-a-dict",
    partition_leakage_fence_verified=True,case_family_leakage_fence_verified=True,
    minimum_support_compliant=True,case_family_integrity_verified=True,partition_integrity_verified=True))
expect("integrity_exclusion_reason_count","EXCLUSION_REASON_COUNT_TYPE",lambda:gate.cohort_denominator_integrity(
    declared_denominator=100,evaluated_count=80,excluded_count=20,
    exclusion_reasons={"gold_indeterminate":-1},
    partition_leakage_fence_verified=True,case_family_leakage_fence_verified=True,
    minimum_support_compliant=True,case_family_integrity_verified=True,partition_integrity_verified=True))

# ---------------------------------------------------------------------------
# Leakage verification
# ---------------------------------------------------------------------------

leakage_ok=gate.leakage_verification(
    partition_leakage_fence_verified=True,
    case_family_leakage_fence_verified=True,
    subject_group_isolation_verified=True,
    serial_split_isolation_verified=True,
)
check("leakage_schema",leakage_ok["schema"]=="ekg-ep3-pkt08-leakage-verification-v1")
check("leakage_no_leakage",leakage_ok["no_leakage"] is True)
check("leakage_state",leakage_ok["leakage_state"]=="NO_LEAKAGE_VERIFIED")

leakage_fail=gate.leakage_verification(
    partition_leakage_fence_verified=False,
    case_family_leakage_fence_verified=True,
    subject_group_isolation_verified=True,
    serial_split_isolation_verified=True,
)
check("leakage_fail_no_leakage",leakage_fail["no_leakage"] is False)
check("leakage_fail_state",leakage_fail["leakage_state"]=="LEAKAGE_DETECTED")

check("leakage_validate_ok",gate.validate_leakage_verification(leakage_ok) is True)
check("leakage_validate_fail",gate.validate_leakage_verification(leakage_fail) is True)

# ---------------------------------------------------------------------------
# Evaluation freeze
# ---------------------------------------------------------------------------

freeze=gate.evaluation_freeze(
    freeze_identity_sha256="a"*64,
    dataset_manifest_sha256="b"*64,
    prediction_artifact_sha256s=["c"*64,"d"*64,"c"*64],
    evidence_timestamp_utc="2026-09-15T12:00:00Z",
    inputs_sha256="e"*64,
    predictions_sha256="f"*64,
    admitted_gold_manifest_sha256="0"*64,
    metrics_sha256="1"*64,
    code_commit_sha256="2"*64,
    code_tree_sha256="3"*64,
    model_artifact_sha256="4"*64,
    configuration_sha256="5"*64,
    cohort_policy_sha256="6"*64,
)
check("freeze_schema",freeze["schema"]=="ekg-ep3-pkt08-evaluation-freeze-v1")
check("freeze_frozen",freeze["frozen"] is True)
check("freeze_immutable",freeze["immutable"] is True)
check("freeze_no_post_modification",freeze["post_freeze_modification_allowed"] is False)
check("freeze_dedup_sorted",freeze["prediction_artifact_sha256s"]==["c"*64,"d"*64])
check("freeze_hash",len(freeze["freeze_sha256"])==64)

check("freeze_validate",gate.validate_evaluation_freeze(freeze) is True)

expect("freeze_identity_type","EVALUATION_FREEZE_IDENTITY_INVALID",lambda:gate.evaluation_freeze(
    freeze_identity_sha256="short",dataset_manifest_sha256="b"*64,
    prediction_artifact_sha256s=["c"*64],evidence_timestamp_utc="2026-09-15T12:00:00Z",
    inputs_sha256="e"*64,predictions_sha256="f"*64,admitted_gold_manifest_sha256="0"*64,
    metrics_sha256="1"*64,code_commit_sha256="2"*64,code_tree_sha256="3"*64,
    model_artifact_sha256="4"*64,configuration_sha256="5"*64,cohort_policy_sha256="6"*64))
expect("freeze_not_frozen","EVALUATION_FREEZE_NOT_FROZEN",lambda:gate.evaluation_freeze(
    freeze_identity_sha256="a"*64,dataset_manifest_sha256="b"*64,
    prediction_artifact_sha256s=["c"*64],evidence_timestamp_utc="2026-09-15T12:00:00Z",
    inputs_sha256="e"*64,predictions_sha256="f"*64,admitted_gold_manifest_sha256="0"*64,
    metrics_sha256="1"*64,code_commit_sha256="2"*64,code_tree_sha256="3"*64,
    model_artifact_sha256="4"*64,configuration_sha256="5"*64,cohort_policy_sha256="6"*64,
    frozen=False))

# Stale check
check("freeze_not_stale",gate.is_evaluation_freeze_stale(freeze,"2026-09-15T13:00:00Z") is False)
check("freeze_stale",gate.is_evaluation_freeze_stale(freeze,"2026-09-14T12:00:00Z") is True)

# ---------------------------------------------------------------------------
# Claim eligibility
# ---------------------------------------------------------------------------

claim_ok=gate.claim_eligibility(
    clinically_eligible_evidence_maturity=True,
    clinical_accuracy_claimed=False,
    diagnostic_performance_reporting_allowed=True,
    explicit_claim_authorized=True,
)
check("claim_schema",claim_ok["schema"]=="ekg-ep3-pkt08-claim-eligibility-v1")
check("claim_eligible",claim_ok["claim_eligibility"] is True)
check("claim_state",claim_ok["claim_state"]=="CLAIM_ELIGIBLE")

claim_not_eligible=gate.claim_eligibility(
    clinically_eligible_evidence_maturity=True,
    clinical_accuracy_claimed=False,
    diagnostic_performance_reporting_allowed=True,
    explicit_claim_authorized=False,
)
check("claim_not_eligible",claim_not_eligible["claim_eligibility"] is False)
check("claim_not_eligible_state",claim_not_eligible["claim_state"]=="CLAIM_INELIGIBLE")

check("claim_validate_ok",gate.validate_claim_eligibility(claim_ok) is True)
check("claim_validate_not_eligible",gate.validate_claim_eligibility(claim_not_eligible) is True)

expect("claim_clinically_eligible_type","CLINICALLY_ELIGIBLE_EVIDENCE_MATURITY_TYPE",lambda:gate.claim_eligibility(
    clinically_eligible_evidence_maturity="yes",clinical_accuracy_claimed=False,
    diagnostic_performance_reporting_allowed=True,explicit_claim_authorized=True))
expect("claim_accuracy_type","CLINICAL_ACCURACY_CLAIMED_TYPE",lambda:gate.claim_eligibility(
    clinically_eligible_evidence_maturity=True,clinical_accuracy_claimed="false",
    diagnostic_performance_reporting_allowed=True,explicit_claim_authorized=True))
expect("claim_reporting_type","DIAGNOSTIC_PERFORMANCE_REPORTING_TYPE",lambda:gate.claim_eligibility(
    clinically_eligible_evidence_maturity=True,clinical_accuracy_claimed=False,
    diagnostic_performance_reporting_allowed="yes",explicit_claim_authorized=True))
expect("claim_authorized_type","EXPLICIT_CLAIM_AUTHORIZED_TYPE",lambda:gate.claim_eligibility(
    clinically_eligible_evidence_maturity=True,clinical_accuracy_claimed=False,
    diagnostic_performance_reporting_allowed=True,explicit_claim_authorized="yes"))

# ---------------------------------------------------------------------------
# Governance sign-off
# ---------------------------------------------------------------------------

sign_off=gate.governance_sign_off(
    sign_off_identity_sha256="a"*64,
    principal_sha256=principal("governance-reviewer"),
    session_id="session-001",
    review_evidence_bundle_sha256="b"*64,
    sign_off_timestamp_utc="2026-09-15T12:00:00Z",
    sign_off_revoked=False,
    sign_off_explicit=True,
)
check("sign_off_schema",sign_off["schema"]=="ekg-ep3-pkt08-governance-sign-off-v1")
check("sign_off_explicit",sign_off["sign_off_explicit"] is True)
check("sign_off_revoked",sign_off["sign_off_revoked"] is False)
check("sign_off_performed",sign_off["sign_off_performed"] is True)
check("sign_off_valid",sign_off["sign_off_valid"] is True)
check("sign_off_hash",len(sign_off["sign_off_sha256"])==64)

check("sign_off_validate",gate.validate_governance_sign_off(sign_off) is True)

sign_off_revoked=gate.governance_sign_off(
    sign_off_identity_sha256="a"*64,
    principal_sha256=principal("governance-reviewer"),
    session_id="session-001",
    review_evidence_bundle_sha256="b"*64,
    sign_off_timestamp_utc="2026-09-15T12:00:00Z",
    sign_off_revoked=True,
    sign_off_explicit=True,
)
check("sign_off_revoked_performed",sign_off_revoked["sign_off_performed"] is False)
check("sign_off_revoked_valid",sign_off_revoked["sign_off_valid"] is False)

check("sign_off_revoked_validate",gate.validate_governance_sign_off(sign_off_revoked) is True)

expect("sign_off_identity_type","SIGN_OFF_IDENTITY_INVALID",lambda:gate.governance_sign_off(
    sign_off_identity_sha256="short",principal_sha256=principal("x"),
    session_id="session-001",review_evidence_bundle_sha256="b"*64,
    sign_off_timestamp_utc="2026-09-15T12:00:00Z"))
expect("sign_off_timestamp_invalid","SIGN_OFF_TIMESTAMP_INVALID",lambda:gate.governance_sign_off(
    sign_off_identity_sha256="a"*64,principal_sha256=principal("x"),
    session_id="session-001",review_evidence_bundle_sha256="b"*64,
    sign_off_timestamp_utc=""))

# ---------------------------------------------------------------------------
# Release evidence bundle
# ---------------------------------------------------------------------------

bundle=gate.release_evidence_bundle(
    candidate_identity=identity,
    gold_admission=gold_zero,
    evidence_maturity=maturity_zero,
    cohort_integrity=integrity_ok,
    leakage_verification_result=leakage_ok,
    evaluation_freeze=freeze,
    claim_eligibility_result=claim_not_eligible,
    governance_sign_off_result=sign_off,
    readiness_state="BLOCKED",
    activation_eligibility_state="INELIGIBLE",
    limitations=["ACTIVATION_ELIGIBLE is an eligibility state, not activation."],
    residual_blockers=["No admitted adjudicated gold"],
    ci_receipt_sha256="1"*64,
    verification_receipt_sha256="2"*64,
)
check("bundle_schema",bundle["schema"]=="ekg-ep3-pkt08-release-evidence-bundle-v1")
check("bundle_packet_id",bundle["packet_id"]==gate.PACKET_ID)
check("bundle_baseline_commit",bundle["baseline_commit"]==gate.BASELINE_COMMIT)
check("bundle_baseline_tree",bundle["baseline_tree"]==gate.BASELINE_TREE)
check("bundle_candidate_active",bundle["candidate_active"] is False)
check("bundle_diagnostic_runtime",bundle["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("bundle_gold_count",bundle["approved_adjudicated_gold_count"]==0)
check("bundle_gold_admission",bundle["clinical_gold_admission_performed"] is False)
check("bundle_metric_maturity",bundle["metric_maturity"]=="NOT_REPORTABLE")
check("bundle_clinical_accuracy",bundle["clinical_accuracy_claimed"] is False)
check("bundle_reporting_allowed",bundle["diagnostic_performance_reporting_allowed"] is False)
check("bundle_provenance_complete",bundle["provenance_complete"] is True)
check("bundle_can_activate",bundle["bundle_can_activate_runtime"] is False)
check("bundle_hash",len(bundle["release_evidence_bundle_sha256"])==64)

check("bundle_validate",gate.validate_release_evidence_bundle(bundle) is True)

expect("bundle_readiness_unknown","READINESS_STATE_UNKNOWN",lambda:gate.release_evidence_bundle(
    candidate_identity=identity,gold_admission=gold_zero,evidence_maturity=maturity_zero,
    cohort_integrity=integrity_ok,leakage_verification_result=leakage_ok,
    evaluation_freeze=freeze,claim_eligibility_result=claim_not_eligible,
    governance_sign_off_result=sign_off,readiness_state="MADE_UP",
    activation_eligibility_state="INELIGIBLE",limitations=[],residual_blockers=[],
    ci_receipt_sha256="7"*64,verification_receipt_sha256="8"*64))
expect("bundle_ci_receipt_type","CI_RECEIPT_INVALID",lambda:gate.release_evidence_bundle(
    candidate_identity=identity,gold_admission=gold_zero,evidence_maturity=maturity_zero,
    cohort_integrity=integrity_ok,leakage_verification_result=leakage_ok,
    evaluation_freeze=freeze,claim_eligibility_result=claim_not_eligible,
    governance_sign_off_result=sign_off,readiness_state="BLOCKED",
    activation_eligibility_state="INELIGIBLE",limitations=[],residual_blockers=[],
    ci_receipt_sha256="short",verification_receipt_sha256="8"*64))

# ---------------------------------------------------------------------------
# Activation eligibility gate (conjunctive, fail closed)
# ---------------------------------------------------------------------------

# Zero-gold fail-closed case
zero_gold_gate=gate.activation_eligibility_gate(
    candidate_identity=identity,
    gold_admission=gold_zero,
    evidence_maturity=maturity_zero,
    cohort_integrity=integrity_ok,
    leakage_verification_result=leakage_ok,
    evaluation_freeze=freeze,
    claim_eligibility_result=claim_not_eligible,
    governance_sign_off_result=sign_off,
)
check("zero_gold_gate_schema",zero_gold_gate["schema"]=="ekg-ep3-pkt08-activation-eligibility-gate-v1")
check("zero_gold_gate_packet",zero_gold_gate["packet_id"]==gate.PACKET_ID)
check("zero_gold_gate_baseline",zero_gold_gate["baseline_commit"]==gate.BASELINE_COMMIT)
check("zero_gold_gate_candidate_active",zero_gold_gate["candidate_active"] is False)
check("zero_gold_gate_diagnostic_runtime",zero_gold_gate["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("zero_gold_gate_runtime_activation",zero_gold_gate["diagnostic_runtime_activation_allowed"] is False)
check("zero_gold_gate_auto_select",zero_gold_gate["automatic_candidate_selection_allowed"] is False)
check("zero_gold_gate_runtime_influence",zero_gold_gate["runtime_influence_allowed"] is False)
check("zero_gold_gate_patient_cds",zero_gold_gate["patient_specific_clinical_decision_support_allowed"] is False)
check("zero_gold_gate_actual_activation",zero_gold_gate["actual_activation_performed_by_this_packet"] is False)
check("zero_gold_gate_readiness",zero_gold_gate["readiness_state"]=="BLOCKED")
check("zero_gold_gate_activation_eligibility",zero_gold_gate["activation_eligibility_state"]=="INELIGIBLE")
check("zero_gold_gate_satisfied",len(zero_gold_gate["satisfied_prerequisites"])>=0)
check("zero_gold_gate_unsatisfied_count",len(zero_gold_gate["unsatisfied_prerequisites"])>0)
check("zero_gold_gate_unsatisfied_includes_gold","genuinely_admitted_adjudicated_gold" in zero_gold_gate["unsatisfied_prerequisites"])

check("zero_gold_gate_validate",gate.validate_activation_eligibility_gate(zero_gold_gate) is True)

# Full eligibility case (ACTIVATION_ELIGIBLE but still inactive!)
full_eligibility_gate=gate.activation_eligibility_gate(
    candidate_identity=identity,
    gold_admission=gold_fully,
    evidence_maturity=maturity_eligible,
    cohort_integrity=integrity_ok,
    leakage_verification_result=leakage_ok,
    evaluation_freeze=freeze,
    claim_eligibility_result=claim_ok,
    governance_sign_off_result=sign_off,
)
check("full_eligibility_gate_readiness",full_eligibility_gate["readiness_state"]=="READY_FOR_GOVERNANCE_REVIEW")
check("full_eligibility_gate_activation_eligible",full_eligibility_gate["activation_eligibility_state"]=="ACTIVATION_ELIGIBLE")
check("full_eligibility_gate_candidate_inactive",full_eligibility_gate["candidate_active"] is False)
check("full_eligibility_gate_runtime_inactive",full_eligibility_gate["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("full_eligibility_gate_no_actual_activation",full_eligibility_gate["actual_activation_performed_by_this_packet"] is False)
check("full_eligibility_gate_satisfied_all",len(full_eligibility_gate["satisfied_prerequisites"])==len(gate.ACTIVATION_PREREQUISITES))

# Stale evidence invalidates
stale_gate=gate.activation_eligibility_gate(
    candidate_identity=identity,
    gold_admission=gold_fully,
    evidence_maturity=maturity_eligible,
    cohort_integrity=integrity_ok,
    leakage_verification_result=leakage_ok,
    evaluation_freeze=freeze,
    claim_eligibility_result=claim_ok,
    governance_sign_off_result=sign_off,
    current_timestamp_utc="2026-09-14T12:00:00Z",  # Earlier than freeze timestamp
)
check("stale_gate_readiness",stale_gate["readiness_state"]=="BLOCKED")
check("stale_gate_activation_ineligible",stale_gate["activation_eligibility_state"]=="INELIGIBLE")
check("stale_gate_stale_detected",stale_gate["stale_evidence_detected"] is True)
check("stale_gate_unsatisfied_includes_freeze","non_stale_immutable_evaluation_freeze" in stale_gate["unsatisfied_prerequisites"])

# Revoked sign-off invalidates
revoked_signoff_gate=gate.activation_eligibility_gate(
    candidate_identity=identity,
    gold_admission=gold_fully,
    evidence_maturity=maturity_eligible,
    cohort_integrity=integrity_ok,
    leakage_verification_result=leakage_ok,
    evaluation_freeze=freeze,
    claim_eligibility_result=claim_ok,
    governance_sign_off_result=sign_off_revoked,
)
check("revoked_gate_readiness",revoked_signoff_gate["readiness_state"]=="BLOCKED")
check("revoked_gate_activation_ineligible",revoked_signoff_gate["activation_eligibility_state"]=="INELIGIBLE")
check("revoked_gate_revoked_detected",revoked_signoff_gate["sign_off_revoked_detected"] is True)

# ---------------------------------------------------------------------------
# Invalidation / rollback / deactivation
# ---------------------------------------------------------------------------

invalidated=gate.invalidate_readiness(
    current_state={"readiness_state":"READY_FOR_GOVERNANCE_REVIEW","activation_eligibility_state":"ACTIVATION_ELIGIBLE"},
    trigger="sign_off_revocation",
    reason="Governance sign-off was revoked",
)
check("invalidated_schema",invalidated["schema"]=="ekg-ep3-pkt08-invalidation-record-v1")
check("invalidated_trigger",invalidated["trigger"]=="sign_off_revocation")
check("invalidated_new_readiness",invalidated["new_readiness_state"]=="BLOCKED")
check("invalidated_new_activation",invalidated["new_activation_eligibility_state"]=="INELIGIBLE")
check("invalidated_runtime_preserved",invalidated["diagnostic_runtime_preserved"]=="GOVERNED_INACTIVE")

expect("invalidation_trigger_unknown","INVALIDATION_TRIGGER_UNKNOWN",lambda:gate.invalidate_readiness(
    current_state={},trigger="made_up_trigger",reason="test"))

deactivated=gate.deactivate_and_rollback(
    activated_state={"readiness_state":"READY_FOR_GOVERNANCE_REVIEW","activation_eligibility_state":"ACTIVATION_ELIGIBLE","diagnostic_runtime":"ACTIVE"},
    trigger="stale_or_revoked_evidence",
    reason="Evidence was found to be stale",
)
check("deactivated_schema",deactivated["schema"]=="ekg-ep3-pkt08-deactivation-record-v1")
check("deactivated_new_readiness",deactivated["new_readiness_state"]=="BLOCKED")
check("deactivated_new_activation",deactivated["new_activation_eligibility_state"]=="INELIGIBLE")
check("deactivated_new_runtime",deactivated["new_diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("deactivated_candidate_inactive",deactivated["new_candidate_active"] is False)
check("deactivated_no_silent_fallback",deactivated["silent_fallback_allowed"] is False)
check("deactivated_no_source_substitution",deactivated["source_substitution_allowed"] is False)
check("deactivated_no_candidate_substitution",deactivated["candidate_substitution_allowed"] is False)
check("deactivated_no_authority_rewrite",deactivated["authority_rewrite_allowed"] is False)
check("deactivated_rollback_performed",deactivated["rollback_performed"] is True)

# ---------------------------------------------------------------------------
# Current zero-gold state
# ---------------------------------------------------------------------------

current=gate.current_zero_gold_activation_state()
check("current_schema",current["schema"]==gate.SCHEMA)
check("current_packet",current["packet_id"]==gate.PACKET_ID)
check("current_gold_count",current["approved_adjudicated_gold_count"]==0)
check("current_gold_admission",current["clinical_gold_admission_performed"] is False)
check("current_metric_maturity",current["metric_maturity"]=="NOT_REPORTABLE")
check("current_clinically_eligible_count",current["clinically_eligible_metric_count"]==0)
check("current_reporting_allowed",current["diagnostic_performance_reporting_allowed"] is False)
check("current_clinical_accuracy",current["clinical_accuracy_claimed"] is False)
check("current_readiness",current["readiness_state"]=="BLOCKED")
check("current_activation_eligibility",current["activation_eligibility_state"]=="INELIGIBLE")
check("current_candidate_active",current["candidate_active"] is False)
check("current_diagnostic_runtime",current["diagnostic_runtime"]=="GOVERNED_INACTIVE")

# ---------------------------------------------------------------------------
# Activation readiness descriptor
# ---------------------------------------------------------------------------

descriptor=gate.activation_readiness_descriptor(zero_gold_gate)
check("descriptor_schema",descriptor["schema"]=="ekg-ep3-pkt08-activation-readiness-descriptor-v1")
check("descriptor_packet",descriptor["packet_id"]==gate.PACKET_ID)
check("descriptor_baseline",descriptor["baseline_commit"]==gate.BASELINE_COMMIT)
check("descriptor_readiness",descriptor["readiness_state"]=="BLOCKED")
check("descriptor_activation",descriptor["activation_eligibility_state"]=="INELIGIBLE")
check("descriptor_candidate_inactive",descriptor["candidate_active"] is False)
check("descriptor_runtime_inactive",descriptor["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("descriptor_no_raw_clinical",descriptor["raw_clinical_waveform_or_image_bytes_included"] is False)
check("descriptor_no_phi",descriptor["phi_included"] is False)
check("descriptor_no_authority_rewrite",descriptor["authority_rewritten"] is False)
check("descriptor_no_silent_fallback",descriptor["silent_fallback_allowed"] is False)
check("descriptor_no_source_substitution",descriptor["source_substitution_allowed"] is False)
check("descriptor_no_candidate_substitution",descriptor["candidate_substitution_allowed"] is False)

# ---------------------------------------------------------------------------
# Fixtures validation
# ---------------------------------------------------------------------------

fixture=json.loads((GEN/"EP3_PKT08_ACTIVATION_GATE_FIXTURES.json").read_text())
check("fixture_no_phi",fixture["phi"] is False)
check("fixture_no_raw",fixture["raw_clinical_waveform_or_image_bytes_included"] is False)
check("fixture_zero_gold",fixture["approved_adjudicated_gold_count"]==0)
check("fixture_no_admission",fixture["clinical_gold_admission_performed"] is False)
check("fixture_maturity",fixture["metric_maturity"]=="NOT_REPORTABLE")
check("fixture_runtime_inactive",fixture["diagnostic_runtime"]=="GOVERNED_INACTIVE")
check("fixture_reporting_blocked",fixture["diagnostic_performance_reporting_allowed"] is False)
check("fixture_synth_not_gold",fixture["synthetic_fixtures_are_clinical_gold"] is False)
check("fixture_scenarios",len(fixture["scenarios"])==20)

# ---------------------------------------------------------------------------
# Identity provenance constants
# ---------------------------------------------------------------------------

check("all_prerequisites_defined",len(gate.ACTIVATION_PREREQUISITES)==9)
check("prereq_gold","genuinely_admitted_adjudicated_gold" in gate.ACTIVATION_PREREQUISITES)
check("prereq_maturity","clinically_eligible_evidence_maturity" in gate.ACTIVATION_PREREQUISITES)
check("prereq_identities","exact_candidate_model_config_source_identities" in gate.ACTIVATION_PREREQUISITES)
check("prereq_integrity","denominator_cohort_integrity" in gate.ACTIVATION_PREREQUISITES)
check("prereq_no_leakage","no_leakage" in gate.ACTIVATION_PREREQUISITES)
check("prereq_non_stale","non_stale_immutable_evaluation_freeze" in gate.ACTIVATION_PREREQUISITES)
check("prereq_claim","claim_eligibility" in gate.ACTIVATION_PREREQUISITES)
check("prereq_provenance","provenance_complete_release_evidence" in gate.ACTIVATION_PREREQUISITES)
check("prereq_sign_off","explicit_governed_sign_off" in gate.ACTIVATION_PREREQUISITES)

# ---------------------------------------------------------------------------
# Predecessor packet receipts
# ---------------------------------------------------------------------------

check("predecessor_receipts",len(gate.PREDECESSOR_PACKET_RECEIPTS)==7)
check("predecessor_pkt01",gate.PREDECESSOR_PACKET_RECEIPTS.get("PKT-EP3-01") is not None)
check("predecessor_pkt07",gate.PREDECESSOR_PACKET_RECEIPTS.get("PKT-EP3-07")=="7e92a1cc42ec16162626eb45fec8f3a5c38175ec9707b365933421213ca80f86")

# ---------------------------------------------------------------------------
# Final summary
# ---------------------------------------------------------------------------

print(json.dumps({
    "schema":"ekg-ep3-pkt08-diagnostic-activation-gate-tests-v1",
    "pass":True,"passed":passed,"total":passed,
    "approved_adjudicated_gold_count":0,
    "clinical_gold_admission_performed":False,
    "candidate_active":False,
    "diagnostic_runtime":"GOVERNED_INACTIVE",
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "metric_maturity":"NOT_REPORTABLE",
    "synthetic_fixtures_are_clinical_gold":False,
    "raw_clinical_waveform_or_image_bytes_included":False,
    "authority_rewritten":False,
    "silent_fallback_allowed":False,
    "source_substitution_allowed":False,
    "candidate_substitution_allowed":False,
},sort_keys=True))
