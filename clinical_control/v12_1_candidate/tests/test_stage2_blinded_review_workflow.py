from __future__ import annotations

import copy
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
GEN = ROOT / "validation_generated"
sys.path.insert(0, str(GEN))

import blinded_review_workflow as review
import evaluation_engine as evaluation
import signal_qc_exposure as signal
import source_evidence_bridge as bridge
import system_status_adapter as status

passed = 0

def check(name, value):
    global passed
    assert value, name
    passed += 1
    print("PASS", name)

def expect(name, code, fn):
    global passed
    try:
        fn()
    except (ValueError, RuntimeError) as exc:
        assert code in str(exc), (name, exc)
    else:
        raise AssertionError(name)
    passed += 1
    print("PASS", name)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

def rehash_exposure(value):
    x = copy.deepcopy(value)
    body = copy.deepcopy(x)
    body.pop("exposure_id", None)
    body.pop("exposure_sha256", None)
    sha = hashlib.sha256(canonical(body)).hexdigest()
    x["exposure_sha256"] = sha
    x["exposure_id"] = "sqc_" + sha[:24]
    return x

def rehash_package(value):
    x = copy.deepcopy(value)
    body = copy.deepcopy(x)
    body.pop("review_package_id", None)
    body.pop("review_package_sha256", None)
    sha = hashlib.sha256(canonical(body)).hexdigest()
    x["review_package_sha256"] = sha
    x["review_package_id"] = "rpkg_" + sha[:24]
    return x

def rehash_submission(value):
    x = copy.deepcopy(value)
    body = copy.deepcopy(x)
    body.pop("submission_id", None)
    body.pop("submission_sha256", None)
    sha = hashlib.sha256(canonical(body)).hexdigest()
    x["submission_sha256"] = sha
    x["submission_id"] = "rsub_" + sha[:24]
    return x

def sref(ref_id, kind, char):
    return status.evidence_ref(ref_id, kind, char * 64)

def status_snapshot():
    substrate = status.current_substrate_state()
    return status.build_status({
        "repository_binding": copy.deepcopy(status.accepted_authority()),
        "source": {
            "source_id": "synthetic-source", "source_sha256": "a" * 64,
            "state": "AVAILABLE", "raw_source_available": True,
            "raw_source_in_git": False, "source_verified": True,
            "evidence_refs": [sref("source", "SOURCE_VERIFICATION", "1")],
        },
        "inspection": {
            "state": "AVAILABLE", "verified": True, "limitations": [],
            "evidence_refs": [sref("inspection", "SOURCE_INSPECTION", "2")],
        },
        "waveform_qc": {
            "state": "AVAILABLE", "verified": True, "limitations": [],
            "evidence_refs": [sref("qc", "WAVEFORM_QC", "3")],
        },
        "candidate_control": {
            **{k: substrate[k] for k in (
                "candidate_active", "clinical_accuracy_claimed",
                "automatic_selection_allowed", "runtime_status",
                "native_dataset_annotations_are_project_gold",
                "synthetic_fixtures_are_clinical_gold",
            )},
            "evidence_refs": [sref("candidate", "CANDIDATE_CONTROL", "4")],
        },
        "evaluation": {
            **{k: substrate[k] for k in (
                "approved_adjudicated_gold_count",
                "diagnostic_performance_reporting_allowed",
                "clinical_accuracy_promotion_allowed",
            )},
            "evidence_refs": [sref("evaluation", "EVALUATION", "5")],
        },
    })

def packet2():
    extra = bridge.bridge_ref(
        "lineage", "SOURCE_LINEAGE", "6" * 64, "Cardiology-NP-Evidence",
        state="AVAILABLE", limitations=[],
    )
    return bridge.build_bridge(status_snapshot=status_snapshot(), evidence_refs=[extra])
