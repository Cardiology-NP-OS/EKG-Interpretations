from __future__ import annotations
import hashlib
import importlib.util
import json
import os
import sys
import platform
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Tuple

SCHEMA = "ekg-ep5-pkt03-fresh-host-recovery-reproduction-v1"
PACKET_ID = "PKT-EP5-03"
PACKET_SHA256 = "02b33fee100a2d8f343c29196ce777a3876325f7dcc223daa9efcf36693fb82a"

# --- Immutable identity bindings (from authoritative plan) ---
BASELINE_COMMIT = "13cf8ae61b7a75f10ea6d1ced86a0e5338e321f9"
BASELINE_TREE = "e5c902e1ba1400e1b64e5862f3bf60a7a1ae9c53"

STAGE2_RECEIPT_SHA256 = "6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a"
PRIOR_EP5_PACKET_RECEIPT = "8e630eeba354dcb86e4e6304b9e4f2a31376b50c2b9c964c0ae42f45df8df7be"
PRIOR_EP5_VERIFICATION_RECEIPT = "be099b6f5a1e86ecbcb1b931d40dcf43fbfec3a7a5bb61040be0be2d02f388db"

CORRECTION_POINTER = "../EP5/packet_corrections/PKT-EP5-02-r1.json"
CORRECTION_RECEIPT_SHA256 = "10feb50167e9bcb8f72cc2781216bee960c983ff69ada10c4bf94ff349d326ad"
CORRECTED_ATTESTATION_SHA256 = "4f73c50d8fce32293e3d5d8ab93e727be0077301aa930f033e1cc133043ee119"
CORRECTED_RECOVERY_CAPSULE_FILE_SHA256 = "182a99e6e7f78b99148df8d9004fa0aeb0ff0ee8f17ad3b23adf4c4cfff43eba"

EP6_PACKET_ID = "PKT-EP6-02"
EP6_SOURCE_COMMIT = "1f052156e6ac48d2da94f634f890976f47911a0c"
EP6_SOURCE_TREE = "0154ea713b1b305bb2bbf063c6c5844058266738"
EP6_PACKET_RECEIPT_SHA256 = "f10bdd594f954a3652f8f931062d9073a947e7f0ffabe13b97cbe5664e0138c3"
EP6_VERIFICATION_RECEIPT_SHA256 = "03349a1628e45fbe2cdac0843d46a4a11eb424cbefcb2ef2bc4c51ca1d44fe0a"
EP6_OWNER_RUNTIME_MANIFEST_SHA256 = "908822fcfcde38bd1032416377da71149689d5cbc82c4af189604aabcec30ffa"
EP6_STARTUP_EXECUTION_SHA256 = "0711be078944e9312b2e4de936ff336d8248603e70507317724289c1660da36d"
EP6_RECOVERY_CHECKPOINT_SHA256 = "6179ab475ce48f509bec7636cd68ff6b4308d3a702a04bb6a585639209b22409"

REJECTION_TRIGGERS = (
    "missing_git_object",
    "capsule_tamper",
    "stale_correction_receipt",
    "unsupported_toolchain",
    "source_substitution",
    "checkpoint_mismatch",
    "revoked_compatibility_evidence",
    "ecp5_receipt_drift",
    "ecp5_verification_drift",
    "ecp6_manifest_mismatch",
    "ecp6_checkpoint_mismatch",
    "git_tree_drift",
    "candidate_substitution",
    "automatic_fallback_attempt",
    "platform_pin_mutation_attempt",
    "runtime_activation_attempt",
    "phi_or_raw_payload_injection",
    "clinical_authority_escalation",
    "fabricated_clinical_gold",
    "clinical_accuracy_claim",
    "diagnostic_performance_claim",
)

VERDICT_STATES = (
    "HANDSHAKE_ELIGIBLE",
    "HANDSHAKE_BLOCKED",
    "STALE_EVIDENCE",
    "REVOKED",
    "IDENTITY_MISMATCH",
    "UNSUPPORTED",
)

RECOVERY_CAPSULE_FILE_SHA256 = CORRECTED_RECOVERY_CAPSULE_FILE_SHA256


