"""EP3 Packet 7 diagnostic-performance metric/reporting eligibility contracts.

Deterministic, provenance-bound mechanics for declaring statistical metric
types and governing whether they may ever be reported. This module never
computes or publishes clinical sensitivity/specificity/PPV/NPV/AUROC or any
other diagnostic-performance metric. In the current zero-gold state it only
returns explicit NOT_REPORTABLE/UNAVAILABLE evidence-maturity contracts, and
it never activates the quarantined candidate or diagnostic runtime.
"""
from __future__ import annotations

import hashlib
import json
from copy import deepcopy

import adjudication_dataset_contracts as adjudication
import evaluation_engine as evaluation
import system_status_adapter as status

SCHEMA = "ekg-ep3-pkt07-metric-reporting-eligibility-v1"
BASELINE_COMMIT = "f6fdb0ed70c5d349fe40773df638165e79172fd3"
BASELINE_TREE = "dd1cfc1beb05476ac89e1cda4fb2eaedfa0a29ad"
STAGE1_RECEIPT_SHA256 = "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb"
PRIOR_PACKET_RECEIPT_SHA256 = "d9a29faf5ad7407a30ba2accaffacbfc81cf8054604698ec3c255242615b3e45"

METRIC_DECLARATION_SCHEMA = "ekg-ep3-pkt07-metric-declaration-v1"
ELIGIBILITY_GATE_SCHEMA = "ekg-ep3-pkt07-eligibility-gate-v1"
MATURITY_SCHEMA = "ekg-ep3-pkt07-evidence-maturity-v1"
SUBGROUP_SCHEMA = "ekg-ep3-pkt07-subgroup-support-v1"
STRATUM_SCHEMA = "ekg-ep3-pkt07-confidence-stratum-v1"
RECONCILIATION_SCHEMA = "ekg-ep3-pkt07-endpoint-reconciliation-v1"
COHORT_POLICY_SCHEMA = "ekg-ep3-pkt07-endpoint-cohort-policy-v1"
COHORT_INDEPENDENCE_SCHEMA = "ekg-ep3-pkt07-cohort-independence-v1"
FREEZE_SCHEMA = "ekg-ep3-pkt07-evaluation-freeze-v1"
SCORE_SCHEMA = "ekg-ep3-pkt07-bound-prediction-score-v1"
ABSTENTION_SCHEMA = "ekg-ep3-pkt07-abstention-declaration-v1"
CLAIM_GATE_SCHEMA = "ekg-ep3-pkt07-claim-gate-v1"
ENVELOPE_SCHEMA = "ekg-ep3-pkt07-protected-metric-envelope-v1"

METRIC_TYPES = {
    "SENSITIVITY", "SPECIFICITY", "PPV", "NPV", "AUROC", "AUPRC", "F1",
    "ACCURACY", "BRIER_SCORE", "POSITIVE_LIKELIHOOD_RATIO", "NEGATIVE_LIKELIHOOD_RATIO",
}
MATURITY_STATES = {
    "NOT_REPORTABLE", "PRELIMINARY_INSUFFICIENT_SUPPORT",
    "ENGINEERING_CONFORMANCE_ONLY", "CLINICALLY_ELIGIBLE",
}
CONFIDENCE_STRATA = {"HIGH_CONFIDENCE", "MODERATE_CONFIDENCE", "LOW_CONFIDENCE", "ABSTAINED"}
MIN_SUBGROUP_SUPPORT = 30
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


def _text(value, code, min_len=1, max_len=96):
    if not isinstance(value, str) or not (min_len <= len(value.strip()) <= max_len):
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


def _rate(numerator, denominator):
    return {"value": None if denominator == 0 else numerator / denominator,
            "numerator": numerator, "denominator": denominator,
            "defined": denominator != 0}


# --- statistical metric declaration (never computed here) -----------------

def metric_declaration(*, metric_name, pattern_id):
    if metric_name not in METRIC_TYPES:
        raise ValueError("METRIC_TYPE_UNKNOWN")
    ids = {p["id"] for p in evaluation.registry()["patterns"]}
    if pattern_id not in ids:
        raise ValueError("METRIC_PATTERN_UNKNOWN")
    body = {
        "schema": METRIC_DECLARATION_SCHEMA,
        "metric_name": metric_name,
        "pattern_id": pattern_id,
        "registry_binding": _registry_binding(),
        "value": None,
        "computed": False,
        "clinical_accuracy_claimed": False,
    }
    body["declaration_sha256"] = _digest(body)
    return body