def exposure():
    return signal.build_exposure(
        bridge_envelope=packet2(),
        source_artifact_sha256="1" * 64,
        inspection={
            "evidence_ref_id":"inspection","artifact_sha256":"2"*64,
            "state":"AVAILABLE","verified":True,
            "lead_names":["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"],
            "lead_count":12,"sample_rate_hz":100,"sample_count":1000,
            "duration_seconds":10,"source_identity_state":"VERIFIED","limitations":[],
        },
        waveform_qc={
            "evidence_ref_id":"qc","artifact_sha256":"3"*64,
            "state":"AVAILABLE","verified":True,"engineering_usable":True,
            "flags":[],"limitations":[],
        },
        preview={
            "preview_id":"preview-001","summary_artifact_sha256":"7"*64,
            "point_count":256,"lead_count":12,"bounded":True,
            "diagnostic_interpretation_included":False,"limitations":[],
        },
        transformation={
            "kind":"ORIGINAL","source_artifact_sha256":"1"*64,
            "derived_artifact_sha256":"1"*64,"authority_state":"PRESERVED","limitations":[],
        },
        calibration={
            "state":"TRUSTED","evidence_ref_id":"inspection","artifact_sha256":"2"*64,
            "measurement_eligible":True,"paper_speed_mm_s":25,"gain_mm_mv":10,"limitations":[],
        },
        untrusted_metadata=[
            {"channel":"MACHINE_INTERPRETATION","artifact_sha256":"8"*64,"present":True},
            {"channel":"NATIVE_DATASET_ANNOTATION","artifact_sha256":"9"*64,"present":True},
        ],
    )

def eligible(complete=True):
    return review.eligibility_descriptor(
        usage_status="APPROVED",
        privacy_review_status="CLEARED_NON_SENSITIVE",
        rights_status="APPROVED_FOR_EVALUATION",
        source_identity_state="VERIFIED",
        review_complete=complete,
    )

def reviewer(actor, principal, session):
    return review.reviewer_identity(
        actor_id=actor, principal_sha256=principal * 64, session_id=session
    )

check("baseline_commit", review.BASELINE_COMMIT == "60e216234eb80b293e335fe97a42547cc360cd9c")
check("baseline_tree", review.BASELINE_TREE == "af6b4f0df8035c3d90d75990cabfc87337bc5a12")
check("stage1_receipt", review.STAGE1_RECEIPT_SHA256 == "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")
check("prior_packet_receipt", review.PRIOR_PACKET_RECEIPT_SHA256 == "f11c2b232b6f76d3be62b95ac44eb379becd41244bb8e67f8e0dfe18881232e1")
check("review_labels_include_abstain", "ABSTAIN" in review.REVIEW_LABELS)
check("evaluation_zero_gold", evaluation.performance_gate([])["approved_adjudicated_gold_count"] == 0)
check("evaluation_reporting_blocked", evaluation.performance_gate([])["diagnostic_performance_reporting_allowed"] is False)