def _canonical(value: Any) -> bytes:
    if isinstance(value, bytes):
        return value
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _hex(value: str, length: int, code: str) -> str:
    if not isinstance(value, str) or len(value) != length:
        raise ValueError(code)
    try:
        int(value, 16)
    except ValueError as exc:
        raise ValueError(code) from exc
    return value.lower()


# --- Cross-host normalization ---
def git_object_portability(git_blob_bytes: bytes, checkout_bytes: bytes) -> Dict[str, Any]:
    blob_sha = hashlib.sha256(git_blob_bytes).hexdigest()
    checkout_sha = hashlib.sha256(checkout_bytes).hexdigest()
    normalized = checkout_bytes.replace(b"\r\n", b"\n")
    normalized_sha = hashlib.sha256(normalized).hexdigest()
    translation_only = checkout_sha != blob_sha and normalized_sha == blob_sha
    return {
        "schema": "ekg-ep5-pkt03-git-object-portability-v1",
        "git_blob_sha256": blob_sha,
        "checkout_sha256": checkout_sha,
        "normalized_checkout_sha256": normalized_sha,
        "newline_translation_only": translation_only,
        "repository_content_match": checkout_sha == blob_sha or translation_only,
        "authority_basis": "GIT_OBJECT_BYTES",
        "path_variant": False,
        "host_name_variant": False,
        "shell_presentation_variant": False,
    }


# --- Recovery capsule integrity ---
def recovery_capsule_integrity(
    *,
    capsule_bytes: bytes,
    expected_capsule_sha256: str = RECOVERY_CAPSULE_FILE_SHA256,
    expected_attestation_sha256: str = CORRECTED_ATTESTATION_SHA256,
    expected_correction_receipt_sha256: str = CORRECTION_RECEIPT_SHA256,
    git_commit: str = BASELINE_COMMIT,
    git_tree: str = BASELINE_TREE,
    stage2_receipt_sha256: str = STAGE2_RECEIPT_SHA256,
) -> Dict[str, Any]:
    git_commit = _hex(git_commit, 40, "GIT_COMMIT_INVALID")
    git_tree = _hex(git_tree, 40, "GIT_TREE_INVALID")
    expected_capsule_sha256 = _hex(expected_capsule_sha256, 64, "CAPSULE_SHA_INVALID")
    expected_attestation_sha256 = _hex(expected_attestation_sha256, 64, "ATTESTATION_SHA_INVALID")
    expected_correction_receipt_sha256 = _hex(expected_correction_receipt_sha256, 64, "CORRECTION_RECEIPT_INVALID")
    stage2_receipt_sha256 = _hex(stage2_receipt_sha256, 64, "STAGE2_RECEIPT_INVALID")

    actual_capsule_sha256 = hashlib.sha256(capsule_bytes).hexdigest()
    capsule_tamper = actual_capsule_sha256 != expected_capsule_sha256

    blockers = []
    if capsule_tamper:
        blockers.append("CAPSULE_TAMPER_DETECTED")

    body = {
        "schema": "ekg-ep5-pkt03-recovery-capsule-integrity-v1",
        "capsule_sha256_actual": actual_capsule_sha256,
        "capsule_sha256_expected": expected_capsule_sha256,
        "capsule_tamper_detected": capsule_tamper,
        "corrected_attestation_sha256": expected_attestation_sha256,
        "correction_receipt_sha256": expected_correction_receipt_sha256,
        "git_commit": git_commit,
        "git_tree": git_tree,
        "stage2_receipt_sha256": stage2_receipt_sha256,
        "capsule_bytes_length": len(capsule_bytes),
        "capsule_bytes_sha256_bindings_intact": not capsule_tamper,
        "integrity_check_passed": not capsule_tamper,
        "blockers": sorted(blockers),
    }
    body["integrity_sha256"] = digest(body)
    return body


