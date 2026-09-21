#!/usr/bin/env python3
import argparse
import csv
import hashlib
import json
import math
import statistics
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

import wfdb


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path):
    return json.loads(path.read_text(encoding="utf8"))


def parse_source_hashes(dataset_root, cohort):
    manifest_path = dataset_root / "SHA256SUMS.txt"
    require(sha256_file(manifest_path) == cohort["source_identity"]["source_sha256_manifest_sha256"], "LUDB_SOURCE_MANIFEST_HASH")
    expected = {}
    for line in manifest_path.read_text(encoding="utf8").splitlines():
        digest, relative = line.split(maxsplit=1)
        relative = relative.strip()
        target = (dataset_root / relative).resolve()
        require(target.is_relative_to(dataset_root.resolve()), "LUDB_SOURCE_PATH_ESCAPE")
        require(relative not in expected, "LUDB_DUPLICATE_SOURCE_PATH")
        require(len(digest) == 64 and all(ch in "0123456789abcdef" for ch in digest), "LUDB_SOURCE_HASH_FORMAT")
        expected[relative] = digest
    require(len(expected) == cohort["source_identity"]["source_sha256_manifest_entries"], "LUDB_SOURCE_MANIFEST_ENTRY_COUNT")
    failures = []
    for relative, expected_digest in expected.items():
        target = dataset_root / relative
        if not target.is_file() or sha256_file(target) != expected_digest:
            failures.append(relative)
    require(not failures, "LUDB_SOURCE_HASH_VERIFICATION_FAILED:" + ",".join(failures[:5]))
    return expected


def percentile(values, probability):
    ordered = sorted(values)
    position = (len(ordered) - 1) * probability
    left = math.floor(position)
    fraction = position - left
    right = ordered[left + 1] if left + 1 < len(ordered) else ordered[left]
    return ordered[left] + (right - ordered[left]) * fraction


def ratio(numerator, denominator):
    return None if denominator == 0 else numerator / denominator


def f1(sensitivity, positive_predictive_value):
    if sensitivity is None or positive_predictive_value is None or sensitivity + positive_predictive_value == 0:
        return None
    return 2 * sensitivity * positive_predictive_value / (sensitivity + positive_predictive_value)


def phenotype_flags(metadata):
    return {
        "cardiac_pacing": bool(metadata["Cardiac pacing"].strip()),
        "bundle_branch": "bundle branch block" in metadata["Conduction abnormalities"].lower(),
        "ventricular_extrasystole": "ventricular extrasystole" in metadata["Extrasystolies"].lower(),
        "sinus_tachycardia": "tachycardia" in metadata["Rhythms"].lower(),
        "sinus_bradycardia": "bradycardia" in metadata["Rhythms"].lower(),
    }