elig = eligible()
check("eligibility_valid", review.validate_eligibility(elig) is True)
check("eligibility_source_ready", elig["source_eligible"] is True)
check("eligibility_handoff_ready", elig["adjudication_handoff_allowed"] is True)
check("eligibility_gold_blocked", elig["clinical_gold_admission_allowed"] is False)
check("eligibility_hash", len(elig["eligibility_sha256"]) == 64)
unknown_rights = review.eligibility_descriptor(
    usage_status="APPROVED", privacy_review_status="CLEARED_NON_SENSITIVE",
    rights_status="UNKNOWN", source_identity_state="VERIFIED", review_complete=True
)
check("unknown_rights_source_blocked", unknown_rights["source_eligible"] is False)
check("unknown_rights_handoff_blocked", unknown_rights["adjudication_handoff_allowed"] is False)
forged_elig = copy.deepcopy(unknown_rights)
forged_elig["source_eligible"] = True
check("forged_eligibility_invalid", review.validate_eligibility(forged_elig) is False)
expect("bad_usage_status", "USAGE_STATUS", lambda: review.eligibility_descriptor(
    usage_status="MAYBE", privacy_review_status="CLEARED_NON_SENSITIVE",
    rights_status="APPROVED_FOR_EVALUATION", source_identity_state="VERIFIED", review_complete=True
))
exp = exposure()
pkg = review.create_review_package(
    case_key="case-001", signal_qc_exposure=exp, eligibility=elig
)
check("package_schema", pkg["schema"] == "ekg-blinded-review-package-v1")
check("package_id", pkg["review_package_id"] == "rpkg_" + pkg["review_package_sha256"][:24])
check("package_valid", review.validate_review_package(pkg) is True)
check("package_deterministic", pkg == review.create_review_package(case_key="case-001", signal_qc_exposure=exp, eligibility=elig))
check("package_source_bound", pkg["source_artifact_sha256"] == exp["source_artifact_sha256"])
check("package_exposure_bound", pkg["signal_qc_exposure_sha256"] == exp["exposure_sha256"])
check("package_navigation_readonly", pkg["source_navigation"]["read_only"] is True)
check("package_navigation_no_payload", pkg["source_navigation"]["raw_payload_included"] is False)
check("package_blinded", pkg["blinding_state"] == "BLINDED_VERIFIED")
check("package_ready", pkg["package_state"] == "READY" and pkg["review_allowed"] is True)
check("package_no_diagnostic_hint", pkg["diagnostic_hint_included"] is False)
check("package_no_machine_interpretation", pkg["machine_interpretation_included"] is False)
check("package_no_native_labels", pkg["native_dataset_labels_included"] is False)
check("package_no_prior_labels", pkg["prior_reviewer_labels_included"] is False)
check("package_no_predictions", pkg["predictions_included"] is False)
check("package_no_raw_payload", pkg["raw_clinical_payload_included"] is False)
check("package_no_authority", pkg["authority_effect"] == "NONE")
check("package_repository_baseline", pkg["repository_binding"]["baseline_commit"] == review.BASELINE_COMMIT)
check("package_stage1_bound", pkg["stage1_receipt_sha256"] == review.STAGE1_RECEIPT_SHA256)
check("package_prior_bound", pkg["prior_packet_receipt_sha256"] == review.PRIOR_PACKET_RECEIPT_SHA256)
check("package_untrusted_channels_excluded", "MACHINE_INTERPRETATION" in pkg["excluded_channels"] and "NATIVE_DATASET_ANNOTATION" in pkg["excluded_channels"])
check("package_no_untrusted_metadata_copy", "untrusted_metadata" not in pkg)

contaminated = review.create_review_package(
    case_key="case-002", signal_qc_exposure=exp, eligibility=elig,
    contamination_flags=["MACHINE_INTERPRETATION_VISIBLE"],
)
check("contamination_explicit", contaminated["blinding_state"] == "CONTAMINATED")
check("contamination_blocks_package", contaminated["package_state"] == "BLOCKED" and contaminated["review_allowed"] is False)
check("contaminated_package_valid_record", review.validate_review_package(contaminated) is True)
expect("unknown_contamination_flag", "CONTAMINATION_FLAG_UNKNOWN", lambda: review.create_review_package(
    case_key="case-003", signal_qc_exposure=exp, eligibility=elig, contamination_flags=["MAGIC"]
))
blocked_rights_pkg = review.create_review_package(
    case_key="case-004", signal_qc_exposure=exp, eligibility=unknown_rights
)
check("ineligible_package_blocked", blocked_rights_pkg["package_state"] == "BLOCKED")
check("ineligible_package_not_reviewable", blocked_rights_pkg["review_allowed"] is False)

