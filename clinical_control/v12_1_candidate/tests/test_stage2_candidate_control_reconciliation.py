from __future__ import annotations

import copy
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
GEN = ROOT / "validation_generated"
sys.path.insert(0, str(GEN))

import candidate_control_reconciliation as control
import evaluation_engine as evaluation
import pattern_candidate_engine as candidate_engine

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
    except (ValueError, RuntimeError, TypeError) as exc:
        assert code in str(exc), (name, exc)
    else:
        raise AssertionError(name)
    passed += 1
    print("PASS", name)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

def rehash_reconciliation(value):
    x = copy.deepcopy(value)
    body = copy.deepcopy(x)
    body.pop("reconciliation_id", None)
    body.pop("reconciliation_sha256", None)
    sha = hashlib.sha256(canonical(body)).hexdigest()
    x["reconciliation_sha256"] = sha
    x["reconciliation_id"] = "ccr_" + sha[:24]
    return x

def source(**changes):
    args = {
        "source_artifact_sha256": "1" * 64,
        "signal_qc_exposure_sha256": "2" * 64,
        "source_state": "AVAILABLE",
        "engineering_state": "USABLE",
        "calibration_state": "TRUSTED",
        "usage_status": "APPROVED",
        "privacy_status": "CLEARED_NON_SENSITIVE",
        "evidence_eligibility": "ELIGIBLE",
        "limitations": [],
    }
    args.update(changes)
    return control.source_evidence_descriptor(**args)

def review(**changes):
    args = {
        "review_package_id": "rpkg_case001",
        "review_package_sha256": "3" * 64,
        "submission_refs": [
            {"submission_id": "rsub_a", "submission_sha256": "4" * 64},
            {"submission_id": "rsub_b", "submission_sha256": "5" * 64},
        ],
        "adjudication_handoff_ref": {"handoff_id": "rah_case001", "handoff_sha256": "6" * 64},
        "review_state": "CLEAN",
        "comparison_state": "CONCORDANT",
    }
    args.update(changes)
    return control.review_evidence_descriptor(**args)

def reconcile(**changes):
    args = {
        "candidate_key": "candidate-001",
        "lifecycle_state": "EVALUATION_ONLY",
        "configuration": control.candidate_configuration(),
        "source_evidence": source(),
        "review_evidence": review(),
        "candidate_outputs": [
            candidate_engine.evaluate_pattern("left_axis", [], {}),
            candidate_engine.evaluate_pattern("sinus_rhythm", [], {}),
        ],
        "untrusted_metadata": [
            {"channel": "MACHINE_INTERPRETATION", "artifact_sha256": "7" * 64, "present": True},
            {"channel": "NATIVE_DATASET_ANNOTATION", "artifact_sha256": "8" * 64, "present": True},
        ],
        "limitations": [],
        "staleness_reasons": [],
    }
    args.update(changes)
    return control.reconcile_candidate_control(**args)

check("schema", control.SCHEMA == "ekg-ep3-pkt05-candidate-control-v1")
check("baseline_commit", control.BASELINE_COMMIT == "439ce89beb485bc4fd458885bfe970d580efecd2")
check("baseline_tree", control.BASELINE_TREE == "bbc2ebdda63e49e555b09f532f8c2262d0178ecd")
check("stage1_receipt", control.STAGE1_RECEIPT_SHA256 == "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")
check("prior_receipt", control.PRIOR_PACKET_RECEIPT_SHA256 == "3030f7e0d9dacafcaf81d767df97969f4255fb4397b4963521ad14197baa5e66")
check("lifecycle_states", control.LIFECYCLE_STATES == {"GOVERNED_INACTIVE","EVALUATION_ONLY","BLOCKED","STALE","UNKNOWN"})
check("untrusted_channels", {"NATIVE_DATASET_ANNOTATION","OCR_TEXT","EMBEDDED_LABEL","MACHINE_INTERPRETATION","PRIOR_REVIEWER_LABEL","SYNTHETIC_FIXTURE"} <= control.UNTRUSTED_CHANNELS)

