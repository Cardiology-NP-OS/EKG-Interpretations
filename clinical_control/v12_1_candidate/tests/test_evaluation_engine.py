import copy
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "validation_generated" / "evaluation_engine.py"
CONTRACTS = ROOT / "validation_generated" / "EVALUATION_CONTRACTS.json"
spec = importlib.util.spec_from_file_location("evaluation_engine", MODULE)
m = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(m)

passed = 0

def check(name, condition):
    global passed
    assert condition, name
    passed += 1
    print("PASS", name)

def expect_error(name, code, fn):
    global passed
    try:
        fn()
    except ValueError as exc:
        assert code in str(exc), (name, exc)
    else:
        raise AssertionError(name)
    passed += 1
    print("PASS", name)
def make_case(*, tracing_id="trace-001", subject="family-001", split="TEST",
              label="POSITIVE", coverage=None):
    tracing = {"tracing_id": tracing_id, "tracing_sha256": "a" * 64}
    binding = m.registry_binding()
    labels = {"sinus_rhythm": label}
    case = {
        "schema": m.GOLD_SCHEMA,
        "case_id": m.gold_case_id(tracing, binding),
        "case_version": 1,
        "source_provenance": {
            "source_id": "licensed-source-001",
            "source_sha256": "b" * 64,
            "rights_status": "APPROVED_FOR_EVALUATION",
            "consent_usage_status": "AUTHORIZED",
            "native_dataset_annotation_as_gold": False,
        },
        "tracing_identity": tracing,
        "usage_status": "APPROVED",
        "privacy_review_status": "CLEARED_NON_SENSITIVE",
        "registry_binding": binding,
        "independent_annotations": [
            {"reviewer_id": "reviewer-A", "session_id": "session-A",
             "blinded": True, "pattern_labels": dict(labels)},
            {"reviewer_id": "reviewer-B", "session_id": "session-B",
             "blinded": True, "pattern_labels": dict(labels)},
        ],
        "adjudication_status": "FINAL",
        "final_adjudication": {
            "adjudicator_id": "adjudicator-C",
            "session_id": "adjudication-C",
            "rationale": "Synthetic test rationale for workflow validation.",
            "pattern_labels": dict(labels),
        },
        "pattern_labels": dict(labels),
        "measurement_ground_truth": [
            {"metric": "qrs", "value": 100.0, "unit": "ms",
             "source": "synthetic-reference", "method": "explicit-test-value"}
        ],
        "partition": {
            "split": split,
            "case_family_id": subject,
            "subject_group_id": subject,
        },
        "coverage_tags": list(coverage or ["synthetic-adult-default"]),
    }
    return case

def make_prediction(case, label="POSITIVE"):
    return {
        "schema": m.PRED_SCHEMA,
        "case_id": case["case_id"],
        "case_version": case["case_version"],
        "engine_binding": {
            "engine_id": "quarantined-pattern-candidate",
            "commit": "c" * 40,
            "tree": "d" * 40,
            "configuration_sha256": "e" * 64,
        },
        "registry_binding": m.registry_binding(),
        "pattern_predictions": {"sinus_rhythm": label},
    }
reg = m.registry()
check("registry_version_pinned", reg["version"] == "5.0")
check("registry_count_59", len(reg["patterns"]) == 59)
contracts = json.loads(CONTRACTS.read_text(encoding="utf-8"))
check("contracts_candidate_inactive", contracts["candidate_active"] is False)
check("contracts_native_labels_not_gold", contracts["native_dataset_annotations_are_project_gold"] is False)

case = make_case()
check("valid_gold_case", m.validate_gold_case(case) is case)
same = make_case()
check("gold_id_deterministic", case["case_id"] == same["case_id"])
different = make_case(tracing_id="trace-002")
different["tracing_identity"]["tracing_sha256"] = "f" * 64
different["case_id"] = m.gold_case_id(different["tracing_identity"], different["registry_binding"])
check("gold_id_changes_with_tracing", case["case_id"] != different["case_id"])