stale_exp = copy.deepcopy(exp)
stale_exp["binding"]["baseline_commit"] = "0" * 40
stale_exp = rehash_exposure(stale_exp)
expect("stale_packet3_exposure_rejected", "PACKET3_SIGNAL_QC_AUTHORITY_MISMATCH", lambda: review.create_review_package(
    case_key="case-stale", signal_qc_exposure=stale_exp, eligibility=elig
))
raw_exp = copy.deepcopy(exp)
raw_exp["raw_payload"] = "synthetic"
raw_exp = rehash_exposure(raw_exp)
expect("raw_payload_exposure_rejected", "RAW_CLINICAL_PAYLOAD_FORBIDDEN", lambda: review.create_review_package(
    case_key="case-raw", signal_qc_exposure=raw_exp, eligibility=elig
))
tampered_pkg = rehash_package(pkg)
tampered_pkg["predictions_included"] = True
tampered_pkg = rehash_package(tampered_pkg)
check("rehashed_prediction_tamper_invalid", review.validate_review_package(tampered_pkg) is False)
extra_pkg = copy.deepcopy(pkg)
extra_pkg["benign_extra"] = "x"
extra_pkg = rehash_package(extra_pkg)
check("rehashed_extra_package_field_invalid", review.validate_review_package(extra_pkg) is False)
forged_pkg_elig = copy.deepcopy(pkg)
forged_pkg_elig["eligibility"]["source_eligible"] = False
forged_pkg_elig = rehash_package(forged_pkg_elig)
check("rehashed_eligibility_tamper_invalid", review.validate_review_package(forged_pkg_elig) is False)
r1 = reviewer("reviewer-a", "a", "session-a")
r2 = reviewer("reviewer-b", "b", "session-b")
check("reviewer1_schema", r1["schema"] == "ekg-blinded-reviewer-identity-v1")
check("reviewer1_hash", len(r1["reviewer_identity_sha256"]) == 64)
check("reviewer_no_credentials", r1["credentials_embedded"] is False)
check("reviewer_no_direct_ids", r1["direct_identifiers_embedded"] is False)
check("reviewer_independence", review.validate_reviewer_independence([r1, r2]) is True)
expect("duplicate_actor_rejected", "REVIEWER_ACTOR_NOT_INDEPENDENT", lambda: review.validate_reviewer_independence([r1, reviewer("reviewer-a", "c", "session-c")]))
expect("duplicate_principal_rejected", "REVIEWER_PRINCIPAL_NOT_INDEPENDENT", lambda: review.validate_reviewer_independence([r1, reviewer("reviewer-c", "a", "session-c")]))
expect("duplicate_session_rejected", "REVIEWER_SESSION_NOT_INDEPENDENT", lambda: review.validate_reviewer_independence([r1, reviewer("reviewer-c", "c", "session-a")]))
expect("bad_reviewer_actor", "REVIEWER_ACTOR_ID", lambda: review.reviewer_identity(actor_id="Reviewer A", principal_sha256="a"*64, session_id="session-a"))
expect("bad_reviewer_hash", "REVIEWER_PRINCIPAL_SHA256", lambda: review.reviewer_identity(actor_id="reviewer-c", principal_sha256="short", session_id="session-c"))

a1 = review.create_assignment(review_package=pkg, reviewer=r1, assignment_key="assignment-a")
a2 = review.create_assignment(review_package=pkg, reviewer=r2, assignment_key="assignment-b")
check("assignment1_valid", review.validate_assignment(a1) is True)
check("assignment2_valid", review.validate_assignment(a2) is True)
check("assignment_initial_state", a1["state"] == "ASSIGNED")
check("assignment_root_version", a1["assignment_version"] == 1 and a1["predecessor_assignment_sha256"] is None)
check("assignment_append_only", a1["append_only"] is True)
check("assignment_no_reassignment", a1["silent_reassignment_allowed"] is False)
check("assignment_labels_hidden", a1["reviewer_labels_visible_before_submission"] is False)
check("assignment_non_gold", a1["clinical_gold"] is False)
expect("blocked_package_not_assignable", "REVIEW_PACKAGE_NOT_ASSIGNABLE", lambda: review.create_assignment(
    review_package=contaminated, reviewer=r1, assignment_key="assignment-c"
))