# --- hard eligibility gate --------------------------------------------------

def reporting_eligibility_gate(*, approved_adjudicated_gold_count, clinical_gold_admission_performed):
    if not isinstance(approved_adjudicated_gold_count, int) or isinstance(approved_adjudicated_gold_count, bool) \
            or approved_adjudicated_gold_count < 0:
        raise ValueError("APPROVED_ADJUDICATED_GOLD_COUNT_TYPE")
    if not isinstance(clinical_gold_admission_performed, bool):
        raise ValueError("CLINICAL_GOLD_ADMISSION_PERFORMED_TYPE")
    eligible = approved_adjudicated_gold_count > 0 and clinical_gold_admission_performed is True
    body = {
        "schema": ELIGIBILITY_GATE_SCHEMA,
        "approved_adjudicated_gold_count": approved_adjudicated_gold_count,
        "clinical_gold_admission_performed": clinical_gold_admission_performed,
        "clinical_metric_computation_eligible": eligible,
    }
    body["gate_sha256"] = _digest(body)
    return body


# --- evidence maturity -------------------------------------------------------

def evidence_maturity_state(*, gate, sufficient_support, endpoint_reconciled,
                            freeze_verified, cohort_independent,
                            engineering_conformance_only=False):
    expected_gate = reporting_eligibility_gate(
        approved_adjudicated_gold_count=gate["approved_adjudicated_gold_count"],
        clinical_gold_admission_performed=gate["clinical_gold_admission_performed"],
    )
    if gate != expected_gate:
        raise ValueError("ELIGIBILITY_GATE_INTEGRITY")
    for name, value in (
        ("SUFFICIENT_SUPPORT", sufficient_support),
        ("ENDPOINT_RECONCILED", endpoint_reconciled),
        ("FREEZE_VERIFIED", freeze_verified),
        ("COHORT_INDEPENDENT", cohort_independent),
        ("ENGINEERING_CONFORMANCE_ONLY", engineering_conformance_only),
    ):
        if not isinstance(value, bool):
            raise ValueError(name + "_TYPE")
    if not gate["clinical_metric_computation_eligible"]:
        state = "NOT_REPORTABLE"
    elif engineering_conformance_only:
        state = "ENGINEERING_CONFORMANCE_ONLY"
    elif not (sufficient_support and endpoint_reconciled and freeze_verified and cohort_independent):
        state = "PRELIMINARY_INSUFFICIENT_SUPPORT"
    else:
        state = "CLINICALLY_ELIGIBLE"
    body = {
        "schema": MATURITY_SCHEMA,
        "gate": deepcopy(gate),
        "sufficient_support": sufficient_support,
        "endpoint_reconciled": endpoint_reconciled,
        "freeze_verified": freeze_verified,
        "cohort_independent": cohort_independent,
        "engineering_conformance_only": engineering_conformance_only,
        "maturity_state": state,
        "clinical_metric_reportable": state == "CLINICALLY_ELIGIBLE",
    }
    if state not in MATURITY_STATES:
        raise ValueError("MATURITY_STATE_UNKNOWN")
    body["maturity_sha256"] = _digest(body)
    return body


def validate_evidence_maturity(value):
    if not isinstance(value, dict) or value.get("schema") != MATURITY_SCHEMA:
        return False
    try:
        copy = deepcopy(value)
        maturity_sha = copy.pop("maturity_sha256")
        if _sha(maturity_sha, "MATURITY_SHA256") != _digest(copy):
            return False
        rebuilt = evidence_maturity_state(
            gate=value["gate"],
            sufficient_support=value["sufficient_support"],
            endpoint_reconciled=value["endpoint_reconciled"],
            freeze_verified=value["freeze_verified"],
            cohort_independent=value["cohort_independent"],
            engineering_conformance_only=value["engineering_conformance_only"],
        )
        return rebuilt == value
    except (KeyError, TypeError, ValueError):
        return False


