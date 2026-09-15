"""EP3 Packet 1 system-facing EKG status/quarantine adapter.

Metadata and engineering governance only. This module never stores raw ECG bytes,
performs diagnostic interpretation, or activates the quarantined candidate.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy

import evaluation_engine as evaluation
import pattern_candidate_engine as patterns

SCHEMA = "ekg-ep3-system-status-v1"
REPOSITORY = "Cardiology-NP-OS/EKG-Interpretations"
ACCEPTED_COMMIT = "3d04986dcce2b20ed19a226e6596002878f8f031"
ACCEPTED_TREE = "245ebbe924befaf2a9ca510c59551554a2305baf"
ACCEPTED_EVALUATION_CANDIDATE_COMMIT = "3aad1e1e750afb0567fb2824db841971a86b9b83"
STAGE1_ACCEPTANCE_RECEIPT_SHA256 = "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb"
SOURCE_REGISTRY_SHA256 = "c1d9d116755931487a9b5434832aa2827763bf7ef772449963588da20b20b89e"
PATTERN_REGISTRY_SHA256 = "05764e9437862f6c4f1948c6f0385abb320764c4cb0f2007ce7c426df7d31fdb"

STATUS_STATES = {"GOVERNED_INACTIVE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"}
SOURCE_STATES = {"AVAILABLE", "UNAVAILABLE", "UNKNOWN"}
EVIDENCE_STATES = {"AVAILABLE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"}
REF_KINDS = {"SOURCE_VERIFICATION", "SOURCE_INSPECTION", "WAVEFORM_QC", "CANDIDATE_CONTROL", "EVALUATION"}
PHI_KEYS = {
    "patient_name", "person_name", "first_name", "last_name", "dob", "date_of_birth",
    "mrn", "ssn", "address", "phone", "email",
}
SECRET_KEYS = {"password", "secret", "token", "api_key", "apikey", "credential", "credentials"}
RAW_PAYLOAD_KEYS = {"raw_source_bytes", "waveform_bytes", "ecg_bytes", "signal_bytes", "raw_ecg"}

def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

def _digest(value):
    return hashlib.sha256(_canonical(value)).hexdigest()

def _sha64(value, code):
    if not isinstance(value, str) or len(value) != 64:
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
        if lowered in PHI_KEYS:
            raise ValueError("DIRECT_IDENTIFIER_FORBIDDEN:" + path + "." + str(key))
        if lowered in SECRET_KEYS:
            raise ValueError("SECRET_MATERIAL_FORBIDDEN:" + path + "." + str(key))
        if lowered in RAW_PAYLOAD_KEYS:
            raise ValueError("RAW_CLINICAL_PAYLOAD_FORBIDDEN:" + path + "." + str(key))
        _walk_safe(item, path + "." + str(key))
def accepted_authority():
    return {
        "repository": REPOSITORY,
        "commit": ACCEPTED_COMMIT,
        "tree": ACCEPTED_TREE,
        "accepted_evaluation_candidate_commit": ACCEPTED_EVALUATION_CANDIDATE_COMMIT,
        "stage1_acceptance_receipt_sha256": STAGE1_ACCEPTANCE_RECEIPT_SHA256,
        "registry_binding": evaluation.registry_binding(),
        "source_registry_sha256": SOURCE_REGISTRY_SHA256,
    }

def current_substrate_state():
    candidate = patterns.aggregate_candidates([])
    performance = evaluation.performance_gate([])
    if candidate["candidate_active"] is not False:
        raise ValueError("CANDIDATE_SUBSTRATE_ACTIVE")
    if candidate["clinical_accuracy_claimed"] is not False:
        raise ValueError("CANDIDATE_SUBSTRATE_ACCURACY_CLAIM")
    if candidate["automatic_selection_allowed"] is not False:
        raise ValueError("CANDIDATE_SUBSTRATE_AUTOMATIC_SELECTION")
    if performance["approved_adjudicated_gold_count"] != 0:
        raise ValueError("STAGE1_GOLD_COUNT_CHANGED")
    if performance["diagnostic_performance_reporting_allowed"] is not False:
        raise ValueError("STAGE1_DIAGNOSTIC_REPORTING_GATE_CHANGED")
    return {
        "candidate_active": False,
        "clinical_accuracy_claimed": False,
        "automatic_selection_allowed": False,
        "runtime_status": "GOVERNED_INACTIVE",
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "approved_adjudicated_gold_count": 0,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_promotion_allowed": False,
    }

def evidence_ref(ref_id, kind, artifact_sha256):
    if not str(ref_id).strip():
        raise ValueError("EVIDENCE_REF_ID_REQUIRED")
    if kind not in REF_KINDS:
        raise ValueError("EVIDENCE_REF_KIND")
    return {
        "ref_id": str(ref_id),
        "kind": kind,
        "artifact_sha256": _sha64(artifact_sha256, "EVIDENCE_REF_SHA256"),
    }
def _validate_refs(refs):
    if not isinstance(refs, list):
        raise ValueError("EVIDENCE_REFS_SHAPE")
    seen = set()
    validated = []
    for ref in refs:
        _required(ref, {"ref_id", "kind", "artifact_sha256"}, "EVIDENCE_REF_MISSING")
        _walk_safe(ref)
        if not str(ref["ref_id"]).strip():
            raise ValueError("EVIDENCE_REF_ID_REQUIRED")
        if ref["kind"] not in REF_KINDS:
            raise ValueError("EVIDENCE_REF_KIND")
        _sha64(ref["artifact_sha256"], "EVIDENCE_REF_SHA256")
        if ref["ref_id"] in seen:
            raise ValueError("EVIDENCE_REF_DUPLICATE")
        seen.add(ref["ref_id"])
        validated.append(deepcopy(ref))
    return validated

def _shape(snapshot):
    _required(snapshot, {
        "repository_binding", "source", "inspection", "waveform_qc",
        "candidate_control", "evaluation",
    }, "STATUS_SNAPSHOT_MISSING")
    _walk_safe(snapshot)
    binding = snapshot["repository_binding"]
    _required(binding, {
        "repository", "commit", "tree", "stage1_acceptance_receipt_sha256",
        "registry_binding", "source_registry_sha256",
    }, "REPOSITORY_BINDING_MISSING")
    source = snapshot["source"]
    _required(source, {
        "source_id", "source_sha256", "state", "raw_source_available",
        "raw_source_in_git", "source_verified", "evidence_refs",
    }, "SOURCE_STATUS_MISSING")
    if not str(source["source_id"]).strip():
        raise ValueError("SOURCE_ID_REQUIRED")
    _sha64(source["source_sha256"], "SOURCE_SHA256")
    if source["state"] not in SOURCE_STATES:
        raise ValueError("SOURCE_STATE")
    if not isinstance(source["raw_source_available"], bool) or not isinstance(source["raw_source_in_git"], bool):
        raise ValueError("SOURCE_AVAILABILITY_TYPE")
    if not isinstance(source["source_verified"], bool):
        raise ValueError("SOURCE_VERIFIED_TYPE")
    _validate_refs(source["evidence_refs"])
    for key, code in (("inspection", "INSPECTION"), ("waveform_qc", "WAVEFORM_QC")):
        section = snapshot[key]
        _required(section, {"state", "verified", "limitations", "evidence_refs"}, code + "_STATUS_MISSING")
        if section["state"] not in EVIDENCE_STATES:
            raise ValueError(code + "_STATE")
        if not isinstance(section["verified"], bool):
            raise ValueError(code + "_VERIFIED_TYPE")
        if not isinstance(section["limitations"], list) or any(not isinstance(x, str) for x in section["limitations"]):
            raise ValueError(code + "_LIMITATIONS")
        _validate_refs(section["evidence_refs"])
    candidate = snapshot["candidate_control"]
    _required(candidate, {
        "candidate_active", "clinical_accuracy_claimed", "automatic_selection_allowed",
        "runtime_status", "native_dataset_annotations_are_project_gold",
        "synthetic_fixtures_are_clinical_gold", "evidence_refs",
    }, "CANDIDATE_CONTROL_MISSING")
    _validate_refs(candidate["evidence_refs"])
    evaluation_state = snapshot["evaluation"]
    _required(evaluation_state, {
        "approved_adjudicated_gold_count", "diagnostic_performance_reporting_allowed",
        "clinical_accuracy_promotion_allowed", "evidence_refs",
    }, "EVALUATION_STATUS_MISSING")
    if type(evaluation_state["approved_adjudicated_gold_count"]) is not int or evaluation_state["approved_adjudicated_gold_count"] < 0:
        raise ValueError("GOLD_COUNT")
    _validate_refs(evaluation_state["evidence_refs"])
    return snapshot

def _authority_reasons(snapshot):
    expected = accepted_authority()
    binding = snapshot["repository_binding"]
    reasons = []
    for field, code in (
        ("repository", "STALE_REPOSITORY"),
        ("commit", "STALE_COMMIT"),
        ("tree", "STALE_TREE"),
        ("stage1_acceptance_receipt_sha256", "STALE_STAGE1_ACCEPTANCE"),
        ("source_registry_sha256", "STALE_SOURCE_REGISTRY"),
    ):
        if binding.get(field) != expected[field]:
            reasons.append(code)
    if binding.get("registry_binding") != expected["registry_binding"]:
        reasons.append("STALE_PATTERN_REGISTRY")
    canonical = current_substrate_state()
    candidate = snapshot["candidate_control"]
    for field, code in (
        ("candidate_active", "CANDIDATE_ACTIVE_FORBIDDEN"),
        ("clinical_accuracy_claimed", "CLINICAL_ACCURACY_CLAIM_FORBIDDEN"),
        ("automatic_selection_allowed", "AUTOMATIC_SELECTION_FORBIDDEN"),
        ("runtime_status", "CANDIDATE_RUNTIME_STATUS_STALE"),
        ("native_dataset_annotations_are_project_gold", "NATIVE_LABEL_GOLD_FORBIDDEN"),
        ("synthetic_fixtures_are_clinical_gold", "SYNTHETIC_GOLD_FORBIDDEN"),
    ):
        if candidate.get(field) != canonical[field]:
            reasons.append(code)
    evaluation_state = snapshot["evaluation"]
    for field, code in (
        ("approved_adjudicated_gold_count", "GOLD_COUNT_STALE"),
        ("diagnostic_performance_reporting_allowed", "DIAGNOSTIC_REPORTING_GATE_STALE"),
        ("clinical_accuracy_promotion_allowed", "CLINICAL_PROMOTION_GATE_STALE"),
    ):
        if evaluation_state.get(field) != canonical[field]:
            reasons.append(code)
    if snapshot["source"]["raw_source_in_git"] is not False:
        reasons.append("RAW_SOURCE_MUST_REMAIN_OUTSIDE_GIT")
    return sorted(set(reasons))

def _collect_refs(snapshot):
    refs = []
    for section in ("source", "inspection", "waveform_qc", "candidate_control", "evaluation"):
        refs.extend(_validate_refs(snapshot[section]["evidence_refs"]))
    ids = [ref["ref_id"] for ref in refs]
    if len(ids) != len(set(ids)):
        raise ValueError("EVIDENCE_REF_DUPLICATE_ACROSS_SECTIONS")
    return sorted(refs, key=lambda ref: ref["ref_id"])

def build_status(snapshot):
    _shape(snapshot)
    reasons = _authority_reasons(snapshot)
    source = snapshot["source"]
    inspection = snapshot["inspection"]
    qc = snapshot["waveform_qc"]
    limitations = list(inspection["limitations"]) + list(qc["limitations"])
    if reasons:
        state = "UNKNOWN"
    elif source["state"] == "UNAVAILABLE" or source["raw_source_available"] is False:
        state = "UNAVAILABLE"
        limitations.append("RAW_SOURCE_UNAVAILABLE")
    elif source["state"] == "UNKNOWN" or source["source_verified"] is False:
        state = "UNKNOWN"
        limitations.append("SOURCE_VERIFICATION_UNKNOWN")
    elif inspection["state"] == "UNKNOWN" or inspection["verified"] is False:
        state = "UNKNOWN"
        limitations.append("SOURCE_INSPECTION_UNKNOWN")
    elif qc["state"] == "UNKNOWN" or qc["verified"] is False:
        state = "UNKNOWN"
        limitations.append("WAVEFORM_QC_UNKNOWN")
    elif inspection["state"] in {"DEGRADED", "UNAVAILABLE"} or qc["state"] in {"DEGRADED", "UNAVAILABLE"}:
        state = "DEGRADED"
    else:
        state = "GOVERNED_INACTIVE"
    limitations.extend(reasons)
    limitations.extend(["DIAGNOSTIC_RUNTIME_GOVERNED_INACTIVE", "ZERO_APPROVED_ADJUDICATED_GOLD"])
    canonical = current_substrate_state()
    body = {
        "schema": SCHEMA,
        "state": state,
        "governance_state": "GOVERNED_INACTIVE",
        "authority": accepted_authority(),
        "source": {
            "source_id": source["source_id"],
            "source_sha256": source["source_sha256"],
            "state": source["state"],
            "raw_source_available": source["raw_source_available"],
            "raw_source_in_git": False,
            "source_verified": source["source_verified"],
        },
        "inspection": {
            "state": inspection["state"],
            "verified": inspection["verified"],
        },
        "waveform_qc": {
            "state": qc["state"],
            "verified": qc["verified"],
        },
        "candidate_control": {
            key: canonical[key] for key in (
                "candidate_active", "clinical_accuracy_claimed", "automatic_selection_allowed",
                "runtime_status", "native_dataset_annotations_are_project_gold",
                "synthetic_fixtures_are_clinical_gold",
            )
        },
        "evaluation": {
            key: canonical[key] for key in (
                "approved_adjudicated_gold_count", "diagnostic_performance_reporting_allowed",
                "clinical_accuracy_promotion_allowed",
            )
        },
        "capabilities": {
            "status.read": "SUPPORTED",
            "diagnostic.execute": "UNSUPPORTED",
            "clinical_performance.read": "BLOCKED_ZERO_GOLD",
        },
        "limitations": sorted(set(limitations)),
        "provenance_refs": _collect_refs(snapshot),
        "clinical_accuracy_claimed": False,
        "diagnostic_runtime_activation_allowed": False,
        "silent_fallback_allowed": False,
    }
    if body["state"] not in STATUS_STATES:
        raise ValueError("STATUS_STATE")
    return {**body, "status_sha256": _digest(body)}
def diagnostic_execute(*_args, **_kwargs):
    raise RuntimeError("DIAGNOSTIC_EXECUTION_UNSUPPORTED_GOVERNED_INACTIVE")

def release_contract():
    canonical = current_substrate_state()
    return {
        "schema": "ekg-ep3-pkt01-status-release-contract-v1",
        "packet": "PKT-EP3-01",
        "theme": "System status adapter and quarantine contract",
        "repository": REPOSITORY,
        "baseline_commit": ACCEPTED_COMMIT,
        "baseline_tree": ACCEPTED_TREE,
        "stage1_acceptance_receipt_sha256": STAGE1_ACCEPTANCE_RECEIPT_SHA256,
        "status_read_supported": True,
        "diagnostic_execution_supported": False,
        "candidate_active": canonical["candidate_active"],
        "clinical_accuracy_claimed": canonical["clinical_accuracy_claimed"],
        "approved_adjudicated_gold_count": canonical["approved_adjudicated_gold_count"],
        "diagnostic_performance_reporting_allowed": canonical["diagnostic_performance_reporting_allowed"],
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "raw_source_bytes_stored_in_git": False,
        "independent_machine_verification_required": True,
        "github_ci_required": True,
    }