cfg = control.candidate_configuration()
check("config_schema", cfg["schema"] == "ekg-v12-1-candidate-configuration-v1")
check("config_repo", cfg["repository"] == "Cardiology-NP-OS/EKG-Interpretations")
check("config_commit", cfg["packet4_commit"] == control.BASELINE_COMMIT)
check("config_tree", cfg["packet4_tree"] == control.BASELINE_TREE)
check("config_stage1", cfg["stage1_receipt_sha256"] == control.STAGE1_RECEIPT_SHA256)
check("config_packet4_receipt", cfg["packet4_receipt_sha256"] == control.PRIOR_PACKET_RECEIPT_SHA256)
check("config_registry_version", cfg["pattern_registry"]["version"] == "5.0")
check("config_registry_hash", cfg["pattern_registry"]["sha256"] == evaluation.REGISTRY_SHA256)
check("config_registry_count", len(evaluation.registry()["patterns"]) == 59)
check("config_rules_hash", cfg["rules_sha256"] == control.RULES_SHA256)
check("config_default_fail_closed", cfg["default_behavior"] == "NOT_EXECUTABLE")
check("config_candidate_inactive", cfg["candidate_active"] is False)
check("config_auto_selection_blocked", cfg["automatic_selection_allowed"] is False)
check("config_no_accuracy", cfg["clinical_accuracy_claimed"] is False)
check("config_hash", len(cfg["configuration_sha256"]) == 64)
check("config_deterministic", cfg == control.candidate_configuration())

src = source()
check("source_schema", src["schema"] == "ekg-ep3-pkt05-source-evidence-state-v1")
check("source_hash", len(src["source_evidence_sha256"]) == 64)
check("source_artifact_bound", src["source_artifact_sha256"] == "1"*64)
check("signal_qc_bound", src["signal_qc_exposure_sha256"] == "2"*64)
check("source_available", src["source_state"] == "AVAILABLE")
check("engineering_usable", src["engineering_state"] == "USABLE")
check("calibration_trusted", src["calibration_state"] == "TRUSTED")
check("usage_approved", src["usage_status"] == "APPROVED")
check("privacy_cleared", src["privacy_status"] == "CLEARED_NON_SENSITIVE")
check("eligibility_explicit", src["evidence_eligibility"] == "ELIGIBLE")
check("source_eval_eligible", src["candidate_evaluation_eligible"] is True)
check("engineering_not_clinical", src["engineering_usability_is_clinical_validity"] is False)
check("clinical_validity_not_inferred", src["clinical_validity_inferred"] is False)
check("degraded_not_eligible", source(engineering_state="DEGRADED")["candidate_evaluation_eligible"] is False)
check("untrusted_calibration_not_eligible", source(calibration_state="UNTRUSTED")["candidate_evaluation_eligible"] is False)
check("unknown_calibration_not_eligible", source(calibration_state="UNKNOWN")["candidate_evaluation_eligible"] is False)
check("usage_rejected_not_eligible", source(usage_status="REJECTED")["candidate_evaluation_eligible"] is False)
check("privacy_blocked_not_eligible", source(privacy_status="BLOCKED")["candidate_evaluation_eligible"] is False)
check("evidence_ineligible_not_eligible", source(evidence_eligibility="INELIGIBLE")["candidate_evaluation_eligible"] is False)
check("source_conflict_not_eligible", source(source_state="CONFLICT")["candidate_evaluation_eligible"] is False)
expect("bad_source_state", "SOURCE_STATE", lambda: source(source_state="READY"))
expect("bad_engineering_state", "ENGINEERING_STATE", lambda: source(engineering_state="CLINICAL"))
expect("bad_calibration_state", "CALIBRATION_STATE", lambda: source(calibration_state="ASSUMED"))
expect("bad_usage", "USAGE_STATUS", lambda: source(usage_status="MAYBE"))
expect("bad_privacy", "PRIVACY_STATUS", lambda: source(privacy_status="MAYBE"))
expect("bad_eligibility", "EVIDENCE_ELIGIBILITY", lambda: source(evidence_eligibility="MAYBE"))