def aggregate_rows(rows):
    reference = sum(row["referenceEventCount"] for row in rows)
    predicted = sum(row["predictedEventCount"] for row in rows)
    matched = sum(row["matchedEventCount"] for row in rows)
    false_positive = sum(row["falsePositiveCount"] for row in rows)
    false_negative = sum(row["falseNegativeCount"] for row in rows)
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
        require(all(math.isfinite(value) for value in samples), f"LUDB_NONFINITE_SIGNAL:{source_record}:{lead_name}")
        leads.append({"leadName": lead_name, "samples": samples})
        annotation = wfdb.rdann(str(record_base), lead_name)
        peaks = [int(sample) for sample, symbol in zip(annotation.sample, annotation.symbol) if symbol == "N"]
        require(peaks, f"LUDB_QRS_REFERENCES_REQUIRED:{source_record}:{lead_name}")
        references[lead_name] = peaks
        annotation_hashes[lead_name] = expected_hashes[f"data/{source_record}.{lead_name}"]

    input_path = temp_root / f"{source_record}.input.json"
    output_path = temp_root / f"{source_record}.output.json"
    payload = {
        "recordId": f"ludb/1.0.1/data/{source_record}",
        "sampleRateHz": 500,
        "leads": leads,
        "referenceEventsByLead": references,
        "signalAssetSha256": expected_hashes[f"data/{source_record}.dat"],
        "annotationAssetSha256ByLead": annotation_hashes,
        "configurationId": protocol["detector_code_under_test"]["configuration_id"],
    }
    input_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf8")
    process = subprocess.run(
        ["node", str(repo_root / "validation/development/run_target_qrs_v2.js"), str(input_path), str(output_path)],
        cwd=repo_root,
        text=True,
        capture_output=True,
        check=False,
    )
    require(process.returncode == 0, f"LUDB_TARGET_RUNNER:{source_record}:{process.stderr.strip() or process.stdout.strip()}")
    target = load_json(output_path)
    matching = target["matching"]
    sensitivity = ratio(matching["matchedCount"], matching["referenceCount"])
    ppv = ratio(matching["matchedCount"], matching["predictedCount"])
    timing_errors_ms = [value * 2 for value in target["timingErrorsSamples"]]
    flags = phenotype_flags(metadata)
    return {
        "recordId": f"ludb/1.0.1/data/{source_record}",
        "sourceRecord": source_record,
        "selectedLeadName": target["selectedLeadName"],
        "referenceEventCount": matching["referenceCount"],
        "predictedEventCount": matching["predictedCount"],
        "matchedEventCount": matching["matchedCount"],
        "falsePositiveCount": matching["falsePositiveCount"],
        "falseNegativeCount": matching["falseNegativeCount"],
        "sensitivity": sensitivity,
        "positivePredictiveValue": ppv,
        "f1": f1(sensitivity, ppv),
        "timingMeanAbsoluteErrorMs": statistics.mean(timing_errors_ms) if timing_errors_ms else None,
        "timingMedianAbsoluteErrorMs": statistics.median(timing_errors_ms) if timing_errors_ms else None,
        "pacedComplexCandidateCount": target["pacedComplexCandidateCount"],
        "searchbackEventCount": target["searchbackEventCount"],
        "metadataPhenotypes": [name for name, present in flags.items() if present],
        "sourceFilesSha256": {
            "header": expected_hashes[f"data/{source_record}.hea"],
            "signal": expected_hashes[f"data/{source_record}.dat"],
            "selectedLeadAnnotation": target["sourceFilesSha256"]["selectedLeadAnnotation"],
        },
        "_timingErrorsMs": timing_errors_ms,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    dataset_root = Path(args.dataset_root).resolve()
    output_path = Path(args.output).resolve()
    require(not output_path.exists(), "LUDB_OUTPUT_ALREADY_EXISTS")
    cohort = load_json(repo_root / "validation/development/LUDB_QRS_V2_DEV_V1.json")
    split = load_json(repo_root / "evaluation/splits/LUDB_QRS_V2_DEV_V1_SPLIT.json")
    protocol = load_json(repo_root / "evaluation/protocols/LUDB_QRS_V2_DEVELOPMENT_V1.json")
    require(protocol["executed_split"] == "train", "LUDB_TRAIN_SPLIT_REQUIRED")
    require(protocol["internal_holdout_authorized"] is False, "LUDB_HOLDOUT_MUST_REMAIN_CLOSED")
    require(cohort["relationship_to_locked_evaluation"]["contains_locked_signal_bytes"] is False, "LUDB_LOCKED_SIGNAL_LEAKAGE")
    expected_hashes = parse_source_hashes(dataset_root, cohort)
    records = [line.strip().split("/")[-1] for line in (dataset_root / "RECORDS").read_text(encoding="utf8").splitlines() if line.strip()]
    require(len(records) == 200 and len(set(records)) == 200, "LUDB_RECORDS_CONTRACT")
    validation = set(split["validation_source_records"])
    train = [record for record in records if record not in validation]
    require(len(train) == split["train_count"] and len(validation) == split["validation_count"], "LUDB_SPLIT_COUNT")
    metadata_rows = {
        row["ID"].strip(): row
        for row in csv.DictReader((dataset_root / "ludb.csv").open(encoding="utf-8-sig", newline=""))
    }
    require(set(metadata_rows) == set(records), "LUDB_METADATA_RECORD_IDENTITY")

    record_results = []
    all_timing_errors = []
    with tempfile.TemporaryDirectory(prefix="ludb-qrs-v2-train-") as temp:
        temp_root = Path(temp)
        for source_record in train:
            row = run_record(repo_root, dataset_root, source_record, metadata_rows[source_record], expected_hashes, protocol, temp_root)
            all_timing_errors.extend(row.pop("_timingErrorsMs"))
            record_results.append(row)

    aggregate = aggregate_rows(record_results)
    aggregate["timingMeanAbsoluteErrorMs"] = statistics.mean(all_timing_errors) if all_timing_errors else None
    aggregate["timingMedianAbsoluteErrorMs"] = statistics.median(all_timing_errors) if all_timing_errors else None
    sensitivity_values = [row["sensitivity"] for row in record_results]
    ppv_values = [row["positivePredictiveValue"] for row in record_results]
    f1_values = [row["f1"] for row in record_results]
    subgroup_names = ["cardiac_pacing", "bundle_branch", "ventricular_extrasystole", "sinus_tachycardia", "sinus_bradycardia"]
    result = {
        "schema": "ekg-ludb-qrs-v2-development-result-v1",
        "protocolId": protocol["protocol_id"],
        "protocolStateAtExecution": protocol["state"],
        "cohortId": cohort["cohort_id"],
        "dataset": {
            "datasetId": cohort["dataset"]["dataset_id"],
            "version": cohort["dataset"]["version"],
            "executedSplit": "train",
            "recordCount": len(record_results),
            "internalHoldoutRecordCount": len(validation),
            "internalHoldoutAnnotationsParsedOrScored": False,
            "sourceManifestSha256": cohort["source_identity"]["source_sha256_manifest_sha256"],
            "allSourceManifestEntriesVerified": True,
        },
        "codeUnderTest": protocol["detector_code_under_test"],
        "matching": protocol["matching"],
        "aggregate": aggregate,
        "recordDistribution": {
            "recordSensitivityMedian": statistics.median(sensitivity_values),
            "recordSensitivityMin": min(sensitivity_values),
            "recordSensitivityP05": percentile(sensitivity_values, 0.05),
            "recordPositivePredictiveValueMedian": statistics.median(ppv_values),
            "recordPositivePredictiveValueMin": min(ppv_values),
            "recordPositivePredictiveValueP05": percentile(ppv_values, 0.05),
            "recordF1Median": statistics.median(f1_values),
            "recordF1Min": min(f1_values),
            "recordF1P05": percentile(f1_values, 0.05),
        },
        "metadataSubgroups": {
            name: aggregate_rows([row for row in record_results if name in row["metadataPhenotypes"]])
            for name in subgroup_names
        },
        "selectedLeadDistribution": dict(sorted(Counter(row["selectedLeadName"] for row in record_results).items())),
        "records": record_results,
        "reader": {"package": "wfdb", "version": wfdb.__version__, "validationOnly": True},
        "developmentDataBoundary": {
            "lockedMitbihSignalsOrLabelsUsed": False,
            "internalLudbHoldoutLabelsUsed": False,
            "sourceLabelsAreProjectGold": False,
            "projectGold": False,
        },
        "limitations": [
            "LUDB records are ten-second twelve-lead ECGs and do not establish long-duration ambulatory performance.",
            "Per-lead source annotations are external labels and are not project clinical gold.",
            "Metadata phenotype subgroups are descriptive and may overlap.",
            "Metrics are nonreportable development evidence and do not establish clinical validity.",
        ],
        "authority": cohort["authority"],
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("x", encoding="utf8") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")
    print("LUDB_QRS_V2_TRAIN_RESULT " + json.dumps({
        "protocolId": result["protocolId"],
        **result["aggregate"],
        **result["recordDistribution"],
        "internalHoldoutAnnotationsParsedOrScored": False,
        "runtimeAuthority": False,
        "metrics": "NOT_REPORTABLE",
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