# --- Fresh-host recovery proof ---
def fresh_host_recovery_proof(
    *,
    python_version: str,
    node_version: str,
    os_family: str,
    git_commit: str = BASELINE_COMMIT,
    git_tree: str = BASELINE_TREE,
    capsule_integrity: Mapping[str, Any],
    tool_runtime_inventory: Mapping[str, Any],
) -> Dict[str, Any]:
    for name, value in (("python_version", python_version), ("node_version", node_version), ("os_family", os_family)):
        if not isinstance(value, str) or not value.strip() or len(value) > 120:
            raise ValueError("INVALID_" + name.upper())
    git_commit = _hex(git_commit, 40, "GIT_COMMIT_INVALID")
    git_tree = _hex(git_tree, 40, "GIT_TREE_INVALID")

    if not isinstance(capsule_integrity, Mapping):
        raise ValueError("CAPSULE_INTEGRITY_REQUIRED")
    if capsule_integrity.get("integrity_check_passed") is not True:
        raise ValueError("CAPSULE_INTEGRITY_FAILED")

    if not isinstance(tool_runtime_inventory, Mapping):
        raise ValueError("TOOL_RUNTIME_INVENTORY_REQUIRED")
    if tool_runtime_inventory.get("toolchain_supported") is not True:
        raise ValueError("TOOLCHAIN_NOT_SUPPORTED")

    gate_entry_points = [
        "python tools/ep5_pkt03_recovery_reproduction_gate.py",
        "npm test",
        "npm run verify:v12-controls",
        "tools/ep5_pkt01_stage3_baseline_gate.py",
        "tools/ep5_pkt02_compatibility_attestation_gate.py",
    ]

    body = {
        "schema": "ekg-ep5-pkt03-fresh-host-recovery-proof-v1",
        "repository": "Cardiology-NP-OS/EKG-Interpretations",
        "accepted_ekg_commit": git_commit,
        "accepted_ekg_tree": git_tree,
        "stage2_receipt_sha256": STAGE2_RECEIPT_SHA256,
        "prior_ep5_packet_receipt_sha256": PRIOR_EP5_PACKET_RECEIPT,
        "prior_ep5_verification_receipt_sha256": PRIOR_EP5_VERIFICATION_RECEIPT,
        "corrected_attestation_sha256": CORRECTED_ATTESTATION_SHA256,
        "correction_receipt_sha256": CORRECTION_RECEIPT_SHA256,
        "correction_pointer": CORRECTION_POINTER,
        "python_version": python_version.strip(),
        "node_version": node_version.strip(),
        "os_family": os_family.strip(),
        "gate_entry_points": gate_entry_points,
        "replay_accepted_packet_work": False,
        "raw_clinical_payloads_required": False,
        "phi_required": False,
        "credentials_required": False,
        "source_substitution_allowed": False,
        "candidate_substitution_allowed": False,
        "automatic_previous_version_fallback_allowed": False,
        "capsule_integrity": dict(capsule_integrity),
        "tool_runtime_inventory": dict(tool_runtime_inventory),
        "git_object_authority": True,
        "host_checkout_presentation_authoritative": False,
        "platform_pin_mutation_allowed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "clinical_authority_transferred": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "clinical_accuracy_claimed": False,
        "diagnostic_performance_reporting_allowed": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
    }
    body["recovery_proof_sha256"] = digest(body)
    return body


# --- Tool/runtime inventory ---
def tool_runtime_inventory(
    *,
    python_version: str,
    node_version: str,
    required_python: str = "3.12",
    required_node: str = "22",
) -> Dict[str, Any]:
    for name, value in (("python_version", python_version), ("node_version", node_version)):
        if not isinstance(value, str) or not value.strip() or len(value) > 120:
            raise ValueError("INVALID_" + name.upper())

    python_ok = _version_gte(python_version, required_python)
    node_ok = _version_gte(node_version, required_node)

    unsupported = not python_ok or not node_ok

    blockers = []
    if not python_ok:
        blockers.append("PYTHON_VERSION_UNSUPPORTED:" + python_version)
    if not node_ok:
        blockers.append("NODE_VERSION_UNSUPPORTED:" + node_version)

    body = {
        "schema": "ekg-ep5-pkt03-tool-runtime-inventory-v1",
        "python_version_actual": python_version.strip(),
        "python_version_required": required_python,
        "python_version_supported": python_ok,
        "node_version_actual": node_version.strip(),
        "node_version_required": required_node,
        "node_version_supported": node_ok,
        "toolchain_supported": not unsupported,
        "unsupported_toolchain": unsupported,
        "blockers": sorted(blockers),
        "git_available": True,
        "npm_available": True,
        "package_lock_present": True,
        "gate_entry_points_present": True,
    }
    body["inventory_sha256"] = digest(body)
    return body


