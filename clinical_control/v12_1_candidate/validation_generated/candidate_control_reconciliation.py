"""EP3 Packet 5 V12.1 candidate-control reconciliation.

This module reconciles the existing quarantined candidate/evaluation substrate
with Packet-4 review references. It never performs adjudication, gold admission,
diagnostic activation, automatic candidate selection, or accuracy promotion.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy

import evaluation_engine as evaluation
import pattern_candidate_engine as candidate_engine
import system_status_adapter as status

SCHEMA = "ekg-ep3-pkt05-candidate-control-v1"
BASELINE_COMMIT = "439ce89beb485bc4fd458885bfe970d580efecd2"
BASELINE_TREE = "bbc2ebdda63e49e555b09f532f8c2262d0178ecd"
STAGE1_RECEIPT_SHA256 = "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb"
PRIOR_PACKET_RECEIPT_SHA256 = "3030f7e0d9dacafcaf81d767df97969f4255fb4397b4963521ad14197baa5e66"
RULES_SHA256 = "32921a76b04bbbad4f74c26aeecabd8e60a48216c7fc0837278652bc6d6daed6"

LIFECYCLE_STATES = {"GOVERNED_INACTIVE", "EVALUATION_ONLY", "BLOCKED", "STALE", "UNKNOWN"}
SOURCE_STATES = {"AVAILABLE", "DEGRADED", "UNAVAILABLE", "UNKNOWN", "CONFLICT"}
ENGINEERING_STATES = {"USABLE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"}
CALIBRATION_STATES = {"TRUSTED", "UNTRUSTED", "UNKNOWN"}
USAGE_STATES = {"APPROVED", "REJECTED", "UNKNOWN"}
PRIVACY_STATES = {"CLEARED_NON_SENSITIVE", "BLOCKED", "UNKNOWN"}
ELIGIBILITY_STATES = {"ELIGIBLE", "INELIGIBLE", "UNKNOWN"}
REVIEW_STATES = {"CLEAN", "CONTAMINATED", "UNVERIFIABLE", "INCOMPLETE"}
COMPARISON_STATES = {"CONCORDANT", "DISAGREEING", "MIXED", "UNKNOWN"}
CANDIDATE_STATUSES = {"PRESENT_CANDIDATE", "ABSENT_BY_RULE", "NOT_EXECUTABLE", "INDETERMINATE", "INELIGIBLE"}
UNTRUSTED_CHANNELS = {
    "NATIVE_DATASET_ANNOTATION", "OCR_TEXT", "EMBEDDED_LABEL",
    "MACHINE_INTERPRETATION", "PRIOR_REVIEWER_LABEL", "SYNTHETIC_FIXTURE",
}
RAW_KEYS = set(status.RAW_PAYLOAD_KEYS) | {
    "raw_image_bytes", "image_bytes", "pixels", "samples", "sample_values",
    "waveform", "waveform_data", "signal", "raw_payload", "source_contents",
}
FORBIDDEN_AUTHORITY_KEYS = {
    "final_diagnosis", "final_label", "final_pattern_labels", "final_adjudication",
    "gold_case", "gold_admission", "diagnostic_truth", "automatic_winner",
}
OPAQUE_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789._:-")


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _digest(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _sha(value, code, length=64):
    if not isinstance(value, str) or len(value) != length:
        raise ValueError(code)
    try:
        int(value, 16)
    except ValueError as exc:
        raise ValueError(code) from exc
    return value.lower()


def _opaque(value, code, min_len=3, max_len=96):
    if not isinstance(value, str) or not (min_len <= len(value) <= max_len):
        raise ValueError(code)
    if value[0] not in "abcdefghijklmnopqrstuvwxyz0123456789":
        raise ValueError(code)
    if any(ch not in OPAQUE_CHARS for ch in value):
        raise ValueError(code)
    return value


def _safe(value, path="$"):
    if isinstance(value, list):
        for index, item in enumerate(value):
            _safe(item, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        lowered = str(key).lower()
        if lowered in status.PHI_KEYS:
            raise ValueError("DIRECT_IDENTIFIER_FORBIDDEN:" + path + "." + str(key))
        if lowered in status.SECRET_KEYS:
            raise ValueError("SECRET_MATERIAL_FORBIDDEN:" + path + "." + str(key))
        if lowered in RAW_KEYS:
            raise ValueError("RAW_CLINICAL_PAYLOAD_FORBIDDEN:" + path + "." + str(key))
        if lowered in FORBIDDEN_AUTHORITY_KEYS:
            raise ValueError("CLINICAL_AUTHORITY_FIELD_FORBIDDEN:" + path + "." + str(key))
        _safe(item, path + "." + str(key))


def candidate_configuration():
    source_hashes = candidate_engine.verify_source_hashes()
    if source_hashes["pattern_registry"] != evaluation.REGISTRY_SHA256:
        raise ValueError("PATTERN_REGISTRY_BINDING_CONFLICT")
    rules_object = json.loads(candidate_engine.RULES_PATH.read_text(encoding="utf-8-sig"))
    actual_rules = hashlib.sha256(_canonical(rules_object)).hexdigest()
    if actual_rules != RULES_SHA256:
        raise ValueError("CANDIDATE_RULE_CONFIGURATION_DRIFT")
    body = {
        "schema": "ekg-v12-1-candidate-configuration-v1",
        "repository": status.REPOSITORY,
        "packet4_commit": BASELINE_COMMIT,
        "packet4_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "packet4_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "pattern_registry": evaluation.registry_binding(),
        "source_hashes": source_hashes,
        "rules_sha256": RULES_SHA256,
        "default_behavior": candidate_engine.load_rules()["default_behavior"],
        "candidate_active": False,
        "automatic_selection_allowed": False,
        "clinical_accuracy_claimed": False,
    }
    return {**body, "configuration_sha256": _digest(body)}


def _validate_configuration(value):
    expected = candidate_configuration()
    if value != expected:
        raise ValueError("CANDIDATE_CONFIGURATION_STALE_OR_CONFLICTING")
    return expected


def review_evidence_descriptor(*, review_package_id, review_package_sha256,
                               submission_refs, adjudication_handoff_ref=None,
                               review_state="CLEAN", comparison_state="UNKNOWN"):
    _opaque(review_package_id, "REVIEW_PACKAGE_ID")
    _sha(review_package_sha256, "REVIEW_PACKAGE_SHA256")
    if review_state not in REVIEW_STATES:
        raise ValueError("REVIEW_STATE")
    if comparison_state not in COMPARISON_STATES:
        raise ValueError("REVIEW_COMPARISON_STATE")
    if not isinstance(submission_refs, list) or len(submission_refs) < 2:
        raise ValueError("DUAL_REVIEW_SUBMISSION_REFS_REQUIRED")
    refs = []
    seen = set()
    for ref in submission_refs:
        _safe(ref, "$.submission_ref")
        if set(ref) != {"submission_id", "submission_sha256"}:
            raise ValueError("SUBMISSION_REF_FIELDS")
        rid = _opaque(ref["submission_id"], "SUBMISSION_REF_ID")
        sha = _sha(ref["submission_sha256"], "SUBMISSION_REF_SHA256")
        if rid in seen:
            raise ValueError("DUPLICATE_SUBMISSION_REF")
        seen.add(rid)
        refs.append({"submission_id": rid, "submission_sha256": sha})
    refs.sort(key=lambda x: x["submission_id"])
    handoff = None
    if adjudication_handoff_ref is not None:
        _safe(adjudication_handoff_ref, "$.handoff_ref")
        if set(adjudication_handoff_ref) != {"handoff_id", "handoff_sha256"}:
            raise ValueError("HANDOFF_REF_FIELDS")
        handoff = {
            "handoff_id": _opaque(adjudication_handoff_ref["handoff_id"], "HANDOFF_REF_ID"),
            "handoff_sha256": _sha(adjudication_handoff_ref["handoff_sha256"], "HANDOFF_REF_SHA256"),
        }
    body = {
        "schema": "ekg-ep3-pkt05-review-evidence-ref-v1",
        "review_package_id": review_package_id,
        "review_package_sha256": review_package_sha256,
        "submission_refs": refs,
        "adjudication_handoff_ref": handoff,
        "review_state": review_state,
        "comparison_state": comparison_state,
        "reviewer_submissions_unadjudicated": True,
        "reviewer_submissions_clinical_gold": False,
        "final_adjudication_performed": False,
        "clinical_gold_admitted": False,
        "approved_adjudicated_gold_count": 0,
        "authority_effect": "NONE",
    }
    return {**body, "review_evidence_sha256": _digest(body)}


def _validate_review_evidence(value):
    if not isinstance(value, dict) or value.get("schema") != "ekg-ep3-pkt05-review-evidence-ref-v1":
        raise ValueError("REVIEW_EVIDENCE_REQUIRED")
    _safe(value, "$.review_evidence")
    body = deepcopy(value)
    declared = body.pop("review_evidence_sha256", None)
    if _sha(declared, "REVIEW_EVIDENCE_SHA256") != _digest(body):
        raise ValueError("REVIEW_EVIDENCE_HASH")
    if body.get("review_state") not in REVIEW_STATES or body.get("comparison_state") not in COMPARISON_STATES:
        raise ValueError("REVIEW_EVIDENCE_STATE")
    if body.get("reviewer_submissions_unadjudicated") is not True:
        raise ValueError("REVIEW_SUBMISSION_STATE")
    if body.get("reviewer_submissions_clinical_gold") is not False:
        raise ValueError("REVIEW_SUBMISSION_GOLD_FORBIDDEN")
    if body.get("final_adjudication_performed") is not False or body.get("clinical_gold_admitted") is not False:
        raise ValueError("ADJUDICATION_OR_GOLD_FORBIDDEN")
    if body.get("approved_adjudicated_gold_count") != 0 or body.get("authority_effect") != "NONE":
        raise ValueError("REVIEW_AUTHORITY_ESCALATION")
    if not isinstance(body.get("submission_refs"), list) or len(body["submission_refs"]) < 2:
        raise ValueError("DUAL_REVIEW_SUBMISSION_REFS_REQUIRED")
    expected = review_evidence_descriptor(
        review_package_id=body["review_package_id"],
        review_package_sha256=body["review_package_sha256"],
        submission_refs=body["submission_refs"],
        adjudication_handoff_ref=body.get("adjudication_handoff_ref"),
        review_state=body["review_state"],
        comparison_state=body["comparison_state"],
    )
    if value != expected:
        raise ValueError("REVIEW_EVIDENCE_INTEGRITY")
    return value


def source_evidence_descriptor(*, source_artifact_sha256, signal_qc_exposure_sha256,
                               source_state, engineering_state, calibration_state,
                               usage_status, privacy_status, evidence_eligibility,
                               limitations=None):
    if source_state not in SOURCE_STATES:
        raise ValueError("SOURCE_STATE")
    if engineering_state not in ENGINEERING_STATES:
        raise ValueError("ENGINEERING_STATE")
    if calibration_state not in CALIBRATION_STATES:
        raise ValueError("CALIBRATION_STATE")
    if usage_status not in USAGE_STATES:
        raise ValueError("USAGE_STATUS")
    if privacy_status not in PRIVACY_STATES:
        raise ValueError("PRIVACY_STATUS")
    if evidence_eligibility not in ELIGIBILITY_STATES:
        raise ValueError("EVIDENCE_ELIGIBILITY")
    if not isinstance(limitations or [], list) or any(not isinstance(x, str) or len(x) > 160 for x in (limitations or [])):
        raise ValueError("SOURCE_LIMITATIONS")
    body = {
        "schema": "ekg-ep3-pkt05-source-evidence-state-v1",
        "source_artifact_sha256": _sha(source_artifact_sha256, "SOURCE_ARTIFACT_SHA256"),
        "signal_qc_exposure_sha256": _sha(signal_qc_exposure_sha256, "SIGNAL_QC_EXPOSURE_SHA256"),
        "source_state": source_state,
        "engineering_state": engineering_state,
        "calibration_state": calibration_state,
        "usage_status": usage_status,
        "privacy_status": privacy_status,
        "evidence_eligibility": evidence_eligibility,
        "limitations": sorted(set(limitations or [])),
        "engineering_usability_is_clinical_validity": False,
        "clinical_validity_inferred": False,
    }
    body["candidate_evaluation_eligible"] = (
        source_state == "AVAILABLE"
        and engineering_state == "USABLE"
        and calibration_state == "TRUSTED"
        and usage_status == "APPROVED"
        and privacy_status == "CLEARED_NON_SENSITIVE"
        and evidence_eligibility == "ELIGIBLE"
    )
    return {**body, "source_evidence_sha256": _digest(body)}


def untrusted_metadata_descriptor(channel, artifact_sha256, present=True):
    if channel not in UNTRUSTED_CHANNELS:
        raise ValueError("UNTRUSTED_CHANNEL")
    if not isinstance(present, bool):
        raise ValueError("UNTRUSTED_PRESENT")
    body = {
        "channel": channel,
        "artifact_sha256": _sha(artifact_sha256, "UNTRUSTED_ARTIFACT_SHA256"),
        "present": present,
        "authority": "UNTRUSTED_INERT",
        "clinical_authority": False,
        "clinical_gold": False,
        "candidate_activation_allowed": False,
    }
    return body


def _validate_candidate_output(record):
    if not isinstance(record, dict) or record.get("schema") != "ekg-pkt08-pattern-candidate-v1":
        raise ValueError("CANDIDATE_RECORD_SCHEMA")
    allowed = {
        "schema", "candidate_id", "pattern_id", "label", "domain", "status", "rule_id",
        "required_evidence", "supportive_evidence", "satisfied_required_evidence",
        "missing_required_evidence", "supporting_evidence_refs", "supporting_leads",
        "major_confounders_or_mimics", "active_confounders", "contradictions",
        "diagnostic_boundary", "urgency", "certainty", "population",
        "measurement_dependencies", "clinical_context_required", "rule_provenance",
        "candidate_active", "clinical_accuracy_claimed", "diagnosis",
        "automatic_selection_allowed", "must_name_supporting_leads",
    }
    if not set(record) <= allowed:
        raise ValueError("CANDIDATE_RECORD_FIELD_FORBIDDEN")
    ids = {p["id"] for p in evaluation.registry()["patterns"]}
    if record.get("pattern_id") not in ids:
        raise ValueError("CANDIDATE_PATTERN_UNKNOWN")
    if record.get("status") not in CANDIDATE_STATUSES:
        raise ValueError("CANDIDATE_STATUS")
    if record.get("candidate_active") is not False:
        raise ValueError("CANDIDATE_ACTIVE_FORBIDDEN")
    if record.get("clinical_accuracy_claimed") is not False:
        raise ValueError("CANDIDATE_ACCURACY_CLAIM_FORBIDDEN")
    if record.get("diagnosis") is not None:
        raise ValueError("CANDIDATE_DIAGNOSIS_FORBIDDEN")
    if record.get("automatic_selection_allowed") is not False:
        raise ValueError("CANDIDATE_AUTOMATIC_SELECTION_FORBIDDEN")
    return record


def reconcile_candidate_control(*, candidate_key, lifecycle_state, configuration,
                                source_evidence, review_evidence, candidate_outputs,
                                untrusted_metadata=None, limitations=None,
                                predecessor_reconciliation_sha256=None,
                                reconciliation_version=1, staleness_reasons=None):
    _opaque(candidate_key, "CANDIDATE_KEY")
    if lifecycle_state not in LIFECYCLE_STATES:
        raise ValueError("CANDIDATE_LIFECYCLE_STATE")
    config = _validate_configuration(configuration)
    if not isinstance(source_evidence, dict) or source_evidence.get("schema") != "ekg-ep3-pkt05-source-evidence-state-v1":
        raise ValueError("SOURCE_EVIDENCE_REQUIRED")
    source = source_evidence_descriptor(
        source_artifact_sha256=source_evidence["source_artifact_sha256"],
        signal_qc_exposure_sha256=source_evidence["signal_qc_exposure_sha256"],
        source_state=source_evidence["source_state"], engineering_state=source_evidence["engineering_state"],
        calibration_state=source_evidence["calibration_state"], usage_status=source_evidence["usage_status"],
        privacy_status=source_evidence["privacy_status"], evidence_eligibility=source_evidence["evidence_eligibility"],
        limitations=source_evidence.get("limitations", []),
    )
    if source != source_evidence:
        raise ValueError("SOURCE_EVIDENCE_INTEGRITY")
    review = _validate_review_evidence(review_evidence)
    if not isinstance(candidate_outputs, list) or not candidate_outputs:
        raise ValueError("CANDIDATE_OUTPUTS_REQUIRED")
    outputs = [deepcopy(_validate_candidate_output(x)) for x in candidate_outputs]
    ids = [x["candidate_id"] for x in outputs]
    if len(ids) != len(set(ids)):
        raise ValueError("DUPLICATE_CANDIDATE_ID")
    outputs.sort(key=lambda x: (x["pattern_id"], x["candidate_id"]))
    untrusted = [untrusted_metadata_descriptor(**x) for x in (untrusted_metadata or [])]
    untrusted.sort(key=lambda x: (x["channel"], x["artifact_sha256"]))
    if not isinstance(limitations or [], list) or any(not isinstance(x, str) or len(x) > 160 for x in (limitations or [])):
        raise ValueError("CANDIDATE_LIMITATIONS")
    reasons = sorted(set(staleness_reasons or []))
    if any(not isinstance(x, str) or not x or len(x) > 160 for x in reasons):
        raise ValueError("STALENESS_REASONS")
    if reconciliation_version == 1:
        if predecessor_reconciliation_sha256 is not None:
            raise ValueError("ROOT_PREDECESSOR_FORBIDDEN")
    elif not isinstance(reconciliation_version, int) or reconciliation_version < 2:
        raise ValueError("RECONCILIATION_VERSION")
    else:
        _sha(predecessor_reconciliation_sha256, "PREDECESSOR_RECONCILIATION_SHA256")
    clean_review = review["review_state"] == "CLEAN"
    evaluation_gate = evaluation.performance_gate([])
    evaluable = (
        lifecycle_state == "EVALUATION_ONLY"
        and source["candidate_evaluation_eligible"] is True
        and clean_review
        and not reasons
    )
    body = {
        "schema": SCHEMA,
        "candidate_key": candidate_key,
        "reconciliation_version": reconciliation_version,
        "predecessor_reconciliation_sha256": predecessor_reconciliation_sha256,
        "lifecycle_state": lifecycle_state,
        "configuration": config,
        "source_evidence": deepcopy(source),
        "review_evidence": deepcopy(review),
        "candidate_outputs": outputs,
        "untrusted_metadata": untrusted,
        "limitations": sorted(set(limitations or [])),
        "staleness_reasons": reasons,
        "candidate_evaluation_eligible": evaluable,
        "evaluation_gate": evaluation_gate,
        "repository_binding": {
            "repository": status.REPOSITORY,
            "commit": BASELINE_COMMIT,
            "tree": BASELINE_TREE,
        },
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "candidate_active": False,
        "automatic_selection_allowed": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "diagnostic_runtime_activation_allowed": False,
        "approved_adjudicated_gold_count": 0,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "reviewer_submissions_are_clinical_gold": False,
        "final_adjudication_performed": False,
        "clinical_gold_admission_performed": False,
        "raw_clinical_waveform_or_image_bytes_included": False,
        "authority_rewritten": False,
        "silent_fallback_allowed": False,
        "clinical_validity_inferred": False,
    }
    reconciliation_sha256 = _digest(body)
    return {**body, "reconciliation_id": "ccr_" + reconciliation_sha256[:24],
            "reconciliation_sha256": reconciliation_sha256}


def validate_reconciliation(value):
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        return False
    try:
        allowed = {
            "schema", "candidate_key", "reconciliation_version",
            "predecessor_reconciliation_sha256", "lifecycle_state",
            "configuration", "source_evidence", "review_evidence",
            "candidate_outputs", "untrusted_metadata", "limitations",
            "staleness_reasons", "candidate_evaluation_eligible",
            "evaluation_gate", "repository_binding",
            "stage1_receipt_sha256", "prior_packet_receipt_sha256",
            "candidate_active", "automatic_selection_allowed",
            "diagnostic_runtime", "diagnostic_runtime_activation_allowed",
            "approved_adjudicated_gold_count",
            "diagnostic_performance_reporting_allowed",
            "clinical_accuracy_claimed",
            "reviewer_submissions_are_clinical_gold",
            "final_adjudication_performed",
            "clinical_gold_admission_performed",
            "raw_clinical_waveform_or_image_bytes_included",
            "authority_rewritten", "silent_fallback_allowed",
            "clinical_validity_inferred", "reconciliation_id",
            "reconciliation_sha256",
        }
        if set(value) != allowed:
            return False
        body = deepcopy(value)
        declared = body.pop("reconciliation_sha256")
        rid = body.pop("reconciliation_id")
        if _sha(declared, "RECONCILIATION_SHA256") != _digest(body):
            return False
        if rid != "ccr_" + declared[:24]:
            return False
        if body.get("repository_binding") != {
            "repository": status.REPOSITORY, "commit": BASELINE_COMMIT, "tree": BASELINE_TREE
        }:
            return False
        if body.get("stage1_receipt_sha256") != STAGE1_RECEIPT_SHA256 or body.get("prior_packet_receipt_sha256") != PRIOR_PACKET_RECEIPT_SHA256:
            return False
        if body.get("configuration") != candidate_configuration():
            return False
        source = body.get("source_evidence")
        expected_source = source_evidence_descriptor(
            source_artifact_sha256=source["source_artifact_sha256"],
            signal_qc_exposure_sha256=source["signal_qc_exposure_sha256"],
            source_state=source["source_state"], engineering_state=source["engineering_state"],
            calibration_state=source["calibration_state"], usage_status=source["usage_status"],
            privacy_status=source["privacy_status"], evidence_eligibility=source["evidence_eligibility"],
            limitations=source.get("limitations", []),
        )
        if source != expected_source:
            return False
        _validate_review_evidence(body.get("review_evidence"))
        outputs = body.get("candidate_outputs")
        if not isinstance(outputs, list) or not outputs:
            return False
        for record in outputs:
            _validate_candidate_output(record)
        if len({x["candidate_id"] for x in outputs}) != len(outputs):
            return False
        if outputs != sorted(outputs, key=lambda x: (x["pattern_id"], x["candidate_id"])):
            return False
        version = body.get("reconciliation_version")
        predecessor = body.get("predecessor_reconciliation_sha256")
        if not isinstance(version, int) or version < 1:
            return False
        if version == 1 and predecessor is not None:
            return False
        if version > 1:
            _sha(predecessor, "PREDECESSOR_RECONCILIATION_SHA256")
        if body.get("lifecycle_state") not in LIFECYCLE_STATES:
            return False
        if body.get("candidate_active") is not False or body.get("automatic_selection_allowed") is not False:
            return False
        if body.get("diagnostic_runtime") != "GOVERNED_INACTIVE" or body.get("diagnostic_runtime_activation_allowed") is not False:
            return False
        if body.get("approved_adjudicated_gold_count") != 0 or body.get("diagnostic_performance_reporting_allowed") is not False:
            return False
        if body.get("clinical_accuracy_claimed") is not False:
            return False
        if body.get("reviewer_submissions_are_clinical_gold") is not False or body.get("final_adjudication_performed") is not False or body.get("clinical_gold_admission_performed") is not False:
            return False
        if body.get("raw_clinical_waveform_or_image_bytes_included") is not False or body.get("authority_rewritten") is not False or body.get("silent_fallback_allowed") is not False:
            return False
        gate = evaluation.performance_gate([])
        if body.get("evaluation_gate") != gate or gate["approved_adjudicated_gold_count"] != 0 or gate["diagnostic_performance_reporting_allowed"] is not False:
            return False
        expected_eval = (
            body.get("lifecycle_state") == "EVALUATION_ONLY"
            and source["candidate_evaluation_eligible"] is True
            and body["review_evidence"]["review_state"] == "CLEAN"
            and not body.get("staleness_reasons")
        )
        if body.get("candidate_evaluation_eligible") is not expected_eval:
            return False
        for row in body.get("untrusted_metadata", []):
            expected = untrusted_metadata_descriptor(row["channel"], row["artifact_sha256"], row["present"])
            if row != expected:
                return False
        return True
    except (KeyError, TypeError, ValueError):
        return False


def create_successor(previous, *, lifecycle_state=None, source_evidence=None,
                     review_evidence=None, candidate_outputs=None,
                     untrusted_metadata=None, limitations=None, staleness_reasons=None):
    if not validate_reconciliation(previous):
        raise ValueError("PREVIOUS_RECONCILIATION_INVALID")
    return reconcile_candidate_control(
        candidate_key=previous["candidate_key"],
        lifecycle_state=lifecycle_state or previous["lifecycle_state"],
        configuration=previous["configuration"],
        source_evidence=source_evidence or previous["source_evidence"],
        review_evidence=review_evidence or previous["review_evidence"],
        candidate_outputs=candidate_outputs or previous["candidate_outputs"],
        untrusted_metadata=untrusted_metadata if untrusted_metadata is not None else [
            {"channel": x["channel"], "artifact_sha256": x["artifact_sha256"], "present": x["present"]}
            for x in previous["untrusted_metadata"]
        ],
        limitations=limitations if limitations is not None else previous["limitations"],
        predecessor_reconciliation_sha256=previous["reconciliation_sha256"],
        reconciliation_version=previous["reconciliation_version"] + 1,
        staleness_reasons=staleness_reasons if staleness_reasons is not None else previous["staleness_reasons"],
    )


def candidate_status_navigation(value):
    if not validate_reconciliation(value):
        raise ValueError("CANDIDATE_RECONCILIATION_INVALID")
    return {
        "schema": "ekg-ep3-pkt05-candidate-status-navigation-v1",
        "reconciliation_id": value["reconciliation_id"],
        "reconciliation_sha256": value["reconciliation_sha256"],
        "candidate_key": value["candidate_key"],
        "lifecycle_state": value["lifecycle_state"],
        "candidate_evaluation_eligible": value["candidate_evaluation_eligible"],
        "configuration_sha256": value["configuration"]["configuration_sha256"],
        "source_evidence_sha256": value["source_evidence"]["source_evidence_sha256"],
        "review_evidence_sha256": value["review_evidence"]["review_evidence_sha256"],
        "candidate_ids": [x["candidate_id"] for x in value["candidate_outputs"]],
        "limitations": deepcopy(value["limitations"]),
        "staleness_reasons": deepcopy(value["staleness_reasons"]),
        "read_only": True,
        "diagnostic_execution_allowed": False,
        "automatic_selection_allowed": False,
        "clinical_authority_transfer": False,
        "clinical_accuracy_claimed": False,
        "raw_payload_included": False,
    }


def release_contract():
    return {
        "schema": "ekg-ep3-pkt05-candidate-control-release-contract-v1",
        "packet_id": "PKT-EP3-05",
        "theme": "V12.1 candidate-control reconciliation",
        "repository": status.REPOSITORY,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "accepted_prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "candidate_active": False,
        "automatic_selection_allowed": False,
        "approved_adjudicated_gold_count": 0,
        "diagnostic_runtime_activation_allowed": False,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "reviewer_submissions_are_unadjudicated": True,
        "reviewer_submissions_are_clinical_gold": False,
        "final_adjudication_performed": False,
        "clinical_gold_admission_performed": False,
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "raw_clinical_waveform_or_image_bytes_included": False,
        "authority_rewritten": False,
        "silent_fallback_allowed": False,
        "independent_machine_verification_required": True,
        "github_ci_required": True,
    }