rev = review()
check("review_schema", rev["schema"] == "ekg-ep3-pkt05-review-evidence-ref-v1")
check("review_hash", len(rev["review_evidence_sha256"]) == 64)
check("review_package_bound", rev["review_package_sha256"] == "3"*64)
check("review_two_submissions", len(rev["submission_refs"]) == 2)
check("review_submissions_sorted", [x["submission_id"] for x in rev["submission_refs"]] == ["rsub_a","rsub_b"])
check("review_handoff_bound", rev["adjudication_handoff_ref"]["handoff_sha256"] == "6"*64)
check("review_clean", rev["review_state"] == "CLEAN")
check("review_concordant", rev["comparison_state"] == "CONCORDANT")
check("review_unadjudicated", rev["reviewer_submissions_unadjudicated"] is True)
check("review_non_gold", rev["reviewer_submissions_clinical_gold"] is False)
check("review_not_final", rev["final_adjudication_performed"] is False)
check("review_no_gold_admission", rev["clinical_gold_admitted"] is False)
check("review_zero_gold", rev["approved_adjudicated_gold_count"] == 0)
check("review_no_authority", rev["authority_effect"] == "NONE")
check("review_disagreement_preserved", review(comparison_state="DISAGREEING")["comparison_state"] == "DISAGREEING")
check("review_contamination_preserved", review(review_state="CONTAMINATED")["review_state"] == "CONTAMINATED")
check("review_unverifiable_preserved", review(review_state="UNVERIFIABLE")["review_state"] == "UNVERIFIABLE")
check("review_incomplete_preserved", review(review_state="INCOMPLETE")["review_state"] == "INCOMPLETE")
expect("single_submission_ref", "DUAL_REVIEW_SUBMISSION_REFS_REQUIRED", lambda: review(submission_refs=[{"submission_id":"rsub_a","submission_sha256":"4"*64}]))
expect("duplicate_submission_ref", "DUPLICATE_SUBMISSION_REF", lambda: review(submission_refs=[{"submission_id":"rsub_a","submission_sha256":"4"*64},{"submission_id":"rsub_a","submission_sha256":"5"*64}]))
expect("bad_review_state", "REVIEW_STATE", lambda: review(review_state="TRUSTED"))
expect("bad_comparison_state", "REVIEW_COMPARISON_STATE", lambda: review(comparison_state="MATCH"))

u = control.untrusted_metadata_descriptor("MACHINE_INTERPRETATION", "a"*64, True)
check("untrusted_authority", u["authority"] == "UNTRUSTED_INERT")
check("untrusted_no_clinical_authority", u["clinical_authority"] is False)
check("untrusted_not_gold", u["clinical_gold"] is False)
check("untrusted_cannot_activate", u["candidate_activation_allowed"] is False)
expect("unknown_untrusted_channel", "UNTRUSTED_CHANNEL", lambda: control.untrusted_metadata_descriptor("MODEL_TRUTH","a"*64,True))