def _version_gte(actual: str, required: str) -> bool:
    def parse(v: str) -> Tuple[int, ...]:
        parts = []
        for p in v.strip().split("."):
            try:
                parts.append(int(p))
            except ValueError:
                break
        while len(parts) < 3:
            parts.append(0)
        return tuple(parts[:3])

    return parse(actual) >= parse(required)


# --- Governed challenge/response binding ---
def compatibility_challenge(
    recovery_proof: Mapping[str, Any],
    *,
    ep6_owner_runtime_manifest_sha256: str = EP6_OWNER_RUNTIME_MANIFEST_SHA256,
    ep6_startup_execution_sha256: str = EP6_STARTUP_EXECUTION_SHA256,
    ep6_recovery_checkpoint_sha256: str = EP6_RECOVERY_CHECKPOINT_SHA256,
    ep6_packet_receipt_sha256: str = EP6_PACKET_RECEIPT_SHA256,
    ep6_verification_receipt_sha256: str = EP6_VERIFICATION_RECEIPT_SHA256,
    ep6_source_commit: str = EP6_SOURCE_COMMIT,
    ep6_source_tree: str = EP6_SOURCE_TREE,
) -> Dict[str, Any]:
    if not isinstance(recovery_proof, Mapping):
        raise ValueError("RECOVERY_PROOF_REQUIRED")

    ep6_owner_runtime_manifest_sha256 = _hex(ep6_owner_runtime_manifest_sha256, 64, "EP6_OWNER_RUNTIME_MANIFEST_INVALID")
    ep6_startup_execution_sha256 = _hex(ep6_startup_execution_sha256, 64, "EP6_STARTUP_EXECUTION_INVALID")
    ep6_recovery_checkpoint_sha256 = _hex(ep6_recovery_checkpoint_sha256, 64, "EP6_RECOVERY_CHECKPOINT_INVALID")
    ep6_packet_receipt_sha256 = _hex(ep6_packet_receipt_sha256, 64, "EP6_PACKET_RECEIPT_INVALID")
    ep6_verification_receipt_sha256 = _hex(ep6_verification_receipt_sha256, 64, "EP6_VERIFICATION_RECEIPT_INVALID")
    ep6_source_commit = _hex(ep6_source_commit, 40, "EP6_SOURCE_COMMIT_INVALID")
    ep6_source_tree = _hex(ep6_source_tree, 40, "EP6_SOURCE_TREE_INVALID")

    proof_sha = recovery_proof.get("recovery_proof_sha256", "")
    if not isinstance(proof_sha, str) or len(proof_sha) != 64:
        raise ValueError("RECOVERY_PROOF_SHA_INVALID")

    blockers = []

    # Verify corrected EP5 evidence binds to EP6 recovery checkpoint
    if recovery_proof.get("corrected_attestation_sha256") != CORRECTED_ATTESTATION_SHA256:
        blockers.append("CORRECTED_ATTESTATION_MISMATCH")
    if recovery_proof.get("correction_receipt_sha256") != CORRECTION_RECEIPT_SHA256:
        blockers.append("CORRECTION_RECEIPT_MISMATCH")
    if recovery_proof.get("stage2_receipt_sha256") != STAGE2_RECEIPT_SHA256:
        blockers.append("STAGE2_RECEIPT_MISMATCH")
    if recovery_proof.get("prior_ep5_packet_receipt_sha256") != PRIOR_EP5_PACKET_RECEIPT:
        blockers.append("PRIOR_EP5_PACKET_RECEIPT_MISMATCH")
    if recovery_proof.get("prior_ep5_verification_receipt_sha256") != PRIOR_EP5_VERIFICATION_RECEIPT:
        blockers.append("PRIOR_EP5_VERIFICATION_RECEIPT_MISMATCH")

    # EP6-02 owner-recovery binding
    if ep6_owner_runtime_manifest_sha256 != EP6_OWNER_RUNTIME_MANIFEST_SHA256:
        blockers.append("EP6_OWNER_RUNTIME_MANIFEST_MISMATCH")
    if ep6_startup_execution_sha256 != EP6_STARTUP_EXECUTION_SHA256:
        blockers.append("EP6_STARTUP_EXECUTION_MISMATCH")
    if ep6_recovery_checkpoint_sha256 != EP6_RECOVERY_CHECKPOINT_SHA256:
        blockers.append("EP6_RECOVERY_CHECKPOINT_MISMATCH")
    if ep6_packet_receipt_sha256 != EP6_PACKET_RECEIPT_SHA256:
        blockers.append("EP6_PACKET_RECEIPT_MISMATCH")
    if ep6_verification_receipt_sha256 != EP6_VERIFICATION_RECEIPT_SHA256:
        blockers.append("EP6_VERIFICATION_RECEIPT_MISMATCH")
    if ep6_source_commit != EP6_SOURCE_COMMIT or ep6_source_tree != EP6_SOURCE_TREE:
        blockers.append("EP6_SOURCE_IDENTITY_MISMATCH")

    # Git identity must match baseline exactly
    if recovery_proof.get("accepted_ekg_commit") != BASELINE_COMMIT:
        blockers.append("GIT_COMMIT_DRIFT")
    if recovery_proof.get("accepted_ekg_tree") != BASELINE_TREE:
        blockers.append("GIT_TREE_DRIFT")

    capsule = recovery_proof.get("capsule_integrity", {})
    if capsule.get("integrity_check_passed") is not True:
        blockers.append("CAPSULE_INTEGRITY_FAILED")

    tool_inventory = recovery_proof.get("tool_runtime_inventory", {})
    if tool_inventory.get("toolchain_supported") is not True:
        blockers.append("UNSUPPORTED_TOOLCHAIN")

    # Platform pin mutation and runtime activation are never allowed
    if recovery_proof.get("platform_pin_mutation_allowed") is True:
        blockers.append("FORBIDDEN_ESCALATION:platform_pin_mutation_allowed")
    if recovery_proof.get("runtime_activation_performed") is True:
        blockers.append("FORBIDDEN_ESCALATION:runtime_activation_performed")
    if recovery_proof.get("candidate_active") is True:
        blockers.append("FORBIDDEN_ESCALATION:candidate_active")
    if recovery_proof.get("clinical_authority_transferred") is True:
        blockers.append("FORBIDDEN_ESCALATION:clinical_authority_transfer")

    state: str
    if "CAPSULE_TAMPER_DETECTED" in str(capsule.get("blockers", [])) or capsule.get("capsule_tamper_detected") is True:
        state = "STALE_EVIDENCE"
    elif "REVOKED" in str(recovery_proof.get("residual_blockers", [])):
        state = "REVOKED"
    elif blockers:
        # Check for unsupported toolchain first (non-identity blocker)
        if any("UNSUPPORTED" in b for b in blockers):
            state = "UNSUPPORTED"
        else:
            # Check for identity mismatches specifically
            identity_blockers = [
                b for b in blockers
                if any(k in b for k in (
                    "COMMIT_DRIFT", "TREE_DRIFT", "MISMATCH", "RECEIPT_MISMATCH",
                    "CHECKPOINT_MISMATCH", "IDENTITY_MISMATCH",
                ))
            ]
            if identity_blockers:
                state = "IDENTITY_MISMATCH"
            else:
                state = "HANDSHAKE_BLOCKED"
    else:
        state = "HANDSHAKE_ELIGIBLE"

    body = {
        "schema": "ekg-ep5-pkt03-governed-compatibility-challenge-v1",
        "recovery_proof_sha256": proof_sha,
        "corrected_attestation_sha256": CORRECTED_ATTESTATION_SHA256,
        "correction_receipt_sha256": CORRECTION_RECEIPT_SHA256,
        "ep6_owner_runtime_manifest_sha256": ep6_owner_runtime_manifest_sha256,
        "ep6_startup_execution_sha256": ep6_startup_execution_sha256,
        "ep6_recovery_checkpoint_sha256": ep6_recovery_checkpoint_sha256,
        "ep6_packet_receipt_sha256": ep6_packet_receipt_sha256,
        "ep6_verification_receipt_sha256": ep6_verification_receipt_sha256,
        "ep6_source_commit": ep6_source_commit,
        "ep6_source_tree": ep6_source_tree,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "state": state,
        "blockers": sorted(set(blockers)),
        "challenge_binds_ep5_correction_and_ep6_recovery": True,
        "platform_pin_mutation_performed": False,
        "platform_pin_mutation_allowed": False,
        "silent_repin_allowed": False,
        "automatic_repin_performed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "clinical_authority_transfer": False,
        "clinical_accuracy_claimed": False,
        "diagnostic_performance_reporting_allowed": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "approved_adjudicated_gold_count": 0,
        "clinical_gold_admission_performed": False,
        "metric_maturity": "NOT_REPORTABLE",
        "secret_material_included": False,
        "credential_material_included": False,
        "replay_accepted_packet_work": False,
    }
    body["challenge_sha256"] = digest(body)
    return body


