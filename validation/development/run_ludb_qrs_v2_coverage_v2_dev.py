#!/usr/bin/env python3
import argparse
import csv
import json
import statistics
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

import wfdb

from run_ludb_qrs_v2_dev import (
    f1,
    load_json,
    parse_source_hashes,
    percentile,
    phenotype_flags,
    ratio,
    require,
)


def aggregate_view(rows, prefix):
    reference = sum(row[f"{prefix}ReferenceEventCount"] for row in rows)
    predicted = sum(row[f"{prefix}PredictedEventCount"] for row in rows)
    matched = sum(row[f"{prefix}MatchedEventCount"] for row in rows)
    false_positive = sum(row[f"{prefix}FalsePositiveCount"] for row in rows)
    false_negative = sum(row[f"{prefix}FalseNegativeCount"] for row in rows)
    sensitivity = ratio(matched, reference)
    ppv = ratio(matched, predicted)
    return {
        "recordCount": len(rows),
        "referenceEventCount": reference,
        "predictedEventCount": predicted,
        "matchedEventCount": matched,
        "falsePositiveCount": false_positive,
        "falseNegativeCount": false_negative,
        "sensitivity": sensitivity,
        "positivePredictiveValue": ppv,
        "f1": f1(sensitivity, ppv),
    }


def distribution(values):
    return {
        "median": statistics.median(values),
        "minimum": min(values),
        "p05": percentile(values, 0.05),
        "p95": percentile(values, 0.95),
        "maximum": max(values),
    }


def view_distribution(rows, prefix):
    return {
        "recordSensitivity": distribution([row[f"{prefix}Sensitivity"] for row in rows]),
        "recordPositivePredictiveValue": distribution([row[f"{prefix}PositivePredictiveValue"] for row in rows]),
        "recordF1": distribution([row[f"{prefix}F1"] for row in rows]),
    }


def add_timing(aggregate, timing_errors_ms):
    aggregate["timingMeanAbsoluteErrorMs"] = statistics.mean(timing_errors_ms) if timing_errors_ms else None
    aggregate["timingMedianAbsoluteErrorMs"] = statistics.median(timing_errors_ms) if timing_errors_ms else None
    return aggregate


def scoring_pairs(scoring):
    return [
        (row["referenceSampleIndex"], row["predictedSampleIndex"], row["absoluteErrorSamples"])
        for row in scoring
    ]