x = reconcile()
check("reconciliation_schema", x["schema"] == control.SCHEMA)
check("reconciliation_id", x["reconciliation_id"] == "ccr_" + x["reconciliation_sha256"][:24])
check("reconciliation_hash", len(x["reconciliation_sha256"]) == 64)
check("reconciliation_version", x["reconciliation_version"] == 1)
check("root_predecessor", x["predecessor_reconciliation_sha256"] is None)
check("candidate_key", x["candidate_key"] == "candidate-001")
check("lifecycle_eval_only", x["lifecycle_state"] == "EVALUATION_ONLY")
check("eval_eligible", x["candidate_evaluation_eligible"] is True)
check("repository_exact", x["repository_binding"]["commit"] == control.BASELINE_COMMIT and x["repository_binding"]["tree"] == control.BASELINE_TREE)
check("stage1_exact", x["stage1_receipt_sha256"] == control.STAGE1_RECEIPT_SHA256)
check("prior_exact", x["prior_packet_receipt_sha256"] == control.PRIOR_PACKET_RECEIPT_SHA256)
check("candidate_inactive", x["candidate_active"] is False)
check("automatic_selection_blocked", x["automatic_selection_allowed"] is False)
check("runtime_inactive", x["diagnostic_runtime"] == "GOVERNED_INACTIVE")
check("runtime_activation_blocked", x["diagnostic_runtime_activation_allowed"] is False)
check("zero_gold", x["approved_adjudicated_gold_count"] == 0)
check("reporting_blocked", x["diagnostic_performance_reporting_allowed"] is False)
check("no_accuracy", x["clinical_accuracy_claimed"] is False)
check("review_submissions_not_gold", x["reviewer_submissions_are_clinical_gold"] is False)
check("no_final_adjudication", x["final_adjudication_performed"] is False)
check("no_gold_admission", x["clinical_gold_admission_performed"] is False)
check("no_raw", x["raw_clinical_waveform_or_image_bytes_included"] is False)
check("no_authority_rewrite", x["authority_rewritten"] is False)
check("no_fallback", x["silent_fallback_allowed"] is False)
check("no_clinical_validity_inference", x["clinical_validity_inferred"] is False)
check("evaluation_gate_zero_gold", x["evaluation_gate"]["approved_adjudicated_gold_count"] == 0)
check("evaluation_gate_reporting_blocked", x["evaluation_gate"]["diagnostic_performance_reporting_allowed"] is False)
check("evaluation_gate_candidate_inactive", x["evaluation_gate"]["candidate_active"] is False)
check("candidate_outputs_two", len(x["candidate_outputs"]) == 2)
check("candidate_outputs_sorted", x["candidate_outputs"] == sorted(x["candidate_outputs"], key=lambda row:(row["pattern_id"],row["candidate_id"])))
check("candidate_outputs_inactive", all(row["candidate_active"] is False for row in x["candidate_outputs"]))
check("candidate_outputs_not_diagnosis", all(row["diagnosis"] is None for row in x["candidate_outputs"]))
check("candidate_outputs_no_auto_select", all(row["automatic_selection_allowed"] is False for row in x["candidate_outputs"]))
check("untrusted_inert_all", all(row["authority"] == "UNTRUSTED_INERT" for row in x["untrusted_metadata"]))
check("reconciliation_valid", control.validate_reconciliation(x) is True)
check("reconciliation_deterministic", x == reconcile())

for state in ["GOVERNED_INACTIVE","BLOCKED","STALE","UNKNOWN"]:
    reasons = ["stale-evidence"] if state == "STALE" else []
    item = reconcile(candidate_key="candidate-"+state.lower().replace("_","-"), lifecycle_state=state, staleness_reasons=reasons)
    check("state_"+state.lower(), item["lifecycle_state"] == state)
    check("state_not_eval_"+state.lower(), item["candidate_evaluation_eligible"] is False)
    check("state_valid_"+state.lower(), control.validate_reconciliation(item) is True)

check("degraded_source_blocks_eval", reconcile(candidate_key="candidate-degraded", source_evidence=source(engineering_state="DEGRADED"))["candidate_evaluation_eligible"] is False)
check("contaminated_review_blocks_eval", reconcile(candidate_key="candidate-contam", review_evidence=review(review_state="CONTAMINATED"))["candidate_evaluation_eligible"] is False)
check("staleness_reason_blocks_eval", reconcile(candidate_key="candidate-stale-reason", staleness_reasons=["registry-review-required"])["candidate_evaluation_eligible"] is False)
check("disagreement_remains_unadjudicated", reconcile(candidate_key="candidate-disagree", review_evidence=review(comparison_state="DISAGREEING"))["review_evidence"]["comparison_state"] == "DISAGREEING")