# --- subgroup minimum-support / confidence strata (fail closed) ------------

def subgroup_support_check(*, subgroup_id, evaluated_count, minimum_support=MIN_SUBGROUP_SUPPORT):
    _text(subgroup_id, "SUBGROUP_ID_REQUIRED")
    if not isinstance(evaluated_count, int) or isinstance(evaluated_count, bool) or evaluated_count < 0:
        raise ValueError("SUBGROUP_EVALUATED_COUNT_TYPE")
    if not isinstance(minimum_support, int) or isinstance(minimum_support, bool) or minimum_support < 1:
        raise ValueError("SUBGROUP_MINIMUM_SUPPORT_TYPE")
    sufficient = evaluated_count >= minimum_support
    body = {
        "schema": SUBGROUP_SCHEMA,
        "subgroup_id": subgroup_id,
        "evaluated_count": evaluated_count,
        "minimum_support": minimum_support,
        "sufficient_support": sufficient,
        "state": "SUFFICIENT_SUPPORT" if sufficient else "INSUFFICIENT_SUPPORT_FAIL_CLOSED",
        "subgroup_performance_reportable": sufficient,
    }
    body["subgroup_sha256"] = _digest(body)
    return body


def confidence_stratum(*, stratum_id, evaluated_count, minimum_support=MIN_SUBGROUP_SUPPORT):
    if stratum_id not in CONFIDENCE_STRATA:
        raise ValueError("CONFIDENCE_STRATUM_UNKNOWN")
    if not isinstance(evaluated_count, int) or isinstance(evaluated_count, bool) or evaluated_count < 0:
        raise ValueError("STRATUM_EVALUATED_COUNT_TYPE")
    if not isinstance(minimum_support, int) or isinstance(minimum_support, bool) or minimum_support < 1:
        raise ValueError("STRATUM_MINIMUM_SUPPORT_TYPE")
    sufficient = evaluated_count >= minimum_support
    body = {
        "schema": STRATUM_SCHEMA,
        "stratum_id": stratum_id,
        "evaluated_count": evaluated_count,
        "minimum_support": minimum_support,
        "sufficient_support": sufficient,
        "stratum_reportable": sufficient,
    }
    body["stratum_sha256"] = _digest(body)
    return body


# --- exact endpoint/denominator reconciliation ------------------------------

def endpoint_reconciliation(*, declared_denominator, evaluated_count, excluded_count, exclusion_reasons):
    if not isinstance(declared_denominator, int) or isinstance(declared_denominator, bool) or declared_denominator < 0:
        raise ValueError("DECLARED_DENOMINATOR_TYPE")
    if not isinstance(evaluated_count, int) or isinstance(evaluated_count, bool) or evaluated_count < 0:
        raise ValueError("EVALUATED_COUNT_TYPE")
    if not isinstance(excluded_count, int) or isinstance(excluded_count, bool) or excluded_count < 0:
        raise ValueError("EXCLUDED_COUNT_TYPE")
    if not isinstance(exclusion_reasons, dict) or not all(
        isinstance(v, int) and not isinstance(v, bool) and v >= 0 for v in exclusion_reasons.values()
    ):
        raise ValueError("EXCLUSION_REASONS_SHAPE")
    reasons_total = sum(exclusion_reasons.values())
    reconciled = (
        reasons_total == excluded_count
        and (evaluated_count + excluded_count) == declared_denominator
    )
    body = {
        "schema": RECONCILIATION_SCHEMA,
        "declared_denominator": declared_denominator,
        "evaluated_count": evaluated_count,
        "excluded_count": excluded_count,
        "exclusion_reasons": dict(sorted(exclusion_reasons.items())),
        "reconciled": reconciled,
        "state": "RECONCILED" if reconciled else "DENOMINATOR_MISMATCH_REJECTED",
    }
    body["reconciliation_sha256"] = _digest(body)
    return body


# --- endpoint cohort policy / inherited Packet-6 leakage fences ------------

