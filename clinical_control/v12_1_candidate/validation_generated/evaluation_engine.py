"""PKT-EP1-09 adjudicated-gold and evaluation infrastructure.

Engineering/evaluation mechanics only. This module creates no clinical labels,
does not treat native dataset annotations as adjudicated gold, and blocks
diagnostic-performance claims when approved adjudicated gold is absent.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "source_core" / "23_PATTERN_REGISTRY.json"
REGISTRY_SHA256 = "05764e9437862f6c4f1948c6f0385abb320764c4cb0f2007ce7c426df7d31fdb"
GOLD_SCHEMA = "ekg-pkt09-gold-case-v1"
PRED_SCHEMA = "ekg-pkt09-prediction-v1"
SYNTHETIC_SCHEMA = "ekg-pkt09-synthetic-evaluator-case-v1"
LABELS = {"POSITIVE", "NEGATIVE", "INDETERMINATE"}
PREDICTION_LABELS = LABELS | {"UNSUPPORTED"}
SPLITS = {"TRAIN", "VALIDATION", "TEST", "HELD_OUT"}
def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

def _id(prefix: str, value) -> str:
    return prefix + hashlib.sha256(_canonical(value)).hexdigest()[:24]

def _sha40(value, name):
    if not isinstance(value, str) or len(value) != 40:
        raise ValueError(name)
    int(value, 16)
    return value

def _sha64(value, name):
    if not isinstance(value, str) or len(value) != 64:
        raise ValueError(name)
    int(value, 16)
    return value

def registry():
    if _sha(REGISTRY_PATH) != REGISTRY_SHA256:
        raise ValueError("PATTERN_REGISTRY_SHA256_MISMATCH")
    data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8-sig"))
    ids = [p["id"] for p in data["patterns"]]
    if data.get("version") != "5.0" or len(ids) != 59 or len(set(ids)) != 59:
        raise ValueError("PATTERN_REGISTRY_IDENTITY")
    return data
def registry_binding():
    data = registry()
    return {"version": data["version"], "sha256": REGISTRY_SHA256}

def gold_case_id(tracing_identity, binding=None):
    binding = binding or registry_binding()
    return _id("gold_", {"tracing_identity": tracing_identity, "registry_binding": binding})

def _validate_binding(binding):
    expected = registry_binding()
    if binding != expected:
        raise ValueError("REGISTRY_BINDING_STALE_OR_UNKNOWN")

def _validate_labels(labels):
    ids = {p["id"] for p in registry()["patterns"]}
    if not isinstance(labels, dict) or not labels:
        raise ValueError("PATTERN_LABELS_EMPTY")
    for pattern_id, label in labels.items():
        if pattern_id not in ids:
            raise ValueError("PATTERN_LABEL_UNKNOWN")
        if label not in LABELS:
            raise ValueError("PATTERN_LABEL_STATE")
    return labels

def _required(mapping, fields, code):
    if not isinstance(mapping, dict):
        raise ValueError(code)
    missing = sorted(set(fields) - set(mapping))
    if missing:
        raise ValueError(code + ":" + ",".join(missing))

def validate_gold_case(case: dict) -> dict:
    if case.get("schema") != GOLD_SCHEMA:
        raise ValueError("GOLD_SCHEMA")
    required = {"case_id", "case_version", "source_provenance", "tracing_identity",
                "usage_status", "privacy_review_status", "registry_binding",
                "independent_annotations", "adjudication_status", "final_adjudication",
                "pattern_labels", "measurement_ground_truth", "partition"}
    _required(case, required, "GOLD_MISSING")
    if case["usage_status"] != "APPROVED":
        raise ValueError("GOLD_USAGE_NOT_APPROVED")
    if case["privacy_review_status"] != "CLEARED_NON_SENSITIVE":
        raise ValueError("GOLD_PRIVACY_REVIEW_NOT_CLEAR")
    source = case["source_provenance"]
    _required(source, {"source_id", "source_sha256", "rights_status", "consent_usage_status",
                       "native_dataset_annotation_as_gold"}, "SOURCE_PROVENANCE_MISSING")
    _sha64(source["source_sha256"], "SOURCE_SHA256")
    if source["rights_status"] != "APPROVED_FOR_EVALUATION":
        raise ValueError("SOURCE_RIGHTS_NOT_APPROVED")
    if source["consent_usage_status"] != "AUTHORIZED":
        raise ValueError("SOURCE_USAGE_NOT_AUTHORIZED")
    if source["native_dataset_annotation_as_gold"] is not False:
        raise ValueError("NATIVE_DATASET_LABEL_CANNOT_BE_PROJECT_GOLD")
    tracing = case["tracing_identity"]
    _required(tracing, {"tracing_id", "tracing_sha256"}, "TRACING_IDENTITY_MISSING")
    _sha64(tracing["tracing_sha256"], "TRACING_SHA256")
    _validate_binding(case["registry_binding"])
    if case["case_id"] != gold_case_id(tracing, case["registry_binding"]):
        raise ValueError("CASE_ID_NOT_IMMUTABLY_BOUND")
    if not isinstance(case["case_version"], int) or case["case_version"] < 1:
        raise ValueError("CASE_VERSION")
    annotations = case["independent_annotations"]
    if not isinstance(annotations, list) or len(annotations) < 2:
        raise ValueError("DUAL_INDEPENDENT_ANNOTATION_REQUIRED")
    reviewers = []
    for annotation in annotations:
        _required(annotation, {"reviewer_id", "session_id", "blinded", "pattern_labels"},
                  "ANNOTATION_MISSING")
        if annotation["blinded"] is not True:
            raise ValueError("ANNOTATION_NOT_BLINDED")
        reviewers.append(annotation["reviewer_id"])
        _validate_labels(annotation["pattern_labels"])
    if len(reviewers) != len(set(reviewers)):
        raise ValueError("ANNOTATORS_NOT_INDEPENDENT")
    if case["adjudication_status"] != "FINAL":
        raise ValueError("FINAL_ADJUDICATION_REQUIRED")
    final = case["final_adjudication"]
    _required(final, {"adjudicator_id", "session_id", "rationale", "pattern_labels"},
              "FINAL_ADJUDICATION_MISSING")
    if not str(final["rationale"]).strip():
        raise ValueError("ADJUDICATION_RATIONALE_REQUIRED")
    _validate_labels(final["pattern_labels"])
    labels = _validate_labels(case["pattern_labels"])
    if labels != final["pattern_labels"]:
        raise ValueError("FINAL_LABEL_BINDING_MISMATCH")
    measurements = case["measurement_ground_truth"]
    if not isinstance(measurements, list):
        raise ValueError("MEASUREMENT_GROUND_TRUTH_SHAPE")
    for measurement in measurements:
        _required(measurement, {"metric", "value", "unit", "source", "method"},
                  "MEASUREMENT_TRUTH_MISSING")
        if not isinstance(measurement["value"], (int, float)) or not math.isfinite(measurement["value"]):
            raise ValueError("MEASUREMENT_TRUTH_NONFINITE")
        if not str(measurement["source"]).strip() or not str(measurement["method"]).strip():
            raise ValueError("MEASUREMENT_TRUTH_PROVENANCE")
    partition = case["partition"]
    _required(partition, {"split", "case_family_id", "subject_group_id"}, "PARTITION_MISSING")
    if partition["split"] not in SPLITS:
        raise ValueError("PARTITION_STATE")
    return case
def validate_no_split_leakage(cases):
    seen = {}
    conflicts = []
    for case in cases:
        validate_gold_case(case)
        group = case["partition"]["subject_group_id"]
        split = case["partition"]["split"]
        if group in seen and seen[group] != split:
            conflicts.append({"subject_group_id": group, "splits": sorted({seen[group], split})})
        else:
            seen[group] = split
    if conflicts:
        raise ValueError("SUBJECT_OR_SERIAL_SPLIT_LEAKAGE:" + json.dumps(conflicts, sort_keys=True))
    return {"pass": True, "subject_groups": len(seen)}

def validate_prediction(prediction):
    if prediction.get("schema") != PRED_SCHEMA:
        raise ValueError("PREDICTION_SCHEMA")
    _required(prediction, {"case_id", "case_version", "engine_binding", "registry_binding",
                           "pattern_predictions"}, "PREDICTION_MISSING")
    engine = prediction["engine_binding"]
    _required(engine, {"engine_id", "commit", "tree", "configuration_sha256"},
              "ENGINE_BINDING_MISSING")
    _sha40(engine["commit"], "ENGINE_COMMIT")
    _sha40(engine["tree"], "ENGINE_TREE")
    _sha64(engine["configuration_sha256"], "ENGINE_CONFIGURATION_SHA256")
    _validate_binding(prediction["registry_binding"])
    values = prediction["pattern_predictions"]
    ids = {p["id"] for p in registry()["patterns"]}
    if not isinstance(values, dict) or not values:
        raise ValueError("PREDICTIONS_EMPTY")
    for pattern_id, label in values.items():
        if pattern_id not in ids:
            raise ValueError("PREDICTION_PATTERN_UNKNOWN")
        if label not in PREDICTION_LABELS:
            raise ValueError("PREDICTION_STATE")
    return prediction
def confusion_from_label_pairs(pairs):
    counts = {"tp": 0, "tn": 0, "fp": 0, "fn": 0, "excluded": 0,
              "exclusion_reasons": Counter()}
    for gold, prediction in pairs:
        if gold not in {"POSITIVE", "NEGATIVE"}:
            counts["excluded"] += 1
            counts["exclusion_reasons"]["gold_indeterminate"] += 1
            continue
        if prediction not in {"POSITIVE", "NEGATIVE"}:
            counts["excluded"] += 1
            counts["exclusion_reasons"]["prediction_indeterminate_or_unsupported"] += 1
            continue
        if gold == "POSITIVE" and prediction == "POSITIVE":
            counts["tp"] += 1
        elif gold == "NEGATIVE" and prediction == "NEGATIVE":
            counts["tn"] += 1
        elif gold == "NEGATIVE":
            counts["fp"] += 1
        else:
            counts["fn"] += 1
    counts["evaluated"] = counts["tp"] + counts["tn"] + counts["fp"] + counts["fn"]
    counts["total"] = counts["evaluated"] + counts["excluded"]
    counts["exclusion_reasons"] = dict(counts["exclusion_reasons"])
    return counts

def confusion_counts(gold_cases, predictions, pattern_id):
    indexed = {}
    for case in gold_cases:
        validate_gold_case(case)
        indexed[(case["case_id"], case["case_version"])] = case
    pairs = []
    missing_prediction = 0
    for prediction in predictions:
        validate_prediction(prediction)
        key = (prediction["case_id"], prediction["case_version"])
        if key not in indexed:
            raise ValueError("PREDICTION_CASE_VERSION_UNBOUND")
        case = indexed[key]
        if pattern_id not in case["pattern_labels"]:
            continue
        pairs.append((case["pattern_labels"][pattern_id],
                      prediction["pattern_predictions"].get(pattern_id, "UNSUPPORTED")))
    predicted_keys = {(p["case_id"], p["case_version"]) for p in predictions}
    for key, case in indexed.items():
        if pattern_id in case["pattern_labels"] and key not in predicted_keys:
            missing_prediction += 1
            pairs.append((case["pattern_labels"][pattern_id], "UNSUPPORTED"))
    out = confusion_from_label_pairs(pairs)
    out["missing_prediction_records"] = missing_prediction
    return out

def _metric(numerator, denominator):
    return {"value": None if denominator == 0 else numerator / denominator,
            "numerator": numerator, "denominator": denominator,
            "defined": denominator != 0}

def metrics(counts):
    return {
        "sensitivity": _metric(counts["tp"], counts["tp"] + counts["fn"]),
        "specificity": _metric(counts["tn"], counts["tn"] + counts["fp"]),
        "ppv": _metric(counts["tp"], counts["tp"] + counts["fp"]),
        "npv": _metric(counts["tn"], counts["tn"] + counts["fn"]),
    }

def metric_report(*, pattern_id, counts, engine_binding, gold_version):
    evaluated = counts["evaluated"]
    positive = counts["tp"] + counts["fn"]
    return {
        "schema": "ekg-pkt09-metric-report-v1",
        "pattern_id": pattern_id,
        "counts": dict(counts),
        "metrics": metrics(counts),
        "sample_count_evaluated": evaluated,
        "sample_count_total": counts["total"],
        "prevalence": _metric(positive, evaluated),
        "exclusions": counts["excluded"],
        "indeterminate_or_unsupported_rate": _metric(counts["excluded"], counts["total"]),
        "engine_binding": dict(engine_binding),
        "gold_version": gold_version,
        "clinical_accuracy_claimed": False,
    }

def clinical_metric_report(*, gold_cases, predictions, pattern_id, engine_binding, gold_version):
    gate = performance_gate(gold_cases)
    if not gate["diagnostic_performance_reporting_allowed"]:
        raise ValueError("NO_APPROVED_ADJUDICATED_GOLD")
    counts = confusion_counts(gold_cases, predictions, pattern_id)
    return metric_report(pattern_id=pattern_id, counts=counts,
                         engine_binding=engine_binding, gold_version=gold_version)

def coverage_inventory(cases):
    inventory = Counter()
    for case in cases:
        validate_gold_case(case)
        tags = case.get("coverage_tags", [])
        if not tags:
            inventory["UNSPECIFIED"] += 1
        else:
            for tag in tags:
                inventory[str(tag)] += 1
    return {"schema": "ekg-pkt09-coverage-inventory-v1",
            "case_count": len(cases), "coverage": dict(sorted(inventory.items())),
            "subgroup_performance_claimed": False}

def performance_gate(cases):
    approved = 0
    for case in cases:
        try:
            validate_gold_case(case)
        except ValueError:
            continue
        approved += 1
    return {
        "schema": "ekg-pkt09-clinical-performance-gate-v1",
        "approved_adjudicated_gold_count": approved,
        "diagnostic_performance_reporting_allowed": approved > 0,
        "clinical_accuracy_promotion_allowed": False,
        "candidate_active": False,
        "reason": "NO_APPROVED_ADJUDICATED_GOLD" if approved == 0 else "GOLD_PRESENT_BUT_PROMOTION_REQUIRES_SEPARATE_GOVERNANCE",
    }
def synthetic_math_fixture():
    return {
        "schema": SYNTHETIC_SCHEMA,
        "synthetic_engineering_evidence_only": True,
        "clinical_gold": False,
        "pairs": [
            ["POSITIVE", "POSITIVE"],
            ["POSITIVE", "NEGATIVE"],
            ["NEGATIVE", "POSITIVE"],
            ["NEGATIVE", "NEGATIVE"],
            ["INDETERMINATE", "POSITIVE"],
            ["POSITIVE", "INDETERMINATE"],
        ],
    }

def release_contract(gold_cases=()):
    gate = performance_gate(list(gold_cases))
    return {
        "schema": "ekg-pkt09-ep1-release-contract-v1",
        "packet": "PKT-EP1-09",
        "candidate_active": False,
        "automatic_clinical_activation": False,
        "clinical_accuracy_claimed": False,
        "native_ptbxl_labels_are_project_gold": False,
        "approved_adjudicated_gold_count": gate["approved_adjudicated_gold_count"],
        "diagnostic_performance_reporting_allowed": gate["diagnostic_performance_reporting_allowed"],
        "downstream_projects": ["EP3", "EP4"],
        "downstream_authority": "evaluation_infrastructure_only",
        "separate_governance_required_for_clinical_activation": True,
    }
