"""EP3 Packet 6 evaluation/adjudication dataset contracts.

Deterministic, provenance-bound contracts for human adjudication and
evaluation-dataset assembly. No labels are invented and no runtime activation
or performance reporting is authorized by this module.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy

import candidate_control_reconciliation as candidate_control
import evaluation_engine as evaluation
import system_status_adapter as status

SCHEMA = "ekg-ep3-pkt06-adjudication-dataset-v1"
BASELINE_COMMIT = "047adf472ab76430ed683d6ae0b41154fbd13885"
BASELINE_TREE = "7795590c2fd1714c726b3806d807b6ffb7e8b0d7"
STAGE1_RECEIPT_SHA256 = "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb"
PRIOR_PACKET_RECEIPT_SHA256 = "46a40cdb1095a6f401c3611abc4628986f44d682130db2c7f0449610f7b80895"

CASE_STATES = {"PENDING_HUMAN_ADJUDICATION", "FINAL_HUMAN_ADJUDICATED", "INELIGIBLE", "BLOCKED"}
SOURCE_STATES = {"ELIGIBLE", "INELIGIBLE", "UNKNOWN", "CONFLICT"}
PARTITIONS = set(evaluation.SPLITS)
FINAL_LABELS = set(evaluation.LABELS)
OPAQUE_CHARS = set("abcdefghijklmnopqrstuvwxyz0123456789._:-")
RAW_KEYS = {
    "raw_waveform", "waveform", "waveform_bytes", "ecg_bytes", "samples",
    "sample_values", "raw_image", "image_bytes", "pixels", "raw_payload",
    "clinical_payload", "source_contents", "document_contents",
}
SECRET_KEYS = {"password", "passwd", "secret", "api_key", "token", "credential", "credentials"}
DIRECT_ID_KEYS = {
    "patient_name", "full_name", "first_name", "last_name", "dob",
    "date_of_birth", "mrn", "medical_record_number", "ssn", "email", "phone",
}
UNTRUSTED_GOLD_SOURCES = {
    "NATIVE_DATASET_ANNOTATION", "OCR_TEXT", "EMBEDDED_LABEL",
    "MACHINE_INTERPRETATION", "PRIOR_REVIEWER_LABEL", "SYNTHETIC_FIXTURE",
}


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
    return value


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
        for i, item in enumerate(value):
            _safe(item, f"{path}[{i}]")
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        lowered = str(key).lower()
        if lowered in RAW_KEYS:
            raise ValueError("RAW_CLINICAL_PAYLOAD_FORBIDDEN:" + path + "." + str(key))
        if lowered in SECRET_KEYS:
            raise ValueError("SECRET_FIELD_FORBIDDEN:" + path + "." + str(key))
        if lowered in DIRECT_ID_KEYS:
            raise ValueError("DIRECT_IDENTIFIER_FORBIDDEN:" + path + "." + str(key))
        _safe(item, path + "." + str(key))


def _registry_binding(value=None):
    expected = evaluation.registry_binding()
    if value is not None and value != expected:
        raise ValueError("REGISTRY_BINDING_STALE_OR_UNKNOWN")
    return deepcopy(expected)


def _validate_label_map(labels):
    ids = {p["id"] for p in evaluation.registry()["patterns"]}
    if not isinstance(labels, dict) or not labels:
        raise ValueError("FINAL_PATTERN_LABELS_REQUIRED")
    clean = {}
    for pattern_id, label in sorted(labels.items()):
        if pattern_id not in ids:
            raise ValueError("FINAL_PATTERN_LABEL_UNKNOWN")
        if label not in FINAL_LABELS:
            raise ValueError("FINAL_PATTERN_LABEL_STATE")
        clean[pattern_id] = label
    return clean


def adjudicator_descriptor(*, actor_id, principal_sha256, session_id):
    body = {
        "actor_id": _opaque(actor_id, "ADJUDICATOR_ACTOR_ID"),
        "principal_sha256": _sha(principal_sha256, "ADJUDICATOR_PRINCIPAL_SHA256"),
        "session_id": _opaque(session_id, "ADJUDICATOR_SESSION_ID"),
        "role": "HUMAN_ADJUDICATOR",
        "clinical_gold_authority": False,
        "diagnostic_runtime_authority": False,
    }
    body["descriptor_sha256"] = _digest(body)
    return body


def review_submission_ref(*, submission_id, submission_sha256, reviewer_actor_id,
                          reviewer_principal_sha256, reviewer_session_id,
                          blinded=True, review_state="CLEAN"):
    if blinded is not True:
        raise ValueError("REVIEW_NOT_BLINDED")
    if review_state not in {"CLEAN", "CONTAMINATED", "UNVERIFIABLE", "INCOMPLETE"}:
        raise ValueError("REVIEW_STATE")
    body = {
        "submission_id": _opaque(submission_id, "SUBMISSION_ID"),
        "submission_sha256": _sha(submission_sha256, "SUBMISSION_SHA256"),
        "reviewer_actor_id": _opaque(reviewer_actor_id, "REVIEWER_ACTOR_ID"),
        "reviewer_principal_sha256": _sha(reviewer_principal_sha256, "REVIEWER_PRINCIPAL_SHA256"),
        "reviewer_session_id": _opaque(reviewer_session_id, "REVIEWER_SESSION_ID"),
        "blinded": True,
        "review_state": review_state,
        "clinical_gold": False,
        "adjudicated": False,
    }
    body["ref_sha256"] = _digest(body)
    return body


def source_eligibility(*, source_artifact_sha256, tracing_identity_sha256,
                       rights_status, usage_status, privacy_status,
                       source_identity_state="ELIGIBLE",
                       native_dataset_annotation_as_gold=False,
                       synthetic_fixture=False):
    _safe({
        "rights_status": rights_status,
        "usage_status": usage_status,
        "privacy_status": privacy_status,
    })
    if source_identity_state not in SOURCE_STATES:
        raise ValueError("SOURCE_IDENTITY_STATE")
    if native_dataset_annotation_as_gold is not False:
        raise ValueError("NATIVE_DATASET_LABEL_CANNOT_BE_PROJECT_GOLD")
    eligible = (
        synthetic_fixture is False
        and source_identity_state == "ELIGIBLE"
        and rights_status == "APPROVED_FOR_EVALUATION"
        and usage_status == "AUTHORIZED"
        and privacy_status == "CLEARED_NON_SENSITIVE"
    )
    body = {
        "source_artifact_sha256": _sha(source_artifact_sha256, "SOURCE_ARTIFACT_SHA256"),
        "tracing_identity_sha256": _sha(tracing_identity_sha256, "TRACING_IDENTITY_SHA256"),
        "rights_status": rights_status,
        "usage_status": usage_status,
        "privacy_status": privacy_status,
        "source_identity_state": source_identity_state,
        "native_dataset_annotation_as_gold": False,
        "synthetic_fixture": bool(synthetic_fixture),
        "eligible_for_adjudication": eligible,
    }
    body["eligibility_sha256"] = _digest(body)
    return body


def _validate_submission_refs(refs):
    if not isinstance(refs, list) or len(refs) < 2:
        raise ValueError("DUAL_REVIEW_SUBMISSIONS_REQUIRED")
    clean = []
    actors, principals, sessions, submissions = set(), set(), set(), set()
    for ref in refs:
        expected = review_submission_ref(
            submission_id=ref["submission_id"],
            submission_sha256=ref["submission_sha256"],
            reviewer_actor_id=ref["reviewer_actor_id"],
            reviewer_principal_sha256=ref["reviewer_principal_sha256"],
            reviewer_session_id=ref["reviewer_session_id"],
            blinded=ref["blinded"],
            review_state=ref["review_state"],
        )
        if ref != expected:
            raise ValueError("REVIEW_SUBMISSION_REF_INTEGRITY")
        if expected["review_state"] != "CLEAN":
            raise ValueError("REVIEW_SUBMISSION_NOT_CLEAN")
        if expected["reviewer_actor_id"] in actors:
            raise ValueError("REVIEWER_ACTOR_NOT_INDEPENDENT")
        if expected["reviewer_principal_sha256"] in principals:
            raise ValueError("REVIEWER_PRINCIPAL_NOT_INDEPENDENT")
        if expected["reviewer_session_id"] in sessions:
            raise ValueError("REVIEWER_SESSION_NOT_INDEPENDENT")
        if expected["submission_id"] in submissions:
            raise ValueError("DUPLICATE_SUBMISSION")
        actors.add(expected["reviewer_actor_id"])
        principals.add(expected["reviewer_principal_sha256"])
        sessions.add(expected["reviewer_session_id"])
        submissions.add(expected["submission_id"])
        clean.append(expected)
    return sorted(clean, key=lambda x: (x["submission_id"], x["submission_sha256"]))


def create_adjudication_case(*, case_key, source, review_submissions,
                             candidate_reconciliation_sha256,
                             state="PENDING_HUMAN_ADJUDICATION",
                             final_adjudicator=None, final_pattern_labels=None,
                             rationale=None, measurement_ground_truth_refs=None,
                             predecessor_case_sha256=None, case_version=1):
    _opaque(case_key, "CASE_KEY")
    if state not in CASE_STATES:
        raise ValueError("ADJUDICATION_CASE_STATE")
    if not isinstance(source, dict):
        raise ValueError("SOURCE_ELIGIBILITY_REQUIRED")
    expected_source = source_eligibility(
        source_artifact_sha256=source["source_artifact_sha256"],
        tracing_identity_sha256=source["tracing_identity_sha256"],
        rights_status=source["rights_status"],
        usage_status=source["usage_status"],
        privacy_status=source["privacy_status"],
        source_identity_state=source["source_identity_state"],
        native_dataset_annotation_as_gold=source["native_dataset_annotation_as_gold"],
        synthetic_fixture=source["synthetic_fixture"],
    )
    if source != expected_source:
        raise ValueError("SOURCE_ELIGIBILITY_INTEGRITY")
    submissions = _validate_submission_refs(review_submissions)
    _sha(candidate_reconciliation_sha256, "CANDIDATE_RECONCILIATION_SHA256")
    if not isinstance(case_version, int) or case_version < 1:
        raise ValueError("CASE_VERSION")
    if case_version == 1:
        if predecessor_case_sha256 is not None:
            raise ValueError("ROOT_CASE_PREDECESSOR_FORBIDDEN")
    else:
        _sha(predecessor_case_sha256, "PREDECESSOR_CASE_SHA256")
    measurements = sorted(set(measurement_ground_truth_refs or []))
    for ref in measurements:
        _sha(ref, "MEASUREMENT_GROUND_TRUTH_REF_SHA256")
    final = None
    if state == "FINAL_HUMAN_ADJUDICATED":
        if final_adjudicator is None or final_pattern_labels is None:
            raise ValueError("FINAL_HUMAN_ADJUDICATION_REQUIRED")
        adj = adjudicator_descriptor(
            actor_id=final_adjudicator["actor_id"],
            principal_sha256=final_adjudicator["principal_sha256"],
            session_id=final_adjudicator["session_id"],
        )
        if final_adjudicator != adj:
            raise ValueError("ADJUDICATOR_DESCRIPTOR_INTEGRITY")
        labels = _validate_label_map(final_pattern_labels)
        if not isinstance(rationale, str) or not rationale.strip() or len(rationale) > 2000:
            raise ValueError("ADJUDICATION_RATIONALE_REQUIRED")
        final = {
            "adjudicator": adj,
            "pattern_labels": labels,
            "rationale": rationale.strip(),
            "human_adjudicated": True,
            "automatic_adjudication": False,
            "machine_label_used_as_truth": False,
        }
    elif any(x is not None for x in (final_adjudicator, final_pattern_labels, rationale)):
        raise ValueError("FINAL_FIELDS_FOR_NONFINAL_CASE")
    body = {
        "schema": SCHEMA,
        "case_key": case_key,
        "case_version": case_version,
        "predecessor_case_sha256": predecessor_case_sha256,
        "state": state,
        "source": deepcopy(source),
        "review_submissions": submissions,
        "candidate_reconciliation_sha256": candidate_reconciliation_sha256,
        "registry_binding": _registry_binding(),
        "measurement_ground_truth_refs": measurements,
        "final_adjudication": final,
        "repository_binding": {
            "repository": status.REPOSITORY,
            "commit": BASELINE_COMMIT,
            "tree": BASELINE_TREE,
        },
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "clinical_gold": False,
        "clinical_gold_admission_performed": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "candidate_active": False,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "raw_clinical_payload_included": False,
        "authority_rewritten": False,
        "silent_fallback_allowed": False,
    }
    _safe(body)
    case_sha = _digest(body)
    return {**body, "case_id": "adjcase_" + case_sha[:24], "case_sha256": case_sha}


def validate_adjudication_case(value):
    if not isinstance(value, dict) or value.get("schema") != SCHEMA:
        return False
    try:
        copy = deepcopy(value)
        case_sha = copy.pop("case_sha256")
        case_id = copy.pop("case_id")
        if _sha(case_sha, "CASE_SHA256") != _digest(copy):
            return False
        if case_id != "adjcase_" + case_sha[:24]:
            return False
        final = value["final_adjudication"]
        rebuilt = create_adjudication_case(
            case_key=value["case_key"],
            source=value["source"],
            review_submissions=value["review_submissions"],
            candidate_reconciliation_sha256=value["candidate_reconciliation_sha256"],
            state=value["state"],
            final_adjudicator=(final or {}).get("adjudicator"),
            final_pattern_labels=(final or {}).get("pattern_labels"),
            rationale=(final or {}).get("rationale"),
            measurement_ground_truth_refs=value["measurement_ground_truth_refs"],
            predecessor_case_sha256=value["predecessor_case_sha256"],
            case_version=value["case_version"],
        )
        return rebuilt == value
    except (KeyError, TypeError, ValueError):
        return False


def create_case_successor(previous, **changes):
    if not validate_adjudication_case(previous):
        raise ValueError("PREVIOUS_ADJUDICATION_CASE_INVALID")
    source = changes.pop("source", previous["source"])
    reviews = changes.pop("review_submissions", previous["review_submissions"])
    candidate_sha = changes.pop(
        "candidate_reconciliation_sha256",
        previous["candidate_reconciliation_sha256"],
    )
    state = changes.pop("state", previous["state"])
    if changes:
        final_adjudicator = changes.pop("final_adjudicator", None)
    else:
        final_adjudicator = None
    final_labels = changes.pop("final_pattern_labels", None)
    rationale = changes.pop("rationale", None)
    measurements = changes.pop(
        "measurement_ground_truth_refs",
        previous["measurement_ground_truth_refs"],
    )
    if changes:
        raise ValueError("CASE_SUCCESSOR_FIELD_FORBIDDEN")
    return create_adjudication_case(
        case_key=previous["case_key"],
        source=source,
        review_submissions=reviews,
        candidate_reconciliation_sha256=candidate_sha,
        state=state,
        final_adjudicator=final_adjudicator,
        final_pattern_labels=final_labels,
        rationale=rationale,
        measurement_ground_truth_refs=measurements,
        predecessor_case_sha256=previous["case_sha256"],
        case_version=previous["case_version"] + 1,
    )


def gold_admission_contract(case):
    if not validate_adjudication_case(case):
        raise ValueError("ADJUDICATION_CASE_INVALID")
    ready = (
        case["state"] == "FINAL_HUMAN_ADJUDICATED"
        and case["source"]["eligible_for_adjudication"] is True
        and case["final_adjudication"] is not None
        and all(x["review_state"] == "CLEAN" for x in case["review_submissions"])
    )
    state = "ADMISSION_READY" if ready else "NOT_ADMISSION_READY"
    body = {
        "schema": "ekg-ep3-pkt06-gold-admission-contract-v1",
        "case_id": case["case_id"],
        "case_sha256": case["case_sha256"],
        "state": state,
        "all_eligibility_gates_satisfied": ready,
        "governed_admission_receipt_required": True,
        "clinical_gold": False,
        "clinical_gold_admission_performed": False,
        "approved_adjudicated_gold_count_delta": 0,
        "native_dataset_annotations_can_satisfy_admission": False,
        "ocr_or_machine_labels_can_satisfy_admission": False,
        "synthetic_fixture_can_satisfy_admission": False,
        "automatic_adjudication_allowed": False,
        "diagnostic_runtime_activation_allowed": False,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
    }
    return {**body, "contract_sha256": _digest(body)}


def admitted_case_ref(*, case_id, case_version, case_sha256,
                      admission_receipt_sha256, partition,
                      case_family_id, subject_group_id):
    _opaque(case_id, "ADMITTED_CASE_ID")
    _sha(case_sha256, "ADMITTED_CASE_SHA256")
    _sha(admission_receipt_sha256, "ADMISSION_RECEIPT_SHA256")
    if not isinstance(case_version, int) or case_version < 1:
        raise ValueError("ADMITTED_CASE_VERSION")
    if partition not in PARTITIONS:
        raise ValueError("DATASET_PARTITION")
    body = {
        "case_id": case_id,
        "case_version": case_version,
        "case_sha256": case_sha256,
        "admission_receipt_sha256": admission_receipt_sha256,
        "partition": partition,
        "case_family_id": _opaque(case_family_id, "CASE_FAMILY_ID"),
        "subject_group_id": _opaque(subject_group_id, "SUBJECT_GROUP_ID"),
        "clinical_gold": True,
        "human_adjudicated": True,
        "governed_admission_receipt_verified": True,
    }
    body["ref_sha256"] = _digest(body)
    return body


def evaluation_dataset_manifest(*, dataset_key, admitted_case_refs=None,
                                exclusions=None, dataset_version=1,
                                predecessor_manifest_sha256=None):
    _opaque(dataset_key, "DATASET_KEY")
    if not isinstance(dataset_version, int) or dataset_version < 1:
        raise ValueError("DATASET_VERSION")
    if dataset_version == 1:
        if predecessor_manifest_sha256 is not None:
            raise ValueError("ROOT_DATASET_PREDECESSOR_FORBIDDEN")
    else:
        _sha(predecessor_manifest_sha256, "PREDECESSOR_MANIFEST_SHA256")
    refs = []
    seen_case_versions = set()
    subject_splits = {}
    family_splits = {}
    for ref in admitted_case_refs or []:
        expected = admitted_case_ref(
            case_id=ref["case_id"],
            case_version=ref["case_version"],
            case_sha256=ref["case_sha256"],
            admission_receipt_sha256=ref["admission_receipt_sha256"],
            partition=ref["partition"],
            case_family_id=ref["case_family_id"],
            subject_group_id=ref["subject_group_id"],
        )
        if ref != expected:
            raise ValueError("ADMITTED_CASE_REF_INTEGRITY")
        key = (ref["case_id"], ref["case_version"])
        if key in seen_case_versions:
            raise ValueError("DUPLICATE_CASE_VERSION")
        seen_case_versions.add(key)
        prior = subject_splits.get(ref["subject_group_id"])
        if prior is not None and prior != ref["partition"]:
            raise ValueError("SUBJECT_OR_SERIAL_SPLIT_LEAKAGE")
        subject_splits[ref["subject_group_id"]] = ref["partition"]
        family_prior = family_splits.get(ref["case_family_id"])
        if family_prior is not None and family_prior != ref["partition"]:
            raise ValueError("CASE_FAMILY_SPLIT_LEAKAGE")
        family_splits[ref["case_family_id"]] = ref["partition"]
        refs.append(expected)
    refs.sort(key=lambda x: (x["partition"], x["case_id"], x["case_version"]))
    ex = sorted(set(exclusions or []))
    if any(not isinstance(x, str) or not x or len(x) > 160 for x in ex):
        raise ValueError("DATASET_EXCLUSIONS")
    body = {
        "schema": "ekg-ep3-pkt06-evaluation-dataset-manifest-v1",
        "dataset_key": dataset_key,
        "dataset_version": dataset_version,
        "predecessor_manifest_sha256": predecessor_manifest_sha256,
        "registry_binding": _registry_binding(),
        "admitted_case_refs": refs,
        "exclusions": ex,
        "approved_adjudicated_gold_count": len(refs),
        "raw_clinical_payload_included": False,
        "phi_included": False,
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "diagnostic_runtime_activation_allowed": False,
        "clinical_accuracy_claimed": False,
    }
    manifest_sha = _digest(body)
    return {
        **body,
        "manifest_id": "evalds_" + manifest_sha[:24],
        "manifest_sha256": manifest_sha,
    }


def validate_dataset_manifest(value):
    if not isinstance(value, dict):
        return False
    try:
        copy = deepcopy(value)
        manifest_sha = copy.pop("manifest_sha256")
        manifest_id = copy.pop("manifest_id")
        if _sha(manifest_sha, "MANIFEST_SHA256") != _digest(copy):
            return False
        if manifest_id != "evalds_" + manifest_sha[:24]:
            return False
        rebuilt = evaluation_dataset_manifest(
            dataset_key=value["dataset_key"],
            admitted_case_refs=value["admitted_case_refs"],
            exclusions=value["exclusions"],
            dataset_version=value["dataset_version"],
            predecessor_manifest_sha256=value["predecessor_manifest_sha256"],
        )
        return rebuilt == value
    except (KeyError, TypeError, ValueError):
        return False


def prediction_binding(*, case_id, case_version, dataset_manifest_sha256,
                       candidate_reconciliation_sha256, configuration_sha256,
                       engine_commit=BASELINE_COMMIT,
                       engine_tree=BASELINE_TREE):
    body = {
        "schema": "ekg-ep3-pkt06-prediction-binding-v1",
        "case_id": _opaque(case_id, "PREDICTION_CASE_ID"),
        "case_version": case_version,
        "dataset_manifest_sha256": _sha(
            dataset_manifest_sha256,
            "DATASET_MANIFEST_SHA256",
        ),
        "candidate_reconciliation_sha256": _sha(
            candidate_reconciliation_sha256,
            "CANDIDATE_RECONCILIATION_SHA256",
        ),
        "configuration_sha256": _sha(
            configuration_sha256,
            "CANDIDATE_CONFIGURATION_SHA256",
        ),
        "engine_commit": _sha(engine_commit, "ENGINE_COMMIT", length=40),
        "engine_tree": _sha(engine_tree, "ENGINE_TREE", length=40),
        "registry_binding": _registry_binding(),
        "clinical_accuracy_claimed": False,
        "diagnostic_runtime_activation_allowed": False,
    }
    if not isinstance(case_version, int) or case_version < 1:
        raise ValueError("PREDICTION_CASE_VERSION")
    body["binding_sha256"] = _digest(body)
    return body


def current_zero_gold_state():
    gate = evaluation.performance_gate([])
    if gate["approved_adjudicated_gold_count"] != 0:
        raise ValueError("ZERO_GOLD_STATE_CHANGED")
    return {
        "approved_adjudicated_gold_count": 0,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_promotion_allowed": False,
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
    }


def release_contract():
    state = current_zero_gold_state()
    return {
        "schema": "ekg-ep3-pkt06-adjudication-dataset-release-contract-v1",
        "packet_id": "PKT-EP3-06",
        "theme": "Evaluation/adjudication dataset contracts",
        "repository": status.REPOSITORY,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "accepted_prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        **state,
        "clinical_gold_admission_performed": False,
        "diagnostic_runtime_activation_allowed": False,
        "clinical_accuracy_claimed": False,
        "native_dataset_annotations_are_project_gold": False,
        "machine_interpretations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "raw_clinical_waveform_or_image_bytes_included": False,
        "authority_rewritten": False,
        "silent_fallback_allowed": False,
        "independent_machine_verification_required": True,
        "github_ci_required": True,
    }
