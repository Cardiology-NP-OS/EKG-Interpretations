"""EP3 Packet 9 end-to-end EKG integration freeze.

Engineering-only, fail-closed integration surface over accepted EP3 Packets 1-8.
This module does not diagnose, activate diagnostic runtime, create clinical gold,
promote clinical metrics, or transfer specialist clinical authority.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Tuple

SCHEMA = "ekg-ep3-pkt09-integration-freeze-v1"
PACKET_ID = "PKT-EP3-09"
PACKET_SHA256 = "3391254b7af3dec5c847c167a40ad3cc2aa070e976cfd552d48f38332c1ae294"
BASELINE_COMMIT = "6fbf1814258813bfb6ff78407e013cf23ff9e07d"
BASELINE_TREE = "01442274b34bf40ae600ee1ee21de8f15ae3b4de"
STAGE1_RECEIPT_SHA256 = "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb"
PRIOR_PACKET_RECEIPT_SHA256 = "f151e49837cf84fea9e4b6bdeb4e01ebe3ae9708547adb6ae1106bc64b1aa293"

PACKET_RECEIPTS = {
    "PKT-EP3-01": "96b1b26c3e069c7aad226894a81461e56dce322d16f32431884ef10e7118975f",
    "PKT-EP3-02": "f0f8cd6b330ce56dc02267fd23cc85175d4d02037fb4f2f0b974508d078996eb",
    "PKT-EP3-03": "f11c2b232b6f76d3be62b95ac44eb379becd41244bb8e67f8e0dfe18881232e1",
    "PKT-EP3-04": "3030f7e0d9dacafcaf81d767df97969f4255fb4397b4963521ad14197baa5e66",
    "PKT-EP3-05": "46a40cdb1095a6f401c3611abc4628986f44d682130db2c7f0449610f7b80895",
    "PKT-EP3-06": "d9a29faf5ad7407a30ba2accaffacbfc81cf8054604698ec3c255242615b3e45",
    "PKT-EP3-07": "7e92a1cc42ec16162626eb45fec8f3a5c38175ec9707b365933421213ca80f86",
    "PKT-EP3-08": "f151e49837cf84fea9e4b6bdeb4e01ebe3ae9708547adb6ae1106bc64b1aa293",
}

PACKET_VERIFICATION_RECEIPTS = {
    "PKT-EP3-01": "acfd6bd29b4f41c504590255fa88440e47dd320e0ab0cb2a7fb454226ae93883",
    "PKT-EP3-02": "563fcd6329f9326eb06397f8bb87598d55ed7688bf93153a0f4c65b032200ca1",
    "PKT-EP3-03": "68fbfdffbe1065c85771378bb66366cbc0137bdf0a2bf2cd3ff3ce4fd5326a4f",
    "PKT-EP3-04": "fc232315dc6ec78b5e14105a8c3bef2f5fc8a432558960f990bae64aa926c42e",
    "PKT-EP3-05": "f95d1e71d9b1ae387c5d4bf672824adabf4976d708ad6e5ec1ad76a05d132470",
    "PKT-EP3-06": "1cc22893a38c4ec620b6ababe6780dc565e97d99542dd163648709a20463d582",
    "PKT-EP3-07": "306a1caccbdda2e3e803d94141099609c6f79161a68bb2d8585f5883cc31f4d1",
    "PKT-EP3-08": "43bed5cb6ecda55f6fc65a3fab2072843fbe9845358c6865c5f79e5fff7d3000",
}

ACCEPTED_IMPLEMENTATION_IDENTITIES = {
    "PKT-EP3-01": ("b73d62847746986a18671cd2da1608540f46aa7b", "aa309eedf0437bc8d5b3870a22f4825ee22aaba3"),
    "PKT-EP3-02": ("e18739ea03bf1db800d27d5f9ae40d55efb66ad7", "b54b363ca8a7700a43983970fbaddd5f7f0a91fe"),
    "PKT-EP3-03": ("60e216234eb80b293e335fe97a42547cc360cd9c", "af6b4f0df8035c3d90d75990cabfc87337bc5a12"),
    "PKT-EP3-04": ("439ce89beb485bc4fd458885bfe970d580efecd2", "bbc2ebdda63e49e555b09f532f8c2262d0178ecd"),
    "PKT-EP3-05": ("047adf472ab76430ed683d6ae0b41154fbd13885", "7795590c2fd1714c726b3806d807b6ffb7e8b0d7"),
    "PKT-EP3-06": ("f6fdb0ed70c5d349fe40773df638165e79172fd3", "dd1cfc1beb05476ac89e1cda4fb2eaedfa0a29ad"),
    "PKT-EP3-07": ("3e8d2bd417e962b526d97a0330bcbe5c3d3ab8bd", "d5d3f6214c77db3bf8566d9d537d51fb2b53124e"),
    "PKT-EP3-08": (BASELINE_COMMIT, BASELINE_TREE),
}

CURRENT_STATE = {
    "approved_adjudicated_gold_count": 0,
    "clinical_gold_admission_performed": False,
    "metric_maturity": "NOT_REPORTABLE",
    "diagnostic_performance_reporting_allowed": False,
    "clinical_accuracy_claimed": False,
    "readiness_state": "BLOCKED",
    "activation_eligibility_state": "INELIGIBLE",
    "candidate_active": False,
    "diagnostic_runtime": "GOVERNED_INACTIVE",
    "integration_freeze_state": "BLOCKED",
    "integration_descriptor_status": "PROVISIONAL_READ_ONLY",
}

DONOR_GAP_ADJUDICATION = (
    {
        "gap_id": "calibrated-measurement-geometry",
        "disposition": "DEFERRED_WITH_REASON",
        "reason": "Exact measurement geometry is unsafe without trustworthy scale metadata.",
        "must_ship_now_scope": [],
        "engineering_only_archive_allowed": True,
        "runtime_measurement_capability_added": False,
        "bulk_donor_import_allowed": False,
    },
    {
        "gap_id": "unified-reader-packet-builder",
        "disposition": "DEFERRED_WITH_REASON",
        "reason": "A unified reader must not become a competing diagnostic engine.",
        "must_ship_now_scope": [
            "bounded_source_verification_reference",
            "bounded_inspection_reference",
            "bounded_signal_quality_reference",
            "bounded_readiness_status_reference",
        ],
        "engineering_only_archive_allowed": True,
        "diagnostic_conclusions_allowed": False,
        "automatic_candidate_selection_allowed": False,
        "bulk_donor_import_allowed": False,
    },
)

RECOVERED_V12_BOUNDARIES = (
    ("inspect_first", "clinical_control/v12_1_candidate/source_text/remaining_controls/29_IMAGE_QUALITY_PROTOCOL.md"),
    ("source_audit", "clinical_control/v12_1_candidate/source_text/30_CURRENT_SOURCE_MAP_2026.md"),
    ("engineering_evaluation", "clinical_control/v12_1_candidate/validation_generated/EVALUATION_CONTRACTS.json"),
    ("red_team", "clinical_control/v12_1_candidate/validation_generated/MODE_SELF_AUDIT_CONTRACT.json"),
    ("structured_output", "clinical_control/v12_1_candidate/source_text/remaining_controls/68_STRUCTURED_OUTPUT_GUIDE.md"),
    ("self_audit", "clinical_control/v12_1_candidate/source_text/remaining_controls/18_SELF_AUDIT_RUBRIC.md"),
)

PRODUCT_RUNTIME_ASSETS = (
    "read_only_integration_descriptor",
    "release_evidence_bundle_bindings",
    "bounded_provenance_status_exposure",
)
ENGINEERING_ONLY_ASSETS = (
    "synthetic_integration_fixtures",
    "donor_gap_archive_records",
    "boundary_recovery_verification",
    "red_team_review_notes",
)

FAIL_CLOSED_TRIGGERS = (
    "source_substitution",
    "provenance_mismatch",
    "candidate_identity_drift",
    "model_identity_drift",
    "configuration_identity_drift",
    "source_identity_drift",
    "stale_evidence",
    "revoked_evidence",
    "unknown_or_untrusted_calibration",
    "cross_packet_state_conflict",
    "clinical_authority_escalation",
    "silent_fallback",
    "raw_clinical_payload_or_phi",
    "tampered_release_manifest",
    "packet_receipt_mismatch",
    "verification_receipt_mismatch",
)

def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")

def digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()

def _require_hex(value: str, length: int, code: str) -> str:
    if not isinstance(value, str) or len(value) != length:
        raise ValueError(code)
    try:
        int(value, 16)
    except ValueError as exc:
        raise ValueError(code) from exc
    return value.lower()

def _require_bool(value: Any, code: str) -> bool:
    if type(value) is not bool:
        raise ValueError(code)
    return value

def boundary_inventory(repo_root: Path) -> List[Dict[str, Any]]:
    """Verify recovered V12 boundary files by exact repository path and SHA-256."""
    records: List[Dict[str, Any]] = []
    for boundary, rel in RECOVERED_V12_BOUNDARIES:
        path = repo_root / rel
        if not path.is_file():
            records.append({"boundary": boundary, "path": rel, "present": False, "sha256": None})
            continue
        records.append({
            "boundary": boundary,
            "path": rel,
            "present": True,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        })
    return records

def cross_packet_consistency(
    *,
    packet_receipts: Mapping[str, str],
    verification_receipts: Mapping[str, str],
    current_state: Mapping[str, Any],
) -> Dict[str, Any]:
    """Compare observed lineage/state against the accepted Build authority."""
    blockers: List[str] = []
    for packet_id, expected in PACKET_RECEIPTS.items():
        if packet_receipts.get(packet_id) != expected:
            blockers.append(f"PACKET_RECEIPT_MISMATCH:{packet_id}")
    for packet_id, expected in PACKET_VERIFICATION_RECEIPTS.items():
        if verification_receipts.get(packet_id) != expected:
            blockers.append(f"VERIFICATION_RECEIPT_MISMATCH:{packet_id}")
    for field, expected in CURRENT_STATE.items():
        if current_state.get(field) != expected:
            blockers.append(f"STATE_CONFLICT:{field}")
    return {
        "schema": "ekg-ep3-pkt09-cross-packet-consistency-v1",
        "consistent": not blockers,
        "blockers": sorted(blockers),
        "packet_receipts_checked": len(PACKET_RECEIPTS),
        "verification_receipts_checked": len(PACKET_VERIFICATION_RECEIPTS),
        "state_fields_checked": len(CURRENT_STATE),
    }

def donor_gap_verdict() -> Dict[str, Any]:
    """Return immutable donor-gap adjudication without importing donor runtime logic."""
    records = [dict(record) for record in DONOR_GAP_ADJUDICATION]
    blockers = []
    for record in records:
        if record["disposition"] not in {"MUST_SHIP_NOW", "ENGINEERING_ONLY_ARCHIVE", "DEFERRED_WITH_REASON"}:
            blockers.append(f"UNKNOWN_DISPOSITION:{record['gap_id']}")
        if record.get("bulk_donor_import_allowed") is not False:
            blockers.append(f"BULK_DONOR_IMPORT_NOT_FENCED:{record['gap_id']}")
    return {
        "schema": "ekg-ep3-pkt09-donor-gap-adjudication-v1",
        "records": records,
        "conformant": not blockers,
        "blockers": blockers,
        "bulk_donor_import_allowed": False,
    }

def build_integration_manifest(
    *,
    implementation_commit: str,
    implementation_tree: str,
    source_pack_sha256: str,
    candidate_identity_sha256: str,
    ci_receipt_sha256: str,
    independent_verification_receipt_sha256: str,
    boundary_records: Iterable[Mapping[str, Any]],
    packet_receipts: Mapping[str, str] = PACKET_RECEIPTS,
    verification_receipts: Mapping[str, str] = PACKET_VERIFICATION_RECEIPTS,
) -> Dict[str, Any]:
    """Build an immutable Packet-9 engineering integration manifest."""
    implementation_commit = _require_hex(implementation_commit, 40, "IMPLEMENTATION_COMMIT_INVALID")
    implementation_tree = _require_hex(implementation_tree, 40, "IMPLEMENTATION_TREE_INVALID")
    source_pack_sha256 = _require_hex(source_pack_sha256, 64, "SOURCE_PACK_SHA256_INVALID")
    candidate_identity_sha256 = _require_hex(candidate_identity_sha256, 64, "CANDIDATE_IDENTITY_SHA256_INVALID")
    ci_receipt_sha256 = _require_hex(ci_receipt_sha256, 64, "CI_RECEIPT_SHA256_INVALID")
    independent_verification_receipt_sha256 = _require_hex(
        independent_verification_receipt_sha256, 64, "INDEPENDENT_VERIFICATION_RECEIPT_INVALID"
    )
    consistency = cross_packet_consistency(
        packet_receipts=packet_receipts,
        verification_receipts=verification_receipts,
        current_state=CURRENT_STATE,
    )
    boundary_records = [dict(record) for record in boundary_records]
    missing_boundaries = sorted(record["boundary"] for record in boundary_records if not record.get("present"))
    donor = donor_gap_verdict()
    manifest = {
        "schema": "ekg-ep3-pkt09-integration-manifest-v1",
        "packet_id": PACKET_ID,
        "packet_sha256": PACKET_SHA256,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "implementation_commit": implementation_commit,
        "implementation_tree": implementation_tree,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "packet_receipts": dict(packet_receipts),
        "packet_verification_receipts": dict(verification_receipts),
        "accepted_implementation_identities": {
            key: {"commit": value[0], "tree": value[1]}
            for key, value in ACCEPTED_IMPLEMENTATION_IDENTITIES.items()
        },
        "source_pack_sha256": source_pack_sha256,
        "candidate_identity_sha256": candidate_identity_sha256,
        "ci_receipt_sha256": ci_receipt_sha256,
        "independent_verification_receipt_sha256": independent_verification_receipt_sha256,
        "current_state": dict(CURRENT_STATE),
        "cross_packet_consistency": consistency,
        "donor_gap_adjudication": donor,
        "recovered_v12_boundaries": boundary_records,
        "missing_recovered_boundaries": missing_boundaries,
        "product_runtime_assets": list(PRODUCT_RUNTIME_ASSETS),
        "engineering_only_assets": list(ENGINEERING_ONLY_ASSETS),
        "raw_clinical_waveform_or_image_bytes_included": False,
        "phi_included": False,
        "diagnostic_runtime_activation_performed": False,
        "clinical_authority_transferred": False,
        "automatic_candidate_selection_performed": False,
        "clinical_accuracy_claimed": False,
        "diagnostic_performance_reporting_allowed": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "bulk_donor_import_performed": False,
    }
    manifest["engineering_release_conformant"] = bool(
        consistency["consistent"] and donor["conformant"] and not missing_boundaries
    )
    manifest["manifest_sha256"] = digest(manifest)
    manifest["immutable"] = True
    return manifest

def validate_manifest(manifest: Mapping[str, Any]) -> Dict[str, Any]:
    """Fail closed on tamper, lineage drift, missing boundaries, or authority escalation."""
    blockers: List[str] = []
    if manifest.get("schema") != "ekg-ep3-pkt09-integration-manifest-v1":
        blockers.append("MANIFEST_SCHEMA_MISMATCH")
    if manifest.get("packet_id") != PACKET_ID or manifest.get("packet_sha256") != PACKET_SHA256:
        blockers.append("PACKET_IDENTITY_MISMATCH")
    if manifest.get("baseline_commit") != BASELINE_COMMIT or manifest.get("baseline_tree") != BASELINE_TREE:
        blockers.append("BASELINE_IDENTITY_MISMATCH")
    if manifest.get("stage1_receipt_sha256") != STAGE1_RECEIPT_SHA256:
        blockers.append("STAGE1_RECEIPT_MISMATCH")
    if manifest.get("prior_packet_receipt_sha256") != PRIOR_PACKET_RECEIPT_SHA256:
        blockers.append("PRIOR_PACKET_RECEIPT_MISMATCH")
    consistency = cross_packet_consistency(
        packet_receipts=manifest.get("packet_receipts", {}),
        verification_receipts=manifest.get("packet_verification_receipts", {}),
        current_state=manifest.get("current_state", {}),
    )
    blockers.extend(consistency["blockers"])
    if manifest.get("missing_recovered_boundaries"):
        blockers.append("RECOVERED_V12_BOUNDARY_MISSING")
    for field in (
        "raw_clinical_waveform_or_image_bytes_included",
        "phi_included",
        "diagnostic_runtime_activation_performed",
        "clinical_authority_transferred",
        "automatic_candidate_selection_performed",
        "clinical_accuracy_claimed",
        "diagnostic_performance_reporting_allowed",
        "synthetic_fixtures_are_clinical_gold",
        "bulk_donor_import_performed",
    ):
        if manifest.get(field) is not False:
            blockers.append(f"FORBIDDEN_ESCALATION:{field}")
    supplied = manifest.get("manifest_sha256")
    unsigned = {k: v for k, v in manifest.items() if k not in {"manifest_sha256", "immutable"}}
    if supplied != digest(unsigned):
        blockers.append("MANIFEST_SHA256_MISMATCH")
    if manifest.get("immutable") is not True:
        blockers.append("MANIFEST_NOT_IMMUTABLE")
    return {
        "schema": "ekg-ep3-pkt09-manifest-validation-v1",
        "valid": not blockers,
        "blockers": sorted(set(blockers)),
        "integration_freeze_state": "BLOCKED",
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "candidate_active": False,
    }

def platform_descriptor(manifest: Mapping[str, Any]) -> Dict[str, Any]:
    """Read-only Platform descriptor. Never emits diagnosis, treatment, or patient-specific CDS."""
    validation = validate_manifest(manifest)
    descriptor = {
        "schema": "ekg-ep3-pkt09-platform-integration-descriptor-v1",
        "packet_id": PACKET_ID,
        "integration_manifest_sha256": manifest.get("manifest_sha256"),
        "exact_commit": manifest.get("implementation_commit"),
        "exact_tree": manifest.get("implementation_tree"),
        "status": "PROVISIONAL_READ_ONLY" if validation["valid"] else "BLOCKED",
        "read_only": True,
        "provenance_complete": validation["valid"],
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "readiness_state": "BLOCKED",
        "activation_eligibility_state": "INELIGIBLE",
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "raw_clinical_waveform_or_image_bytes_included": False,
        "phi_included": False,
        "diagnostic_conclusions_included": False,
        "patient_specific_clinical_decision_support_included": False,
        "treatment_or_prescribing_advice_included": False,
        "automatic_candidate_selection_allowed": False,
        "runtime_influence_allowed": False,
        "clinical_authority_transferred": False,
        "blockers": validation["blockers"] + [
            "APPROVED_ADJUDICATED_GOLD_COUNT_ZERO",
            "CLINICAL_GOLD_ADMISSION_NOT_PERFORMED",
            "METRIC_MATURITY_NOT_REPORTABLE",
            "DIAGNOSTIC_RUNTIME_GOVERNED_INACTIVE",
        ],
        "limitations": [
            "engineering integration only",
            "no clinical accuracy claim",
            "no diagnostic runtime activation",
            "no patient-specific CDS",
        ],
    }
    descriptor["descriptor_sha256"] = digest(descriptor)
    return descriptor

def invalidation_record(*, manifest_sha256: str, trigger: str, reason: str) -> Dict[str, Any]:
    """Append-only invalidation/rollback record."""
    _require_hex(manifest_sha256, 64, "MANIFEST_SHA256_INVALID")
    if trigger not in FAIL_CLOSED_TRIGGERS:
        raise ValueError("UNKNOWN_FAIL_CLOSED_TRIGGER")
    if not isinstance(reason, str) or not reason.strip():
        raise ValueError("INVALIDATION_REASON_REQUIRED")
    record = {
        "schema": "ekg-ep3-pkt09-invalidation-record-v1",
        "manifest_sha256": manifest_sha256,
        "trigger": trigger,
        "reason": reason.strip(),
        "new_integration_freeze_state": "BLOCKED",
        "new_activation_eligibility_state": "INELIGIBLE",
        "new_diagnostic_runtime": "GOVERNED_INACTIVE",
        "candidate_active": False,
        "silent_fallback_allowed": False,
        "source_substitution_allowed": False,
        "candidate_substitution_allowed": False,
        "authority_rewrite_allowed": False,
    }
    record["record_sha256"] = digest(record)
    return record

def asset_classification() -> Dict[str, Any]:
    return {
        "schema": "ekg-ep3-pkt09-asset-classification-v1",
        "product_runtime_assets": list(PRODUCT_RUNTIME_ASSETS),
        "engineering_only_assets": list(ENGINEERING_ONLY_ASSETS),
        "clinical_runtime_assets_added": [],
        "raw_clinical_payload_assets_added": [],
        "authority_transfer_assets_added": [],
    }