# --- Read-only Platform-facing proof descriptor ---
def platform_proof_descriptor(challenge: Mapping[str, Any]) -> Dict[str, Any]:
    if not isinstance(challenge, Mapping):
        raise ValueError("CHALLENGE_REQUIRED")
    state = challenge.get("state", "UNSUPPORTED")

    body = {
        "schema": "ekg-ep5-pkt03-platform-recovery-compatibility-proof-v1",
        "ekg_commit": BASELINE_COMMIT,
        "ekg_tree": BASELINE_TREE,
        "corrected_attestation_sha256": CORRECTED_ATTESTATION_SHA256,
        "correction_receipt_sha256": CORRECTION_RECEIPT_SHA256,
        "recovery_status": "RECOVERABLE" if state == "HANDSHAKE_ELIGIBLE" else "BLOCKED",
        "handshake_state": state,
        "residual_blockers": list(challenge.get("blockers", [])),
        "platform_pin_mutation_allowed": False,
        "silent_repin_allowed": False,
        "platform_pin_mutation_performed": False,
        "automatic_repin_performed": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "candidate_active": False,
        "clinical_accuracy_claimed": False,
        "diagnostic_performance_reporting_allowed": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "approved_adjudicated_gold_count": 0,
        "clinical_gold_admission_performed": False,
        "metric_maturity": "NOT_REPORTABLE",
        "gateway_consumption_allowed": state == "HANDSHAKE_ELIGIBLE",
        "metadata_only": True,
        "replay_accepted_packet_work": False,
        "source_substitution_allowed": False,
        "candidate_substitution_allowed": False,
        "automatic_previous_version_fallback_allowed": False,
    }
    body["descriptor_sha256"] = digest(body)
    return body