def run_record(repo_root, dataset_root, source_record, metadata, expected_hashes, protocol, temp_root):
    record_base = dataset_root / "data" / source_record
    record = wfdb.rdrecord(str(record_base), physical=True)
    require(record.p_signal is not None, f"LUDB_SIGNAL_REQUIRED:{source_record}")
    require(float(record.fs) == 500, f"LUDB_SAMPLE_RATE:{source_record}")
    require(record.p_signal.shape == (5000, 12), f"LUDB_SIGNAL_SHAPE:{source_record}")
    lead_names = [str(value).lower() for value in record.sig_name]
    require(len(set(lead_names)) == 12, f"LUDB_DUPLICATE_LEADS:{source_record}")
    leads = []
    references = {}
    annotation_hashes = {}
    for index, lead_name in enumerate(lead_names):
        samples = [float(value) for value in record.p_signal[:, index]]
        require(all(value == value and abs(value) != float("inf") for value in samples), f"LUDB_NONFINITE_SIGNAL:{source_record}:{lead_name}")
        leads.append({"leadName": lead_name, "samples": samples})
        annotation = wfdb.rdann(str(record_base), lead_name)
        peaks = [int(sample) for sample, symbol in zip(annotation.sample, annotation.symbol) if symbol == "N"]
        references[lead_name] = peaks
        annotation_hashes[lead_name] = expected_hashes[f"data/{source_record}.{lead_name}"]

    input_path = temp_root / f"{source_record}.coverage-v2.input.json"
    output_path = temp_root / f"{source_record}.coverage-v2.output.json"
    payload = {
        "recordId": f"ludb/1.0.1/data/{source_record}",
        "sampleRateHz": 500,
        "sampleCount": 5000,
        "leads": leads,
        "referenceEventsByLead": references,
        "signalAssetSha256": expected_hashes[f"data/{source_record}.dat"],
        "annotationAssetSha256ByLead": annotation_hashes,
        "configurationId": protocol["detector_code_under_test"]["configuration_id"],
    }
    input_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf8")
    process = subprocess.run(
        ["node", str(repo_root / protocol["evaluator"]["target_runner"]), str(input_path), str(output_path)],
        cwd=repo_root,
        text=True,
        capture_output=True,
        check=False,
    )
    require(process.returncode == 0, f"LUDB_COVERAGE_TARGET_RUNNER:{source_record}:{process.stderr.strip() or process.stdout.strip()}")
    target = load_json(output_path)
    coverage = target["coverageScoring"]
    full = coverage["fullRecord"]["matching"]
    observable = coverage["observable"]
    require(scoring_pairs(full["matches"]) == scoring_pairs(observable["matches"]), f"LUDB_COVERAGE_TIMING_SCOPE_DRIFT:{source_record}")
    require(full["predictedCount"] == observable["predictedEventCount"] + coverage["excludedEdges"]["totalCount"], f"LUDB_COVERAGE_ACCOUNTING:{source_record}")
    full_timing_ms = [row["absoluteErrorSamples"] * 2 for row in full["matches"]]
    observable_timing_ms = [row["absoluteErrorSamples"] * 2 for row in observable["matches"]]
    flags = phenotype_flags(metadata)
    full_sensitivity = ratio(full["matchedCount"], full["referenceCount"])
    full_ppv = ratio(full["matchedCount"], full["predictedCount"])
    observable_sensitivity = ratio(observable["matchedEventCount"], observable["referenceEventCount"])
    observable_ppv = ratio(observable["matchedEventCount"], observable["predictedEventCount"])
    interval = coverage["annotationObservableInterval"]
    return {
        "recordId": f"ludb/1.0.1/data/{source_record}",
        "sourceRecord": source_record,
        "selectedLeadName": target["selectedLeadName"],
        "coverageFirstReferenceSampleIndex": interval["firstReferenceSampleIndex"],
        "coverageLastReferenceSampleIndex": interval["lastReferenceSampleIndex"],
        "coverageFraction": (interval["lastReferenceSampleIndex"] - interval["firstReferenceSampleIndex"] + 1) / target["sampleCount"],
        "fullReferenceEventCount": full["referenceCount"],
        "fullPredictedEventCount": full["predictedCount"],
        "fullMatchedEventCount": full["matchedCount"],
        "fullFalsePositiveCount": full["falsePositiveCount"],
        "fullFalseNegativeCount": full["falseNegativeCount"],
        "fullSensitivity": full_sensitivity,
        "fullPositivePredictiveValue": full_ppv,
        "fullF1": f1(full_sensitivity, full_ppv),
        "observableReferenceEventCount": observable["referenceEventCount"],
        "observablePredictedEventCount": observable["predictedEventCount"],
        "observableMatchedEventCount": observable["matchedEventCount"],
        "observableFalsePositiveCount": observable["falsePositiveCount"],
        "observableFalseNegativeCount": observable["falseNegativeCount"],
        "observableSensitivity": observable_sensitivity,
        "observablePositivePredictiveValue": observable_ppv,
        "observableF1": f1(observable_sensitivity, observable_ppv),
        "excludedEdgeDetectionCount": coverage["excludedEdges"]["totalCount"],
        "excludedBeforeCount": coverage["excludedEdges"]["beforeCount"],
        "excludedAfterCount": coverage["excludedEdges"]["afterCount"],
        "boundaryRescueBeforeCount": observable["boundaryRescueBeforeCount"],
        "boundaryRescueAfterCount": observable["boundaryRescueAfterCount"],
        "internalFalsePositiveSampleIndices": observable["internalFalsePositiveSampleIndices"],
        "unmatchedReferenceSampleIndices": observable["unmatchedReferenceSampleIndices"],
        "fullTimingMeanAbsoluteErrorMs": statistics.mean(full_timing_ms) if full_timing_ms else None,
        "fullTimingMedianAbsoluteErrorMs": statistics.median(full_timing_ms) if full_timing_ms else None,
        "observableTimingMeanAbsoluteErrorMs": statistics.mean(observable_timing_ms) if observable_timing_ms else None,
        "observableTimingMedianAbsoluteErrorMs": statistics.median(observable_timing_ms) if observable_timing_ms else None,
        "pacedComplexCandidateCount": target["pacedComplexCandidateCount"],
        "searchbackEventCount": target["searchbackEventCount"],
        "metadataPhenotypes": [name for name, present in flags.items() if present],
        "sourceFilesSha256": {
            "header": expected_hashes[f"data/{source_record}.hea"],
            "signal": expected_hashes[f"data/{source_record}.dat"],
            "selectedLeadAnnotation": target["sourceFilesSha256"]["selectedLeadAnnotation"],
        },
        "_fullTimingErrorsMs": full_timing_ms,
        "_observableTimingErrorsMs": observable_timing_ms,
    }


