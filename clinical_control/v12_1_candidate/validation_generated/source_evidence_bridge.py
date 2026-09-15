"""EP3 Packet 2 source-evidence and provenance bridge.

Metadata and provenance only. This module does not perform diagnostic interpretation
or activate the governed-inactive EKG runtime.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy

import system_status_adapter as status

SCHEMA = "ekg-ep3-pkt02-source-evidence-bridge-v1"
BASELINE_COMMIT = "b73d62847746986a18671cd2da1608540f46aa7b"
BASELINE_TREE = "aa309eedf0437bc8d5b3870a22f4825ee22aaba3"
STAGE1_RECEIPT_SHA256 = "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb"
PKT1_RECEIPT_SHA256 = "96b1b26c3e069c7aad226894a81461e56dce322d16f32431884ef10e7118975f"
BRIDGE_STATES = {"COMPLETE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"}
REF_STATES = {"AVAILABLE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"}
REF_KINDS = {"SOURCE_VERIFICATION", "SOURCE_INSPECTION", "WAVEFORM_QC", "CANDIDATE_CONTROL", "EVALUATION", "SOURCE_LINEAGE", "RECEIPT"}
PHI_KEYS = status.PHI_KEYS
SECRET_KEYS = status.SECRET_KEYS
RAW_PAYLOAD_KEYS = status.RAW_PAYLOAD_KEYS

def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

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

def accepted_packet1_binding():
    return {
        "repository": status.REPOSITORY,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "packet1_receipt_sha256": PKT1_RECEIPT_SHA256,
        "status_adapter_authority": status.accepted_authority(),
    }
def bridge_ref(ref_id, kind, artifact_sha256, source_authority, *, state="AVAILABLE", limitations=()):
    if not isinstance(ref_id, str) or not ref_id.strip():
        raise ValueError("EVIDENCE_REF_ID_REQUIRED")
    if kind not in REF_KINDS:
        raise ValueError("EVIDENCE_REF_KIND")
    if state not in REF_STATES:
        raise ValueError("EVIDENCE_REF_STATE")
    if not isinstance(source_authority, str) or not source_authority.strip():
        raise ValueError("SOURCE_AUTHORITY_REQUIRED")
    if not isinstance(limitations, (list, tuple)) or any(not isinstance(item, str) for item in limitations):
        raise ValueError("EVIDENCE_LIMITATIONS")
    body = {
        "ref_id": ref_id,
        "kind": kind,
        "artifact_sha256": _sha(artifact_sha256, "EVIDENCE_REF_SHA256"),
        "source_authority": source_authority,
        "state": state,
        "limitations": list(limitations),
    }
    _walk_safe(body)
    return body

def _validate_bridge_ref(ref):
    _walk_safe(ref)
    _required(ref, {"ref_id", "kind", "artifact_sha256", "source_authority", "state", "limitations"}, "BRIDGE_REF_MISSING")
    allowed = {"ref_id", "kind", "artifact_sha256", "source_authority", "state", "limitations"}
    extra = sorted(set(ref) - allowed)
    if extra:
        raise ValueError("BRIDGE_REF_FIELD_FORBIDDEN:" + ",".join(extra))
    return bridge_ref(ref["ref_id"], ref["kind"], ref["artifact_sha256"], ref["source_authority"], state=ref["state"], limitations=ref["limitations"])
def _validate_status_snapshot(snapshot):
    _required(snapshot, {
        "schema", "state", "governance_state", "authority", "candidate_control",
        "evaluation", "provenance_refs", "clinical_accuracy_claimed",
        "diagnostic_runtime_activation_allowed", "silent_fallback_allowed",
    }, "STATUS_SNAPSHOT_MISSING")
    _walk_safe(snapshot)
    if snapshot["schema"] != status.SCHEMA:
        raise ValueError("STATUS_SCHEMA_STALE")
    if snapshot["authority"] != status.accepted_authority():
        raise ValueError("STATUS_AUTHORITY_STALE")
    if snapshot["governance_state"] != "GOVERNED_INACTIVE":
        raise ValueError("EKG_GOVERNANCE_STATE_CHANGED")
    if snapshot["candidate_control"].get("candidate_active") is not False:
        raise ValueError("CANDIDATE_ACTIVE_FORBIDDEN")
    if snapshot["clinical_accuracy_claimed"] is not False:
        raise ValueError("CLINICAL_ACCURACY_CLAIM_FORBIDDEN")
    if snapshot["diagnostic_runtime_activation_allowed"] is not False:
        raise ValueError("DIAGNOSTIC_ACTIVATION_FORBIDDEN")
    if snapshot["silent_fallback_allowed"] is not False:
        raise ValueError("SILENT_FALLBACK_FORBIDDEN")
    evaluation = snapshot["evaluation"]
    if evaluation.get("approved_adjudicated_gold_count") != 0:
        raise ValueError("UNAPPROVED_GOLD_COUNT")
    if evaluation.get("diagnostic_performance_reporting_allowed") is not False:
        raise ValueError("DIAGNOSTIC_REPORTING_FORBIDDEN")
    return snapshot

def _status_refs(snapshot):
    rows = []
    for ref in snapshot["provenance_refs"]:
        _walk_safe(ref)
        _required(ref, {"ref_id", "kind", "artifact_sha256"}, "STATUS_REF_MISSING")
        _sha(ref["artifact_sha256"], "STATUS_REF_SHA256")
        rows.append({"origin": "EP3_PKT01_STATUS_ADAPTER", "ref": deepcopy(ref)})
    return rows

def _canonicalize_refs(snapshot, refs):
    rows = _status_refs(snapshot)
    for ref in refs:
        clean = _validate_bridge_ref(ref)
        rows.append({"origin": clean["source_authority"], "ref": clean})
    by_identity = {}
    by_ref_id = {}
    for row in rows:
        canonical = json.dumps(row, sort_keys=True, separators=(",", ":"))
        ref_id = row["ref"]["ref_id"]
        previous = by_ref_id.get(ref_id)
        if previous is not None and previous != canonical:
            raise ValueError("EVIDENCE_REF_CONFLICT:" + ref_id)
        by_ref_id[ref_id] = canonical
        by_identity[canonical] = row
    return [deepcopy(by_identity[key]) for key in sorted(by_identity)]

def _bridge_state(status_snapshot, refs):
    if status_snapshot["state"] in {"UNAVAILABLE", "UNKNOWN"}:
        return status_snapshot["state"]
    states = {row["ref"].get("state", "AVAILABLE") for row in refs}
    if "UNAVAILABLE" in states:
        return "UNAVAILABLE"
    if "UNKNOWN" in states:
        return "UNKNOWN"
    if status_snapshot["state"] == "DEGRADED" or "DEGRADED" in states:
        return "DEGRADED"
    return "COMPLETE"

def build_bridge(*, status_snapshot, evidence_refs):
    _validate_status_snapshot(status_snapshot)
    if not isinstance(evidence_refs, list):
        raise ValueError("EVIDENCE_REFS_SHAPE")
    refs = _canonicalize_refs(status_snapshot, evidence_refs)
    state = _bridge_state(status_snapshot, refs)
    limitations = sorted({item for row in refs for item in row["ref"].get("limitations", [])})
    body = {
        "schema": SCHEMA,
        "binding": accepted_packet1_binding(),
        "state": state,
        "status_sha256": status_snapshot["status_sha256"],
        "evidence_refs": refs,
        "limitations": limitations,
        "raw_clinical_source_bytes_in_git": False,
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "candidate_active": False,
        "approved_adjudicated_gold_count": 0,
        "diagnostic_runtime_activation_allowed": False,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "authority_rewritten": False,
        "silent_fallback_allowed": False,
    }
    return {**body, "bundle_sha256": _digest(body)}

def lineage_descriptor(bridge):
    _required(bridge, {"schema", "bundle_sha256", "binding", "evidence_refs"}, "BRIDGE_MISSING")
    if bridge["schema"] != SCHEMA:
        raise ValueError("BRIDGE_SCHEMA")
    return {
        "schema": "ekg-source-lineage-descriptor-v1",
        "repository": bridge["binding"]["repository"],
        "baseline_commit": bridge["binding"]["baseline_commit"],
        "baseline_tree": bridge["binding"]["baseline_tree"],
        "bundle_sha256": _sha(bridge["bundle_sha256"], "BUNDLE_SHA256"),
        "evidence_ref_ids": sorted(row["ref"]["ref_id"] for row in bridge["evidence_refs"]),
        "read_only": True,
        "diagnostic_interpretation": False,
        "authority_effect": "NONE",
    }
def append_receipt(*, bridge, previous_receipt_sha256=None):
    _required(bridge, {"schema", "bundle_sha256", "state"}, "BRIDGE_MISSING")
    if bridge["schema"] != SCHEMA:
        raise ValueError("BRIDGE_SCHEMA")
    previous = None
    if previous_receipt_sha256 is not None:
        previous = _sha(previous_receipt_sha256, "PREVIOUS_RECEIPT_SHA256")
    body = {
        "schema": "ekg-evidence-append-receipt-v1",
        "packet_id": "PKT-EP3-02",
        "bundle_sha256": _sha(bridge["bundle_sha256"], "BUNDLE_SHA256"),
        "bridge_state": bridge["state"],
        "previous_receipt_sha256": previous,
        "append_only": True,
        "authority_effect": "NONE",
        "clinical_accuracy_claimed": False,
        "diagnostic_runtime_activation_allowed": False,
    }
    return {**body, "receipt_sha256": _digest(body)}

def release_contract():
    return {
        "schema": "ekg-ep3-pkt02-evidence-release-contract-v1",
        "packet": "PKT-EP3-02",
        "theme": "Source-evidence and provenance bridge",
        "repository": status.REPOSITORY,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "accepted_prior_packet_receipt_sha256": PKT1_RECEIPT_SHA256,
        "diagnostic_execution_supported": False,
        "candidate_active": False,
        "clinical_accuracy_claimed": False,
        "approved_adjudicated_gold_count": 0,
        "diagnostic_performance_reporting_allowed": False,
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "raw_source_bytes_stored_in_git": False,
        "independent_machine_verification_required": True,
        "github_ci_required": True,
    }