a1_open = review.transition_assignment(a1, "OPENED")
a2_open = review.transition_assignment(a2, "OPENED")
check("assignment_open_version", a1_open["assignment_version"] == 2)
check("assignment_open_predecessor", a1_open["predecessor_assignment_sha256"] == a1["assignment_sha256"])
check("assignment_open_valid", review.validate_assignment(a1_open) is True)
a1_sub = review.transition_assignment(a1_open, "SUBMITTED")
a2_sub = review.transition_assignment(a2_open, "SUBMITTED")
check("assignment_submitted", a1_sub["state"] == "SUBMITTED" and a2_sub["state"] == "SUBMITTED")
check("assignment_submitted_valid", review.validate_assignment(a1_sub) is True)
expect("terminal_reopen_rejected", "ASSIGNMENT_TRANSITION_FORBIDDEN", lambda: review.transition_assignment(a1_sub, "OPENED"))
expect("skip_assigned_to_submitted", "ASSIGNMENT_TRANSITION_FORBIDDEN", lambda: review.transition_assignment(a1, "SUBMITTED"))
expect("unknown_assignment_state", "ASSIGNMENT_STATE", lambda: review.transition_assignment(a1, "MAGIC"))
tampered_assignment = copy.deepcopy(a1_sub)
tampered_assignment["clinical_gold"] = True
check("tampered_assignment_invalid", review.validate_assignment(tampered_assignment) is False)
extra_assignment = copy.deepcopy(a1_sub)
extra_assignment["extra"] = "x"
body = copy.deepcopy(extra_assignment)
body.pop("assignment_id"); body.pop("assignment_sha256")
h = hashlib.sha256(canonical(body)).hexdigest()
extra_assignment["assignment_sha256"] = h
extra_assignment["assignment_id"] = "rasg_" + h[:24]
check("rehashed_extra_assignment_invalid", review.validate_assignment(extra_assignment) is False)
pattern_id = evaluation.registry()["patterns"][0]["id"]
check("pattern_id_resolved", isinstance(pattern_id, str) and bool(pattern_id))
sub1 = review.create_reviewer_submission(
    assignment=a1_sub,
    pattern_labels={pattern_id:"POSITIVE"},
    measurement_annotations=[{
        "metric":"qrs_duration","value":96.0,"unit":"ms",
        "source_ref":"inspection","method":"manual-bounded-review"
    }],
)
sub2 = review.create_reviewer_submission(
    assignment=a2_sub, pattern_labels={pattern_id:"POSITIVE"}, measurement_annotations=[]
)
check("submission1_valid", review.validate_submission(sub1) is True)
check("submission2_valid", review.validate_submission(sub2) is True)
check("submission_unadjudicated", sub1["submitted_state"] == "UNADJUDICATED")
check("submission_non_gold", sub1["clinical_gold"] is False and sub1["approved_adjudicated_gold"] is False)
check("submission_not_truth", sub1["diagnostic_truth"] is False)
check("submission_no_authority", sub1["authority_effect"] == "NONE")
check("submission_blinded", sub1["reviewer_blinded"] is True)
check("submission_registry_exact", sub1["registry_binding"] == evaluation.registry_binding())
check("measurement_separate", "pattern_labels" not in sub1["measurement_annotations"][0])
check("measurement_provenance", sub1["measurement_annotations"][0]["source_ref"] == "inspection")
expect("submission_requires_submitted_assignment", "ASSIGNMENT_NOT_SUBMITTED", lambda: review.create_reviewer_submission(
    assignment=a1_open, pattern_labels={pattern_id:"POSITIVE"}
))
expect("unknown_pattern_rejected", "REVIEW_PATTERN_UNKNOWN", lambda: review.create_reviewer_submission(
    assignment=a1_sub, pattern_labels={"made_up_pattern":"POSITIVE"}
))
expect("unsupported_label_rejected", "REVIEW_LABEL_STATE", lambda: review.create_reviewer_submission(
    assignment=a1_sub, pattern_labels={pattern_id:"MAGIC"}
))
sub_ind = review.create_reviewer_submission(assignment=a1_sub, pattern_labels={pattern_id:"INDETERMINATE"})
sub_abs = review.create_reviewer_submission(assignment=a2_sub, pattern_labels={pattern_id:"ABSTAIN"})
check("indeterminate_allowed_non_gold", sub_ind["pattern_labels"][pattern_id] == "INDETERMINATE" and sub_ind["clinical_gold"] is False)
check("abstain_allowed_non_gold", sub_abs["pattern_labels"][pattern_id] == "ABSTAIN" and sub_abs["clinical_gold"] is False)
expect("measurement_nonfinite_rejected", "MEASUREMENT_VALUE", lambda: review.create_reviewer_submission(
    assignment=a1_sub, pattern_labels={pattern_id:"POSITIVE"},
    measurement_annotations=[{"metric":"qrs","value":float("nan"),"unit":"ms","source_ref":"inspection","method":"manual"}]
))
expect("measurement_raw_field_rejected", "RAW_CLINICAL_PAYLOAD_FORBIDDEN", lambda: review.create_reviewer_submission(
    assignment=a1_sub, pattern_labels={pattern_id:"POSITIVE"},
    measurement_annotations=[{"metric":"qrs","value":96,"unit":"ms","source_ref":"inspection","method":"manual","waveform_bytes":"x"}]
))
tampered_sub = rehash_submission(sub1)
tampered_sub["clinical_gold"] = True
tampered_sub = rehash_submission(tampered_sub)
check("rehashed_gold_submission_invalid", review.validate_submission(tampered_sub) is False)
extra_sub = copy.deepcopy(sub1)
extra_sub["extra"] = "x"
extra_sub = rehash_submission(extra_sub)
check("rehashed_extra_submission_invalid", review.validate_submission(extra_sub) is False)