bad_candidate = candidate_engine.evaluate_pattern("left_axis", [], {})
bad_candidate["candidate_active"] = True
expect("active_candidate_rejected", "CANDIDATE_ACTIVE_FORBIDDEN", lambda: reconcile(candidate_key="candidate-active", candidate_outputs=[bad_candidate]))
bad_candidate = candidate_engine.evaluate_pattern("left_axis", [], {})
bad_candidate["diagnosis"] = "left axis deviation"
expect("diagnosis_candidate_rejected", "CANDIDATE_DIAGNOSIS_FORBIDDEN", lambda: reconcile(candidate_key="candidate-diagnosis", candidate_outputs=[bad_candidate]))
bad_candidate = candidate_engine.evaluate_pattern("left_axis", [], {})
bad_candidate["automatic_selection_allowed"] = True
expect("auto_selection_candidate_rejected", "CANDIDATE_AUTOMATIC_SELECTION_FORBIDDEN", lambda: reconcile(candidate_key="candidate-auto", candidate_outputs=[bad_candidate]))
bad_candidate = candidate_engine.evaluate_pattern("left_axis", [], {})
bad_candidate["extra_field"] = "x"
expect("extra_candidate_field_rejected", "CANDIDATE_RECORD_FIELD_FORBIDDEN", lambda: reconcile(candidate_key="candidate-extra", candidate_outputs=[bad_candidate]))
expect("empty_candidate_outputs", "CANDIDATE_OUTPUTS_REQUIRED", lambda: reconcile(candidate_key="candidate-empty", candidate_outputs=[]))
dup = candidate_engine.evaluate_pattern("left_axis", [], {})
expect("duplicate_candidate_id", "DUPLICATE_CANDIDATE_ID", lambda: reconcile(candidate_key="candidate-dup", candidate_outputs=[dup, copy.deepcopy(dup)]))
bad_cfg = copy.deepcopy(cfg); bad_cfg["rules_sha256"] = "0"*64
expect("stale_configuration_rejected", "CANDIDATE_CONFIGURATION_STALE_OR_CONFLICTING", lambda: reconcile(candidate_key="candidate-stale-config", configuration=bad_cfg))
bad_src = copy.deepcopy(src); bad_src["candidate_evaluation_eligible"] = False
expect("source_integrity_rejected", "SOURCE_EVIDENCE_INTEGRITY", lambda: reconcile(candidate_key="candidate-source-tamper", source_evidence=bad_src))
bad_rev = copy.deepcopy(rev); bad_rev["clinical_gold_admitted"] = True
bad_rev["review_evidence_sha256"] = hashlib.sha256(canonical({k:v for k,v in bad_rev.items() if k!="review_evidence_sha256"})).hexdigest()
expect("review_gold_tamper_rejected", "ADJUDICATION_OR_GOLD_FORBIDDEN", lambda: reconcile(candidate_key="candidate-review-tamper", review_evidence=bad_rev))
expect("unknown_lifecycle", "CANDIDATE_LIFECYCLE_STATE", lambda: reconcile(candidate_key="candidate-bad-state", lifecycle_state="ACTIVE"))
expect("root_predecessor_forbidden", "ROOT_PREDECESSOR_FORBIDDEN", lambda: reconcile(candidate_key="candidate-root-pre", predecessor_reconciliation_sha256="9"*64))
expect("bad_successor_version", "RECONCILIATION_VERSION", lambda: control.reconcile_candidate_control(
    candidate_key="candidate-version",lifecycle_state="STALE",configuration=cfg,source_evidence=src,review_evidence=rev,
    candidate_outputs=[candidate_engine.evaluate_pattern("left_axis",[],{})],predecessor_reconciliation_sha256="9"*64,reconciliation_version=0,staleness_reasons=["x"]
))

successor = control.create_successor(x, lifecycle_state="STALE", staleness_reasons=["registry-review-required"])
check("successor_version", successor["reconciliation_version"] == 2)
check("successor_predecessor", successor["predecessor_reconciliation_sha256"] == x["reconciliation_sha256"])
check("successor_same_key", successor["candidate_key"] == x["candidate_key"])
check("successor_state", successor["lifecycle_state"] == "STALE")
check("successor_not_eval", successor["candidate_evaluation_eligible"] is False)
check("successor_valid", control.validate_reconciliation(successor) is True)

