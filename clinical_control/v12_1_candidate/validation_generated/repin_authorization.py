"""EP5 Packet 4 governed Stage-3 EKG repin authorization.

Engineering/governance metadata only. This module never mutates Platform, never
activates EKG runtime, never imports clinical payloads, and never grants clinical
authority. All state transitions are append-only evidence receipts.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Dict, Iterable, Mapping, Sequence

SCHEMA = "ekg-ep5-pkt04-repin-authorization-v1"
PACKET_ID = "PKT-EP5-04"
PACKET_SHA256 = "9fe42e2bff2c3194ba073c6747df17e57c8475db20b764df29e5d236fadd038f"
BASELINE_COMMIT = "09ec7010191ecca0336abb9fccf369ce182c89e1"
BASELINE_TREE = "6f5f1c261816f8cf33001802fdfb4237b80f387b"
STAGE2_RECEIPT_SHA256 = "6d90ee07819f1a269a239fcb969cf4d479dc3d809a3e637c9b675c8831363d7a"
PRIOR_PACKET_RECEIPT_SHA256 = "bf21e05a214a7331c3396aa567443c74943d72ac809bede01293e9c1397cfb62"
PRIOR_VERIFICATION_RECEIPT_SHA256 = "c5ed10f3720743fb9379860512c18f779531449ffd79f2259a8b3fabd4303f98"
RECOVERY_PROOF_SHA256 = "21d0c01a19bce5f5731d55469bafb01104825da9fd3fd7fe85956a21ba89944d"
HANDSHAKE_CHALLENGE_SHA256 = "cd62c4a85505c511cd03c7d786c2546174f38b53d177ba20e27923b86a289c63"
PLATFORM_DESCRIPTOR_SHA256 = "2f8d47ce9fe6dd1a97dbc0dcea4c9120269925b212b1ece6f4880953644387fe"
V12_BOUNDARY_VERIFICATION_SHA256 = "5ada5ae2f849ff6e06c0c3dd2e40d6713d12e05ef46097df698829fcffe47346"

EP6_PKT03 = {
    "source_commit": "cb9dfa805eaf5cc396f8d957525d5d1f7784280c",
    "source_tree": "95e2a56609a110ac941055acd761f4b3686ba674",
    "packet_receipt_sha256": "5c5b63f9b2c2b67e6d9ef1bca0e6bb56f8557d46b0fc221219983bd44858a4ba",
    "verification_receipt_sha256": "72abc685ede986e9f478b3d6b901e6868a8121094eedefad0a39f66e8b30b810",
    "continuity_contract_file_sha256": "e26204653eac44038f1e312ffe33d4745c30130dabddb27a6ab562817fa6f7e0",
    "operational_state": "DEGRADED",
    "freshness_state": "STALE_PIN",
    "diagnostic_runtime": "GOVERNED_INACTIVE",
    "evidence_runtime_authority": "NON_RUNTIME_AUTHORITY",
}

HISTORICAL_STAGE2_PIN = {
    "repository": "Cardiology-NP-OS/EKG-Interpretations",
    "commit": "6fbf1814258813bfb6ff78407e013cf23ff9e07d",
    "tree": "01442274b34bf40ae600ee1ee21de8f15ae3b4de",
    "runtime_status": "GOVERNED_INACTIVE",
}
AUTHORIZED_STAGE3_DESTINATION = {
    "repository": "Cardiology-NP-OS/EKG-Interpretations",
    "commit": BASELINE_COMMIT,
    "tree": BASELINE_TREE,
    "runtime_status": "GOVERNED_INACTIVE",
}
AUTHORIZATION_STATES = ("ELIGIBLE", "BLOCKED", "REVOKED", "CONSUMED")
REVOCATION_TRIGGERS = (
    "PLATFORM_DRIFT", "EKG_DRIFT", "HISTORICAL_PIN_MISMATCH", "STALE_EVIDENCE",
    "REVOKED_EVIDENCE", "HANDSHAKE_MISMATCH", "CONTINUITY_MISMATCH",
    "MISSING_INDEPENDENT_VERIFICATION", "MISSING_CI_PROOF", "PROVENANCE_MALFORMED",
    "SOURCE_SUBSTITUTION", "AUTHORITY_ESCALATION", "MANIFEST_TAMPER",
    "RUNTIME_ACTIVATION_ATTEMPT", "CLINICAL_VALIDITY_ESCALATION",
)
_H40 = re.compile(r"^[a-f0-9]{40}$")
_H64 = re.compile(r"^[a-f0-9]{64}$")
_ID = re.compile(r"^[a-z0-9][a-z0-9._:-]{2,119}$")


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def digest(value: Any) -> str:
    if isinstance(value, bytes):
        return hashlib.sha256(value).hexdigest()
    return hashlib.sha256(_canonical(value)).hexdigest()


def _clone(value: Any) -> Any:
    return json.loads(json.dumps(value))


def _hash(value: str, length: int, code: str) -> str:
    regex = _H40 if length == 40 else _H64
    if not isinstance(value, str) or not regex.fullmatch(value):
        raise ValueError(code)
    return value


def _safe_id(value: str, code: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(code)
    return value


def _pin(value: Mapping[str, Any], code: str) -> Dict[str, str]:
    if not isinstance(value, Mapping):
        raise ValueError(code)
    allowed = {"repository", "commit", "tree", "runtime_status"}
    if set(value) != allowed:
        raise ValueError(code)
    repository = value.get("repository")
    if repository != "Cardiology-NP-OS/EKG-Interpretations":
        raise ValueError(code)
    commit = _hash(value.get("commit"), 40, code)
    tree = _hash(value.get("tree"), 40, code)
    if value.get("runtime_status") != "GOVERNED_INACTIVE":
        raise ValueError(code)
    return {"repository": repository, "commit": commit, "tree": tree, "runtime_status": "GOVERNED_INACTIVE"}


def _challenge_material(*, historical_pin: Mapping[str, Any], destination: Mapping[str, Any],
                        platform_commit: str, platform_tree: str,
                        recovery_proof_sha256: str, handshake_challenge_sha256: str,
                        platform_descriptor_sha256: str, continuity_contract_file_sha256: str) -> Dict[str, Any]:
    return {
        "schema": "ekg-ep5-pkt04-authorization-challenge-material-v1",
        "packet_id": PACKET_ID,
        "packet_sha256": PACKET_SHA256,
        "historical_pin": _clone(historical_pin),
        "authorized_destination": _clone(destination),
        "target_platform": {"commit": platform_commit, "tree": platform_tree},
        "ep5_pkt03": {
            "packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
            "verification_receipt_sha256": PRIOR_VERIFICATION_RECEIPT_SHA256,
            "recovery_proof_sha256": recovery_proof_sha256,
            "handshake_challenge_sha256": handshake_challenge_sha256,
            "platform_descriptor_sha256": platform_descriptor_sha256,
        },
        "ep6_pkt03": {
            "packet_receipt_sha256": EP6_PKT03["packet_receipt_sha256"],
            "verification_receipt_sha256": EP6_PKT03["verification_receipt_sha256"],
            "continuity_contract_file_sha256": continuity_contract_file_sha256,
        },
    }


def create_repin_authorization(
    *,
    historical_pin: Mapping[str, Any] = HISTORICAL_STAGE2_PIN,
    destination: Mapping[str, Any] = AUTHORIZED_STAGE3_DESTINATION,
    platform_commit: str = EP6_PKT03["source_commit"],
    platform_tree: str = EP6_PKT03["source_tree"],
    recovery_proof_sha256: str = RECOVERY_PROOF_SHA256,
    handshake_challenge_sha256: str = HANDSHAKE_CHALLENGE_SHA256,
    platform_descriptor_sha256: str = PLATFORM_DESCRIPTOR_SHA256,
    v12_boundary_verification_sha256: str = V12_BOUNDARY_VERIFICATION_SHA256,
    ep6_packet_receipt_sha256: str = EP6_PKT03["packet_receipt_sha256"],
    ep6_verification_receipt_sha256: str = EP6_PKT03["verification_receipt_sha256"],
    continuity_contract_file_sha256: str = EP6_PKT03["continuity_contract_file_sha256"],
    independent_verification_pass: bool = True,
    candidate_ci_pass: bool = True,
    main_ci_pass: bool = True,
    source_substitution_attempt: bool = False,
    runtime_activation_attempt: bool = False,
    authority_escalation_attempt: bool = False,
    clinical_validity_escalation_attempt: bool = False,
) -> Dict[str, Any]:
    hist = _pin(historical_pin, "HISTORICAL_PIN_INVALID")
    dest = _pin(destination, "DESTINATION_PIN_INVALID")
    platform_commit = _hash(platform_commit, 40, "PLATFORM_COMMIT_INVALID")
    platform_tree = _hash(platform_tree, 40, "PLATFORM_TREE_INVALID")
    proof_fields = {
        "recovery_proof_sha256": _hash(recovery_proof_sha256, 64, "RECOVERY_PROOF_INVALID"),
        "handshake_challenge_sha256": _hash(handshake_challenge_sha256, 64, "HANDSHAKE_PROOF_INVALID"),
        "platform_descriptor_sha256": _hash(platform_descriptor_sha256, 64, "PLATFORM_DESCRIPTOR_INVALID"),
        "v12_boundary_verification_sha256": _hash(v12_boundary_verification_sha256, 64, "V12_PROOF_INVALID"),
        "ep6_packet_receipt_sha256": _hash(ep6_packet_receipt_sha256, 64, "EP6_PACKET_RECEIPT_INVALID"),
        "ep6_verification_receipt_sha256": _hash(ep6_verification_receipt_sha256, 64, "EP6_VERIFICATION_RECEIPT_INVALID"),
        "continuity_contract_file_sha256": _hash(continuity_contract_file_sha256, 64, "CONTINUITY_CONTRACT_INVALID"),
    }
    for flag, code in [
        (independent_verification_pass, "INDEPENDENT_VERIFICATION_BOOLEAN_REQUIRED"),
        (candidate_ci_pass, "CANDIDATE_CI_BOOLEAN_REQUIRED"),
        (main_ci_pass, "MAIN_CI_BOOLEAN_REQUIRED"),
        (source_substitution_attempt, "SOURCE_SUBSTITUTION_BOOLEAN_REQUIRED"),
        (runtime_activation_attempt, "RUNTIME_ACTIVATION_BOOLEAN_REQUIRED"),
        (authority_escalation_attempt, "AUTHORITY_ESCALATION_BOOLEAN_REQUIRED"),
        (clinical_validity_escalation_attempt, "CLINICAL_VALIDITY_ESCALATION_BOOLEAN_REQUIRED"),
    ]:
        if type(flag) is not bool:
            raise ValueError(code)

    blockers = []
    if hist != HISTORICAL_STAGE2_PIN:
        blockers.append("HISTORICAL_PIN_MISMATCH")
    if dest != AUTHORIZED_STAGE3_DESTINATION:
        blockers.append("EKG_DRIFT")
    if platform_commit != EP6_PKT03["source_commit"] or platform_tree != EP6_PKT03["source_tree"]:
        blockers.append("PLATFORM_DRIFT")
    if proof_fields["recovery_proof_sha256"] != RECOVERY_PROOF_SHA256:
        blockers.append("STALE_EVIDENCE")
    if proof_fields["handshake_challenge_sha256"] != HANDSHAKE_CHALLENGE_SHA256:
        blockers.append("HANDSHAKE_MISMATCH")
    if proof_fields["platform_descriptor_sha256"] != PLATFORM_DESCRIPTOR_SHA256:
        blockers.append("STALE_EVIDENCE")
    if proof_fields["v12_boundary_verification_sha256"] != V12_BOUNDARY_VERIFICATION_SHA256:
        blockers.append("STALE_EVIDENCE")
    if proof_fields["ep6_packet_receipt_sha256"] != EP6_PKT03["packet_receipt_sha256"]:
        blockers.append("CONTINUITY_MISMATCH")
    if proof_fields["ep6_verification_receipt_sha256"] != EP6_PKT03["verification_receipt_sha256"]:
        blockers.append("CONTINUITY_MISMATCH")
    if proof_fields["continuity_contract_file_sha256"] != EP6_PKT03["continuity_contract_file_sha256"]:
        blockers.append("CONTINUITY_MISMATCH")
    if not independent_verification_pass:
        blockers.append("MISSING_INDEPENDENT_VERIFICATION")
    if not candidate_ci_pass or not main_ci_pass:
        blockers.append("MISSING_CI_PROOF")
    if source_substitution_attempt:
        blockers.append("SOURCE_SUBSTITUTION")
    if runtime_activation_attempt:
        blockers.append("RUNTIME_ACTIVATION_ATTEMPT")
    if authority_escalation_attempt:
        blockers.append("AUTHORITY_ESCALATION")
    if clinical_validity_escalation_attempt:
        blockers.append("CLINICAL_VALIDITY_ESCALATION")
    blockers = sorted(set(blockers))

    challenge_material = _challenge_material(
        historical_pin=hist,
        destination=dest,
        platform_commit=platform_commit,
        platform_tree=platform_tree,
        recovery_proof_sha256=proof_fields["recovery_proof_sha256"],
        handshake_challenge_sha256=proof_fields["handshake_challenge_sha256"],
        platform_descriptor_sha256=proof_fields["platform_descriptor_sha256"],
        continuity_contract_file_sha256=proof_fields["continuity_contract_file_sha256"],
    )
    body = {
        "schema": SCHEMA,
        "packet_id": PACKET_ID,
        "packet_sha256": PACKET_SHA256,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage2_receipt_sha256": STAGE2_RECEIPT_SHA256,
        "prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "prior_verification_receipt_sha256": PRIOR_VERIFICATION_RECEIPT_SHA256,
        "historical_stage2_pin": hist,
        "authorized_stage3_destination": dest,
        "target_platform": {"commit": platform_commit, "tree": platform_tree},
        "proof_bindings": proof_fields,
        "independent_verification_pass": independent_verification_pass,
        "candidate_ci_pass": candidate_ci_pass,
        "main_ci_pass": main_ci_pass,
        "source_substitution_attempt": source_substitution_attempt,
        "runtime_activation_attempt": runtime_activation_attempt,
        "authority_escalation_attempt": authority_escalation_attempt,
        "clinical_validity_escalation_attempt": clinical_validity_escalation_attempt,
        "authorization_challenge_sha256": digest(challenge_material),
        "state": "ELIGIBLE" if not blockers else "BLOCKED",
        "residual_blockers": blockers,
        "metadata_only": True,
        "single_use": True,
        "replay_allowed": False,
        "renewal_requires_new_governed_authorization": True,
        "historical_stage2_pin_immutable": True,
        "platform_mutation_performed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "platform_freshness_before_consumption": "STALE_PIN",
        "platform_freshness_after_authorization": "STALE_PIN",
        "clinical_validity": "NOT_INFERRED",
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "clinical_authority_transfer": False,
        "source_substitution_allowed": False,
        "automatic_previous_version_fallback_allowed": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "credentials_included": False,
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
    }
    return {**body, "authorization_sha256": digest(body)}


def validate_authorization(value: Mapping[str, Any]) -> bool:
    if not isinstance(value, Mapping):
        return False
    try:
        declared = value.get("authorization_sha256")
        if not isinstance(declared, str) or not _H64.fullmatch(declared):
            return False
        kwargs = {
            "historical_pin": value["historical_stage2_pin"],
            "destination": value["authorized_stage3_destination"],
            "platform_commit": value["target_platform"]["commit"],
            "platform_tree": value["target_platform"]["tree"],
            **value["proof_bindings"],
            "independent_verification_pass": value["independent_verification_pass"],
            "candidate_ci_pass": value["candidate_ci_pass"],
            "main_ci_pass": value["main_ci_pass"],
            "source_substitution_attempt": value["source_substitution_attempt"],
            "runtime_activation_attempt": value["runtime_activation_attempt"],
            "authority_escalation_attempt": value["authority_escalation_attempt"],
            "clinical_validity_escalation_attempt": value["clinical_validity_escalation_attempt"],
        }
        rebuilt = create_repin_authorization(**kwargs)
        return _canonical(rebuilt) == _canonical(dict(value))
    except (KeyError, TypeError, ValueError):
        return False


def _validate_consumption_receipt(receipt: Mapping[str, Any], authorization_sha256: str) -> bool:
    if not isinstance(receipt, Mapping) or receipt.get("schema") != "ekg-ep5-pkt04-authorization-consumption-v1":
        return False
    try:
        if receipt.get("authorization_sha256") != authorization_sha256 or receipt.get("state") != "CONSUMED":
            return False
        declared = receipt.get("consumption_receipt_sha256")
        if not isinstance(declared, str) or not _H64.fullmatch(declared):
            return False
        body = dict(receipt)
        del body["consumption_receipt_sha256"]
        return digest(body) == declared
    except (KeyError, TypeError):
        return False


def _validate_revocation_receipt(receipt: Mapping[str, Any], authorization_sha256: str) -> bool:
    if not isinstance(receipt, Mapping) or receipt.get("schema") != "ekg-ep5-pkt04-authorization-revocation-v1":
        return False
    try:
        if receipt.get("authorization_sha256") != authorization_sha256 or receipt.get("state") != "REVOKED":
            return False
        if receipt.get("trigger") not in REVOCATION_TRIGGERS:
            return False
        declared = receipt.get("revocation_receipt_sha256")
        if not isinstance(declared, str) or not _H64.fullmatch(declared):
            return False
        body = dict(receipt)
        del body["revocation_receipt_sha256"]
        return digest(body) == declared
    except (KeyError, TypeError):
        return False


def authorization_status(
    authorization: Mapping[str, Any],
    *,
    consumption_receipts: Sequence[Mapping[str, Any]] = (),
    revocation_receipts: Sequence[Mapping[str, Any]] = (),
) -> Dict[str, Any]:
    if not validate_authorization(authorization):
        raise ValueError("AUTHORIZATION_INVALID")
    auth_hash = authorization["authorization_sha256"]
    consumptions = [r for r in consumption_receipts if _validate_consumption_receipt(r, auth_hash)]
    revocations = [r for r in revocation_receipts if _validate_revocation_receipt(r, auth_hash)]
    if revocations:
        state = "REVOKED"
    elif consumptions:
        state = "CONSUMED"
    else:
        state = authorization["state"]
    body = {
        "schema": "ekg-ep5-pkt04-authorization-status-v1",
        "authorization_sha256": auth_hash,
        "state": state,
        "valid_consumption_count": len(consumptions),
        "valid_revocation_count": len(revocations),
        "single_use": True,
        "replay_allowed": False,
        "platform_mutation_performed": False,
        "runtime_activation_performed": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "clinical_authority_transfer": False,
    }
    return {**body, "status_sha256": digest(body)}


def consume_authorization(
    authorization: Mapping[str, Any],
    *,
    consumption_id: str,
    existing_consumptions: Sequence[Mapping[str, Any]] = (),
    existing_revocations: Sequence[Mapping[str, Any]] = (),
    observed_platform_commit: str = EP6_PKT03["source_commit"],
    observed_platform_tree: str = EP6_PKT03["source_tree"],
    observed_destination_commit: str = BASELINE_COMMIT,
    observed_destination_tree: str = BASELINE_TREE,
) -> Dict[str, Any]:
    if not validate_authorization(authorization):
        raise ValueError("AUTHORIZATION_INVALID")
    status = authorization_status(
        authorization, consumption_receipts=existing_consumptions, revocation_receipts=existing_revocations
    )
    if status["state"] == "REVOKED":
        raise ValueError("AUTHORIZATION_REVOKED")
    if status["state"] == "CONSUMED":
        raise ValueError("AUTHORIZATION_ALREADY_CONSUMED")
    if status["state"] != "ELIGIBLE":
        raise ValueError("AUTHORIZATION_NOT_ELIGIBLE")
    consumption_id = _safe_id(consumption_id, "CONSUMPTION_ID_INVALID")
    if _hash(observed_platform_commit, 40, "OBSERVED_PLATFORM_COMMIT_INVALID") != authorization["target_platform"]["commit"]:
        raise ValueError("PLATFORM_TARGET_DRIFT")
    if _hash(observed_platform_tree, 40, "OBSERVED_PLATFORM_TREE_INVALID") != authorization["target_platform"]["tree"]:
        raise ValueError("PLATFORM_TARGET_DRIFT")
    if _hash(observed_destination_commit, 40, "OBSERVED_DESTINATION_COMMIT_INVALID") != authorization["authorized_stage3_destination"]["commit"]:
        raise ValueError("EKG_DESTINATION_DRIFT")
    if _hash(observed_destination_tree, 40, "OBSERVED_DESTINATION_TREE_INVALID") != authorization["authorized_stage3_destination"]["tree"]:
        raise ValueError("EKG_DESTINATION_DRIFT")
    body = {
        "schema": "ekg-ep5-pkt04-authorization-consumption-v1",
        "packet_id": PACKET_ID,
        "authorization_sha256": authorization["authorization_sha256"],
        "consumption_id": consumption_id,
        "state": "CONSUMED",
        "observed_platform": {"commit": observed_platform_commit, "tree": observed_platform_tree},
        "observed_destination": {"commit": observed_destination_commit, "tree": observed_destination_tree},
        "single_use": True,
        "replay_allowed": False,
        "downstream_platform_mutation_authorized": True,
        "platform_mutation_performed_by_ep5": False,
        "runtime_activation_authorized": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "credentials_included": False,
    }
    return {**body, "consumption_receipt_sha256": digest(body)}


def revoke_authorization(
    authorization: Mapping[str, Any], *, trigger: str, reason: str
) -> Dict[str, Any]:
    if not validate_authorization(authorization):
        raise ValueError("AUTHORIZATION_INVALID")
    if trigger not in REVOCATION_TRIGGERS:
        raise ValueError("REVOCATION_TRIGGER_UNSUPPORTED")
    if not isinstance(reason, str) or not reason.strip() or len(reason.strip()) > 280:
        raise ValueError("REVOCATION_REASON_INVALID")
    body = {
        "schema": "ekg-ep5-pkt04-authorization-revocation-v1",
        "packet_id": PACKET_ID,
        "authorization_sha256": authorization["authorization_sha256"],
        "state": "REVOKED",
        "trigger": trigger,
        "reason": reason.strip(),
        "append_only": True,
        "historical_stage2_pin_preserved": True,
        "platform_mutation_performed": False,
        "runtime_activation_performed": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "credentials_included": False,
    }
    return {**body, "revocation_receipt_sha256": digest(body)}


def authorization_descriptor(
    authorization: Mapping[str, Any],
    *,
    consumption_receipts: Sequence[Mapping[str, Any]] = (),
    revocation_receipts: Sequence[Mapping[str, Any]] = (),
) -> Dict[str, Any]:
    if not validate_authorization(authorization):
        raise ValueError("AUTHORIZATION_INVALID")
    status = authorization_status(
        authorization, consumption_receipts=consumption_receipts, revocation_receipts=revocation_receipts
    )
    body = {
        "schema": "ekg-ep5-pkt04-downstream-authorization-descriptor-v1",
        "packet_id": PACKET_ID,
        "authorization_sha256": authorization["authorization_sha256"],
        "state": status["state"],
        "historical_stage2_pin": _clone(authorization["historical_stage2_pin"]),
        "authorized_stage3_destination": _clone(authorization["authorized_stage3_destination"]),
        "target_platform": _clone(authorization["target_platform"]),
        "residual_blockers": list(authorization["residual_blockers"]),
        "single_use": True,
        "replay_allowed": False,
        "metadata_only": True,
        "platform_mutation_performed": False,
        "runtime_activation_performed": False,
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "clinical_validity": "NOT_INFERRED",
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "clinical_authority_transfer": False,
        "phi_included": False,
        "raw_clinical_payloads_included": False,
        "credentials_included": False,
        "approved_adjudicated_gold_count": 0,
        "metric_maturity": "NOT_REPORTABLE",
    }
    return {**body, "descriptor_sha256": digest(body)}


def git_object_portability(git_blob_bytes: bytes, checkout_bytes: bytes) -> Dict[str, Any]:
    blob_sha = hashlib.sha256(git_blob_bytes).hexdigest()
    checkout_sha = hashlib.sha256(checkout_bytes).hexdigest()
    normalized = checkout_bytes.replace(b"\r\n", b"\n")
    normalized_sha = hashlib.sha256(normalized).hexdigest()
    translation_only = checkout_sha != blob_sha and normalized_sha == blob_sha
    body = {
        "schema": "ekg-ep5-pkt04-git-object-portability-v1",
        "git_blob_sha256": blob_sha,
        "checkout_sha256": checkout_sha,
        "normalized_checkout_sha256": normalized_sha,
        "newline_translation_only": translation_only,
        "repository_content_match": checkout_sha == blob_sha or translation_only,
        "authority_basis": "GIT_OBJECT_BYTES",
        "host_path_authoritative": False,
        "machine_name_authoritative": False,
        "shell_presentation_authoritative": False,
    }
    return {**body, "portability_sha256": digest(body)}