def endpoint_cohort_policy(*, dataset_manifest_sha256, approved_adjudicated_gold_count,
                           native_dataset_annotations_are_project_gold,
                           synthetic_fixtures_are_clinical_gold,
                           partition_leakage_fence_verified=True,
                           case_family_leakage_fence_verified=True):
    _sha(dataset_manifest_sha256, "DATASET_MANIFEST_SHA256")
    if not isinstance(approved_adjudicated_gold_count, int) or isinstance(approved_adjudicated_gold_count, bool) \
            or approved_adjudicated_gold_count < 0:
        raise ValueError("APPROVED_ADJUDICATED_GOLD_COUNT_TYPE")
    if native_dataset_annotations_are_project_gold is not False:
        raise ValueError("NATIVE_DATASET_LABEL_CANNOT_BE_PROJECT_GOLD")
    if synthetic_fixtures_are_clinical_gold is not False:
        raise ValueError("SYNTHETIC_FIXTURE_CANNOT_BE_CLINICAL_GOLD")
    if partition_leakage_fence_verified is not True or case_family_leakage_fence_verified is not True:
        raise ValueError("LEAKAGE_FENCE_NOT_VERIFIED")
    body = {
        "schema": COHORT_POLICY_SCHEMA,
        "dataset_manifest_sha256": dataset_manifest_sha256,
        "approved_adjudicated_gold_count": approved_adjudicated_gold_count,
        "partition_leakage_fence_verified": True,
        "case_family_leakage_fence_verified": True,
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
    }
    body["policy_sha256"] = _digest(body)
    return body


def endpoint_cohort_policy_from_manifest(dataset_manifest):
    if not adjudication.validate_dataset_manifest(dataset_manifest):
        raise ValueError("DATASET_MANIFEST_INVALID")
    return endpoint_cohort_policy(
        dataset_manifest_sha256=dataset_manifest["manifest_sha256"],
        approved_adjudicated_gold_count=dataset_manifest["approved_adjudicated_gold_count"],
        native_dataset_annotations_are_project_gold=dataset_manifest["native_dataset_annotations_are_project_gold"],
        synthetic_fixtures_are_clinical_gold=dataset_manifest["synthetic_fixtures_are_clinical_gold"],
    )


# --- cohort independence ------------------------------------------------------

def cohort_independence_declaration(*, evaluation_partition, training_partitions):
    if evaluation_partition not in evaluation.SPLITS:
        raise ValueError("EVALUATION_PARTITION_STATE")
    if not isinstance(training_partitions, (list, set, tuple)):
        raise ValueError("TRAINING_PARTITIONS_SHAPE")
    training = set(training_partitions)
    if not training.issubset(evaluation.SPLITS):
        raise ValueError("TRAINING_PARTITION_STATE")
    if evaluation_partition in training:
        raise ValueError("COHORT_NOT_INDEPENDENT")
    body = {
        "schema": COHORT_INDEPENDENCE_SCHEMA,
        "evaluation_partition": evaluation_partition,
        "training_partitions": sorted(training),
        "cohort_independent": True,
    }
    body["declaration_sha256"] = _digest(body)
    return body


# --- evaluation freeze + prediction-artifact integrity ----------------------

def evaluation_freeze_contract(*, dataset_manifest_sha256, prediction_artifact_sha256s, frozen=True):
    _sha(dataset_manifest_sha256, "DATASET_MANIFEST_SHA256")
    if not isinstance(prediction_artifact_sha256s, (list, set, tuple)):
        raise ValueError("PREDICTION_ARTIFACT_SHAS_SHAPE")
    shas = sorted({_sha(value, "PREDICTION_ARTIFACT_SHA256") for value in prediction_artifact_sha256s})
    if frozen is not True:
        raise ValueError("EVALUATION_FREEZE_REQUIRED")
    body = {
        "schema": FREEZE_SCHEMA,
        "dataset_manifest_sha256": dataset_manifest_sha256,
        "prediction_artifact_sha256s": shas,
        "frozen": True,
        "post_freeze_modification_allowed": False,
    }
    body["freeze_sha256"] = _digest(body)
    return body


# --- bound prediction scoring (exact candidate/config/case identity) -------