nav = control.candidate_status_navigation(x)
check("nav_schema", nav["schema"] == "ekg-ep3-pkt05-candidate-status-navigation-v1")
check("nav_reconciliation_exact", nav["reconciliation_sha256"] == x["reconciliation_sha256"])
check("nav_candidate_key", nav["candidate_key"] == x["candidate_key"])
check("nav_lifecycle", nav["lifecycle_state"] == "EVALUATION_ONLY")
check("nav_readonly", nav["read_only"] is True)
check("nav_no_execution", nav["diagnostic_execution_allowed"] is False)
check("nav_no_auto_select", nav["automatic_selection_allowed"] is False)
check("nav_no_authority", nav["clinical_authority_transfer"] is False)
check("nav_no_accuracy", nav["clinical_accuracy_claimed"] is False)
check("nav_no_raw", nav["raw_payload_included"] is False)
check("nav_config_hash", nav["configuration_sha256"] == cfg["configuration_sha256"])
check("nav_source_hash", nav["source_evidence_sha256"] == src["source_evidence_sha256"])
check("nav_review_hash", nav["review_evidence_sha256"] == rev["review_evidence_sha256"])
check("nav_candidate_ids", set(nav["candidate_ids"]) == {row["candidate_id"] for row in x["candidate_outputs"]})

tampered = rehash_reconciliation(x); tampered["candidate_active"] = True; tampered = rehash_reconciliation(tampered)
check("rehash_active_invalid", control.validate_reconciliation(tampered) is False)
tampered = rehash_reconciliation(x); tampered["approved_adjudicated_gold_count"] = 1; tampered = rehash_reconciliation(tampered)
check("rehash_gold_invalid", control.validate_reconciliation(tampered) is False)
tampered = rehash_reconciliation(x); tampered["diagnostic_runtime"] = "ACTIVE"; tampered = rehash_reconciliation(tampered)
check("rehash_runtime_invalid", control.validate_reconciliation(tampered) is False)
tampered = rehash_reconciliation(x); tampered["diagnostic_performance_reporting_allowed"] = True; tampered = rehash_reconciliation(tampered)
check("rehash_reporting_invalid", control.validate_reconciliation(tampered) is False)
tampered = rehash_reconciliation(x); tampered["clinical_accuracy_claimed"] = True; tampered = rehash_reconciliation(tampered)
check("rehash_accuracy_invalid", control.validate_reconciliation(tampered) is False)
tampered = rehash_reconciliation(x); tampered["repository_binding"]["commit"] = "0"*40; tampered = rehash_reconciliation(tampered)
check("rehash_repo_invalid", control.validate_reconciliation(tampered) is False)
tampered = rehash_reconciliation(x); tampered["configuration"]["rules_sha256"] = "0"*64; tampered = rehash_reconciliation(tampered)
check("rehash_config_invalid", control.validate_reconciliation(tampered) is False)
tampered = rehash_reconciliation(x); tampered["extra"] = "x"; tampered = rehash_reconciliation(tampered)
check("rehash_extra_field_invalid", control.validate_reconciliation(tampered) is False)
tampered = rehash_reconciliation(x); tampered["untrusted_metadata"][0]["authority"] = "TRUSTED"; tampered = rehash_reconciliation(tampered)
check("rehash_untrusted_authority_invalid", control.validate_reconciliation(tampered) is False)
tampered = rehash_reconciliation(x); tampered["review_evidence"]["reviewer_submissions_clinical_gold"] = True; tampered = rehash_reconciliation(tampered)
check("rehash_review_gold_invalid", control.validate_reconciliation(tampered) is False)