comparison = review.compare_submissions([sub1, sub2])
check("comparison_concordant", comparison["state"] == "CONCORDANT")
check("comparison_row_concordant", comparison["rows"][0]["state"] == "CONCORDANT")
check("comparison_no_final_label", comparison["final_label_selected"] is False)
check("comparison_no_gold", comparison["clinical_gold_created"] is False)
check("comparison_no_auto_resolution", comparison["automatic_resolution"] is False)
sub2_disagree = review.create_reviewer_submission(
    assignment=a2_sub, pattern_labels={pattern_id:"NEGATIVE"}
)
disagree = review.compare_submissions([sub1, sub2_disagree])
check("comparison_disagreeing", disagree["state"] == "DISAGREEING")
check("disagreement_explicit", disagree["rows"][0]["state"] == "DISAGREEING")
check("disagreement_no_resolution", disagree["automatic_resolution"] is False)
expect("same_reviewer_not_independent", "REVIEWER_ACTOR_NOT_INDEPENDENT", lambda: review.compare_submissions([sub1, sub1]))
handoff = review.create_adjudication_handoff(
    review_package=pkg, assignments=[a1_sub, a2_sub], submissions=[sub1, sub2]
)
check("handoff_schema", handoff["schema"] == "ekg-blinded-review-adjudication-handoff-v1")
check("handoff_ready", handoff["handoff_state"] == "READY_FOR_SEPARATE_ADJUDICATION")
check("handoff_requires_rationale", handoff["rationale_required_for_final_adjudication"] is True)
check("handoff_not_final", handoff["final_adjudication_performed"] is False)
check("handoff_no_final_labels", handoff["final_pattern_labels"] is None)
check("handoff_no_gold", handoff["clinical_gold_admitted"] is False)
check("handoff_zero_gold", handoff["approved_adjudicated_gold_count"] == 0)
check("handoff_no_activation", handoff["diagnostic_runtime_activation_allowed"] is False)
check("handoff_reporting_blocked", handoff["diagnostic_performance_reporting_allowed"] is False)
check("handoff_no_accuracy", handoff["clinical_accuracy_claimed"] is False)
check("handoff_candidate_inactive", handoff["candidate_active"] is False)
check("handoff_no_authority", handoff["authority_effect"] == "NONE")
check("handoff_comparison_concordant", handoff["comparison"]["state"] == "CONCORDANT")
check("handoff_refs_two_assignments", len(handoff["assignment_refs"]) == 2)
check("handoff_refs_two_submissions", len(handoff["submission_refs"]) == 2)

incomplete_pkg = review.create_review_package(
    case_key="case-incomplete", signal_qc_exposure=exp, eligibility=eligible(False)
)
check("incomplete_source_reviewable", incomplete_pkg["review_allowed"] is True)
expect("incomplete_blocks_handoff", "ADJUDICATION_HANDOFF_REVIEW_INCOMPLETE", lambda: review.create_adjudication_handoff(
    review_package=incomplete_pkg, assignments=[a1_sub,a2_sub], submissions=[sub1,sub2]
))
expect("contamination_blocks_handoff", "ADJUDICATION_HANDOFF_BLINDING_BLOCKED", lambda: review.create_adjudication_handoff(
    review_package=contaminated, assignments=[a1_sub,a2_sub], submissions=[sub1,sub2]
))
expect("assignments_must_be_submitted", "ASSIGNMENTS_NOT_TERMINAL_SUBMITTED", lambda: review.create_adjudication_handoff(
    review_package=pkg, assignments=[a1_open,a2_sub], submissions=[sub1,sub2]
))
mismatched_sub = copy.deepcopy(sub2)
mismatched_sub["assignment_sha256"] = "c" * 64
mismatched_sub = rehash_submission(mismatched_sub)
check("mismatched_submission_still_structurally_valid", review.validate_submission(mismatched_sub) is True)
expect("submission_assignment_binding", "SUBMISSION_ASSIGNMENT_MISMATCH", lambda: review.create_adjudication_handoff(
    review_package=pkg, assignments=[a1_sub,a2_sub], submissions=[sub1,mismatched_sub]
))

