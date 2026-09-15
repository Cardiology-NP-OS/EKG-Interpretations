"""EP3 Packet 4 blinded-review workflow contracts.

This module exposes deterministic review workflow mechanics over the accepted
Packet-3 signal/QC boundary. Human reviewer submissions remain unadjudicated,
non-gold evidence. This module never performs diagnosis, final adjudication,
clinical-gold admission, diagnostic activation, or diagnostic-performance
reporting.
"""
from __future__ import annotations

import hashlib
import json
import math
from copy import deepcopy

import evaluation_engine as evaluation
import signal_qc_exposure as signal_qc
import system_status_adapter as status

SCHEMA = "ekg-ep3-pkt04-blinded-review-workflow-v1"
BASELINE_COMMIT = "60e216234eb80b293e335fe97a42547cc360cd9c"
BASELINE_TREE = "af6b4f0df8035c3d90d75990cabfc87337bc5a12"
STAGE1_RECEIPT_SHA256 = "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb"
PRIOR_PACKET_RECEIPT_SHA256 = "f11c2b232b6f76d3be62b95ac44eb379becd41244bb8e67f8e0dfe18881232e1"

REVIEW_LABELS = set(evaluation.LABELS) | {"ABSTAIN"}
ASSIGNMENT_STATES = {"ASSIGNED", "OPENED", "SUBMITTED", "INVALIDATED", "WITHDRAWN"}
TERMINAL_ASSIGNMENT_STATES = {"SUBMITTED", "INVALIDATED", "WITHDRAWN"}
BLINDING_STATES = {"BLINDED_VERIFIED", "CONTAMINATED", "UNVERIFIABLE"}
USAGE_STATES = {"APPROVED", "UNKNOWN", "REJECTED"}
PRIVACY_STATES = {"CLEARED_NON_SENSITIVE", "UNKNOWN", "REQUIRES_REVIEW", "REJECTED"}
RIGHTS_STATES = {"APPROVED_FOR_EVALUATION", "UNKNOWN", "RESTRICTED", "REJECTED"}
SOURCE_IDENTITY_STATES = {"VERIFIED", "UNKNOWN", "CONFLICT"}
PACKAGE_STATES = {"READY", "BLOCKED"}
RAW_KEYS = set(status.RAW_PAYLOAD_KEYS) | {
    "raw_image_bytes", "image_bytes", "pixels", "samples", "sample_values",
    "waveform", "waveform_data", "raw_payload", "source_contents",
}
FORBIDDEN_REVIEW_FIELDS = {
    "final_diagnosis", "final_label", "final_pattern_labels", "final_adjudication",
    "adjudicated_gold", "gold_case", "gold_admission",
    "diagnostic_truth", "prediction", "predictions", "machine_interpretation",
    "ocr_text", "native_dataset_label", "prior_reviewer_labels",
}
# clinical_gold is a fixed false invariant on generated assignment/submission
# records, not a caller-authorized review field. It is validated explicitly.
OPAQUE_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789._:-")
def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _digest(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _opaque(value, code, min_len=3, max_len=96):
    if not isinstance(value, str):
        raise ValueError(code)
    if not (min_len <= len(value) <= max_len):
        raise ValueError(code)
    if value[0] not in "abcdefghijklmnopqrstuvwxyz0123456789":
        raise ValueError(code)
    if any(ch not in OPAQUE_CHARS for ch in value):
        raise ValueError(code)
    return value


def _sha(value, code, length=64):
    if not isinstance(value, str) or len(value) != length:
        raise ValueError(code)
    try:
        int(value, 16)
    except ValueError as exc:
        raise ValueError(code) from exc
    return value.lower()


def _required(value, fields, code):
    if not isinstance(value, dict):
        raise ValueError(code)
    missing = sorted(set(fields) - set(value))
    if missing:
        raise ValueError(code + ":" + ",".join(missing))


def _walk_safe(value, path="$"):
    if isinstance(value, list):
        for index, item in enumerate(value):
            _walk_safe(item, f"{path}[{index}]")
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
        if lowered in FORBIDDEN_REVIEW_FIELDS:
            raise ValueError("REVIEW_AUTHORITY_FIELD_FORBIDDEN:" + path + "." + str(key))
        _walk_safe(item, path + "." + str(key))
def _validate_packet3_exposure(exposure):
    if not isinstance(exposure, dict) or exposure.get("schema") != signal_qc.SCHEMA:
        raise ValueError("PACKET3_SIGNAL_QC_EXPOSURE_REQUIRED")
    _walk_safe(exposure, "$.signal_qc_exposure")
    navigation = signal_qc.navigation_descriptor(exposure)
    binding = exposure.get("binding", {})
    expected_binding = {
        "repository": status.REPOSITORY,
        "baseline_commit": signal_qc.BASELINE_COMMIT,
        "baseline_tree": signal_qc.BASELINE_TREE,
        "stage1_receipt_sha256": signal_qc.STAGE1_RECEIPT_SHA256,
        "prior_packet_receipt_sha256": signal_qc.PRIOR_PACKET_RECEIPT_SHA256,
        "packet2_bundle_sha256": binding.get("packet2_bundle_sha256"),
    }
    if binding != expected_binding:
        raise ValueError("PACKET3_SIGNAL_QC_AUTHORITY_MISMATCH")
    if exposure.get("diagnostic_state") != "GOVERNED_INACTIVE":
        raise ValueError("DIAGNOSTIC_RUNTIME_STATE_CHANGED")
    if exposure.get("candidate_active") is not False:
        raise ValueError("CANDIDATE_ACTIVE_FORBIDDEN")
    if exposure.get("approved_adjudicated_gold_count") != 0:
        raise ValueError("APPROVED_GOLD_COUNT_CHANGED")
    if exposure.get("diagnostic_performance_reporting_allowed") is not False:
        raise ValueError("DIAGNOSTIC_REPORTING_FORBIDDEN")
    if exposure.get("clinical_accuracy_claimed") is not False:
        raise ValueError("CLINICAL_ACCURACY_CLAIM_FORBIDDEN")
    if exposure.get("native_dataset_annotations_are_project_gold") is not False:
        raise ValueError("NATIVE_LABEL_GOLD_FORBIDDEN")
    if exposure.get("synthetic_fixtures_are_clinical_gold") is not False:
        raise ValueError("SYNTHETIC_GOLD_FORBIDDEN")
    if exposure.get("raw_clinical_waveform_or_image_bytes_included") is not False:
        raise ValueError("RAW_CLINICAL_PAYLOAD_FORBIDDEN")
    if exposure.get("authority_rewritten") is not False or exposure.get("silent_fallback_allowed") is not False:
        raise ValueError("PACKET3_AUTHORITY_BOUNDARY_CHANGED")
    return navigation


def reviewer_identity(*, actor_id, principal_sha256, session_id):
    _opaque(actor_id, "REVIEWER_ACTOR_ID")
    _sha(principal_sha256, "REVIEWER_PRINCIPAL_SHA256")
    _opaque(session_id, "REVIEWER_SESSION_ID")
    body = {
        "actor_id": actor_id,
        "principal_sha256": principal_sha256,
        "session_id": session_id,
        "credentials_embedded": False,
        "direct_identifiers_embedded": False,
    }
    return {
        "schema": "ekg-blinded-reviewer-identity-v1",
        **body,
        "reviewer_identity_sha256": _digest(body),
    }


def _validate_reviewer_identity(reviewer):
    _required(reviewer, {
        "schema", "actor_id", "principal_sha256", "session_id",
        "credentials_embedded", "direct_identifiers_embedded",
        "reviewer_identity_sha256",
    }, "REVIEWER_IDENTITY_MISSING")
    if reviewer["schema"] != "ekg-blinded-reviewer-identity-v1":
        raise ValueError("REVIEWER_IDENTITY_SCHEMA")
    material = dict(reviewer)
    declared = material.pop("reviewer_identity_sha256")
    material.pop("schema")
    if declared != _digest(material):
        raise ValueError("REVIEWER_IDENTITY_HASH")
    if reviewer["credentials_embedded"] is not False or reviewer["direct_identifiers_embedded"] is not False:
        raise ValueError("REVIEWER_IDENTITY_SENSITIVE_MATERIAL")
    return True


def validate_reviewer_independence(reviewers):
    if not isinstance(reviewers, list) or len(reviewers) < 2:
        raise ValueError("DUAL_REVIEWER_REQUIRED")
    for reviewer in reviewers:
        _validate_reviewer_identity(reviewer)
    for field, code in (
        ("actor_id", "REVIEWER_ACTOR_NOT_INDEPENDENT"),
        ("principal_sha256", "REVIEWER_PRINCIPAL_NOT_INDEPENDENT"),
        ("session_id", "REVIEWER_SESSION_NOT_INDEPENDENT"),
    ):
        values = [reviewer[field] for reviewer in reviewers]
        if len(values) != len(set(values)):
            raise ValueError(code)
    return True
def eligibility_descriptor(*, usage_status, privacy_review_status, rights_status,
                           source_identity_state, review_complete=False):
    if usage_status not in USAGE_STATES:
        raise ValueError("USAGE_STATUS")
    if privacy_review_status not in PRIVACY_STATES:
        raise ValueError("PRIVACY_REVIEW_STATUS")
    if rights_status not in RIGHTS_STATES:
        raise ValueError("RIGHTS_STATUS")
    if source_identity_state not in SOURCE_IDENTITY_STATES:
        raise ValueError("SOURCE_IDENTITY_STATE")
    if not isinstance(review_complete, bool):
        raise ValueError("REVIEW_COMPLETE")
    ready = (
        usage_status == "APPROVED"
        and privacy_review_status == "CLEARED_NON_SENSITIVE"
        and rights_status == "APPROVED_FOR_EVALUATION"
        and source_identity_state == "VERIFIED"
    )
    body = {
        "schema": "ekg-review-eligibility-v1",
        "usage_status": usage_status,
        "privacy_review_status": privacy_review_status,
        "rights_status": rights_status,
        "source_identity_state": source_identity_state,
        "review_complete": review_complete,
        "source_eligible": ready,
        "adjudication_handoff_allowed": ready and review_complete,
        "clinical_gold_admission_allowed": False,
    }
    return {**body, "eligibility_sha256": _digest(body)}


def validate_eligibility(value):
    if not isinstance(value, dict):
        return False
    try:
        allowed = {
            "schema", "usage_status", "privacy_review_status", "rights_status",
            "source_identity_state", "review_complete", "source_eligible",
            "adjudication_handoff_allowed", "clinical_gold_admission_allowed",
            "eligibility_sha256",
        }
        if set(value) != allowed or value.get("schema") != "ekg-review-eligibility-v1":
            return False
        expected = eligibility_descriptor(
            usage_status=value["usage_status"],
            privacy_review_status=value["privacy_review_status"],
            rights_status=value["rights_status"],
            source_identity_state=value["source_identity_state"],
            review_complete=value["review_complete"],
        )
        return value == expected
    except (ValueError, KeyError, TypeError):
        return False


def _contamination_state(flags):
    if not isinstance(flags, list):
        raise ValueError("CONTAMINATION_FLAGS")
    allowed = {
        "MACHINE_INTERPRETATION_VISIBLE", "OCR_TEXT_VISIBLE", "NATIVE_LABEL_VISIBLE",
        "PRIOR_REVIEW_LABEL_VISIBLE", "PREDICTION_VISIBLE", "OTHER_UNBLINDING_RISK",
    }
    if any(flag not in allowed for flag in flags):
        raise ValueError("CONTAMINATION_FLAG_UNKNOWN")
    return "CONTAMINATED" if flags else "BLINDED_VERIFIED"


def create_review_package(*, case_key, signal_qc_exposure, eligibility,
                          contamination_flags=None):
    _opaque(case_key, "REVIEW_CASE_KEY")
    _walk_safe(eligibility, "$.eligibility")
    if not validate_eligibility(eligibility):
        raise ValueError("REVIEW_ELIGIBILITY_INVALID")
    navigation = _validate_packet3_exposure(signal_qc_exposure)
    flags = sorted(set(contamination_flags or []))
    blinding_state = _contamination_state(flags)
    package_state = "READY" if blinding_state == "BLINDED_VERIFIED" and eligibility.get("source_eligible") is True else "BLOCKED"
    body = {
        "schema": "ekg-blinded-review-package-v1",
        "case_key": case_key,
        "source_artifact_sha256": signal_qc_exposure["source_artifact_sha256"],
        "signal_qc_exposure_id": signal_qc_exposure["exposure_id"],
        "signal_qc_exposure_sha256": signal_qc_exposure["exposure_sha256"],
        "source_navigation": navigation,
        "engineering_state": signal_qc_exposure["engineering_state"],
        "engineering_usable": signal_qc_exposure["engineering_usable"],
        "inspection": deepcopy(signal_qc_exposure["inspection"]),
        "waveform_qc": deepcopy(signal_qc_exposure["waveform_qc"]),
        "preview": deepcopy(signal_qc_exposure["preview"]),
        "transformation": deepcopy(signal_qc_exposure["transformation"]),
        "calibration": deepcopy(signal_qc_exposure["calibration"]),
        "eligibility": deepcopy(eligibility),
        "blinding_state": blinding_state,
        "contamination_flags": flags,
        "excluded_channels": [
            "MACHINE_INTERPRETATION", "OCR_TEXT", "NATIVE_DATASET_ANNOTATION",
            "EMBEDDED_LABEL", "PRIOR_REVIEWER_LABELS", "PREDICTIONS",
        ],
        "package_state": package_state,
        "review_allowed": package_state == "READY",
        "diagnostic_hint_included": False,
        "machine_interpretation_included": False,
        "native_dataset_labels_included": False,
        "prior_reviewer_labels_included": False,
        "predictions_included": False,
        "raw_clinical_payload_included": False,
        "authority_effect": "NONE",
        "repository_binding": {
            "repository": status.REPOSITORY,
            "baseline_commit": BASELINE_COMMIT,
            "baseline_tree": BASELINE_TREE,
        },
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
    }
    package_sha = _digest(body)
    return {
        **body,
        "review_package_id": "rpkg_" + package_sha[:24],
        "review_package_sha256": package_sha,
    }
def validate_review_package(package):
    if not isinstance(package, dict) or package.get("schema") != "ekg-blinded-review-package-v1":
        return False
    try:
        allowed = {
            "schema", "case_key", "source_artifact_sha256", "signal_qc_exposure_id",
            "signal_qc_exposure_sha256", "source_navigation", "engineering_state",
            "engineering_usable", "inspection", "waveform_qc", "preview",
            "transformation", "calibration", "eligibility", "blinding_state",
            "contamination_flags", "excluded_channels", "package_state",
            "review_allowed", "diagnostic_hint_included",
            "machine_interpretation_included", "native_dataset_labels_included",
            "prior_reviewer_labels_included", "predictions_included",
            "raw_clinical_payload_included", "authority_effect",
            "repository_binding", "stage1_receipt_sha256",
            "prior_packet_receipt_sha256", "review_package_id",
            "review_package_sha256",
        }
        if set(package) != allowed:
            return False
        _walk_safe(package, "$.review_package")
        material = deepcopy(package)
        declared = material.pop("review_package_sha256")
        package_id = material.pop("review_package_id")
        if _sha(declared, "REVIEW_PACKAGE_SHA256") != _digest(material):
            return False
        if package_id != "rpkg_" + declared[:24]:
            return False
        if material.get("repository_binding") != {
            "repository": status.REPOSITORY,
            "baseline_commit": BASELINE_COMMIT,
            "baseline_tree": BASELINE_TREE,
        }:
            return False
        if material.get("stage1_receipt_sha256") != STAGE1_RECEIPT_SHA256:
            return False
        if material.get("prior_packet_receipt_sha256") != PRIOR_PACKET_RECEIPT_SHA256:
            return False
        _sha(material.get("source_artifact_sha256"), "SOURCE_ARTIFACT_SHA256")
        _sha(material.get("signal_qc_exposure_sha256"), "SIGNAL_QC_EXPOSURE_SHA256")
        nav = material.get("source_navigation", {})
        if nav.get("exposure_sha256") != material.get("signal_qc_exposure_sha256"):
            return False
        if nav.get("source_artifact_sha256") != material.get("source_artifact_sha256"):
            return False
        if nav.get("read_only") is not True or nav.get("raw_payload_included") is not False:
            return False
        if nav.get("diagnostic_interpretation") is not False or nav.get("authority_effect") != "NONE":
            return False
        eligibility = material.get("eligibility", {})
        expected_eligibility = eligibility_descriptor(
            usage_status=eligibility.get("usage_status"),
            privacy_review_status=eligibility.get("privacy_review_status"),
            rights_status=eligibility.get("rights_status"),
            source_identity_state=eligibility.get("source_identity_state"),
            review_complete=eligibility.get("review_complete"),
        )
        if eligibility != expected_eligibility:
            return False
        if material.get("blinding_state") not in BLINDING_STATES:
            return False
        if _contamination_state(material.get("contamination_flags", [])) != material.get("blinding_state"):
            return False
        expected_state = (
            "READY"
            if material.get("blinding_state") == "BLINDED_VERIFIED"
            and material.get("eligibility", {}).get("source_eligible") is True
            else "BLOCKED"
        )
        if material.get("package_state") != expected_state:
            return False
        if material.get("review_allowed") is not (expected_state == "READY"):
            return False
        for field in (
            "diagnostic_hint_included", "machine_interpretation_included",
            "native_dataset_labels_included", "prior_reviewer_labels_included",
            "predictions_included", "raw_clinical_payload_included",
        ):
            if material.get(field) is not False:
                return False
        if material.get("authority_effect") != "NONE":
            return False
        expected_excluded = [
            "MACHINE_INTERPRETATION", "OCR_TEXT", "NATIVE_DATASET_ANNOTATION",
            "EMBEDDED_LABEL", "PRIOR_REVIEWER_LABELS", "PREDICTIONS",
        ]
        if material.get("excluded_channels") != expected_excluded:
            return False
        return True
    except (ValueError, KeyError, TypeError):
        return False


_ALLOWED_TRANSITIONS = {
    "ASSIGNED": {"OPENED", "WITHDRAWN", "INVALIDATED"},
    "OPENED": {"SUBMITTED", "WITHDRAWN", "INVALIDATED"},
    "SUBMITTED": set(),
    "WITHDRAWN": set(),
    "INVALIDATED": set(),
}


def create_assignment(*, review_package, reviewer, assignment_key):
    if not validate_review_package(review_package) or review_package["review_allowed"] is not True:
        raise ValueError("REVIEW_PACKAGE_NOT_ASSIGNABLE")
    _validate_reviewer_identity(reviewer)
    _opaque(assignment_key, "ASSIGNMENT_KEY")
    body = {
        "schema": "ekg-blinded-review-assignment-v1",
        "assignment_key": assignment_key,
        "assignment_version": 1,
        "predecessor_assignment_sha256": None,
        "review_package_id": review_package["review_package_id"],
        "review_package_sha256": review_package["review_package_sha256"],
        "reviewer": deepcopy(reviewer),
        "state": "ASSIGNED",
        "append_only": True,
        "silent_reassignment_allowed": False,
        "reviewer_labels_visible_before_submission": False,
        "clinical_gold": False,
    }
    assignment_sha = _digest(body)
    return {**body, "assignment_id": "rasg_" + assignment_sha[:24], "assignment_sha256": assignment_sha}
def transition_assignment(previous, new_state):
    if not validate_assignment(previous):
        raise ValueError("PREVIOUS_ASSIGNMENT_INVALID")
    if new_state not in ASSIGNMENT_STATES:
        raise ValueError("ASSIGNMENT_STATE")
    if new_state not in _ALLOWED_TRANSITIONS[previous["state"]]:
        raise ValueError("ASSIGNMENT_TRANSITION_FORBIDDEN")
    body = {
        **{k: deepcopy(v) for k, v in previous.items()
           if k not in {"assignment_id", "assignment_sha256", "assignment_version",
                        "predecessor_assignment_sha256", "state"}},
        "assignment_version": previous["assignment_version"] + 1,
        "predecessor_assignment_sha256": previous["assignment_sha256"],
        "state": new_state,
    }
    # restore deterministic schema-first ordering semantics via canonical hash only
    body["schema"] = "ekg-blinded-review-assignment-v1"
    assignment_sha = _digest(body)
    return {**body, "assignment_id": "rasg_" + assignment_sha[:24], "assignment_sha256": assignment_sha}


def validate_assignment(assignment):
    if not isinstance(assignment, dict) or assignment.get("schema") != "ekg-blinded-review-assignment-v1":
        return False
    try:
        allowed = {
            "schema", "assignment_key", "assignment_version",
            "predecessor_assignment_sha256", "review_package_id",
            "review_package_sha256", "reviewer", "state", "append_only",
            "silent_reassignment_allowed", "reviewer_labels_visible_before_submission",
            "clinical_gold", "assignment_id", "assignment_sha256",
        }
        if set(assignment) != allowed:
            return False
        _walk_safe(assignment, "$.assignment")
        material = deepcopy(assignment)
        declared = material.pop("assignment_sha256")
        assignment_id = material.pop("assignment_id")
        if _sha(declared, "ASSIGNMENT_SHA256") != _digest(material):
            return False
        if assignment_id != "rasg_" + declared[:24]:
            return False
        _opaque(assignment.get("assignment_key"), "ASSIGNMENT_KEY")
        _validate_reviewer_identity(assignment.get("reviewer"))
        if assignment.get("state") not in ASSIGNMENT_STATES:
            return False
        version = assignment.get("assignment_version")
        if not isinstance(version, int) or version < 1:
            return False
        predecessor = assignment.get("predecessor_assignment_sha256")
        if version == 1 and predecessor is not None:
            return False
        if version > 1:
            _sha(predecessor, "ASSIGNMENT_PREDECESSOR_SHA256")
        if assignment.get("append_only") is not True:
            return False
        if assignment.get("silent_reassignment_allowed") is not False:
            return False
        if assignment.get("reviewer_labels_visible_before_submission") is not False:
            return False
        if assignment.get("clinical_gold") is not False:
            return False
        return True
    except (ValueError, KeyError, TypeError):
        return False
def _validate_review_labels(labels):
    ids = {pattern["id"] for pattern in evaluation.registry()["patterns"]}
    if not isinstance(labels, dict) or not labels:
        raise ValueError("REVIEW_LABELS_EMPTY")
    out = {}
    for pattern_id, label in sorted(labels.items()):
        if pattern_id not in ids:
            raise ValueError("REVIEW_PATTERN_UNKNOWN")
        if label not in REVIEW_LABELS:
            raise ValueError("REVIEW_LABEL_STATE")
        out[pattern_id] = label
    return out


def _measurement_annotations(rows):
    if not isinstance(rows, list):
        raise ValueError("MEASUREMENT_ANNOTATIONS_ARRAY")
    output = []
    for row in rows:
        _walk_safe(row, "$.measurement_annotation")
        _required(row, {"metric", "value", "unit", "source_ref", "method"}, "MEASUREMENT_ANNOTATION_MISSING")
        allowed = {"metric", "value", "unit", "source_ref", "method"}
        extra = sorted(set(row) - allowed)
        if extra:
            raise ValueError("MEASUREMENT_ANNOTATION_FIELD:" + ",".join(extra))
        if not isinstance(row["metric"], str) or not row["metric"].strip():
            raise ValueError("MEASUREMENT_METRIC")
        if not isinstance(row["value"], (int, float)) or not math.isfinite(row["value"]):
            raise ValueError("MEASUREMENT_VALUE")
        if not isinstance(row["unit"], str) or not row["unit"].strip():
            raise ValueError("MEASUREMENT_UNIT")
        if not isinstance(row["source_ref"], str) or not row["source_ref"].strip():
            raise ValueError("MEASUREMENT_SOURCE_REF")
        if not isinstance(row["method"], str) or not row["method"].strip():
            raise ValueError("MEASUREMENT_METHOD")
        output.append(deepcopy(row))
    return sorted(output, key=lambda row: _canonical(row))


def create_reviewer_submission(*, assignment, pattern_labels, measurement_annotations=None):
    if not validate_assignment(assignment):
        raise ValueError("ASSIGNMENT_INVALID")
    if assignment["state"] != "SUBMITTED":
        raise ValueError("ASSIGNMENT_NOT_SUBMITTED")
    labels = _validate_review_labels(pattern_labels)
    measurements = _measurement_annotations(measurement_annotations or [])
    body = {
        "schema": "ekg-blinded-review-submission-v1",
        "assignment_id": assignment["assignment_id"],
        "assignment_sha256": assignment["assignment_sha256"],
        "review_package_id": assignment["review_package_id"],
        "review_package_sha256": assignment["review_package_sha256"],
        "reviewer": deepcopy(assignment["reviewer"]),
        "registry_binding": evaluation.registry_binding(),
        "pattern_labels": labels,
        "measurement_annotations": measurements,
        "submitted_state": "UNADJUDICATED",
        "clinical_gold": False,
        "approved_adjudicated_gold": False,
        "diagnostic_truth": False,
        "authority_effect": "NONE",
        "reviewer_blinded": True,
    }
    # diagnostic_truth is intentionally a boolean invariant, not a label.
    submission_sha = _digest(body)
    return {**body, "submission_id": "rsub_" + submission_sha[:24], "submission_sha256": submission_sha}
def validate_submission(submission):
    if not isinstance(submission, dict) or submission.get("schema") != "ekg-blinded-review-submission-v1":
        return False
    try:
        # diagnostic_truth is a fixed invariant field and intentionally exempted
        # from generic forbidden-field input scanning.
        allowed = {
            "schema", "assignment_id", "assignment_sha256",
            "review_package_id", "review_package_sha256", "reviewer",
            "registry_binding", "pattern_labels", "measurement_annotations",
            "submitted_state", "clinical_gold", "approved_adjudicated_gold",
            "diagnostic_truth", "authority_effect", "reviewer_blinded",
            "submission_id", "submission_sha256",
        }
        if set(submission) != allowed:
            return False
        material = deepcopy(submission)
        declared = material.pop("submission_sha256")
        submission_id = material.pop("submission_id")
        if _sha(declared, "SUBMISSION_SHA256") != _digest(material):
            return False
        if submission_id != "rsub_" + declared[:24]:
            return False
        if submission.get("registry_binding") != evaluation.registry_binding():
            return False
        _validate_reviewer_identity(submission.get("reviewer"))
        _sha(submission.get("assignment_sha256"), "SUBMISSION_ASSIGNMENT_SHA256")
        _sha(submission.get("review_package_sha256"), "SUBMISSION_PACKAGE_SHA256")
        _validate_review_labels(submission.get("pattern_labels"))
        _measurement_annotations(submission.get("measurement_annotations", []))
        if submission.get("submitted_state") != "UNADJUDICATED":
            return False
        if submission.get("clinical_gold") is not False:
            return False
        if submission.get("approved_adjudicated_gold") is not False:
            return False
        if submission.get("diagnostic_truth") is not False:
            return False
        if submission.get("authority_effect") != "NONE":
            return False
        if submission.get("reviewer_blinded") is not True:
            return False
        return True
    except (ValueError, KeyError, TypeError):
        return False


def compare_submissions(submissions):
    if not isinstance(submissions, list) or len(submissions) < 2:
        raise ValueError("DUAL_SUBMISSIONS_REQUIRED")
    if any(not validate_submission(item) for item in submissions):
        raise ValueError("SUBMISSION_INVALID")
    validate_reviewer_independence([item["reviewer"] for item in submissions])
    package_ids = {item["review_package_id"] for item in submissions}
    package_hashes = {item["review_package_sha256"] for item in submissions}
    if len(package_ids) != 1 or len(package_hashes) != 1:
        raise ValueError("SUBMISSIONS_PACKAGE_MISMATCH")
    pattern_ids = sorted(set().union(*(item["pattern_labels"].keys() for item in submissions)))
    rows = []
    for pattern_id in pattern_ids:
        values = [item["pattern_labels"].get(pattern_id, "ABSTAIN") for item in submissions]
        state = "CONCORDANT" if len(set(values)) == 1 else "DISAGREEING"
        rows.append({"pattern_id": pattern_id, "reviewer_labels": values, "state": state})
    overall = "CONCORDANT" if rows and all(row["state"] == "CONCORDANT" for row in rows) else "DISAGREEING"
    return {
        "schema": "ekg-blinded-review-comparison-v1",
        "state": overall,
        "rows": rows,
        "final_label_selected": False,
        "clinical_gold_created": False,
        "automatic_resolution": False,
    }
def create_adjudication_handoff(*, review_package, assignments, submissions):
    if not validate_review_package(review_package):
        raise ValueError("REVIEW_PACKAGE_INVALID")
    if review_package["blinding_state"] != "BLINDED_VERIFIED":
        raise ValueError("ADJUDICATION_HANDOFF_BLINDING_BLOCKED")
    if review_package["eligibility"].get("source_eligible") is not True:
        raise ValueError("ADJUDICATION_HANDOFF_ELIGIBILITY_BLOCKED")
    if review_package["eligibility"].get("adjudication_handoff_allowed") is not True:
        raise ValueError("ADJUDICATION_HANDOFF_REVIEW_INCOMPLETE")
    if not isinstance(assignments, list) or len(assignments) < 2:
        raise ValueError("DUAL_ASSIGNMENTS_REQUIRED")
    if any(not validate_assignment(item) for item in assignments):
        raise ValueError("ASSIGNMENT_INVALID")
    if any(item["state"] != "SUBMITTED" for item in assignments):
        raise ValueError("ASSIGNMENTS_NOT_TERMINAL_SUBMITTED")
    if any(item["review_package_sha256"] != review_package["review_package_sha256"] for item in assignments):
        raise ValueError("ASSIGNMENT_PACKAGE_MISMATCH")
    if not isinstance(submissions, list) or len(submissions) < 2:
        raise ValueError("DUAL_SUBMISSIONS_REQUIRED")
    comparison = compare_submissions(submissions)
    assignment_hashes = {item["assignment_sha256"] for item in assignments}
    if any(item["assignment_sha256"] not in assignment_hashes for item in submissions):
        raise ValueError("SUBMISSION_ASSIGNMENT_MISMATCH")
    reviewers = [item["reviewer"] for item in assignments]
    validate_reviewer_independence(reviewers)
    body = {
        "schema": "ekg-blinded-review-adjudication-handoff-v1",
        "review_package_id": review_package["review_package_id"],
        "review_package_sha256": review_package["review_package_sha256"],
        "assignment_refs": sorted(
            [{"assignment_id": item["assignment_id"], "assignment_sha256": item["assignment_sha256"]} for item in assignments],
            key=lambda row: row["assignment_id"],
        ),
        "submission_refs": sorted(
            [{"submission_id": item["submission_id"], "submission_sha256": item["submission_sha256"]} for item in submissions],
            key=lambda row: row["submission_id"],
        ),
        "comparison": comparison,
        "registry_binding": evaluation.registry_binding(),
        "handoff_state": "READY_FOR_SEPARATE_ADJUDICATION",
        "rationale_required_for_final_adjudication": True,
        "final_adjudication_performed": False,
        "final_pattern_labels": None,
        "clinical_gold_admitted": False,
        "approved_adjudicated_gold_count": 0,
        "diagnostic_runtime_activation_allowed": False,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "candidate_active": False,
        "authority_effect": "NONE",
    }
    handoff_sha = _digest(body)
    return {**body, "handoff_id": "rah_" + handoff_sha[:24], "handoff_sha256": handoff_sha}


def release_contract():
    return {
        "schema": "ekg-ep3-pkt04-blinded-review-release-contract-v1",
        "packet": "PKT-EP3-04",
        "theme": "Blinded review workflow contracts",
        "repository": status.REPOSITORY,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "accepted_prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "reviewer_submissions_are_unadjudicated": True,
        "reviewer_submissions_are_clinical_gold": False,
        "final_adjudication_performed": False,
        "clinical_gold_admission_performed": False,
        "candidate_active": False,
        "approved_adjudicated_gold_count": 0,
        "diagnostic_runtime_activation_allowed": False,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "raw_clinical_waveform_or_image_bytes_included": False,
        "authority_rewritten": False,
        "silent_fallback_allowed": False,
        "independent_machine_verification_required": True,
        "github_ci_required": True,
    }