fixture = json.loads((GEN / "EP3_PKT05_CANDIDATE_CONTROL_FIXTURES.json").read_text(encoding="utf-8"))
check("fixture_no_phi", fixture["phi"] is False)
check("fixture_no_raw", fixture["raw_clinical_waveform_or_image_bytes_included"] is False)
check("fixture_candidate_inactive", fixture["candidate_active"] is False)
check("fixture_zero_gold", fixture["approved_adjudicated_gold_count"] == 0)
check("fixture_runtime_inactive", fixture["diagnostic_runtime"] == "GOVERNED_INACTIVE")
check("fixture_activation_blocked", fixture["diagnostic_runtime_activation_allowed"] is False)
check("fixture_reporting_blocked", fixture["diagnostic_performance_reporting_allowed"] is False)
check("fixture_no_accuracy", fixture["clinical_accuracy_claimed"] is False)
check("fixture_reviews_not_gold", fixture["reviewer_submissions_are_clinical_gold"] is False)
check("fixture_no_final_adjudication", fixture["final_adjudication_performed"] is False)
check("fixture_no_gold_admission", fixture["clinical_gold_admission_performed"] is False)
check("fixture_native_not_gold", fixture["native_dataset_annotations_are_project_gold"] is False)
check("fixture_synthetic_not_gold", fixture["synthetic_fixtures_are_clinical_gold"] is False)
check("fixture_scenarios", len(fixture["scenarios"]) == 9)
check("fixture_stale_config", any(row["id"]=="stale-configuration" and row["expected"]=="REJECTED" for row in fixture["scenarios"]))
check("fixture_untrusted_label", any(row["id"]=="untrusted-label" and row["expected"]=="UNTRUSTED_INERT" for row in fixture["scenarios"]))

release = control.release_contract()
check("release_packet", release["packet_id"] == "PKT-EP3-05")
check("release_theme", release["theme"] == "V12.1 candidate-control reconciliation")
check("release_baseline", release["baseline_commit"] == control.BASELINE_COMMIT and release["baseline_tree"] == control.BASELINE_TREE)
check("release_stage1", release["stage1_receipt_sha256"] == control.STAGE1_RECEIPT_SHA256)
check("release_prior", release["accepted_prior_packet_receipt_sha256"] == control.PRIOR_PACKET_RECEIPT_SHA256)
check("release_candidate_inactive", release["candidate_active"] is False)
check("release_auto_selection_blocked", release["automatic_selection_allowed"] is False)
check("release_zero_gold", release["approved_adjudicated_gold_count"] == 0)
check("release_activation_blocked", release["diagnostic_runtime_activation_allowed"] is False)
check("release_reporting_blocked", release["diagnostic_performance_reporting_allowed"] is False)
check("release_no_accuracy", release["clinical_accuracy_claimed"] is False)
check("release_reviews_unadjudicated", release["reviewer_submissions_are_unadjudicated"] is True)
check("release_reviews_not_gold", release["reviewer_submissions_are_clinical_gold"] is False)
check("release_no_final_adjudication", release["final_adjudication_performed"] is False)
check("release_no_gold_admission", release["clinical_gold_admission_performed"] is False)
check("release_native_not_gold", release["native_dataset_annotations_are_project_gold"] is False)
check("release_synthetic_not_gold", release["synthetic_fixtures_are_clinical_gold"] is False)
check("release_no_raw", release["raw_clinical_waveform_or_image_bytes_included"] is False)
check("release_no_authority_rewrite", release["authority_rewritten"] is False)
check("release_no_fallback", release["silent_fallback_allowed"] is False)
check("release_proof_required", release["independent_machine_verification_required"] is True and release["github_ci_required"] is True)

print(json.dumps({
    "schema": "ekg-ep3-pkt05-candidate-control-tests-v1",
    "pass": True, "passed": passed, "total": passed,
    "candidate_active": False,
    "approved_adjudicated_gold_count": 0,
    "diagnostic_runtime": "GOVERNED_INACTIVE",
    "diagnostic_runtime_activation_allowed": False,
    "diagnostic_performance_reporting_allowed": False,
    "clinical_accuracy_claimed": False,
    "reviewer_submissions_are_clinical_gold": False,
    "final_adjudication_performed": False,
    "clinical_gold_admission_performed": False
}, sort_keys=True))