#!/usr/bin/env python3
import argparse
import csv
import json
import statistics
import tempfile
from collections import Counter
from pathlib import Path

import wfdb

from run_ludb_qrs_v2_dev import load_json, parse_source_hashes, require
from run_ludb_qrs_v2_coverage_v2_dev import (
    add_timing,
    aggregate_view,
    distribution,
    run_record,
    subgroup_comparison,
    view_distribution,
)


def train_metrics(receipt):
    observed = receipt["annotation_observable_metrics"]
    return {
        "recordCount": receipt["dataset"]["record_count"],
        "referenceEventCount": observed["reference_event_count"],
        "predictedEventCount": observed["predicted_event_count"],
        "matchedEventCount": observed["matched_event_count"],
        "falsePositiveCount": observed["false_positive_count"],
        "falseNegativeCount": observed["false_negative_count"],
        "sensitivity": observed["sensitivity"],
        "positivePredictiveValue": observed["positive_predictive_value"],
        "f1": observed["f1"],
        "timingMeanAbsoluteErrorMs": observed["timing_mean_absolute_error_ms"],
        "timingMedianAbsoluteErrorMs": observed["timing_median_absolute_error_ms"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--comparison-output", required=True)
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    dataset_root = Path(args.dataset_root).resolve()
    output_path = Path(args.output).resolve()
    comparison_path = Path(args.comparison_output).resolve()
    require(not output_path.exists(), "LUDB_HOLDOUT_OUTPUT_ALREADY_EXISTS")
    require(not comparison_path.exists(), "LUDB_HOLDOUT_COMPARISON_ALREADY_EXISTS")
    require(output_path != comparison_path, "LUDB_HOLDOUT_OUTPUT_PATH_COLLISION")

    cohort = load_json(repo_root / "validation/development/LUDB_QRS_V2_DEV_V1.json")
    split = load_json(repo_root / "evaluation/splits/LUDB_QRS_V2_DEV_V1_SPLIT.json")
    protocol = load_json(repo_root / "evaluation/protocols/LUDB_QRS_V2_COVERAGE_V2_HOLDOUT_V1.json")
    train_receipt = load_json(repo_root / "validation/development/results/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2_TRAIN_RECEIPT.json")
    require(protocol["executed_split"] == "validation", "LUDB_HOLDOUT_VALIDATION_SPLIT_REQUIRED")
    require(protocol["holdout_authorized"] is True, "LUDB_HOLDOUT_NOT_AUTHORIZED")
    require(protocol["execution_policy"]["one_shot"] is True, "LUDB_HOLDOUT_ONE_SHOT_REQUIRED")
    require(protocol["change_policy"]["post_holdout_parameter_tuning"] == "PROHIBITED", "LUDB_HOLDOUT_TUNING_PROHIBITION")
    require(train_receipt["dataset"]["internal_holdout_annotations_parsed_or_scored"] is False, "LUDB_HOLDOUT_PRIOR_NONUSE_PROOF")
    require(cohort["split"]["holdout_annotations_observed_before_freeze"] is False, "LUDB_HOLDOUT_PRE_FREEZE_NONUSE_PROOF")
    require(cohort["relationship_to_locked_evaluation"]["contains_locked_signal_bytes"] is False, "LUDB_HOLDOUT_LOCKED_SIGNAL_LEAKAGE")

    expected_hashes = parse_source_hashes(dataset_root, cohort)
    source_records = [line.strip().split("/")[-1] for line in (dataset_root / "RECORDS").read_text(encoding="utf8").splitlines() if line.strip()]
    require(len(source_records) == 200 and len(set(source_records)) == 200, "LUDB_HOLDOUT_RECORDS_CONTRACT")
    validation = list(split["validation_source_records"])
    require(len(validation) == split["validation_count"] == protocol["executed_record_count"], "LUDB_HOLDOUT_SPLIT_COUNT")
    require(len(set(validation)) == len(validation), "LUDB_HOLDOUT_DUPLICATE_RECORD")
    require(set(validation).issubset(set(source_records)), "LUDB_HOLDOUT_RECORD_IDENTITY")
    metadata_rows = {
        row["ID"].strip(): row
        for row in csv.DictReader((dataset_root / "ludb.csv").open(encoding="utf-8-sig", newline=""))
    }
    require(set(metadata_rows) == set(source_records), "LUDB_HOLDOUT_METADATA_RECORD_IDENTITY")

    rows = []
    full_timing_errors = []
    observable_timing_errors = []
    with tempfile.TemporaryDirectory(prefix="ludb-qrs-v2-coverage-v2-holdout-") as temp:
        temp_root = Path(temp)
        for source_record in validation:
            row = run_record(repo_root, dataset_root, source_record, metadata_rows[source_record], expected_hashes, protocol, temp_root)
            full_timing_errors.extend(row.pop("_fullTimingErrorsMs"))
            observable_timing_errors.extend(row.pop("_observableTimingErrorsMs"))
            rows.append(row)

    full_record = add_timing(aggregate_view(rows, "full"), full_timing_errors)
    observable = add_timing(aggregate_view(rows, "observable"), observable_timing_errors)
    require(full_timing_errors == observable_timing_errors, "LUDB_HOLDOUT_TIMING_SCOPE_DRIFT")
    excluded_before = sum(row["excludedBeforeCount"] for row in rows)
    excluded_after = sum(row["excludedAfterCount"] for row in rows)
    excluded_total = excluded_before + excluded_after
    require(full_record["falsePositiveCount"] == observable["falsePositiveCount"] + excluded_total, "LUDB_HOLDOUT_FP_DECOMPOSITION")

    criteria = protocol["holdout_criteria"]
    catastrophic = [row for row in rows if row["observableSensitivity"] < criteria["catastrophic_record_sensitivity_floor"]]
    aggregate_targets_met = (
        observable["sensitivity"] >= criteria["micro_sensitivity_minimum"]
        and observable["positivePredictiveValue"] >= criteria["micro_positive_predictive_value_minimum"]
        and observable["f1"] >= criteria["micro_f1_minimum"]
    )
    outcome = "HOLDOUT_ENGINEERING_TARGETS_MET" if aggregate_targets_met and not catastrophic else "HOLDOUT_ENGINEERING_TARGETS_NOT_MET"
    subgroup_names = ["cardiac_pacing", "bundle_branch", "ventricular_extrasystole", "sinus_tachycardia", "sinus_bradycardia"]
    poor_records = sorted(rows, key=lambda row: (row["observableF1"], row["observablePositivePredictiveValue"], int(row["sourceRecord"])))
    frozen_train = train_metrics(train_receipt)
    result = {
        "schema": "ekg-ludb-qrs-v2-annotation-coverage-holdout-result-v1",
        "protocolId": protocol["protocol_id"],
        "protocolStateAtExecution": protocol["state"],
        "outcome": outcome,
        "cohortId": cohort["cohort_id"],
        "dataset": {
            "datasetId": cohort["dataset"]["dataset_id"],
            "version": cohort["dataset"]["version"],
            "executedSplit": "validation",
            "recordCount": len(rows),
            "holdoutConsumedByThisExecution": True,
            "holdoutAnnotationsPreviouslyParsedOrScored": False,
            "sourceManifestSha256": cohort["source_identity"]["source_sha256_manifest_sha256"],
            "allSourceManifestEntriesVerified": True,
        },
        "codeUnderTest": protocol["detector_code_under_test"],
        "evaluator": protocol["evaluator"],
        "matching": protocol["matching"],
        "fullRecordContext": full_record,
        "annotationObservable": observable,
        "falsePositiveDecomposition": {
            "fullRecordApparentFalsePositiveCount": full_record["falsePositiveCount"],
            "excludedOutsideAnnotationCoverageCount": excluded_total,
            "excludedBeforeCount": excluded_before,
            "excludedAfterCount": excluded_after,
            "remainingInternalFalsePositiveCount": observable["falsePositiveCount"],
        },
        "recordDistributions": {
            "fullRecordContext": view_distribution(rows, "full"),
            "annotationObservable": view_distribution(rows, "observable"),
            "excludedEdgeDetectionCount": distribution([row["excludedEdgeDetectionCount"] for row in rows]),
            "remainingInternalFalsePositiveCount": distribution([row["observableFalsePositiveCount"] for row in rows]),
            "coverageFraction": distribution([row["coverageFraction"] for row in rows]),
        },
        "metadataSubgroups": subgroup_comparison(rows, subgroup_names),
        "selectedLeadDistribution": dict(sorted(Counter(row["selectedLeadName"] for row in rows).items())),
        "holdoutCriteria": criteria,
        "aggregateTargetsMet": aggregate_targets_met,
        "catastrophicRecordCount": len(catastrophic),
        "records": rows,
        "reader": {"package": "wfdb", "version": wfdb.__version__, "validationOnly": True},
        "developmentDataBoundary": {
            "holdoutWasUnopenedBeforeThisExecution": True,
            "holdoutNowConsumed": True,
            "postHoldoutParameterTuningOnThisSplitAllowed": False,
            "lockedMitbihSignalsOrLabelsUsed": False,
            "sourceLabelsAreProjectGold": False,
            "projectGold": False,
        },
        "limitations": protocol["limitations"],
        "authority": cohort["authority"],
    }
    comparison = {
        "schema": "ekg-ludb-qrs-v2-train-holdout-comparison-v1",
        "protocolId": protocol["protocol_id"],
        "outcome": outcome,
        "sameDetectorConfigurationEvaluatorAndMatcher": True,
        "frozenTrain": frozen_train,
        "holdout": observable,
        "holdoutMinusTrain": {
            "sensitivity": observable["sensitivity"] - frozen_train["sensitivity"],
            "positivePredictiveValue": observable["positivePredictiveValue"] - frozen_train["positivePredictiveValue"],
            "f1": observable["f1"] - frozen_train["f1"],
            "timingMeanAbsoluteErrorMs": observable["timingMeanAbsoluteErrorMs"] - frozen_train["timingMeanAbsoluteErrorMs"],
            "timingMedianAbsoluteErrorMs": observable["timingMedianAbsoluteErrorMs"] - frozen_train["timingMedianAbsoluteErrorMs"],
        },
        "falsePositiveDecomposition": result["falsePositiveDecomposition"],
        "recordDistributions": result["recordDistributions"],
        "metadataSubgroups": result["metadataSubgroups"],
        "selectedLeadDistribution": result["selectedLeadDistribution"],
        "worstHoldoutRecords": [
            {
                "recordId": row["recordId"],
                "selectedLeadName": row["selectedLeadName"],
                "metadataPhenotypes": row["metadataPhenotypes"],
                "sensitivity": row["observableSensitivity"],
                "positivePredictiveValue": row["observablePositivePredictiveValue"],
                "f1": row["observableF1"],
                "internalFalsePositiveCount": row["observableFalsePositiveCount"],
                "falseNegativeCount": row["observableFalseNegativeCount"],
                "excludedEdgeDetectionCount": row["excludedEdgeDetectionCount"],
            }
            for row in poor_records[:20]
        ],
        "catastrophicRecords": [row["recordId"] for row in catastrophic],
        "holdoutWasUnopenedBeforeThisExecution": True,
        "holdoutNowConsumed": True,
        "postHoldoutParameterTuningOnThisSplitAllowed": False,
        "lockedMitbihSignalsOrLabelsUsed": False,
        "clinicalAccuracyEstablished": False,
        "authority": cohort["authority"],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    comparison_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("x", encoding="utf8") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")
    with comparison_path.open("x", encoding="utf8") as handle:
        json.dump(comparison, handle, indent=2)
        handle.write("\n")
    print("LUDB_QRS_V2_COVERAGE_HOLDOUT_RESULT " + json.dumps({
        "protocolId": protocol["protocol_id"],
        "outcome": outcome,
        "fullRecordContext": full_record,
        "annotationObservable": observable,
        "falsePositiveDecomposition": result["falsePositiveDecomposition"],
        "aggregateTargetsMet": aggregate_targets_met,
        "catastrophicRecordCount": len(catastrophic),
        "holdoutWasUnopenedBeforeThisExecution": True,
        "holdoutNowConsumed": True,
        "postHoldoutParameterTuningOnThisSplitAllowed": False,
        "lockedMitbihSignalsOrLabelsUsed": False,
        "runtimeAuthority": False,
        "metrics": "NOT_REPORTABLE",
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