bad = copy.deepcopy(case); bad["usage_status"] = "UNKNOWN"
expect_error("unknown_usage_blocks_gold", "GOLD_USAGE_NOT_APPROVED", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["privacy_review_status"] = "UNKNOWN"
expect_error("unknown_privacy_blocks_gold", "GOLD_PRIVACY_REVIEW_NOT_CLEAR", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["source_provenance"]["rights_status"] = "UNKNOWN"
expect_error("unknown_rights_blocks_gold", "SOURCE_RIGHTS_NOT_APPROVED", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["source_provenance"]["consent_usage_status"] = "UNKNOWN"
expect_error("unknown_usage_authority_blocks_gold", "SOURCE_USAGE_NOT_AUTHORIZED", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["source_provenance"]["native_dataset_annotation_as_gold"] = True
expect_error("native_dataset_label_cannot_be_gold", "NATIVE_DATASET_LABEL_CANNOT_BE_PROJECT_GOLD", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["independent_annotations"] = bad["independent_annotations"][:1]
expect_error("dual_annotation_required", "DUAL_INDEPENDENT_ANNOTATION_REQUIRED", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["independent_annotations"][1]["reviewer_id"] = "reviewer-A"
expect_error("reviewer_independence_required", "ANNOTATORS_NOT_INDEPENDENT", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["independent_annotations"][0]["blinded"] = False
expect_error("blinding_required", "ANNOTATION_NOT_BLINDED", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["adjudication_status"] = "DISAGREEMENT"
expect_error("final_adjudication_required", "FINAL_ADJUDICATION_REQUIRED", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["final_adjudication"]["rationale"] = " "
expect_error("adjudication_rationale_required", "ADJUDICATION_RATIONALE_REQUIRED", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["pattern_labels"] = {"not_a_pattern": "POSITIVE"}
expect_error("unknown_pattern_rejected", "PATTERN_LABEL_UNKNOWN", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["pattern_labels"]["sinus_rhythm"] = "NEGATIVE"
expect_error("final_label_binding_required", "FINAL_LABEL_BINDING_MISMATCH", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["measurement_ground_truth"][0]["value"] = math.inf
expect_error("measurement_truth_nonfinite_rejected", "MEASUREMENT_TRUTH_NONFINITE", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["partition"]["split"] = "RANDOM"
expect_error("unknown_partition_rejected", "PARTITION_STATE", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["case_id"] = "mutable-id"
expect_error("immutable_case_identity_enforced", "CASE_ID_NOT_IMMUTABLY_BOUND", lambda: m.validate_gold_case(bad))
bad = copy.deepcopy(case); bad["case_version"] = 0
expect_error("case_version_positive", "CASE_VERSION", lambda: m.validate_gold_case(bad))

other_split = make_case(tracing_id="trace-003", subject="family-001", split="TRAIN")
other_split["tracing_identity"]["tracing_sha256"] = "1" * 64
other_split["case_id"] = m.gold_case_id(other_split["tracing_identity"], other_split["registry_binding"])
expect_error("subject_split_leakage_rejected", "SUBJECT_OR_SERIAL_SPLIT_LEAKAGE",
             lambda: m.validate_no_split_leakage([case, other_split]))
safe_split = make_case(tracing_id="trace-004", subject="family-002", split="TRAIN")
safe_split["tracing_identity"]["tracing_sha256"] = "2" * 64
safe_split["case_id"] = m.gold_case_id(safe_split["tracing_identity"], safe_split["registry_binding"])
check("partition_nonleak_passes", m.validate_no_split_leakage([case, safe_split])["pass"] is True)

prediction = make_prediction(case)
check("prediction_exact_binding_valid", m.validate_prediction(prediction) is prediction)
bad_pred = copy.deepcopy(prediction); bad_pred["engine_binding"]["commit"] = "short"
expect_error("prediction_commit_must_be_exact", "ENGINE_COMMIT", lambda: m.validate_prediction(bad_pred))
bad_pred = copy.deepcopy(prediction); bad_pred["registry_binding"]["version"] = "stale"
expect_error("prediction_registry_stale_rejected", "REGISTRY_BINDING_STALE_OR_UNKNOWN", lambda: m.validate_prediction(bad_pred))
pairs = [
    ("POSITIVE", "POSITIVE"), ("POSITIVE", "NEGATIVE"),
    ("NEGATIVE", "POSITIVE"), ("NEGATIVE", "NEGATIVE"),
    ("INDETERMINATE", "POSITIVE"), ("POSITIVE", "UNSUPPORTED"),
]
counts = m.confusion_from_label_pairs(pairs)
check("confusion_tp_exact", counts["tp"] == 1)
check("confusion_tn_exact", counts["tn"] == 1)
check("confusion_fp_exact", counts["fp"] == 1)
check("confusion_fn_exact", counts["fn"] == 1)
check("confusion_exclusions_explicit", counts["excluded"] == 2 and counts["total"] == 6)
metric = m.metrics(counts)
check("sensitivity_exact", metric["sensitivity"]["value"] == 0.5)
check("specificity_exact", metric["specificity"]["value"] == 0.5)
check("ppv_exact", metric["ppv"]["value"] == 0.5)
check("npv_exact", metric["npv"]["value"] == 0.5)

zero = m.metrics({"tp":0,"tn":0,"fp":0,"fn":0})
check("zero_denominator_undefined", all(v["value"] is None and not v["defined"] for v in zero.values()))
gate0 = m.performance_gate([])
check("zero_gold_blocks_reporting", gate0["diagnostic_performance_reporting_allowed"] is False)
check("zero_gold_blocks_promotion", gate0["clinical_accuracy_promotion_allowed"] is False)
expect_error("clinical_report_refuses_zero_gold", "NO_APPROVED_ADJUDICATED_GOLD",
             lambda: m.clinical_metric_report(gold_cases=[], predictions=[], pattern_id="sinus_rhythm",
                                              engine_binding=prediction["engine_binding"], gold_version="none"))
gate1 = m.performance_gate([case])
check("validated_gold_is_counted", gate1["approved_adjudicated_gold_count"] == 1)
check("gold_does_not_auto_promote", gate1["clinical_accuracy_promotion_allowed"] is False)
clinical_counts = m.confusion_counts([case], [prediction], "sinus_rhythm")
check("bound_confusion_count", clinical_counts["tp"] == 1 and clinical_counts["evaluated"] == 1)
report = m.clinical_metric_report(
    gold_cases=[case], predictions=[prediction], pattern_id="sinus_rhythm",
    engine_binding=prediction["engine_binding"], gold_version="test-gold-v1")
check("report_has_denominator_context", report["sample_count_evaluated"] == 1 and report["sample_count_total"] == 1)
check("report_never_claims_accuracy", report["clinical_accuracy_claimed"] is False)

missing = m.confusion_counts([case], [], "sinus_rhythm")
check("missing_prediction_excluded", missing["excluded"] == 1 and missing["missing_prediction_records"] == 1)
coverage = m.coverage_inventory([case])
check("coverage_inventory_no_performance_claim", coverage["subgroup_performance_claimed"] is False)
check("coverage_inventory_counts_tags", coverage["coverage"]["synthetic-adult-default"] == 1)

fixture = m.synthetic_math_fixture()
check("synthetic_fixture_not_gold", fixture["clinical_gold"] is False)
fixture_counts = m.confusion_from_label_pairs(fixture["pairs"])
check("synthetic_fixture_math_only", fixture_counts["total"] == 6 and fixture_counts["evaluated"] == 4)
release = m.release_contract([])
check("release_candidate_inactive", release["candidate_active"] is False)
check("release_gold_count_zero", release["approved_adjudicated_gold_count"] == 0)
check("release_no_auto_activation", release["automatic_clinical_activation"] is False)
check("release_downstream_contract", release["downstream_projects"] == ["EP3", "EP4"])

print(json.dumps({
    "schema": "ekg-pkt09-evaluation-engine-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "approved_adjudicated_gold_count": 0,
    "candidate_active": False,
    "clinical_accuracy_claimed": False,
    "synthetic_fixture_is_clinical_gold": False,
}, sort_keys=True))
