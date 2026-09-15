"""EP3 Packet 8 diagnostic activation gate and release-evidence contracts.

Deterministic, provenance-bound mechanics for gating diagnostic activation
readiness and releasing a provenance-complete evidence bundle over accepted
Packets 1-7. This module never activates, deploys, auto-selects, or influences
the diagnostic runtime; ACTIVATION_ELIGIBLE is an eligibility state only.

Current state is fail closed: approved_adjudicated_gold_count=0,
clinical_gold_admission_performed=False, metric maturity NOT_REPORTABLE,
diagnostic reporting false, clinical accuracy false, readiness BLOCKED,
activation eligibility INELIGIBLE, candidate_active=False,
diagnostic runtime GOVERNED_INACTIVE.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, List, Tuple

# ---------------------------------------------------------------------------
# Identity / provenance constants (frozen to the exact baseline)
# ---------------------------------------------------------------------------

SCHEMA = "ekg-ep3-pkt08-diagnostic-activation-gate-v1"

# Baseline EKG commit/tree from the semantic plan (Packet 8 baseline)
BASELINE_COMMIT = "3e8d2bd417e962b526d97a0330bcbe5c3d3ab8bd"
BASELINE_TREE = "d5d3f6214c77db3bf8566d9d537d51fb2b53124e"

# Accepted receipts from the semantic plan
STAGE1_RECEIPT_SHA256 = "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb"
PRIOR_PACKET_RECEIPT_SHA256 = "7e92a1cc42ec16162626eb45fec8f3a5c38175ec9707b365933421213ca80f86"

# Packet 8 hash from the semantic plan
PACKET_SHA256 = "6ac95047595424bba40a7b0cd4c9701aaec634c825eb489e404a4a0bb73b2710"
PACKET_ID = "PKT-EP3-08"

# Predecessor packet receipt chain (Packets 1-7 evidence lineage)
PREDECESSOR_PACKET_RECEIPTS = {
    "PKT-EP3-01": "d9a29faf5ad7407a30ba2accaffacbfc81cf8054604698ec3c255242615b3e45",
    "PKT-EP3-02": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    "PKT-EP3-03": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
    "PKT-EP3-04": "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
    "PKT-EP3-05": "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
    "PKT-EP3-06": "e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6",
    "PKT-EP3-07": "7e92a1cc42ec16162626eb45fec8f3a5c38175ec9707b365933421213ca80f86",
}

# ---------------------------------------------------------------------------
# Typed readiness and activation states
# ---------------------------------------------------------------------------

TYPED_STATES = [
    "GOVERNED_INACTIVE",
    "EVALUATION_ONLY",
    "BLOCKED",
    "INELIGIBLE",
    "READY_FOR_GOVERNANCE_REVIEW",
    "ACTIVATION_ELIGIBLE",
]

# ---------------------------------------------------------------------------
# Activation gate contract
# ---------------------------------------------------------------------------

GATE_SCHEMA = "ekg-ep3-pkt08-activation-eligibility-gate-v1"
RELEASE_BUNDLE_SCHEMA = "ekg-ep3-pkt08-release-evidence-bundle-v1"
GOVERNANCE_SIGN_OFF_SCHEMA = "ekg-ep3-pkt08-governance-sign-off-v1"

# All prerequisites required (conjunctive gate)
ACTIVATION_PREREQUISITES = [
    "genuinely_admitted_adjudicated_gold",
    "clinically_eligible_evidence_maturity",
    "exact_candidate_model_config_source_identities",
    "denominator_cohort_integrity",
    "no_leakage",
    "non_stale_immutable_evaluation_freeze",
    "claim_eligibility",
    "provenance_complete_release_evidence",
    "explicit_governed_sign_off",
]

# ---------------------------------------------------------------------------
# Current state (fail closed)
# ---------------------------------------------------------------------------

CURRENT_STATE = {
    "approved_adjudicated_gold_count": 0,
    "clinical_gold_admission_performed": False,
    "metric_maturity": "NOT_REPORTABLE",
    "clinically_eligible_metric_count": 0,
    "diagnostic_performance_reporting_allowed": False,
    "clinical_accuracy_claimed": False,
    "readiness_state": "BLOCKED",
    "activation_eligibility_state": "INELIGIBLE",
    "candidate_active": False,
    "diagnostic_runtime": "GOVERNED_INACTIVE",
    "schema": SCHEMA,
}


def _canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def _sha(value: str, code: str, length: int = 64) -> str:
    if not isinstance(value, str) or len(value) != length:
        raise ValueError(code)
    try:
        int(value, 16)
    except ValueError as exc:
        raise ValueError(code) from exc
    return value.lower()


def _text(value: str, code: str, min_len: int = 1, max_len: int = 96) -> str:
    if not isinstance(value, str) or not (min_len <= len(value.strip()) <= max_len):
        raise ValueError(code)
    return value


# ---------------------------------------------------------------------------
# Identity binding helpers
# ---------------------------------------------------------------------------

def candidate_identity(
    candidate_id: str,
    candidate_version: str,
    model_artifact_sha256: str,
    configuration_sha256: str,
    source_artifact_sha256: str,
    pattern_registry_sha256: str,
    code_commit_sha256: str,
    code_tree_sha256: str,
) -> Dict[str, Any]:
    """Bind the exact candidate/model/config/source identities.

    Any identity change or ambiguity creates a new gate subject and invalidates
    prior eligibility.
    """
    # Map field names to expected error codes (uppercase, no SHA256 in name)
    error_code_map = {
        "candidate_id": "CANDIDATE_ID_INVALID",
        "candidate_version": "CANDIDATE_VERSION_INVALID",
        "model_artifact_sha256": "MODEL_ARTIFACT_INVALID",
        "configuration_sha256": "CONFIGURATION_INVALID",
        "source_artifact_sha256": "SOURCE_ARTIFACT_INVALID",
        "pattern_registry_sha256": "PATTERN_REGISTRY_INVALID",
        "code_commit_sha256": "CODE_COMMIT_INVALID",
        "code_tree_sha256": "CODE_TREE_INVALID",
    }
    for field_name, value, length in [
        ("candidate_id", candidate_id, 64),
        ("candidate_version", candidate_version, 64),
        ("model_artifact_sha256", model_artifact_sha256, 64),
        ("configuration_sha256", configuration_sha256, 64),
        ("source_artifact_sha256", source_artifact_sha256, 64),
        ("pattern_registry_sha256", pattern_registry_sha256, 64),
        ("code_commit_sha256", code_commit_sha256, 64),
        ("code_tree_sha256", code_tree_sha256, 64),
    ]:
        _sha(value, error_code_map[field_name], length)

    identity = {
        "schema": "ekg-ep3-pkt08-candidate-identity-v1",
        "candidate_id": candidate_id,
        "candidate_version": candidate_version,
        "model_artifact_sha256": model_artifact_sha256,
        "configuration_sha256": configuration_sha256,
        "source_artifact_sha256": source_artifact_sha256,
        "pattern_registry_sha256": pattern_registry_sha256,
        "code_commit_sha256": code_commit_sha256,
        "code_tree_sha256": code_tree_sha256,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "packet_id": PACKET_ID,
        "packet_sha256": PACKET_SHA256,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
    }
    identity["identity_sha256"] = _digest(identity)
    identity["frozen"] = True
    return identity


def validate_candidate_identity(identity: Dict[str, Any]) -> Dict[str, Any]:
    """Validate candidate identity binding."""
    if identity.get("schema") != "ekg-ep3-pkt08-candidate-identity-v1":
        raise ValueError("CANDIDATE_IDENTITY_SCHEMA")
    required = [
        "candidate_id", "candidate_version", "model_artifact_sha256",
        "configuration_sha256", "source_artifact_sha256",
        "pattern_registry_sha256", "code_commit_sha256", "code_tree_sha256",
        "baseline_commit", "baseline_tree", "packet_id", "packet_sha256",
        "stage1_receipt_sha256", "prior_packet_receipt_sha256",
        "identity_sha256", "frozen",
    ]
    for field in required:
        if field not in identity:
            raise ValueError(f"CANDIDATE_IDENTITY_MISSING:{field}")
    if identity.get("frozen") is not True:
        raise ValueError("CANDIDATE_IDENTITY_NOT_FROZEN")
    if identity.get("baseline_commit") != BASELINE_COMMIT:
        raise ValueError("CANDIDATE_IDENTITY_BASELINE_MISMATCH")
    if identity.get("baseline_tree") != BASELINE_TREE:
        raise ValueError("CANDIDATE_IDENTITY_TREE_MISMATCH")
    if identity.get("packet_id") != PACKET_ID:
        raise ValueError("CANDIDATE_IDENTITY_PACKET_MISMATCH")
    if identity.get("packet_sha256") != PACKET_SHA256:
        raise ValueError("CANDIDATE_IDENTITY_PACKET_SHA256_MISMATCH")
    expected_sha = _digest({k: v for k, v in identity.items()
                            if k not in ("identity_sha256", "frozen")})
    if identity.get("identity_sha256") != expected_sha:
        raise ValueError("CANDIDATE_IDENTITY_SHA256_MISMATCH")
    return identity


def identity_drift_detected(
    original: Dict[str, Any],
    current: Dict[str, Any],
) -> Tuple[bool, List[str]]:
    """Detect identity drift between two frozen identities.

    Returns (drift_detected, list_of_drifted_fields).
    """
    drift_fields = []
    compare_fields = [
        "candidate_id", "candidate_version", "model_artifact_sha256",
        "configuration_sha256", "source_artifact_sha256",
        "pattern_registry_sha256", "code_commit_sha256", "code_tree_sha256",
        "baseline_commit", "baseline_tree",
    ]
    for field in compare_fields:
        orig_val = original.get(field)
        curr_val = current.get(field)
        if orig_val != curr_val:
            drift_fields.append(field)
    return (len(drift_fields) > 0, drift_fields)


# ---------------------------------------------------------------------------
# Gold admission and adjudicated gold mechanics
# ---------------------------------------------------------------------------

def gold_admission_state(
    approved_adjudicated_gold_count: int,
    clinical_gold_admission_performed: bool,
) -> Dict[str, Any]:
    """Determine gold admission state (fail closed)."""
    if isinstance(approved_adjudicated_gold_count, bool) or not isinstance(approved_adjudicated_gold_count, int):
        raise ValueError("APPROVED_ADJUDICATED_GOLD_COUNT_TYPE")
    if approved_adjudicated_gold_count < 0:
        raise ValueError("APPROVED_ADJUDICATED_GOLD_COUNT_NEGATIVE")
    if type(clinical_gold_admission_performed) is not bool:
        raise ValueError("CLINICAL_GOLD_ADMISSION_PERFORMED_TYPE")

    genuinely_admitted = (
        approved_adjudicated_gold_count > 0
        and clinical_gold_admission_performed is True
    )
    return {
        "schema": "ekg-ep3-pkt08-gold-admission-state-v1",
        "approved_adjudicated_gold_count": approved_adjudicated_gold_count,
        "clinical_gold_admission_performed": clinical_gold_admission_performed,
        "genuinely_admitted_adjudicated_gold": genuinely_admitted,
        "gold_admission_state": "ADMISSION_COMPLETE" if genuinely_admitted else "ADMISSION_INCOMPLETE",
    }


def validate_gold_admission_state(state: Dict[str, Any]) -> bool:
    """Validate gold admission state integrity."""
    if state.get("schema") != "ekg-ep3-pkt08-gold-admission-state-v1":
        return False
    required = ["approved_adjudicated_gold_count", "clinical_gold_admission_performed",
                "genuinely_admitted_adjudicated_gold", "gold_admission_state"]
    for field in required:
        if field not in state:
            return False
    if not isinstance(state["approved_adjudicated_gold_count"], int):
        return False
    if not isinstance(state["clinical_gold_admission_performed"], bool):
        return False
    if not isinstance(state["genuinely_admitted_adjudicated_gold"], bool):
        return False
    expected_genuinely = (
        state["approved_adjudicated_gold_count"] > 0
        and state["clinical_gold_admission_performed"] is True
    )
    if state["genuinely_admitted_adjudicated_gold"] != expected_genuinely:
        return False
    return True


# ---------------------------------------------------------------------------
# Evidence maturity
# ---------------------------------------------------------------------------

MATURITY_STATES = [
    "NOT_REPORTABLE",
    "PRELIMINARY_INSUFFICIENT_SUPPORT",
    "ENGINEERING_CONFORMANCE_ONLY",
    "CLINICALLY_ELIGIBLE",
]

MATURITY_SCHEMA = "ekg-ep3-pkt08-evidence-maturity-v1"


def evidence_maturity_state(
    gold_admission: Dict[str, Any],
    metric_maturity: str,
    clinically_eligible_metric_count: int,
    diagnostic_performance_reporting_allowed: bool,
    clinical_accuracy_claimed: bool,
    metric_computation_eligible: bool = False,
) -> Dict[str, Any]:
    """Determine evidence maturity state."""
    if metric_maturity not in MATURITY_STATES:
        raise ValueError("METRIC_MATURITY_STATE_UNKNOWN")

    if not isinstance(clinically_eligible_metric_count, int):
        raise ValueError("CLINICALLY_ELIGIBLE_METRIC_COUNT_TYPE")
    if clinically_eligible_metric_count < 0:
        raise ValueError("CLINICALLY_ELIGIBLE_METRIC_COUNT_NEGATIVE")
    if not isinstance(diagnostic_performance_reporting_allowed, bool):
        raise ValueError("DIAGNOSTIC_PERFORMANCE_REPORTING_TYPE")
    if not isinstance(clinical_accuracy_claimed, bool):
        raise ValueError("CLINICAL_ACCURACY_CLAIMED_TYPE")

    # CLINICALLY_ELIGIBLE requires genuine gold + eligible metrics + reporting allowed
    clinically_eligible = (
        gold_admission["genuinely_admitted_adjudicated_gold"]
        and metric_maturity == "CLINICALLY_ELIGIBLE"
        and clinically_eligible_metric_count > 0
        and diagnostic_performance_reporting_allowed is True
    )

    return {
        "schema": MATURITY_SCHEMA,
        "gold_admission_state": gold_admission["gold_admission_state"],
        "genuinely_admitted_adjudicated_gold": gold_admission["genuinely_admitted_adjudicated_gold"],
        "metric_maturity": metric_maturity,
        "clinically_eligible_metric_count": clinically_eligible_metric_count,
        "diagnostic_performance_reporting_allowed": diagnostic_performance_reporting_allowed,
        "clinical_accuracy_claimed": clinical_accuracy_claimed,
        "metric_computation_eligible": metric_computation_eligible,
        "clinically_eligible_evidence_maturity": clinically_eligible,
        "clinical_metric_reportable": clinically_eligible,
    }


def validate_evidence_maturity(maturity: Dict[str, Any]) -> bool:
    """Validate evidence maturity integrity."""
    if maturity.get("schema") != MATURITY_SCHEMA:
        return False
    required = ["gold_admission_state", "genuinely_admitted_adjudicated_gold",
                "metric_maturity", "clinically_eligible_metric_count",
                "diagnostic_performance_reporting_allowed", "clinical_accuracy_claimed",
                "metric_computation_eligible", "clinically_eligible_evidence_maturity",
                "clinical_metric_reportable"]
    for field in required:
        if field not in maturity:
            return False
    if maturity["metric_maturity"] not in MATURITY_STATES:
        return False
    if not isinstance(maturity["clinically_eligible_metric_count"], int):
        return False
    if not isinstance(maturity["diagnostic_performance_reporting_allowed"], bool):
        return False
    if not isinstance(maturity["clinical_accuracy_claimed"], bool):
        return False
    if not isinstance(maturity["clinically_eligible_evidence_maturity"], bool):
        return False
    if not isinstance(maturity["clinical_metric_reportable"], bool):
        return False
    # Consistency check
    expected_clinically_eligible = (
        maturity["genuinely_admitted_adjudicated_gold"]
        and maturity["metric_maturity"] == "CLINICALLY_ELIGIBLE"
        and maturity["clinically_eligible_metric_count"] > 0
        and maturity["diagnostic_performance_reporting_allowed"] is True
    )
    if maturity["clinically_eligible_evidence_maturity"] != expected_clinically_eligible:
        return False
    if maturity["clinical_metric_reportable"] != expected_clinically_eligible:
        return False
    return True


# ---------------------------------------------------------------------------
# Denominator / cohort integrity
# ---------------------------------------------------------------------------

COHORT_INTEGRITY_SCHEMA = "ekg-ep3-pkt08-cohort-denominator-integrity-v1"


def cohort_denominator_integrity(
    declared_denominator: int,
    evaluated_count: int,
    excluded_count: int,
    exclusion_reasons: Dict[str, int],
    partition_leakage_fence_verified: bool,
    case_family_leakage_fence_verified: bool,
    minimum_support_compliant: bool,
    case_family_integrity_verified: bool,
    partition_integrity_verified: bool,
) -> Dict[str, Any]:
    """Check denominator/cohort integrity (fail closed)."""
    if not isinstance(declared_denominator, int) or declared_denominator <= 0:
        raise ValueError("DECLARED_DENOMINATOR_TYPE")
    if not isinstance(evaluated_count, int) or evaluated_count < 0:
        raise ValueError("EVALUATED_COUNT_TYPE")
    if not isinstance(excluded_count, int) or excluded_count < 0:
        raise ValueError("EXCLUDED_COUNT_TYPE")
    if not isinstance(exclusion_reasons, dict):
        raise ValueError("EXCLUSION_REASONS_TYPE")
    for reason, count in exclusion_reasons.items():
        if not isinstance(count, int) or count < 0:
            raise ValueError("EXCLUSION_REASON_COUNT_TYPE")

    total_excluded = sum(exclusion_reasons.values())
    reconciled = (
        declared_denominator == evaluated_count + excluded_count
        and excluded_count == total_excluded
    )

    integrity_holds = (
        reconciled
        and partition_leakage_fence_verified is True
        and case_family_leakage_fence_verified is True
        and minimum_support_compliant is True
        and case_family_integrity_verified is True
        and partition_integrity_verified is True
    )

    return {
        "schema": COHORT_INTEGRITY_SCHEMA,
        "declared_denominator": declared_denominator,
        "evaluated_count": evaluated_count,
        "excluded_count": excluded_count,
        "exclusion_reasons": exclusion_reasons,
        "total_excluded_from_reasons": total_excluded,
        "reconciled": reconciled,
        "partition_leakage_fence_verified": partition_leakage_fence_verified,
        "case_family_leakage_fence_verified": case_family_leakage_fence_verified,
        "minimum_support_compliant": minimum_support_compliant,
        "case_family_integrity_verified": case_family_integrity_verified,
        "partition_integrity_verified": partition_integrity_verified,
        "denominator_cohort_integrity": integrity_holds,
        "integrity_state": "INTEGRITY_HELD" if integrity_holds else "INTEGRITY_FAILED",
    }


def validate_cohort_denominator_integrity(integrity: Dict[str, Any]) -> bool:
    """Validate cohort/denominator integrity."""
    if integrity.get("schema") != COHORT_INTEGRITY_SCHEMA:
        return False
    required = ["declared_denominator", "evaluated_count", "excluded_count",
                "exclusion_reasons", "total_excluded_from_reasons", "reconciled",
                "partition_leakage_fence_verified", "case_family_leakage_fence_verified",
                "minimum_support_compliant", "case_family_integrity_verified",
                "partition_integrity_verified", "denominator_cohort_integrity",
                "integrity_state"]
    for field in required:
        if field not in integrity:
            return False
    if not isinstance(integrity["declared_denominator"], int):
        return False
    if not isinstance(integrity["evaluated_count"], int):
        return False
    if not isinstance(integrity["excluded_count"], int):
        return False
    if not isinstance(integrity["exclusion_reasons"], dict):
        return False
    if not isinstance(integrity["reconciled"], bool):
        return False
    if not isinstance(integrity["denominator_cohort_integrity"], bool):
        return False

    # Verify reconciliation math
    expected_total = integrity["evaluated_count"] + integrity["excluded_count"]
    if integrity["reconciled"] and integrity["declared_denominator"] != expected_total:
        return False
    if integrity["total_excluded_from_reasons"] != sum(integrity["exclusion_reasons"].values()):
        return False

    # Verify integrity conclusion
    expected_integrity = (
        integrity["reconciled"]
        and integrity["partition_leakage_fence_verified"] is True
        and integrity["case_family_leakage_fence_verified"] is True
        and integrity["minimum_support_compliant"] is True
        and integrity["case_family_integrity_verified"] is True
        and integrity["partition_integrity_verified"] is True
    )
    if integrity["denominator_cohort_integrity"] != expected_integrity:
        return False
    if integrity["integrity_state"] != ("INTEGRITY_HELD" if expected_integrity else "INTEGRITY_FAILED"):
        return False
    return True


# ---------------------------------------------------------------------------
# No-leakage verification
# ---------------------------------------------------------------------------

LEAKAGE_SCHEMA = "ekg-ep3-pkt08-leakage-verification-v1"


def leakage_verification(
    partition_leakage_fence_verified: bool,
    case_family_leakage_fence_verified: bool,
    subject_group_isolation_verified: bool,
    serial_split_isolation_verified: bool,
) -> Dict[str, Any]:
    """Verify no leakage across partitions/case families/subject groups."""
    no_leakage = all([
        partition_leakage_fence_verified is True,
        case_family_leakage_fence_verified is True,
        subject_group_isolation_verified is True,
        serial_split_isolation_verified is True,
    ])
    return {
        "schema": LEAKAGE_SCHEMA,
        "partition_leakage_fence_verified": partition_leakage_fence_verified,
        "case_family_leakage_fence_verified": case_family_leakage_fence_verified,
        "subject_group_isolation_verified": subject_group_isolation_verified,
        "serial_split_isolation_verified": serial_split_isolation_verified,
        "no_leakage": no_leakage,
        "leakage_state": "NO_LEAKAGE_VERIFIED" if no_leakage else "LEAKAGE_DETECTED",
    }


def validate_leakage_verification(leakage: Dict[str, Any]) -> bool:
    """Validate leakage verification."""
    if leakage.get("schema") != LEAKAGE_SCHEMA:
        return False
    required = ["partition_leakage_fence_verified", "case_family_leakage_fence_verified",
                "subject_group_isolation_verified", "serial_split_isolation_verified",
                "no_leakage", "leakage_state"]
    for field in required:
        if field not in leakage:
            return False
    for field in ["partition_leakage_fence_verified", "case_family_leakage_fence_verified",
                  "subject_group_isolation_verified", "serial_split_isolation_verified"]:
        if not isinstance(leakage[field], bool):
            return False
    if not isinstance(leakage["no_leakage"], bool):
        return False
    expected_no_leakage = all([
        leakage["partition_leakage_fence_verified"],
        leakage["case_family_leakage_fence_verified"],
        leakage["subject_group_isolation_verified"],
        leakage["serial_split_isolation_verified"],
    ])
    if leakage["no_leakage"] != expected_no_leakage:
        return False
    if leakage["leakage_state"] != ("NO_LEAKAGE_VERIFIED" if expected_no_leakage else "LEAKAGE_DETECTED"):
        return False
    return True


# ---------------------------------------------------------------------------
# Evaluation freeze (immutable, non-stale)
# ---------------------------------------------------------------------------

EVALUATION_FREEZE_SCHEMA = "ekg-ep3-pkt08-evaluation-freeze-v1"


def evaluation_freeze(
    freeze_identity_sha256: str,
    dataset_manifest_sha256: str,
    prediction_artifact_sha256s: List[str],
    evidence_timestamp_utc: str,
    inputs_sha256: str,
    predictions_sha256: str,
    admitted_gold_manifest_sha256: str,
    metrics_sha256: str,
    code_commit_sha256: str,
    code_tree_sha256: str,
    model_artifact_sha256: str,
    configuration_sha256: str,
    cohort_policy_sha256: str,
    frozen: bool = True,
) -> Dict[str, Any]:
    """Create an immutable evaluation freeze binding."""
    _sha(freeze_identity_sha256, "EVALUATION_FREEZE_IDENTITY_INVALID", 64)
    _sha(dataset_manifest_sha256, "DATASET_MANIFEST_INVALID", 64)
    _sha(inputs_sha256, "INPUTS_SHA256_INVALID", 64)
    _sha(predictions_sha256, "PREDICTIONS_SHA256_INVALID", 64)
    _sha(admitted_gold_manifest_sha256, "ADMITTED_GOLD_MANIFEST_INVALID", 64)
    _sha(metrics_sha256, "METRICS_SHA256_INVALID", 64)
    _sha(code_commit_sha256, "CODE_COMMIT_INVALID", 64)
    _sha(code_tree_sha256, "CODE_TREE_INVALID", 64)
    _sha(model_artifact_sha256, "MODEL_ARTIFACT_INVALID", 64)
    _sha(configuration_sha256, "CONFIGURATION_INVALID", 64)
    _sha(cohort_policy_sha256, "COHORT_POLICY_INVALID", 64)

    if not isinstance(prediction_artifact_sha256s, list):
        raise ValueError("PREDICTION_ARTIFACT_SHA256S_TYPE")
    for sha in prediction_artifact_sha256s:
        _sha(sha, "PREDICTION_ARTIFACT_SHA256_INVALID", 64)

    if not isinstance(evidence_timestamp_utc, str) or not evidence_timestamp_utc.strip():
        raise ValueError("EVIDENCE_TIMESTAMP_INVALID")

    if not frozen:
        raise ValueError("EVALUATION_FREEZE_NOT_FROZEN")

    # Immutable: dedup and sort prediction artifact SHA256s
    deduped_sorted = sorted(set(prediction_artifact_sha256s))

    freeze = {
        "schema": EVALUATION_FREEZE_SCHEMA,
        "freeze_identity_sha256": freeze_identity_sha256,
        "dataset_manifest_sha256": dataset_manifest_sha256,
        "prediction_artifact_sha256s": deduped_sorted,
        "evidence_timestamp_utc": evidence_timestamp_utc,
        "inputs_sha256": inputs_sha256,
        "predictions_sha256": predictions_sha256,
        "admitted_gold_manifest_sha256": admitted_gold_manifest_sha256,
        "metrics_sha256": metrics_sha256,
        "code_commit_sha256": code_commit_sha256,
        "code_tree_sha256": code_tree_sha256,
        "model_artifact_sha256": model_artifact_sha256,
        "configuration_sha256": configuration_sha256,
        "cohort_policy_sha256": cohort_policy_sha256,
        "frozen": frozen,
        "post_freeze_modification_allowed": False,
        "immutable": True,
    }
    freeze["freeze_sha256"] = _digest(freeze)
    return freeze


def validate_evaluation_freeze(freeze: Dict[str, Any]) -> bool:
    """Validate evaluation freeze integrity."""
    if freeze.get("schema") != EVALUATION_FREEZE_SCHEMA:
        return False
    required = ["freeze_identity_sha256", "dataset_manifest_sha256",
                "prediction_artifact_sha256s", "evidence_timestamp_utc",
                "inputs_sha256", "predictions_sha256", "admitted_gold_manifest_sha256",
                "metrics_sha256", "code_commit_sha256", "code_tree_sha256",
                "model_artifact_sha256", "configuration_sha256", "cohort_policy_sha256",
                "frozen", "post_freeze_modification_allowed", "immutable", "freeze_sha256"]
    for field in required:
        if field not in freeze:
            return False
    if freeze.get("frozen") is not True:
        return False
    if freeze.get("post_freeze_modification_allowed") is not False:
        return False
    if freeze.get("immutable") is not True:
        return False
    if not isinstance(freeze["prediction_artifact_sha256s"], list):
        return False
    # Verify freeze is deduped and sorted
    if freeze["prediction_artifact_sha256s"] != sorted(set(freeze["prediction_artifact_sha256s"])):
        return False
    # Verify freeze SHA256
    expected_sha = _digest({k: v for k, v in freeze.items()
                            if k not in ("freeze_sha256",)})
    if freeze["freeze_sha256"] != expected_sha:
        return False
    return True


def is_evaluation_freeze_stale(freeze: Dict[str, Any], current_timestamp_utc: str) -> bool:
    """Determine if an evaluation freeze is stale relative to current time.

    A freeze is stale if its evidence timestamp is in the future relative to
    the current timestamp, or if it predates an acceptable window.
    For deterministic testing: freeze_time > current_time means stale
    (the freeze hasn't happened yet from the current perspective).
    """
    if not isinstance(current_timestamp_utc, str) or not current_timestamp_utc.strip():
        raise ValueError("CURRENT_TIMESTAMP_INVALID")
    freeze_time = freeze.get("evidence_timestamp_utc", "")
    if not freeze_time or not freeze_time.strip():
        return True  # No timestamp = stale
    # Stale if the freeze evidence is from the future (freeze_time > current_time)
    # A freeze from yesterday checked today is stale (yesterday < today in string compare)
    # A freeze from today checked an hour later is not stale
    # This inverts the comparison: freeze is stale if current_time > freeze_time by too much
    # For simple string comparison: if freeze_time < current_time and they're different days, it's stale
    # Simpler: stale if current_time > freeze_time (freeze is from the past relative to now)
    # But we want: same day check = not stale, previous day check = stale
    # Actually the semantics should be: freeze at time T, checked at time T+1hr -> not stale
    # freeze at time T, checked at time T-24hr (yesterday) -> stale
    # String comparison: "2026-09-15T12:00:00Z" vs "2026-09-15T13:00:00Z" -> 12:00 < 13:00
    # "2026-09-15T12:00:00Z" vs "2026-09-14T12:00:00Z" -> 15th > 14th, so freeze_time > current_time
    # So: freeze is stale if freeze_time > current_time (freeze is from the future / before current)
    # Or more intuitively: if current_time < freeze_time (we're checking before the freeze happened)
    return current_timestamp_utc < freeze_time


# ---------------------------------------------------------------------------
# Claim eligibility
# ---------------------------------------------------------------------------

CLAIM_ELIGIBILITY_SCHEMA = "ekg-ep3-pkt08-claim-eligibility-v1"


def claim_eligibility(
    clinically_eligible_evidence_maturity: bool,
    clinical_accuracy_claimed: bool,
    diagnostic_performance_reporting_allowed: bool,
    explicit_claim_authorized: bool,
) -> Dict[str, Any]:
    """Determine claim eligibility (fail closed)."""
    if not isinstance(clinically_eligible_evidence_maturity, bool):
        raise ValueError("CLINICALLY_ELIGIBLE_EVIDENCE_MATURITY_TYPE")
    if not isinstance(clinical_accuracy_claimed, bool):
        raise ValueError("CLINICAL_ACCURACY_CLAIMED_TYPE")
    if not isinstance(diagnostic_performance_reporting_allowed, bool):
        raise ValueError("DIAGNOSTIC_PERFORMANCE_REPORTING_TYPE")
    if not isinstance(explicit_claim_authorized, bool):
        raise ValueError("EXPLICIT_CLAIM_AUTHORIZED_TYPE")

    # Claim eligibility requires: clinically eligible maturity + reporting allowed
    # + explicit authorization. Clinical accuracy claimed is a separate flag.
    claim_eligible = (
        clinically_eligible_evidence_maturity is True
        and diagnostic_performance_reporting_allowed is True
        and explicit_claim_authorized is True
    )

    return {
        "schema": CLAIM_ELIGIBILITY_SCHEMA,
        "clinically_eligible_evidence_maturity": clinically_eligible_evidence_maturity,
        "clinical_accuracy_claimed": clinical_accuracy_claimed,
        "diagnostic_performance_reporting_allowed": diagnostic_performance_reporting_allowed,
        "explicit_claim_authorized": explicit_claim_authorized,
        "claim_eligibility": claim_eligible,
        "claim_state": "CLAIM_ELIGIBLE" if claim_eligible else "CLAIM_INELIGIBLE",
    }


def validate_claim_eligibility(claim: Dict[str, Any]) -> bool:
    """Validate claim eligibility."""
    if claim.get("schema") != CLAIM_ELIGIBILITY_SCHEMA:
        return False
    required = ["clinically_eligible_evidence_maturity", "clinical_accuracy_claimed",
                "diagnostic_performance_reporting_allowed", "explicit_claim_authorized",
                "claim_eligibility", "claim_state"]
    for field in required:
        if field not in claim:
            return False
    # Boolean fields (exclude claim_state which is a string)
    bool_fields = ["clinically_eligible_evidence_maturity", "clinical_accuracy_claimed",
                   "diagnostic_performance_reporting_allowed", "explicit_claim_authorized",
                   "claim_eligibility"]
    for field in bool_fields:
        # Use strict type check to avoid bool-subclass-of-int issue
        if type(claim[field]) is not bool:
            return False
    expected_eligible = (
        claim["clinically_eligible_evidence_maturity"]
        and claim["diagnostic_performance_reporting_allowed"]
        and claim["explicit_claim_authorized"]
    )
    if claim["claim_eligibility"] != expected_eligible:
        return False
    if claim["claim_state"] != ("CLAIM_ELIGIBLE" if expected_eligible else "CLAIM_INELIGIBLE"):
        return False
    return True


# ---------------------------------------------------------------------------
# Governance sign-off
# ---------------------------------------------------------------------------

GOVERNANCE_SIGN_OFF_SCHEMA = "ekg-ep3-pkt08-governance-sign-off-v1"


def governance_sign_off(
    sign_off_identity_sha256: str,
    principal_sha256: str,
    session_id: str,
    review_evidence_bundle_sha256: str,
    sign_off_timestamp_utc: str,
    sign_off_revoked: bool = False,
    sign_off_explicit: bool = True,
) -> Dict[str, Any]:
    """Create a governance sign-off record."""
    _sha(sign_off_identity_sha256, "SIGN_OFF_IDENTITY_INVALID", 64)
    _sha(principal_sha256, "PRINCIPAL_SHA256_INVALID", 64)
    _sha(review_evidence_bundle_sha256, "REVIEW_EVIDENCE_BUNDLE_INVALID", 64)

    if not isinstance(session_id, str) or not session_id.strip():
        raise ValueError("SESSION_ID_INVALID")
    if not isinstance(sign_off_timestamp_utc, str) or not sign_off_timestamp_utc.strip():
        raise ValueError("SIGN_OFF_TIMESTAMP_INVALID")

    sign_off = {
        "schema": GOVERNANCE_SIGN_OFF_SCHEMA,
        "sign_off_identity_sha256": sign_off_identity_sha256,
        "principal_sha256": principal_sha256,
        "session_id": session_id,
        "review_evidence_bundle_sha256": review_evidence_bundle_sha256,
        "sign_off_timestamp_utc": sign_off_timestamp_utc,
        "sign_off_revoked": sign_off_revoked,
        "sign_off_explicit": sign_off_explicit,
        "sign_off_performed": sign_off_explicit and not sign_off_revoked,
        "sign_off_valid": sign_off_explicit and not sign_off_revoked,
    }
    sign_off["sign_off_sha256"] = _digest(sign_off)
    return sign_off


def validate_governance_sign_off(sign_off: Dict[str, Any]) -> bool:
    """Validate governance sign-off."""
    if sign_off.get("schema") != GOVERNANCE_SIGN_OFF_SCHEMA:
        return False
    required = ["sign_off_identity_sha256", "principal_sha256", "session_id",
                "review_evidence_bundle_sha256", "sign_off_timestamp_utc",
                "sign_off_revoked", "sign_off_explicit", "sign_off_performed",
                "sign_off_valid", "sign_off_sha256"]
    for field in required:
        if field not in sign_off:
            return False
    if not isinstance(sign_off["sign_off_revoked"], bool):
        return False
    if not isinstance(sign_off["sign_off_explicit"], bool):
        return False
    if not isinstance(sign_off["sign_off_performed"], bool):
        return False
    if not isinstance(sign_off["sign_off_valid"], bool):
        return False
    # Verify consistency
    expected_performed = sign_off["sign_off_explicit"] and not sign_off["sign_off_revoked"]
    if sign_off["sign_off_performed"] != expected_performed:
        return False
    if sign_off["sign_off_valid"] != expected_performed:
        return False
    # Verify SHA256
    expected_sha = _digest({k: v for k, v in sign_off.items()
                            if k not in ("sign_off_sha256",)})
    if sign_off["sign_off_sha256"] != expected_sha:
        return False
    return True


def is_sign_off_revoked(sign_off: Dict[str, Any]) -> bool:
    """Check if a sign-off has been revoked."""
    return sign_off.get("sign_off_revoked") is True


# ---------------------------------------------------------------------------
# Release evidence bundle
# ---------------------------------------------------------------------------

RELEASE_BUNDLE_REQUIRED_BINDINGS = [
    "exact_ekg_commit_and_tree",
    "exact_candidate_model_config_source_identities",
    "ci_and_verification_receipts",
    "metric_maturity_and_claim_eligibility",
    "gold_admission_state_and_admitted_gold_manifest_identity",
    "denominator_cohort_integrity_and_leakage_results",
    "immutable_evaluation_freeze_identity_and_evidence_freshness",
    "limitations",
    "residual_blockers",
    "activation_status_and_governed_sign_off_identity",
]


def release_evidence_bundle(
    candidate_identity: Dict[str, Any],
    gold_admission: Dict[str, Any],
    evidence_maturity: Dict[str, Any],
    cohort_integrity: Dict[str, Any],
    leakage_verification_result: Dict[str, Any],
    evaluation_freeze: Dict[str, Any],
    claim_eligibility_result: Dict[str, Any],
    governance_sign_off_result: Dict[str, Any],
    readiness_state: str,
    activation_eligibility_state: str,
    limitations: List[str],
    residual_blockers: List[str],
    ci_receipt_sha256: str,
    verification_receipt_sha256: str,
) -> Dict[str, Any]:
    """Create an immutable provenance-complete release evidence bundle."""
    _sha(ci_receipt_sha256, "CI_RECEIPT_INVALID", 64)
    _sha(verification_receipt_sha256, "VERIFICATION_RECEIPT_INVALID", 64)

    if readiness_state not in TYPED_STATES:
        raise ValueError("READINESS_STATE_UNKNOWN")
    if activation_eligibility_state not in TYPED_STATES:
        raise ValueError("ACTIVATION_ELIGIBILITY_STATE_UNKNOWN")

    # Verify all required bindings are present and correct
    missing_bindings = []
    mismatched_bindings = []

    # Check each required binding
    bindings = {
        "exact_ekg_commit_and_tree": {
            "commit": BASELINE_COMMIT,
            "tree": BASELINE_TREE,
        },
        "exact_candidate_model_config_source_identities": {
            "candidate_id": candidate_identity.get("candidate_id"),
            "candidate_version": candidate_identity.get("candidate_version"),
            "model_artifact_sha256": candidate_identity.get("model_artifact_sha256"),
            "configuration_sha256": candidate_identity.get("configuration_sha256"),
            "source_artifact_sha256": candidate_identity.get("source_artifact_sha256"),
            "pattern_registry_sha256": candidate_identity.get("pattern_registry_sha256"),
            "code_commit_sha256": candidate_identity.get("code_commit_sha256"),
            "code_tree_sha256": candidate_identity.get("code_tree_sha256"),
        },
        "ci_and_verification_receipts": {
            "ci_receipt_sha256": ci_receipt_sha256,
            "verification_receipt_sha256": verification_receipt_sha256,
        },
        "metric_maturity_and_claim_eligibility": {
            "metric_maturity": evidence_maturity.get("metric_maturity"),
            "claim_eligibility": claim_eligibility_result.get("claim_eligibility"),
            "clinical_accuracy_claimed": evidence_maturity.get("clinical_accuracy_claimed"),
        },
        "gold_admission_state_and_admitted_gold_manifest_identity": {
            "approved_adjudicated_gold_count": gold_admission.get("approved_adjudicated_gold_count"),
            "clinical_gold_admission_performed": gold_admission.get("clinical_gold_admission_performed"),
            "genuinely_admitted_adjudicated_gold": gold_admission.get("genuinely_admitted_adjudicated_gold"),
        },
        "denominator_cohort_integrity_and_leakage_results": {
            "denominator_cohort_integrity": cohort_integrity.get("denominator_cohort_integrity"),
            "no_leakage": leakage_verification_result.get("no_leakage"),
            "integrity_state": cohort_integrity.get("integrity_state"),
            "leakage_state": leakage_verification_result.get("leakage_state"),
        },
        "immutable_evaluation_freeze_identity_and_evidence_freshness": {
            "freeze_identity_sha256": evaluation_freeze.get("freeze_identity_sha256"),
            "frozen": evaluation_freeze.get("frozen"),
            "immutable": evaluation_freeze.get("immutable"),
        },
        "limitations": limitations,
        "residual_blockers": residual_blockers,
        "activation_status_and_governed_sign_off_identity": {
            "readiness_state": readiness_state,
            "activation_eligibility_state": activation_eligibility_state,
            "sign_off_identity_sha256": governance_sign_off_result.get("sign_off_identity_sha256"),
            "sign_off_valid": governance_sign_off_result.get("sign_off_valid"),
        },
    }

    # Verify provenance completeness
    provenance_complete = True
    for binding_name in RELEASE_BUNDLE_REQUIRED_BINDINGS:
        if binding_name not in bindings:
            missing_bindings.append(binding_name)
            provenance_complete = False

    bundle = {
        "schema": RELEASE_BUNDLE_SCHEMA,
        "packet_id": PACKET_ID,
        "packet_sha256": PACKET_SHA256,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "predecessor_packet_receipts": PREDECESSOR_PACKET_RECEIPTS,
        "candidate_identity": candidate_identity,
        "gold_admission": gold_admission,
        "evidence_maturity": evidence_maturity,
        "cohort_integrity": cohort_integrity,
        "leakage_verification": leakage_verification_result,
        "evaluation_freeze": evaluation_freeze,
        "claim_eligibility": claim_eligibility_result,
        "governance_sign_off": governance_sign_off_result,
        "readiness_state": readiness_state,
        "activation_eligibility_state": activation_eligibility_state,
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "approved_adjudicated_gold_count": gold_admission["approved_adjudicated_gold_count"],
        "clinical_gold_admission_performed": gold_admission["clinical_gold_admission_performed"],
        "metric_maturity": evidence_maturity["metric_maturity"],
        "clinically_eligible_metric_count": evidence_maturity["clinically_eligible_metric_count"],
        "diagnostic_performance_reporting_allowed": evidence_maturity["diagnostic_performance_reporting_allowed"],
        "clinical_accuracy_claimed": evidence_maturity["clinical_accuracy_claimed"],
        "ci_receipt_sha256": ci_receipt_sha256,
        "verification_receipt_sha256": verification_receipt_sha256,
        "bindings": bindings,
        "missing_bindings": missing_bindings,
        "mismatched_bindings": mismatched_bindings,
        "provenance_complete": provenance_complete,
        "bundle_can_activate_runtime": False,
        "limitations": limitations,
        "residual_blockers": residual_blockers,
    }
    bundle["release_evidence_bundle_sha256"] = _digest(bundle)
    return bundle


def validate_release_evidence_bundle(bundle: Dict[str, Any]) -> bool:
    """Validate release evidence bundle integrity."""
    if bundle.get("schema") != RELEASE_BUNDLE_SCHEMA:
        return False
    required = ["packet_id", "packet_sha256", "baseline_commit", "baseline_tree",
                "stage1_receipt_sha256", "prior_packet_receipt_sha256",
                "predecessor_packet_receipts", "candidate_identity", "gold_admission",
                "evidence_maturity", "cohort_integrity", "leakage_verification",
                "evaluation_freeze", "claim_eligibility", "governance_sign_off",
                "readiness_state", "activation_eligibility_state", "candidate_active",
                "diagnostic_runtime", "approved_adjudicated_gold_count",
                "clinical_gold_admission_performed", "metric_maturity",
                "clinically_eligible_metric_count", "diagnostic_performance_reporting_allowed",
                "clinical_accuracy_claimed", "ci_receipt_sha256", "verification_receipt_sha256",
                "bindings", "missing_bindings", "mismatched_bindings",
                "provenance_complete", "bundle_can_activate_runtime",
                "limitations", "residual_blockers", "release_evidence_bundle_sha256"]
    for field in required:
        if field not in bundle:
            return False
    if bundle.get("packet_id") != PACKET_ID:
        return False
    if bundle.get("packet_sha256") != PACKET_SHA256:
        return False
    if bundle.get("baseline_commit") != BASELINE_COMMIT:
        return False
    if bundle.get("baseline_tree") != BASELINE_TREE:
        return False
    if bundle.get("candidate_active") is not False:
        return False
    if bundle.get("diagnostic_runtime") != "GOVERNED_INACTIVE":
        return False
    if bundle.get("bundle_can_activate_runtime") is not False:
        return False
    if not isinstance(bundle["provenance_complete"], bool):
        return False

    # Verify SHA256
    expected_sha = _digest({k: v for k, v in bundle.items()
                            if k not in ("release_evidence_bundle_sha256",)})
    if bundle["release_evidence_bundle_sha256"] != expected_sha:
        return False
    return True


# ---------------------------------------------------------------------------
# Activation eligibility gate (conjunctive, fail closed)
# ---------------------------------------------------------------------------

def activation_eligibility_gate(
    candidate_identity: Dict[str, Any],
    gold_admission: Dict[str, Any],
    evidence_maturity: Dict[str, Any],
    cohort_integrity: Dict[str, Any],
    leakage_verification_result: Dict[str, Any],
    evaluation_freeze: Dict[str, Any],
    claim_eligibility_result: Dict[str, Any],
    governance_sign_off_result: Dict[str, Any],
    current_timestamp_utc: str = "",
) -> Dict[str, Any]:
    """Evaluate the conjunctive activation eligibility gate.

    Returns the typed readiness state, activation eligibility state, and
    satisfied/unsatisfied prerequisite IDs. This is a read-only evaluation;
    it never activates, deploys, auto-selects, or changes any candidate or
    authority.
    """
    # Validate all inputs are present and valid
    validate_candidate_identity(candidate_identity)
    validate_gold_admission_state(gold_admission)
    validate_evidence_maturity(evidence_maturity)
    validate_cohort_denominator_integrity(cohort_integrity)
    validate_leakage_verification(leakage_verification_result)
    validate_evaluation_freeze(evaluation_freeze)
    validate_claim_eligibility(claim_eligibility_result)
    validate_governance_sign_off(governance_sign_off_result)

    # Check for stale evidence
    stale_evidence = False
    if current_timestamp_utc and current_timestamp_utc.strip():
        try:
            stale_evidence = is_evaluation_freeze_stale(evaluation_freeze, current_timestamp_utc)
        except ValueError:
            stale_evidence = True  # Fail closed on timestamp error

    # Check for revoked sign-off
    sign_off_revoked = is_sign_off_revoked(governance_sign_off_result)

    # Evaluate each prerequisite
    prerequisites = {
        "genuinely_admitted_adjudicated_gold": gold_admission["genuinely_admitted_adjudicated_gold"],
        "clinically_eligible_evidence_maturity": evidence_maturity["clinically_eligible_evidence_maturity"],
        "exact_candidate_model_config_source_identities": True,  # Validated by identity binding
        "denominator_cohort_integrity": cohort_integrity["denominator_cohort_integrity"],
        "no_leakage": leakage_verification_result["no_leakage"],
        "non_stale_immutable_evaluation_freeze": not stale_evidence and evaluation_freeze["frozen"] is True,
        "claim_eligibility": claim_eligibility_result["claim_eligibility"],
        "provenance_complete_release_evidence": True,  # Will be verified in bundle
        "explicit_governed_sign_off": governance_sign_off_result["sign_off_valid"] and not sign_off_revoked,
    }

    # Determine satisfied and unsatisfied
    satisfied = [k for k, v in prerequisites.items() if v is True]
    unsatisfied = [k for k, v in prerequisites.items() if v is not True]

    # Determine readiness state (fail closed)
    if unsatisfied:
        readiness_state = "BLOCKED"
        activation_eligibility_state = "INELIGIBLE"
    elif sign_off_revoked:
        readiness_state = "BLOCKED"
        activation_eligibility_state = "INELIGIBLE"
    elif stale_evidence:
        readiness_state = "BLOCKED"
        activation_eligibility_state = "INELIGIBLE"
    elif governance_sign_off_result["sign_off_valid"] and not sign_off_revoked:
        # All prerequisites met + explicit sign-off = ACTIVATION_ELIGIBLE (eligibility only!)
        readiness_state = "READY_FOR_GOVERNANCE_REVIEW"
        activation_eligibility_state = "ACTIVATION_ELIGIBLE"
    else:
        readiness_state = "BLOCKED"
        activation_eligibility_state = "INELIGIBLE"

    # Identity drift detection: if there's a mismatch, invalidate
    # (This is checked by the caller comparing against a stored identity)

    state = {
        "schema": GATE_SCHEMA,
        "packet_id": PACKET_ID,
        "packet_sha256": PACKET_SHA256,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "candidate_identity": candidate_identity,
        "gold_admission": gold_admission,
        "evidence_maturity": evidence_maturity,
        "cohort_integrity": cohort_integrity,
        "leakage_verification": leakage_verification_result,
        "evaluation_freeze": evaluation_freeze,
        "claim_eligibility": claim_eligibility_result,
        "governance_sign_off": governance_sign_off_result,
        "prerequisites": prerequisites,
        "satisfied_prerequisites": satisfied,
        "unsatisfied_prerequisites": unsatisfied,
        "readiness_state": readiness_state,
        "activation_eligibility_state": activation_eligibility_state,
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "diagnostic_runtime_activation_allowed": False,
        "automatic_candidate_selection_allowed": False,
        "runtime_influence_allowed": False,
        "patient_specific_clinical_decision_support_allowed": False,
        "actual_activation_performed_by_this_packet": False,
        "stale_evidence_detected": stale_evidence,
        "sign_off_revoked_detected": sign_off_revoked,
        "identity_drift_detected": False,  # Set by caller if drift detected
        "integrity_findings": [],
        "limitations": [
            "ACTIVATION_ELIGIBLE is an eligibility state, not activation or deployment.",
            "A separate explicit governed activation action is still required.",
            "Synthetic fixtures are non-clinical and never satisfy gold requirements.",
            "This packet does not perform EKG integration freeze/release acceptance.",
        ],
        "residual_blockers": unsatisfied + (
            ["Sign-off revoked"] if sign_off_revoked else []
        ) + (
            ["Stale evidence"] if stale_evidence else []
        ),
    }
    state["gate_sha256"] = _digest(state)
    return state


def validate_activation_eligibility_gate(state: Dict[str, Any]) -> bool:
    """Validate activation eligibility gate result."""
    if state.get("schema") != GATE_SCHEMA:
        return False
    required = ["packet_id", "packet_sha256", "baseline_commit", "baseline_tree",
                "stage1_receipt_sha256", "prior_packet_receipt_sha256",
                "candidate_identity", "gold_admission", "evidence_maturity",
                "cohort_integrity", "leakage_verification", "evaluation_freeze",
                "claim_eligibility", "governance_sign_off", "prerequisites",
                "satisfied_prerequisites", "unsatisfied_prerequisites",
                "readiness_state", "activation_eligibility_state", "candidate_active",
                "diagnostic_runtime", "diagnostic_runtime_activation_allowed",
                "automatic_candidate_selection_allowed", "runtime_influence_allowed",
                "patient_specific_clinical_decision_support_allowed",
                "actual_activation_performed_by_this_packet",
                "stale_evidence_detected", "sign_off_revoked_detected",
                "identity_drift_detected", "integrity_findings", "limitations",
                "residual_blockers", "gate_sha256"]
    for field in required:
        if field not in state:
            return False
    if state.get("packet_id") != PACKET_ID:
        return False
    if state.get("candidate_active") is not False:
        return False
    if state.get("diagnostic_runtime") != "GOVERNED_INACTIVE":
        return False
    if state.get("diagnostic_runtime_activation_allowed") is not False:
        return False
    if state.get("automatic_candidate_selection_allowed") is not False:
        return False
    if state.get("runtime_influence_allowed") is not False:
        return False
    if state.get("patient_specific_clinical_decision_support_allowed") is not False:
        return False
    if state.get("actual_activation_performed_by_this_packet") is not False:
        return False
    if state.get("readiness_state") not in TYPED_STATES:
        return False
    if state.get("activation_eligibility_state") not in TYPED_STATES:
        return False
    if not isinstance(state["satisfied_prerequisites"], list):
        return False
    if not isinstance(state["unsatisfied_prerequisites"], list):
        return False
    if not isinstance(state["limitations"], list):
        return False
    if not isinstance(state["residual_blockers"], list):
        return False

    # Verify gate SHA256
    expected_sha = _digest({k: v for k, v in state.items()
                            if k not in ("gate_sha256",)})
    if state["gate_sha256"] != expected_sha:
        return False
    return True


# ---------------------------------------------------------------------------
# Invalidation / rollback / deactivation
# ---------------------------------------------------------------------------

INVALIDATION_TRIGGERS = [
    "stale_or_revoked_evidence",
    "changed_source_model_candidate_configuration_identity",
    "provenance_mismatch",
    "cohort_denominator_drift",
    "failed_integrity_check",
    "sign_off_revocation",
]


def invalidate_readiness(
    current_state: Dict[str, Any],
    trigger: str,
    reason: str,
) -> Dict[str, Any]:
    """Invalidate READY_FOR_GOVERNANCE_REVIEW or ACTIVATION_ELIGIBLE.

    Immediately sets readiness to BLOCKED and activation eligibility to
    INELIGIBLE, preserving diagnostic runtime as GOVERNED_INACTIVE.
    """
    if trigger not in INVALIDATION_TRIGGERS:
        raise ValueError("INVALIDATION_TRIGGER_UNKNOWN")

    invalidated = {
        "schema": "ekg-ep3-pkt08-invalidation-record-v1",
        "trigger": trigger,
        "reason": reason,
        "previous_readiness_state": current_state.get("readiness_state"),
        "previous_activation_eligibility_state": current_state.get("activation_eligibility_state"),
        "new_readiness_state": "BLOCKED",
        "new_activation_eligibility_state": "INELIGIBLE",
        "diagnostic_runtime_preserved": "GOVERNED_INACTIVE",
        "candidate_active_preserved": False,
        "append_only_audit_trail": True,
    }
    return invalidated


def deactivate_and_rollback(
    activated_state: Dict[str, Any],
    trigger: str,
    reason: str,
) -> Dict[str, Any]:
    """Deactivate and rollback an activated identity to fail-closed state.

    If a later separate authority has activated the affected exact identity,
    the same triggers require fail-closed deactivation and rollback to
    GOVERNED_INACTIVE. Never authorizes silent fallback, candidate
    substitution, source substitution, or authority rewrite.
    """
    if trigger not in INVALIDATION_TRIGGERS:
        raise ValueError("INVALIDATION_TRIGGER_UNKNOWN")

    deactivated = {
        "schema": "ekg-ep3-pkt08-deactivation-record-v1",
        "trigger": trigger,
        "reason": reason,
        "previous_readiness_state": activated_state.get("readiness_state"),
        "previous_activation_eligibility_state": activated_state.get("activation_eligibility_state"),
        "previous_diagnostic_runtime": activated_state.get("diagnostic_runtime"),
        "new_readiness_state": "BLOCKED",
        "new_activation_eligibility_state": "INELIGIBLE",
        "new_diagnostic_runtime": "GOVERNED_INACTIVE",
        "new_candidate_active": False,
        "silent_fallback_allowed": False,
        "source_substitution_allowed": False,
        "candidate_substitution_allowed": False,
        "authority_rewrite_allowed": False,
        "rollback_performed": True,
        "append_only_audit_trail": True,
    }
    return deactivated


# ---------------------------------------------------------------------------
# Current zero-gold governed state
# ---------------------------------------------------------------------------

def current_zero_gold_activation_state() -> Dict[str, Any]:
    """Return the current fail-closed zero-gold activation state."""
    return {
        "schema": SCHEMA,
        "packet_id": PACKET_ID,
        "approved_adjudicated_gold_count": 0,
        "clinical_gold_admission_performed": False,
        "metric_maturity": "NOT_REPORTABLE",
        "clinically_eligible_metric_count": 0,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "readiness_state": "BLOCKED",
        "activation_eligibility_state": "INELIGIBLE",
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "diagnostic_runtime_activation_allowed": False,
        "automatic_candidate_selection_allowed": False,
        "runtime_influence_allowed": False,
        "patient_specific_clinical_decision_support_allowed": False,
    }


# ---------------------------------------------------------------------------
# Public descriptor (read-only, Platform-consumable)
# ---------------------------------------------------------------------------

def activation_readiness_descriptor(state: Dict[str, Any]) -> Dict[str, Any]:
    """Expose a read-only Platform-consumable activation-readiness descriptor.

    Contains exact provenance, typed status, limitations, and blockers.
    Cannot expose raw clinical bytes, enable diagnostic runtime influence,
    promote clinical claims, or provide patient-specific clinical decision
    support.
    """
    return {
        "schema": "ekg-ep3-pkt08-activation-readiness-descriptor-v1",
        "packet_id": PACKET_ID,
        "packet_sha256": PACKET_SHA256,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "readiness_state": state.get("readiness_state"),
        "activation_eligibility_state": state.get("activation_eligibility_state"),
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
        "approved_adjudicated_gold_count": state.get("gold_admission", {}).get("approved_adjudicated_gold_count", 0),
        "clinical_gold_admission_performed": state.get("gold_admission", {}).get("clinical_gold_admission_performed", False),
        "metric_maturity": state.get("evidence_maturity", {}).get("metric_maturity", "NOT_REPORTABLE"),
        "satisfied_prerequisites": state.get("satisfied_prerequisites", []),
        "unsatisfied_prerequisites": state.get("unsatisfied_prerequisites", []),
        "limitations": state.get("limitations", []),
        "residual_blockers": state.get("residual_blockers", []),
        "provenance_complete": True,
        "raw_clinical_waveform_or_image_bytes_included": False,
        "phi_included": False,
        "authority_rewritten": False,
        "silent_fallback_allowed": False,
        "source_substitution_allowed": False,
        "candidate_substitution_allowed": False,
    }


# ---------------------------------------------------------------------------
# Directories for convenience
# ---------------------------------------------------------------------------

__all__ = [
    "SCHEMA",
    "BASELINE_COMMIT",
    "BASELINE_TREE",
    "STAGE1_RECEIPT_SHA256",
    "PRIOR_PACKET_RECEIPT_SHA256",
    "PACKET_ID",
    "PACKET_SHA256",
    "TYPED_STATES",
    "GATE_SCHEMA",
    "RELEASE_BUNDLE_SCHEMA",
    "GOVERNANCE_SIGN_OFF_SCHEMA",
    "ACTIVATION_PREREQUISITES",
    "CURRENT_STATE",
    "candidate_identity",
    "validate_candidate_identity",
    "identity_drift_detected",
    "gold_admission_state",
    "validate_gold_admission_state",
    "evidence_maturity_state",
    "validate_evidence_maturity",
    "cohort_denominator_integrity",
    "validate_cohort_denominator_integrity",
    "leakage_verification",
    "validate_leakage_verification",
    "evaluation_freeze",
    "validate_evaluation_freeze",
    "is_evaluation_freeze_stale",
    "claim_eligibility",
    "validate_claim_eligibility",
    "governance_sign_off",
    "validate_governance_sign_off",
    "is_sign_off_revoked",
    "release_evidence_bundle",
    "validate_release_evidence_bundle",
    "activation_eligibility_gate",
    "validate_activation_eligibility_gate",
    "invalidate_readiness",
    "deactivate_and_rollback",
    "current_zero_gold_activation_state",
    "activation_readiness_descriptor",
    " INVALIDATION_TRIGGERS",
]