def bound_prediction_score(*, prediction_binding, case_id, case_version, gold_label, predicted_label):
    if not isinstance(prediction_binding, dict):
        raise ValueError("PREDICTION_BINDING_REQUIRED")
    expected = adjudication.prediction_binding(
        case_id=prediction_binding["case_id"],
        case_version=prediction_binding["case_version"],
        dataset_manifest_sha256=prediction_binding["dataset_manifest_sha256"],
        candidate_reconciliation_sha256=prediction_binding["candidate_reconciliation_sha256"],
        configuration_sha256=prediction_binding["configuration_sha256"],
        engine_commit=prediction_binding["engine_commit"],
        engine_tree=prediction_binding["engine_tree"],
    )
    if prediction_binding != expected:
        raise ValueError("PREDICTION_BINDING_INTEGRITY")
    if case_id != prediction_binding["case_id"] or case_version != prediction_binding["case_version"]:
        raise ValueError("PREDICTION_CASE_IDENTITY_MISMATCH")
    if gold_label not in evaluation.LABELS:
        raise ValueError("GOLD_LABEL_STATE")
    if predicted_label not in evaluation.PREDICTION_LABELS:
        raise ValueError("PREDICTED_LABEL_STATE")
    body = {
        "schema": SCORE_SCHEMA,
        "prediction_binding_sha256": prediction_binding["binding_sha256"],
        "case_id": case_id,
        "case_version": case_version,
        "gold_label": gold_label,
        "predicted_label": predicted_label,
        "clinical_accuracy_claimed": False,
    }
    body["score_sha256"] = _digest(body)
    return body


# --- selective-safety / abstention mechanics (engineering-only) -----------

def abstention_declaration(*, pattern_id, abstained_count, evaluated_count):
    ids = {p["id"] for p in evaluation.registry()["patterns"]}
    if pattern_id not in ids:
        raise ValueError("ABSTENTION_PATTERN_UNKNOWN")
    if not isinstance(abstained_count, int) or isinstance(abstained_count, bool) or abstained_count < 0:
        raise ValueError("ABSTAINED_COUNT_TYPE")
    if not isinstance(evaluated_count, int) or isinstance(evaluated_count, bool) or evaluated_count < 0:
        raise ValueError("EVALUATED_COUNT_TYPE")
    body = {
        "schema": ABSTENTION_SCHEMA,
        "pattern_id": pattern_id,
        "abstained_count": abstained_count,
        "evaluated_count": evaluated_count,
        "abstention_rate": _rate(abstained_count, evaluated_count + abstained_count),
        "engineering_conformance_only": True,
        "clinical_selective_safety_claimed": False,
        "diagnostic_runtime_influence_allowed": False,
    }
    body["abstention_sha256"] = _digest(body)
    return body


# --- claim gating -------------------------------------------------------------

def claim_gate(*, maturity):
    if not validate_evidence_maturity(maturity):
        raise ValueError("MATURITY_CONTRACT_INTEGRITY")
    state = maturity["maturity_state"]
    eligible = state == "CLINICALLY_ELIGIBLE"
    body = {
        "schema": CLAIM_GATE_SCHEMA,
        "maturity_state": state,
        "clinical_accuracy_promotion_allowed": eligible,
        "diagnostic_performance_promotion_allowed": eligible,
        "diagnostic_runtime_influence_allowed": False,
        "clinical_accuracy_claimed": False,
    }
    body["claim_gate_sha256"] = _digest(body)
    return body


# --- protected metric envelope ------------------------------------------------