def require_historical_reproduction(aggregate, receipt):
    historical = receipt["observed_development_metrics"]
    exact_fields = {
        "referenceEventCount": "reference_event_count",
        "predictedEventCount": "predicted_event_count",
        "matchedEventCount": "matched_event_count",
        "falsePositiveCount": "false_positive_count",
        "falseNegativeCount": "false_negative_count",
        "sensitivity": "sensitivity",
        "positivePredictiveValue": "positive_predictive_value",
        "f1": "f1",
        "timingMeanAbsoluteErrorMs": "timing_mean_absolute_error_ms",
        "timingMedianAbsoluteErrorMs": "timing_median_absolute_error_ms",
    }
    for actual_key, receipt_key in exact_fields.items():
        require(aggregate[actual_key] == historical[receipt_key], f"LUDB_HISTORICAL_REPRODUCTION_DRIFT:{actual_key}")


def subgroup_comparison(rows, subgroup_names):
    output = {}
    for name in subgroup_names:
        selected = [row for row in rows if name in row["metadataPhenotypes"]]
        output[name] = {
            "historicalFullRecord": aggregate_view(selected, "full"),
            "annotationObservable": aggregate_view(selected, "observable"),
            "excludedEdgeDetectionCount": sum(row["excludedEdgeDetectionCount"] for row in selected),
        }
    return output


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
    require(not output_path.exists(), "LUDB_COVERAGE_OUTPUT_ALREADY_EXISTS")
    require(not comparison_path.exists(), "LUDB_COVERAGE_COMPARISON_ALREADY_EXISTS")
    require(output_path != comparison_path, "LUDB_COVERAGE_OUTPUT_PATH_COLLISION")
    cohort = load_json(repo_root / "validation/development/LUDB_QRS_V2_DEV_V1.json")
    split = load_json(repo_root / "evaluation/splits/LUDB_QRS_V2_DEV_V1_SPLIT.json")
    protocol = load_json(repo_root / "evaluation/protocols/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2.json")
    historical_receipt = load_json(repo_root / "validation/development/results/LUDB_QRS_V2_TRAIN_V1_RECEIPT.json")
    require(protocol["executed_split"] == "train", "LUDB_COVERAGE_TRAIN_SPLIT_REQUIRED")
    require(protocol["internal_holdout_authorized"] is False, "LUDB_COVERAGE_HOLDOUT_MUST_REMAIN_CLOSED")
    require(protocol["change_policy"]["detector_or_configuration_change"] == "PROHIBITED_IN_THIS_EVALUATOR_REPAIR", "LUDB_COVERAGE_DETECTOR_CHANGE")
    require(cohort["relationship_to_locked_evaluation"]["contains_locked_signal_bytes"] is False, "LUDB_COVERAGE_LOCKED_SIGNAL_LEAKAGE")
    expected_hashes = parse_source_hashes(dataset_root, cohort)
    records = [line.strip().split("/")[-1] for line in (dataset_root / "RECORDS").read_text(encoding="utf8").splitlines() if line.strip()]
    require(len(records) == 200 and len(set(records)) == 200, "LUDB_COVERAGE_RECORDS_CONTRACT")
    validation = set(split["validation_source_records"])
    train = [record for record in records if record not in validation]
    require(len(train) == split["train_count"] and len(validation) == split["validation_count"], "LUDB_COVERAGE_SPLIT_COUNT")
    metadata_rows = {
        row["ID"].strip(): row
        for row in csv.DictReader((dataset_root / "ludb.csv").open(encoding="utf-8-sig", newline=""))
    }
    require(set(metadata_rows) == set(records), "LUDB_COVERAGE_METADATA_RECORD_IDENTITY")

    rows = []
    full_timing_errors = []
    observable_timing_errors = []
    with tempfile.TemporaryDirectory(prefix="ludb-qrs-v2-coverage-v2-train-") as temp:
        temp_root = Path(temp)
        for source_record in train:
            row = run_record(repo_root, dataset_root, source_record, metadata_rows[source_record], expected_hashes, protocol, temp_root)
            full_timing_errors.extend(row.pop("_fullTimingErrorsMs"))
            observable_timing_errors.extend(row.pop("_observableTimingErrorsMs"))
            rows.append(row)

    historical_full = add_timing(aggregate_view(rows, "full"), full_timing_errors)
    observable = add_timing(aggregate_view(rows, "observable"), observable_timing_errors)
    require_historical_reproduction(historical_full, historical_receipt)
    excluded_before = sum(row["excludedBeforeCount"] for row in rows)
    excluded_after = sum(row["excludedAfterCount"] for row in rows)
    excluded_total = excluded_before + excluded_after
    require(historical_full["falsePositiveCount"] == observable["falsePositiveCount"] + excluded_total, "LUDB_COVERAGE_FP_DECOMPOSITION")
    require(full_timing_errors == observable_timing_errors, "LUDB_COVERAGE_AGGREGATE_TIMING_SCOPE_DRIFT")
    subgroup_names = ["cardiac_pacing", "bundle_branch", "ventricular_extrasystole", "sinus_tachycardia", "sinus_bradycardia"]
    catastrophic_floor = protocol["development_criteria"]["catastrophic_record_sensitivity_floor"]
    poor_records = sorted(rows, key=lambda row: (row["observableF1"], row["observablePositivePredictiveValue"], int(row["sourceRecord"])))
    result = {
        "schema": "ekg-ludb-qrs-v2-annotation-coverage-development-result-v2",
        "protocolId": protocol["protocol_id"],
        "protocolStateAtExecution": protocol["state"],
        "historicalResultId": historical_receipt["result_id"],
        "cohortId": cohort["cohort_id"],
        "dataset": {
            "datasetId": cohort["dataset"]["dataset_id"],
            "version": cohort["dataset"]["version"],
            "executedSplit": "train",
            "recordCount": len(rows),
            "internalHoldoutRecordCount": len(validation),
            "internalHoldoutAnnotationsParsedOrScored": False,
            "sourceManifestSha256": cohort["source_identity"]["source_sha256_manifest_sha256"],
            "allSourceManifestEntriesVerified": True,
        },
        "codeUnderTest": protocol["detector_code_under_test"],
        "evaluator": protocol["evaluator"],
        "matching": protocol["matching"],
        "historicalFullRecord": historical_full,
        "annotationObservable": observable,
        "falsePositiveDecomposition": {
            "historicalApparentFalsePositiveCount": historical_full["falsePositiveCount"],
            "excludedOutsideAnnotationCoverageCount": excluded_total,
            "excludedBeforeCount": excluded_before,
            "excludedAfterCount": excluded_after,
            "remainingInternalFalsePositiveCount": observable["falsePositiveCount"],
        },
        "recordDistributions": {
            "historicalFullRecord": view_distribution(rows, "full"),
            "annotationObservable": view_distribution(rows, "observable"),
            "excludedEdgeDetectionCount": distribution([row["excludedEdgeDetectionCount"] for row in rows]),
            "remainingInternalFalsePositiveCount": distribution([row["observableFalsePositiveCount"] for row in rows]),
            "coverageFraction": distribution([row["coverageFraction"] for row in rows]),
        },
        "metadataSubgroups": subgroup_comparison(rows, subgroup_names),
        "selectedLeadDistribution": dict(sorted(Counter(row["selectedLeadName"] for row in rows).items())),
        "catastrophicRecordRule": f"annotation-observable record sensitivity < {catastrophic_floor}",
        "catastrophicRecordCount": sum(row["observableSensitivity"] < catastrophic_floor for row in rows),
        "records": rows,
        "reader": {"package": "wfdb", "version": wfdb.__version__, "validationOnly": True},
        "developmentDataBoundary": {
            "lockedMitbihSignalsOrLabelsUsed": False,
            "internalLudbHoldoutLabelsUsed": False,
            "sourceLabelsAreProjectGold": False,
            "projectGold": False,
        },
        "limitations": protocol["limitations"],
        "authority": cohort["authority"],
    }
    comparison = {
        "schema": "ekg-ludb-qrs-v2-evaluator-comparison-v2",
        "protocolId": protocol["protocol_id"],
        "historicalResultId": historical_receipt["result_id"],
        "sameDetectorAndConfiguration": True,
        "historicalFullRecord": historical_full,
        "annotationObservable": observable,
        "metricDelta": {
            "sensitivity": observable["sensitivity"] - historical_full["sensitivity"],
            "positivePredictiveValue": observable["positivePredictiveValue"] - historical_full["positivePredictiveValue"],
            "f1": observable["f1"] - historical_full["f1"],
        },
        "falsePositiveDecomposition": result["falsePositiveDecomposition"],
        "timingComparison": {
            "matchedPairsByteEquivalentByOrderedValues": True,
            "historicalMeanAbsoluteErrorMs": historical_full["timingMeanAbsoluteErrorMs"],
            "observableMeanAbsoluteErrorMs": observable["timingMeanAbsoluteErrorMs"],
            "historicalMedianAbsoluteErrorMs": historical_full["timingMedianAbsoluteErrorMs"],
            "observableMedianAbsoluteErrorMs": observable["timingMedianAbsoluteErrorMs"],
        },
        "worstObservableRecords": [
            {
                "recordId": row["recordId"],
                "selectedLeadName": row["selectedLeadName"],
                "metadataPhenotypes": row["metadataPhenotypes"],
                "sensitivity": row["observableSensitivity"],
                "positivePredictiveValue": row["observablePositivePredictiveValue"],
                "f1": row["observableF1"],
                "internalFalsePositiveCount": row["observableFalsePositiveCount"],
                "excludedEdgeDetectionCount": row["excludedEdgeDetectionCount"],
            }
            for row in poor_records[:20]
        ],
        "metadataSubgroups": result["metadataSubgroups"],
        "selectedLeadDistribution": result["selectedLeadDistribution"],
        "catastrophicRecordRule": result["catastrophicRecordRule"],
        "catastrophicRecords": [row["recordId"] for row in rows if row["observableSensitivity"] < catastrophic_floor],
        "internalHoldoutAnnotationsParsedOrScored": False,
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
    print("LUDB_QRS_V2_COVERAGE_TRAIN_RESULT " + json.dumps({
        "protocolId": protocol["protocol_id"],
        "historicalFullRecord": historical_full,
        "annotationObservable": observable,
        "falsePositiveDecomposition": result["falsePositiveDecomposition"],
        "catastrophicRecordCount": result["catastrophicRecordCount"],
        "internalHoldoutAnnotationsParsedOrScored": False,
        "lockedMitbihSignalsOrLabelsUsed": False,
        "runtimeAuthority": False,
        "metrics": "NOT_REPORTABLE",
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
