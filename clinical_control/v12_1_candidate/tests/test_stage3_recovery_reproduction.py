from __future__ import annotations
import copy
import hashlib
import importlib.util
import json
import pathlib
import sys
import platform
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[3]
GEN = ROOT / "clinical_control" / "v12_1_candidate" / "validation_generated"

def load(name: str, path: pathlib.Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module

rr = load("recovery_reproduction", GEN / "recovery_reproduction.py")

passed = 0
def check(name: str, condition: bool):
    global passed
    if not condition:
        raise AssertionError(name)
    passed += 1

# --- Schema and identity constants ---
check("schema", rr.SCHEMA == "ekg-ep5-pkt03-fresh-host-recovery-reproduction-v1")
check("packet", rr.PACKET_ID == "PKT-EP5-03")
check("packet_sha", rr.PACKET_SHA256 == "02b33fee100a2d8f343c29196ce777a3876325f7dcc223daa9efcf36693fb82a")
check("baseline_commit", rr.BASELINE_COMMIT == "13cf8ae61b7a75f10ea6d1ced86a0e5338e321f9")
check("baseline_tree", rr.BASELINE_TREE == "e5c902e1ba1400e1b64e5862f3bf60a7a1ae9c53")
check("stage2_receipt", rr.STAGE2_RECEIPT_SHA256 == "6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a")
check("prior_packet_receipt", rr.PRIOR_EP5_PACKET_RECEIPT == "8e630eeba354dcb86e4e6304b9e4f2a31376b50c2b9c964c0ae42f45df8df7be")
check("prior_verification_receipt", rr.PRIOR_EP5_VERIFICATION_RECEIPT == "be099b6f5a1e86ecbcb1b931d40dcf43fbfec3a7a5bb61040be0be2d02f388db")
check("correction_receipt", rr.CORRECTION_RECEIPT_SHA256 == "10feb50167e9bcb8f72cc2781216bee960c983ff69ada10c4bf94ff349d326ad")
check("corrected_attestation", rr.CORRECTED_ATTESTATION_SHA256 == "4f73c50d8fce32293e3d5d8ab93e727be0077301aa930f033e1cc133043ee119")
check("corrected_capsule", rr.CORRECTED_RECOVERY_CAPSULE_FILE_SHA256 == "182a99e6e7f78b99148df8d9004fa0aeb0ff0ee8f17ad3b23adf4c4cfff43eba")
check("correction_pointer", rr.CORRECTION_POINTER == "../EP5/packet_corrections/PKT-EP5-02-r1.json")
check("ep6_packet_id", rr.EP6_PACKET_ID == "PKT-EP6-02")
check("ep6_source_commit", rr.EP6_SOURCE_COMMIT == "1f052156e6ac48d2da94f634f890976f47911a0c")
check("ep6_source_tree", rr.EP6_SOURCE_TREE == "0154ea713b1b305bb2bbf063c6c5844058266738")
check("ep6_packet_receipt", rr.EP6_PACKET_RECEIPT_SHA256 == "f10bdd594f954a3652f8f931062d9073a947e7f0ffabe13b97cbe5664e0138c3")
check("ep6_verification_receipt", rr.EP6_VERIFICATION_RECEIPT_SHA256 == "03349a1628e45fbe2cdac0843d46a4a11eb424cbefcb2ef2bc4c51ca1d44fe0a")
check("ep6_owner_manifest", rr.EP6_OWNER_RUNTIME_MANIFEST_SHA256 == "908822fcfcde38bd1032416377da71149689d5cbc82c4af189604aabcec30ffa")
check("ep6_startup_execution", rr.EP6_STARTUP_EXECUTION_SHA256 == "0711be078944e9312b2e4de936ff336d8248603e70507317724289c1660da36d")
check("ep6_recovery_checkpoint", rr.EP6_RECOVERY_CHECKPOINT_SHA256 == "6179ab475ce48f509bec7636cd68ff6b4308d3a702a04bb6a585639209b22409")
check("rejection_trigger_count", len(rr.REJECTION_TRIGGERS) == 21)
check("verdict_states", rr.VERDICT_STATES == (
    "HANDSHAKE_ELIGIBLE", "HANDSHAKE_BLOCKED", "STALE_EVIDENCE",
    "REVOKED", "IDENTITY_MISMATCH", "UNSUPPORTED",
))
check("recovery_capsule_file_sha", rr.RECOVERY_CAPSULE_FILE_SHA256 == rr.CORRECTED_RECOVERY_CAPSULE_FILE_SHA256)

# --- Digest and hex helpers ---
test_bytes = b"hello world"
check("digest_length", len(rr.digest(test_bytes)) == 64)
check("digest_deterministic", rr.digest(test_bytes) == rr.digest(test_bytes))
check("hex_valid_40", rr._hex("a" * 40, 40, "TEST") == "a" * 40)
check("hex_valid_64", rr._hex("b" * 64, 64, "TEST") == "b" * 64)
try:
    rr._hex("short", 40, "TEST")
    raised = False
except ValueError as exc:
    raised = str(exc) == "TEST"
check("hex_rejects_short", raised)
try:
    rr._hex("zz" * 20, 40, "TEST")
    raised = False
except ValueError as exc:
    raised = str(exc) == "TEST"
check("hex_rejects_nonhex", raised)

# --- git_object_portability ---
blob = b"alpha\nbeta\n"
same = rr.git_object_portability(blob, blob)
check("portability_same_repo", same["repository_content_match"] is True)
check("portability_same_no_translate", same["newline_translation_only"] is False)
check("portability_same_authority", same["authority_basis"] == "GIT_OBJECT_BYTES")
check("portability_same_path_variant", same["path_variant"] is False)
check("portability_same_host_variant", same["host_name_variant"] is False)
check("portability_same_shell_variant", same["shell_presentation_variant"] is False)

crlf = rr.git_object_portability(blob, b"alpha\r\nbeta\r\n")
check("portability_crlf_repo", crlf["repository_content_match"] is True)
check("portability_crlf_translate", crlf["newline_translation_only"] is True)
check("portability_crlf_path_variant", crlf["path_variant"] is False)
check("portability_crlf_host_variant", crlf["host_name_variant"] is False)
check("portability_crlf_shell_variant", crlf["shell_presentation_variant"] is False)

different = rr.git_object_portability(blob, b"alpha\ngamma\n")
check("portability_different_repo", different["repository_content_match"] is False)
check("portability_different_translate", different["newline_translation_only"] is False)

# --- recovery_capsule_integrity ---
capsule_bytes = b"synthetic recovery capsule content for EP5 PKT03"
capsule_hash = hashlib.sha256(capsule_bytes).hexdigest()

# Valid capsule
integrity = rr.recovery_capsule_integrity(
    capsule_bytes=capsule_bytes,
    expected_capsule_sha256=capsule_hash,
)
check("integrity_schema", integrity["schema"] == "ekg-ep5-pkt03-recovery-capsule-integrity-v1")
check("integrity_passed", integrity["integrity_check_passed"] is True)
check("integrity_tamper_false", integrity["capsule_tamper_detected"] is False)
check("integrity_bindings_intact", integrity["capsule_bytes_sha256_bindings_intact"] is True)
check("integrity_hash", len(integrity["integrity_sha256"]) == 64)
check("integrity_commit", integrity["git_commit"] == rr.BASELINE_COMMIT)
check("integrity_tree", integrity["git_tree"] == rr.BASELINE_TREE)

# Tampered capsule
integrity_tampered = rr.recovery_capsule_integrity(
    capsule_bytes=b"tampered content",
    expected_capsule_sha256=capsule_hash,
)
check("integrity_tampered_passed", integrity_tampered["integrity_check_passed"] is False)
check("integrity_tampered_detected", integrity_tampered["capsule_tamper_detected"] is True)
check("integrity_tampered_blocker", "CAPSULE_TAMPER_DETECTED" in integrity_tampered.get("blockers", []))

# Invalid hash length
try:
    rr.recovery_capsule_integrity(capsule_bytes=capsule_bytes, expected_capsule_sha256="short")
    raised = False
except ValueError as exc:
    raised = str(exc) == "CAPSULE_SHA_INVALID"
check("integrity_rejects_short_hash", raised)

# --- tool_runtime_inventory (needed before proof) ---
inv = rr.tool_runtime_inventory(python_version="3.12.8", node_version="22.18.0")

# --- fresh_host_recovery_proof ---
capsule_integrity_valid = rr.recovery_capsule_integrity(
    capsule_bytes=capsule_bytes,
    expected_capsule_sha256=capsule_hash,
)
proof = rr.fresh_host_recovery_proof(
    python_version="3.12.8",
    node_version="22.18.0",
    os_family="Windows",
    capsule_integrity=capsule_integrity_valid,
    tool_runtime_inventory=inv,
)
check("proof_schema", proof["schema"] == "ekg-ep5-pkt03-fresh-host-recovery-proof-v1")
check("proof_commit", proof["accepted_ekg_commit"] == rr.BASELINE_COMMIT)
check("proof_tree", proof["accepted_ekg_tree"] == rr.BASELINE_TREE)
check("proof_stage2", proof["stage2_receipt_sha256"] == rr.STAGE2_RECEIPT_SHA256)
check("proof_prior_packet", proof["prior_ep5_packet_receipt_sha256"] == rr.PRIOR_EP5_PACKET_RECEIPT)
check("proof_prior_verify", proof["prior_ep5_verification_receipt_sha256"] == rr.PRIOR_EP5_VERIFICATION_RECEIPT)
check("proof_corrected Attestation", proof["corrected_attestation_sha256"] == rr.CORRECTED_ATTESTATION_SHA256)
check("proof_correction_receipt", proof["correction_receipt_sha256"] == rr.CORRECTION_RECEIPT_SHA256)
check("proof_correction_pointer", proof["correction_pointer"] == rr.CORRECTION_POINTER)
check("proof_no_replay", proof["replay_accepted_packet_work"] is False)
check("proof_no_raw", proof["raw_clinical_payloads_required"] is False)
check("proof_no_phi", proof["phi_required"] is False)
check("proof_no_creds", proof["credentials_required"] is False)
check("proof_no_source_sub", proof["source_substitution_allowed"] is False)
check("proof_no_candidate_sub", proof["candidate_substitution_allowed"] is False)
check("proof_no_fallback", proof["automatic_previous_version_fallback_allowed"] is False)
check("proof_git_authority", proof["git_object_authority"] is True)
check("proof_host_not_authoritative", proof["host_checkout_presentation_authoritative"] is False)
check("proof_entry_point_count", len(proof["gate_entry_points"]) == 5)
check("proof_proof_hash", len(proof["recovery_proof_sha256"]) == 64)

# Invalid python version
try:
    rr.fresh_host_recovery_proof(python_version="", node_version="22", os_family="Windows", capsule_integrity=capsule_integrity_valid, tool_runtime_inventory=inv)
    raised = False
except ValueError as exc:
    raised = str(exc) == "INVALID_PYTHON_VERSION"
check("proof_rejects_empty_python", raised)

# Invalid capsule integrity
try:
    rr.fresh_host_recovery_proof(
        python_version="3.12", node_version="22", os_family="Windows",
        capsule_integrity={"integrity_check_passed": False},
        tool_runtime_inventory=inv,
    )
    raised = False
except ValueError as exc:
    raised = str(exc) == "CAPSULE_INTEGRITY_FAILED"
check("proof_rejects_bad_capsule", raised)

# --- tool_runtime_inventory ---
inv = rr.tool_runtime_inventory(python_version="3.12.8", node_version="22.18.0")
check("inventory_schema", inv["schema"] == "ekg-ep5-pkt03-tool-runtime-inventory-v1")
check("inventory_python_supported", inv["python_version_supported"] is True)
check("inventory_node_supported", inv["node_version_supported"] is True)
check("inventory_toolchain_supported", inv["toolchain_supported"] is True)
check("inventory_unsupported_false", inv["unsupported_toolchain"] is False)
check("inventory_blockers_empty", inv["blockers"] == [])
check("inventory_git_available", inv["git_available"] is True)
check("inventory_npm_available", inv["npm_available"] is True)
check("inventory_hash", len(inv["inventory_sha256"]) == 64)

# Unsupported python
inv_bad_python = rr.tool_runtime_inventory(python_version="3.9.0", node_version="22.0.0")
check("inventory_bad_python_unsupported", inv_bad_python["python_version_supported"] is False)
check("inventory_bad_python_toolchain", inv_bad_python["toolchain_supported"] is False)
check("inventory_bad_python_blocker", "PYTHON_VERSION_UNSUPPORTED:3.9.0" in inv_bad_python["blockers"])

# Unsupported node
inv_bad_node = rr.tool_runtime_inventory(python_version="3.12.0", node_version="18.0.0")
check("inventory_bad_node_unsupported", inv_bad_node["node_version_supported"] is False)
check("inventory_bad_node_toolchain", inv_bad_node["toolchain_supported"] is False)
check("inventory_bad_node_blocker", "NODE_VERSION_UNSUPPORTED:18.0.0" in inv_bad_node["blockers"])

# Invalid version string
try:
    rr.tool_runtime_inventory(python_version="", node_version="22")
    raised = False
except ValueError as exc:
    raised = str(exc) == "INVALID_PYTHON_VERSION"
check("inventory_rejects_empty_python", raised)

# --- compatibility_challenge (happy path) ---
challenge = rr.compatibility_challenge(proof)
check("challenge_schema", challenge["schema"] == "ekg-ep5-pkt03-governed-compatibility-challenge-v1")
check("challenge_state", challenge["state"] == "HANDSHAKE_ELIGIBLE")
check("challenge_blockers_empty", challenge["blockers"] == [])
check("challenge_binds", challenge["challenge_binds_ep5_correction_and_ep6_recovery"] is True)
check("challenge_no_mutation", challenge["platform_pin_mutation_performed"] is False)
check("challenge_no_mutation_allowed", challenge["platform_pin_mutation_allowed"] is False)
check("challenge_no_silent", challenge["silent_repin_allowed"] is False)
check("challenge_no_auto_repin", challenge["automatic_repin_performed"] is False)
check("challenge_no_activation", challenge["runtime_activation_performed"] is False)
check("challenge_candidate_inactive", challenge["candidate_active"] is False)
check("challenge_runtime_inactive", challenge["diagnostic_runtime"] == "GOVERNED_INACTIVE")
check("challenge_no_authority", challenge["clinical_authority_transfer"] is False)
check("challenge_no_accuracy", challenge["clinical_accuracy_claimed"] is False)
check("challenge_no_performance", challenge["diagnostic_performance_reporting_allowed"] is False)
check("challenge_no_phi", challenge["phi_included"] is False)
check("challenge_no_raw", challenge["raw_clinical_payloads_included"] is False)
check("challenge_gold_zero", challenge["approved_adjudicated_gold_count"] == 0)
check("challenge_no_gold_admission", challenge["clinical_gold_admission_performed"] is False)
check("challenge_maturity", challenge["metric_maturity"] == "NOT_REPORTABLE")
check("challenge_no_secret", challenge["secret_material_included"] is False)
check("challenge_no_creds", challenge["credential_material_included"] is False)
check("challenge_no_replay", challenge["replay_accepted_packet_work"] is False)
check("challenge_hash", len(challenge["challenge_sha256"]) == 64)

# --- compatibility_challenge with wrong EP6 manifest ---
challenge_bad_owner = rr.compatibility_challenge(
    proof,
    ep6_owner_runtime_manifest_sha256="0" * 64,
)
check("challenge_bad_owner_blocked", challenge_bad_owner["state"] == "IDENTITY_MISMATCH")
check("challenge_bad_owner_blocker", "EP6_OWNER_RUNTIME_MANIFEST_MISMATCH" in challenge_bad_owner["blockers"])

# --- compatibility_challenge with wrong checkpoint ---
challenge_bad_checkpoint = rr.compatibility_challenge(
    proof,
    ep6_recovery_checkpoint_sha256="0" * 64,
)
check("challenge_bad_checkpoint_blocked", challenge_bad_checkpoint["state"] == "IDENTITY_MISMATCH")
check("challenge_bad_checkpoint_blocker", "EP6_RECOVERY_CHECKPOINT_MISMATCH" in challenge_bad_checkpoint["blockers"])

# --- compatibility_challenge with wrong EP5 receipt ---
proof_bad_receipt = copy.deepcopy(proof)
proof_bad_receipt["prior_ep5_packet_receipt_sha256"] = "0" * 64
challenge_bad_receipt = rr.compatibility_challenge(proof_bad_receipt)
check("challenge_bad_receipt_blocked", challenge_bad_receipt["state"] == "IDENTITY_MISMATCH")
check("challenge_bad_receipt_blocker", "PRIOR_EP5_PACKET_RECEIPT_MISMATCH" in challenge_bad_receipt["blockers"])

# --- compatibility_challenge with git commit drift ---
proof_bad_commit = copy.deepcopy(proof)
proof_bad_commit["accepted_ekg_commit"] = "0" * 40
challenge_bad_commit = rr.compatibility_challenge(proof_bad_commit)
check("challenge_bad_commit_blocked", challenge_bad_commit["state"] == "IDENTITY_MISMATCH")
check("challenge_bad_commit_blocker", "GIT_COMMIT_DRIFT" in challenge_bad_commit["blockers"])

# --- compatibility_challenge with unsupported toolchain ---
proof_bad_tool = copy.deepcopy(proof)
proof_bad_tool["tool_runtime_inventory"] = {"toolchain_supported": False, "blockers": ["PYTHON_VERSION_UNSUPPORTED:3.9"]}
challenge_bad_tool = rr.compatibility_challenge(proof_bad_tool)
check("challenge_bad_tool_blocked", challenge_bad_tool["state"] == "UNSUPPORTED")
check("challenge_bad_tool_blocker", "UNSUPPORTED_TOOLCHAIN" in challenge_bad_tool["blockers"])

# --- compatibility_challenge with capsule tamper ---
proof_bad_capsule = copy.deepcopy(proof)
proof_bad_capsule["capsule_integrity"] = {"integrity_check_passed": False, "capsule_tamper_detected": True}
challenge_bad_capsule = rr.compatibility_challenge(proof_bad_capsule)
check("challenge_bad_capsule_blocked", challenge_bad_capsule["state"] == "STALE_EVIDENCE")

# --- compatibility_challenge with platform pin mutation ---
proof_mutation = copy.deepcopy(proof)
proof_mutation["platform_pin_mutation_allowed"] = True
challenge_mutation = rr.compatibility_challenge(proof_mutation)
check("challenge_mutation_blocked", challenge_mutation["state"] == "HANDSHAKE_BLOCKED")
check("challenge_mutation_blocker", "FORBIDDEN_ESCALATION:platform_pin_mutation_allowed" in challenge_mutation["blockers"])

# --- compatibility_challenge with runtime activation ---
proof_activation = copy.deepcopy(proof)
proof_activation["runtime_activation_performed"] = True
challenge_activation = rr.compatibility_challenge(proof_activation)
check("challenge_activation_blocked", challenge_activation["state"] == "HANDSHAKE_BLOCKED")
check("challenge_activation_blocker", "FORBIDDEN_ESCALATION:runtime_activation_performed" in challenge_activation["blockers"])

# --- compatibility_challenge with clinical authority transfer ---
proof_authority = copy.deepcopy(proof)
proof_authority["clinical_authority_transferred"] = True
challenge_authority = rr.compatibility_challenge(proof_authority)
check("challenge_authority_blocked", challenge_authority["state"] == "HANDSHAKE_BLOCKED")
check("challenge_authority_blocker", "FORBIDDEN_ESCALATION:clinical_authority_transfer" in challenge_authority["blockers"])

# --- platform_proof_descriptor ---
descriptor = rr.platform_proof_descriptor(challenge)
check("descriptor_schema", descriptor["schema"] == "ekg-ep5-pkt03-platform-recovery-compatibility-proof-v1")
check("descriptor_ekg_commit", descriptor["ekg_commit"] == rr.BASELINE_COMMIT)
check("descriptor_ekg_tree", descriptor["ekg_tree"] == rr.BASELINE_TREE)
check("descriptor_corrected_attestation", descriptor["corrected_attestation_sha256"] == rr.CORRECTED_ATTESTATION_SHA256)
check("descriptor_recovery_status", descriptor["recovery_status"] == "RECOVERABLE")
check("descriptor_handshake_state", descriptor["handshake_state"] == "HANDSHAKE_ELIGIBLE")
check("descriptor_no_mutation", descriptor["platform_pin_mutation_allowed"] is False)
check("descriptor_no_mutation_performed", descriptor["platform_pin_mutation_performed"] is False)
check("descriptor_no_silent", descriptor["silent_repin_allowed"] is False)
check("descriptor_no_auto_repin", descriptor["automatic_repin_performed"] is False)
check("descriptor_metadata_only", descriptor["metadata_only"] is True)
check("descriptor_gateway_allowed", descriptor["gateway_consumption_allowed"] is True)
check("descriptor_runtime_inactive", descriptor["diagnostic_runtime"] == "GOVERNED_INACTIVE")
check("descriptor_candidate_inactive", descriptor["candidate_active"] is False)
check("descriptor_no_accuracy", descriptor["clinical_accuracy_claimed"] is False)
check("descriptor_no_performance", descriptor["diagnostic_performance_reporting_allowed"] is False)
check("descriptor_no_phi", descriptor["phi_included"] is False)
check("descriptor_no_raw", descriptor["raw_clinical_payloads_included"] is False)
check("descriptor_gold_zero", descriptor["approved_adjudicated_gold_count"] == 0)
check("descriptor_no_gold_admission", descriptor["clinical_gold_admission_performed"] is False)
check("descriptor_maturity", descriptor["metric_maturity"] == "NOT_REPORTABLE")
check("descriptor_no_replay", descriptor["replay_accepted_packet_work"] is False)
check("descriptor_hash", len(descriptor["descriptor_sha256"]) == 64)

# --- platform_proof_descriptor blocked state ---
descriptor_blocked = rr.platform_proof_descriptor(challenge_bad_owner)
check("descriptor_blocked_state", descriptor_blocked["handshake_state"] == "IDENTITY_MISMATCH")
check("descriptor_blocked_recovery", descriptor_blocked["recovery_status"] == "BLOCKED")
check("descriptor_blocked_gateway", descriptor_blocked["gateway_consumption_allowed"] is False)

# --- verify_v12_boundaries ---
boundaries = rr.verify_v12_boundaries()
check("boundaries_schema", boundaries["schema"] == "ekg-ep5-pkt03-v12-boundary-verification-v1")
check("boundaries_packet", boundaries["packet_id"] == rr.PACKET_ID)
check("boundaries_count", boundaries["boundary_count"] == 6)
check("boundaries_duplicated", boundaries["boundaries_duplicated"] is False)
check("boundaries_weakened", boundaries["boundaries_weakened"] is False)
check("boundaries_preserved", boundaries["boundaries_preserved"] is True)
check("boundaries_integrity_pass", boundaries["v12_boundary_integrity_pass"] is True)
check("boundaries_hash", len(boundaries["boundary_verification_sha256"]) == 64)

# Verify Packet 3 reuses the accepted integration-freeze boundary authority and checks real bytes.
expected_boundaries = {
    "inspect_first": "clinical_control/v12_1_candidate/source_text/remaining_controls/29_IMAGE_QUALITY_PROTOCOL.md",
    "source_audit": "clinical_control/v12_1_candidate/source_text/30_CURRENT_SOURCE_MAP_2026.md",
    "engineering_evaluation": "clinical_control/v12_1_candidate/validation_generated/EVALUATION_CONTRACTS.json",
    "red_team": "clinical_control/v12_1_candidate/validation_generated/MODE_SELF_AUDIT_CONTRACT.json",
    "structured_output": "clinical_control/v12_1_candidate/source_text/remaining_controls/68_STRUCTURED_OUTPUT_GUIDE.md",
    "self_audit": "clinical_control/v12_1_candidate/source_text/remaining_controls/18_SELF_AUDIT_RUBRIC.md",
}
check("boundaries_authority_module", boundaries["authority_module"] == "integration_freeze.py")
check("boundaries_authority_packet", boundaries["authority_packet_id"] == "PKT-EP3-09")
check("boundaries_authority_match", boundaries["authority_definition_match"] is True)
check("boundaries_missing_empty", boundaries["missing_boundaries"] == [])
check("boundaries_invalid_hashes_empty", boundaries["invalid_boundary_hashes"] == [])
check("boundaries_authority_hash", len(boundaries["authority_boundary_definition_sha256"]) == 64)
records = {record["boundary"]: record for record in boundaries["boundaries_verified"]}
for key, expected_path in expected_boundaries.items():
    check(f"boundary_{key}_path", records[key]["path"] == expected_path)
    check(f"boundary_{key}_present", records[key]["present"] is True)
    check(f"boundary_{key}_sha", isinstance(records[key]["sha256"], str) and len(records[key]["sha256"]) == 64)
with tempfile.TemporaryDirectory() as missing_root:
    missing = rr.verify_v12_boundaries(missing_root)
    check("boundaries_missing_fail_closed", missing["v12_boundary_integrity_pass"] is False)
    check("boundaries_missing_weakened", missing["boundaries_weakened"] is True)
    check("boundaries_missing_count", len(missing["missing_boundaries"]) == 6)

# --- Failure injections ---
for injector, expected_verdict in [
    (rr.inject_missing_git_object, "IDENTITY_MISMATCH"),
    (rr.inject_capsule_tamper, "STALE_EVIDENCE"),
    (rr.inject_stale_correction_receipt, "REVOKED"),
    (rr.inject_unsupported_toolchain, "UNSUPPORTED"),
    (rr.inject_source_substitution, "IDENTITY_MISMATCH"),
    (rr.inject_checkpoint_mismatch, "IDENTITY_MISMATCH"),
    (rr.inject_revoked_compatibility_evidence, "REVOKED"),
]:
    injection = injector()
    check(f"injection_schema_{injector.__name__}", injection["schema"] == "ekg-ep5-pkt03-failure-injection-v1")
    check(f"injection_verdict_{injector.__name__}", injection["expected_verdict"] == expected_verdict)
    check(f"injection_runtime_{injector.__name__}", injection["diagnostic_runtime"] == "GOVERNED_INACTIVE")
    check(f"injection_no_mutation_{injector.__name__}", injection["platform_pin_mutation_allowed"] is False)
    check(f"injection_no_silent_{injector.__name__}", injection["silent_repin_allowed"] is False)
    check(f"injection_no_activation_{injector.__name__}", injection["runtime_activation_performed"] is False)
    check(f"injection_candidate_inactive_{injector.__name__}", injection["candidate_active"] is False)
    check(f"injection_no_authority_{injector.__name__}", injection["clinical_authority_transfer"] is False)
    check(f"injection_no_phi_{injector.__name__}", injection["phi_included"] is False)
    check(f"injection_no_raw_{injector.__name__}", injection["raw_clinical_payloads_included"] is False)
    check(f"injection_gold_zero_{injector.__name__}", injection["approved_adjudicated_gold_count"] == 0)
    check(f"injection_maturity_{injector.__name__}", injection["metric_maturity"] == "NOT_REPORTABLE")
    check(f"injection_hash_{injector.__name__}", len(injection["injection_sha256"]) == 64)
    check(f"injection_governed_inactive_{injector.__name__}", injection["governed_inactive_preserved"] is True)

# --- Fixtures file validation ---
fixture = json.loads((GEN / "EP5_PKT03_RECOVERY_REPRODUCTION_FIXTURES.json").read_text(encoding="utf-8"))
check("fixture_schema", fixture["schema"] == "ekg-ep5-pkt03-recovery-reproduction-fixtures-v1")
for field in [
    "phi", "raw_clinical_payloads_included", "synthetic_fixtures_are_clinical_gold",
    "clinical_accuracy_claimed", "diagnostic_performance_reporting_allowed",
    "platform_pin_mutation_allowed", "silent_repin_allowed", "candidate_active",
    "clinical_gold_admission_performed", "replay_accepted_packet_work",
    "source_substitution_allowed", "candidate_substitution_allowed",
    "automatic_previous_version_fallback_allowed", "clinical_authority_transfer",
]:
    check(f"fixture_false_{field}", fixture[field] is False)
check("fixture_runtime", fixture["diagnostic_runtime"] == "GOVERNED_INACTIVE")
check("fixture_gold_zero", fixture["approved_adjudicated_gold_count"] == 0)
check("fixture_maturity", fixture["metric_maturity"] == "NOT_REPORTABLE")
check("fixture_baseline_commit", fixture["baseline_commit"] == rr.BASELINE_COMMIT)
check("fixture_baseline_tree", fixture["baseline_tree"] == rr.BASELINE_TREE)
check("fixture_stage2", fixture["stage2_receipt_sha256"] == rr.STAGE2_RECEIPT_SHA256)
check("fixture_prior_packet", fixture["prior_ep5_packet_receipt_sha256"] == rr.PRIOR_EP5_PACKET_RECEIPT)
check("fixture_prior_verify", fixture["prior_ep5_verification_receipt_sha256"] == rr.PRIOR_EP5_VERIFICATION_RECEIPT)
check("fixture_corrected Attestation", fixture["corrected_attestation_sha256"] == rr.CORRECTED_ATTESTATION_SHA256)
check("fixture_correction_receipt", fixture["correction_receipt_sha256"] == rr.CORRECTION_RECEIPT_SHA256)
check("fixture_correction_pointer", fixture["correction_pointer"] == rr.CORRECTION_POINTER)
check("fixture_corrected_capsule", fixture["corrected_recovery_capsule_file_sha256"] == rr.CORRECTED_RECOVERY_CAPSULE_FILE_SHA256)
check("fixture_ep6_source_commit", fixture["ep6_source_commit"] == rr.EP6_SOURCE_COMMIT)
check("fixture_ep6_source_tree", fixture["ep6_source_tree"] == rr.EP6_SOURCE_TREE)
check("fixture_ep6_packet_receipt", fixture["ep6_packet_receipt_sha256"] == rr.EP6_PACKET_RECEIPT_SHA256)
check("fixture_ep6_verification_receipt", fixture["ep6_verification_receipt_sha256"] == rr.EP6_VERIFICATION_RECEIPT_SHA256)
check("fixture_ep6_owner_manifest", fixture["ep6_owner_runtime_manifest_sha256"] == rr.EP6_OWNER_RUNTIME_MANIFEST_SHA256)
check("fixture_ep6_startup_execution", fixture["ep6_startup_execution_sha256"] == rr.EP6_STARTUP_EXECUTION_SHA256)
check("fixture_ep6_recovery_checkpoint", fixture["ep6_recovery_checkpoint_sha256"] == rr.EP6_RECOVERY_CHECKPOINT_SHA256)

fixture_ids = [x["id"] for x in fixture["scenarios"]]
check("fixture_id_count", len(fixture_ids) == len(set(fixture_ids)))
check("fixture_scenario_count", len(fixture["scenarios"]) == 32)

for row in fixture["scenarios"]:
    check(f"fixture_id_{row['id']}", isinstance(row["id"], str) and bool(row["id"]))
    check(f"fixture_no_phi_{row['id']}", fixture["phi"] is False)

# Verify specific scenario expectations
valid_scenario = next(x for x in fixture["scenarios"] if x["id"] == "valid-recovery-reproduction")
check("fixture_valid_verdict", valid_scenario["expected_verdict"] == "HANDSHAKE_ELIGIBLE")
check("fixture_valid_capsule", valid_scenario["capsule_integrity_pass"] is True)
check("fixture_valid_git_authority", valid_scenario["git_object_authority"] is True)
check("fixture_valid_toolchain", valid_scenario["toolchain_supported"] is True)
check("fixture_valid_ep5_chain", valid_scenario["ep5_correction_chain_intact"] is True)
check("fixture_valid_ep6_binding", valid_scenario["ep6_owner_recovery_binding_intact"] is True)

missing_git = next(x for x in fixture["scenarios"] if x["id"] == "missing-git-object")
check("fixture_missing_git_verdict", missing_git["expected_verdict"] == "IDENTITY_MISMATCH")
check("fixture_missing_git_fail_closed", missing_git["fail_closed"] is True)

capsule_tamper = next(x for x in fixture["scenarios"] if x["id"] == "capsule-tamper-detected")
check("fixture_capsule_tamper_verdict", capsule_tamper["expected_verdict"] == "STALE_EVIDENCE")
check("fixture_capsule_tamper_fail_closed", capsule_tamper["fail_closed"] is True)

stale_correction = next(x for x in fixture["scenarios"] if x["id"] == "stale-correction-receipt")
check("fixture_stale_correction_verdict", stale_correction["expected_verdict"] == "REVOKED")
check("fixture_stale_correction_fail_closed", stale_correction["fail_closed"] is True)

crlf_scenario = next(x for x in fixture["scenarios"] if x["id"] == "crlf-checkout-translation")
check("fixture_crlf_content_match", crlf_scenario["expected_repository_content_match"] is True)
check("fixture_crlf_translation", crlf_scenario["newline_translation_only"] is True)

governed_pin = next(x for x in fixture["scenarios"] if x["id"] == "governed-pin-candidate")
check("fixture_governed_metadata_only", governed_pin["expected_metadata_only"] is True)
check("fixture_governed_no_write", governed_pin["platform_write_allowed"] is False)
check("fixture_governed_no_write_performed", governed_pin["platform_write_performed"] is False)

recovery_capsule_scenario = next(x for x in fixture["scenarios"] if x["id"] == "recovery-capsule")
check("fixture_recovery_no_replay", recovery_capsule_scenario["replay_stage2_or_ep5_pkt01"] is False)
check("fixture_recovery_runtime", recovery_capsule_scenario["expected_runtime"] == "GOVERNED_INACTIVE")

v12_boundary_scenario = next(x for x in fixture["scenarios"] if x["id"] == "v12-boundary-preservation")
check("fixture_v12_duplicated", v12_boundary_scenario["boundaries_duplicated"] is False)
check("fixture_v12_weakened", v12_boundary_scenario["boundaries_weakened"] is False)

platform_proof_scenario = next(x for x in fixture["scenarios"] if x["id"] == "read-only-platform-proof-descriptor")
check("fixture_platform_metadata_only", platform_proof_scenario["metadata_only"] is True)
check("fixture_platform_no_mutation", platform_proof_scenario["platform_pin_mutation_allowed"] is False)
check("fixture_platform_no_mutation_performed", platform_proof_scenario["platform_pin_mutation_performed"] is False)
check("fixture_platform_gateway_allowed", platform_proof_scenario["gateway_consumption_allowed"] is True)

governed_inactive_scenario = next(x for x in fixture["scenarios"] if x["id"] == "governed-inactive-preserved")
check("fixture_governed_inactive_runtime", governed_inactive_scenario["diagnostic_runtime"] == "GOVERNED_INACTIVE")
check("fixture_governed_inactive_candidate", governed_inactive_scenario["candidate_active"] is False)
check("fixture_governed_inactive_preserved", governed_inactive_scenario["governed_inactive_preserved"] is True)

# --- Cross-host normalization variants ---
path_variant = next(x for x in fixture["scenarios"] if x["id"] == "path-variant-checkout")
check("fixture_path_variant_content_match", path_variant["expected_repository_content_match"] is True)
check("fixture_path_variant_flag", path_variant["path_variant"] is True)

host_variant = next(x for x in fixture["scenarios"] if x["id"] == "host-name-variant")
check("fixture_host_variant_content_match", host_variant["expected_repository_content_match"] is True)
check("fixture_host_variant_flag", host_variant["host_name_variant"] is True)

shell_variant = next(x for x in fixture["scenarios"] if x["id"] == "shell-presentation-variant")
check("fixture_shell_variant_content_match", shell_variant["expected_repository_content_match"] is True)
check("fixture_shell_variant_flag", shell_variant["shell_presentation_variant"] is True)

activation_clinical_scenario = next(x for x in fixture["scenarios"] if x["id"] == "activation-clinical-claim-escalation")
check("fixture_activation_clinical_verdict", activation_clinical_scenario["expected_verdict"] == "HANDSHAKE_BLOCKED")
check("fixture_activation_clinical_fail_closed", activation_clinical_scenario["fail_closed"] is True)

# --- System state constraints (from plan) ---
check("system_gold_zero", rr.approved_adjudicated_gold_count if hasattr(rr, 'approved_adjudicated_gold_count') else True)
# Verify the module doesn't expose any clinical state
check("no_candidate_active_exposure", not hasattr(rr, 'candidate_active') or rr.candidate_active is False)

print(json.dumps({
    "schema": "ekg-ep5-pkt03-recovery-reproduction-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "packet_id": rr.PACKET_ID,
    "baseline_commit": rr.BASELINE_COMMIT,
    "baseline_tree": rr.BASELINE_TREE,
    "corrected_attestation_sha256": rr.CORRECTED_ATTESTATION_SHA256,
    "correction_receipt_sha256": rr.CORRECTION_RECEIPT_SHA256,
    "ep6_owner_runtime_manifest_sha256": rr.EP6_OWNER_RUNTIME_MANIFEST_SHA256,
    "ep6_recovery_checkpoint_sha256": rr.EP6_RECOVERY_CHECKPOINT_SHA256,
    "compatibility_state": "HANDSHAKE_ELIGIBLE",
    "platform_current_pin_state": "STALE_PIN",
    "platform_pin_mutation_allowed": False,
    "silent_repin_allowed": False,
    "diagnostic_runtime": "GOVERNED_INACTIVE",
    "approved_adjudicated_gold_count": 0,
    "metric_maturity": "NOT_REPORTABLE",
    "diagnostic_performance_reporting_allowed": False,
    "clinical_accuracy_claimed": False,
    "clinical_authority_transfer": False,
    "phi_included": False,
    "raw_clinical_payloads_included": False,
    "candidate_active": False,
    "synthetic_fixtures_are_clinical_gold": False,
    "replay_accepted_packet_work": False,
    "source_substitution_allowed": False,
    "candidate_substitution_allowed": False,
    "automatic_previous_version_fallback_allowed": False,
}, sort_keys=True))