def protected_metric_envelope(*, metric_name, pattern_id, gate, maturity, cohort_policy,
                              prediction_binding_sha256, confidence_stratum_ids=None):
    declaration = metric_declaration(metric_name=metric_name, pattern_id=pattern_id)
    expected_gate = reporting_eligibility_gate(
        approved_adjudicated_gold_count=gate["approved_adjudicated_gold_count"],
        clinical_gold_admission_performed=gate["clinical_gold_admission_performed"],
    )
    if gate != expected_gate:
        raise ValueError("ELIGIBILITY_GATE_INTEGRITY")
    if not validate_evidence_maturity(maturity):
        raise ValueError("MATURITY_CONTRACT_INTEGRITY")
    if maturity["gate"] != gate:
        raise ValueError("MATURITY_GATE_BINDING_MISMATCH")
    expected_policy = endpoint_cohort_policy(
        dataset_manifest_sha256=cohort_policy["dataset_manifest_sha256"],
        approved_adjudicated_gold_count=cohort_policy["approved_adjudicated_gold_count"],
        native_dataset_annotations_are_project_gold=cohort_policy["native_dataset_annotations_are_project_gold"],
        synthetic_fixtures_are_clinical_gold=cohort_policy["synthetic_fixtures_are_clinical_gold"],
    )
    if cohort_policy != expected_policy:
        raise ValueError("COHORT_POLICY_INTEGRITY")
    _sha(prediction_binding_sha256, "PREDICTION_BINDING_SHA256")
    strata = sorted(set(confidence_stratum_ids or []))
    for stratum_id in strata:
        if stratum_id not in CONFIDENCE_STRATA:
            raise ValueError("CONFIDENCE_STRATUM_UNKNOWN")
    reportable = maturity["maturity_state"] == "CLINICALLY_ELIGIBLE"
    value_state = "NOT_REPORTABLE" if maturity["maturity_state"] == "NOT_REPORTABLE" else "UNAVAILABLE"
    body = {
        "schema": ENVELOPE_SCHEMA,
        "declaration": declaration,
        "gate": deepcopy(gate),
        "maturity": deepcopy(maturity),
        "cohort_policy": deepcopy(cohort_policy),
        "prediction_binding_sha256": prediction_binding_sha256,
        "confidence_stratum_ids": strata,
        "value": None,
        "value_state": value_state,
        "clinical_metric_reportable": reportable,
        "clinical_accuracy_claimed": False,
        "diagnostic_performance_reporting_allowed": False,
        "diagnostic_runtime_activation_allowed": False,
    }
    _safe(body)
    envelope_sha = _digest(body)
    return {**body, "envelope_id": "metricenv_" + envelope_sha[:24], "envelope_sha256": envelope_sha}


def validate_protected_metric_envelope(value):
    if not isinstance(value, dict) or value.get("schema") != ENVELOPE_SCHEMA:
        return False
    try:
        copy = deepcopy(value)
        envelope_sha = copy.pop("envelope_sha256")
        envelope_id = copy.pop("envelope_id")
        if _sha(envelope_sha, "ENVELOPE_SHA256") != _digest(copy):
            return False
        if envelope_id != "metricenv_" + envelope_sha[:24]:
            return False
        rebuilt = protected_metric_envelope(
            metric_name=value["declaration"]["metric_name"],
            pattern_id=value["declaration"]["pattern_id"],
            gate=value["gate"],
            maturity=value["maturity"],
            cohort_policy=value["cohort_policy"],
            prediction_binding_sha256=value["prediction_binding_sha256"],
            confidence_stratum_ids=value["confidence_stratum_ids"],
        )
        return rebuilt == value
    except (KeyError, TypeError, ValueError):
        return False


# --- current zero-gold governed state ---------------------------------------

def current_zero_gold_reporting_state():
    gate = reporting_eligibility_gate(
        approved_adjudicated_gold_count=0, clinical_gold_admission_performed=False,
    )
    if gate["clinical_metric_computation_eligible"] is not False:
        raise ValueError("ZERO_GOLD_STATE_CHANGED")
    maturity = evidence_maturity_state(
        gate=gate, sufficient_support=False, endpoint_reconciled=False,
        freeze_verified=False, cohort_independent=False,
    )
    if maturity["maturity_state"] != "NOT_REPORTABLE":
        raise ValueError("ZERO_GOLD_MATURITY_CHANGED")
    return {
        "approved_adjudicated_gold_count": 0,
        "clinical_gold_admission_performed": False,
        "clinical_metric_computation_eligible": False,
        "maturity_state": "NOT_REPORTABLE",
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_promotion_allowed": False,
        "candidate_active": False,
        "diagnostic_runtime": "GOVERNED_INACTIVE",
    }


def release_contract():
    state = current_zero_gold_reporting_state()
    return {
        "schema": "ekg-ep3-pkt07-metric-reporting-release-contract-v1",
        "packet_id": "PKT-EP3-07",
        "theme": "Diagnostic-performance metric/reporting eligibility contracts",
        "repository": status.REPOSITORY,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "accepted_prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        **state,
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