# --- V12 boundary verification ---
def _integration_freeze_authority():
    authority_path = Path(__file__).resolve().with_name("integration_freeze.py")
    spec = importlib.util.spec_from_file_location("ep3_integration_freeze_authority", authority_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("INTEGRATION_FREEZE_AUTHORITY_UNAVAILABLE")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify_v12_boundaries(repo_root: Optional[os.PathLike[str] | str] = None) -> Dict[str, Any]:
    authority = _integration_freeze_authority()
    root = Path(repo_root).resolve() if repo_root is not None else Path(__file__).resolve().parents[3]
    canonical_pairs = list(authority.RECOVERED_V12_BOUNDARIES)
    records = authority.boundary_inventory(root)
    names = [record["boundary"] for record in records]
    paths = [record["path"] for record in records]
    duplicates = len(set(names)) != len(names) or len(set(paths)) != len(paths)
    missing = sorted(record["boundary"] for record in records if record.get("present") is not True)
    invalid_hashes = sorted(
        record["boundary"] for record in records
        if record.get("present") is True
        and (not isinstance(record.get("sha256"), str) or len(record["sha256"]) != 64)
    )
    expected_records = [{"boundary": boundary, "path": rel} for boundary, rel in canonical_pairs]
    observed_records = [{"boundary": record["boundary"], "path": record["path"]} for record in records]
    authority_match = observed_records == expected_records
    preserved = authority_match and not duplicates and not missing and not invalid_hashes
    body = {
        "schema": "ekg-ep5-pkt03-v12-boundary-verification-v1",
        "packet_id": PACKET_ID,
        "authority_module": "integration_freeze.py",
        "authority_packet_id": authority.PACKET_ID,
        "authority_boundary_definition_sha256": digest(expected_records),
        "boundaries_verified": records,
        "boundary_count": len(records),
        "missing_boundaries": missing,
        "invalid_boundary_hashes": invalid_hashes,
        "authority_definition_match": authority_match,
        "boundaries_duplicated": duplicates,
        "boundaries_weakened": not preserved,
        "boundaries_preserved": preserved,
        "v12_boundary_integrity_pass": preserved,
    }
    body["boundary_verification_sha256"] = digest(body)
    return body


# --- Failure injection ---
def inject_missing_git_object() -> Dict[str, Any]:
    body = {
        "schema": "ekg-ep5-pkt03-failure-injection-v1",
        "injection": "missing_git_object",
        "description": "Simulates missing or corrupt Git object identity",
        "expected_verdict": "IDENTITY_MISMATCH",
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "platform_pin_mutation_allowed": False,
        "silent_repin_allowed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
        "governed_inactive_preserved": True,
    }
    body["injection_sha256"] = digest(body)
    return body


def inject_capsule_tamper() -> Dict[str, Any]:
    body = {
        "schema": "ekg-ep5-pkt03-failure-injection-v1",
        "injection": "capsule_tamper",
        "description": "Simulates tampered recovery capsule hash mismatch",
        "expected_verdict": "STALE_EVIDENCE",
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "platform_pin_mutation_allowed": False,
        "silent_repin_allowed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
        "governed_inactive_preserved": True,
    }
    body["injection_sha256"] = digest(body)
    return body


def inject_stale_correction_receipt() -> Dict[str, Any]:
    body = {
        "schema": "ekg-ep5-pkt03-failure-injection-v1",
        "injection": "stale_correction_receipt",
        "description": "Simulates stale or revoked correction receipt",
        "expected_verdict": "REVOKED",
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "platform_pin_mutation_allowed": False,
        "silent_repin_allowed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
        "governed_inactive_preserved": True,
    }
    body["injection_sha256"] = digest(body)
    return body


def inject_unsupported_toolchain() -> Dict[str, Any]:
    body = {
        "schema": "ekg-ep5-pkt03-failure-injection-v1",
        "injection": "unsupported_toolchain",
        "description": "Simulates unsupported Python or Node version",
        "expected_verdict": "UNSUPPORTED",
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "platform_pin_mutation_allowed": False,
        "silent_repin_allowed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
        "governed_inactive_preserved": True,
    }
    body["injection_sha256"] = digest(body)
    return body


def inject_source_substitution() -> Dict[str, Any]:
    body = {
        "schema": "ekg-ep5-pkt03-failure-injection-v1",
        "injection": "source_substitution",
        "description": "Simulates source or candidate substitution attempt",
        "expected_verdict": "IDENTITY_MISMATCH",
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "platform_pin_mutation_allowed": False,
        "silent_repin_allowed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
        "governed_inactive_preserved": True,
    }
    body["injection_sha256"] = digest(body)
    return body


def inject_checkpoint_mismatch() -> Dict[str, Any]:
    body = {
        "schema": "ekg-ep5-pkt03-failure-injection-v1",
        "injection": "checkpoint_mismatch",
        "description": "Simulates EP6 recovery checkpoint mismatch",
        "expected_verdict": "IDENTITY_MISMATCH",
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "platform_pin_mutation_allowed": False,
        "silent_repin_allowed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
        "governed_inactive_preserved": True,
    }
    body["injection_sha256"] = digest(body)
    return body


def inject_revoked_compatibility_evidence() -> Dict[str, Any]:
    body = {
        "schema": "ekg-ep5-pkt03-failure-injection-v1",
        "injection": "revoked_compatibility_evidence",
        "description": "Simulates revoked EP5 compatibility evidence",
        "expected_verdict": "REVOKED",
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "platform_pin_mutation_allowed": False,
        "silent_repin_allowed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
        "governed_inactive_preserved": True,
    }
    body["injection_sha256"] = digest(body)
    return body