fixture = json.loads((GEN / "EP3_PKT04_BLINDED_REVIEW_FIXTURES.json").read_text(encoding="utf-8"))
check("fixture_non_phi", fixture["phi"] is False)
check("fixture_no_raw", fixture["raw_clinical_waveform_or_image_bytes_included"] is False)
check("fixture_candidate_inactive", fixture["candidate_active"] is False)
check("fixture_zero_gold", fixture["approved_adjudicated_gold_count"] == 0)
check("fixture_activation_blocked", fixture["diagnostic_runtime_activation_allowed"] is False)
check("fixture_reporting_blocked", fixture["diagnostic_performance_reporting_allowed"] is False)
check("fixture_no_accuracy", fixture["clinical_accuracy_claimed"] is False)
check("fixture_submissions_not_gold", fixture["reviewer_submissions_are_clinical_gold"] is False)
check("fixture_no_final_adjudication", fixture["final_adjudication_performed"] is False)
check("fixture_no_gold_admission", fixture["clinical_gold_admission_performed"] is False)
check("fixture_native_not_gold", fixture["native_dataset_annotations_are_project_gold"] is False)
check("fixture_synthetic_not_gold", fixture["synthetic_fixtures_are_clinical_gold"] is False)
check("fixture_scenarios", len(fixture["scenarios"]) == 8)
check("fixture_has_disagreement", any(x["id"] == "disagreeing" for x in fixture["scenarios"]))
check("fixture_has_contamination", any(x["id"] == "contaminated" for x in fixture["scenarios"]))

release = review.release_contract()
check("release_packet", release["packet"] == "PKT-EP3-04")
check("release_baseline", release["baseline_commit"] == review.BASELINE_COMMIT and release["baseline_tree"] == review.BASELINE_TREE)
check("release_stage1", release["stage1_receipt_sha256"] == review.STAGE1_RECEIPT_SHA256)
check("release_prior", release["accepted_prior_packet_receipt_sha256"] == review.PRIOR_PACKET_RECEIPT_SHA256)
check("release_unadjudicated", release["reviewer_submissions_are_unadjudicated"] is True)
check("release_submissions_not_gold", release["reviewer_submissions_are_clinical_gold"] is False)
check("release_no_final_adjudication", release["final_adjudication_performed"] is False)
check("release_no_gold_admission", release["clinical_gold_admission_performed"] is False)
check("release_candidate_inactive", release["candidate_active"] is False)
check("release_zero_gold", release["approved_adjudicated_gold_count"] == 0)
check("release_activation_blocked", release["diagnostic_runtime_activation_allowed"] is False)
check("release_reporting_blocked", release["diagnostic_performance_reporting_allowed"] is False)
check("release_no_accuracy", release["clinical_accuracy_claimed"] is False)
check("release_native_not_gold", release["native_dataset_annotations_are_project_gold"] is False)
check("release_synthetic_not_gold", release["synthetic_fixtures_are_clinical_gold"] is False)
check("release_no_raw", release["raw_clinical_waveform_or_image_bytes_included"] is False)
check("release_no_authority_rewrite", release["authority_rewritten"] is False)
check("release_no_fallback", release["silent_fallback_allowed"] is False)
check("release_proof_required", release["independent_machine_verification_required"] is True and release["github_ci_required"] is True)

print(json.dumps({
    "schema":"ekg-ep3-pkt04-blinded-review-tests-v1",
    "pass":True,"passed":passed,"total":passed,
    "candidate_active":False,"approved_adjudicated_gold_count":0,
    "diagnostic_runtime_activation_allowed":False,
    "diagnostic_performance_reporting_allowed":False,
    "clinical_accuracy_claimed":False,
    "reviewer_submissions_are_clinical_gold":False,
    "final_adjudication_performed":False,
}, sort_keys=True))
