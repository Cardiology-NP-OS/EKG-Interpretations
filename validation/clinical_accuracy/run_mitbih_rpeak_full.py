#!/usr/bin/env python3
import argparse
import json
import math
import statistics
import subprocess
import tempfile
from collections import defaultdict
from pathlib import Path

import wfdb

import run_mitbih_rpeak_pilot as pilot

EXPECTED_RECORD_COUNT = 48
PROTOCOL_ID = "MITBIH-RPEAK-FULL-V1"
Z95 = 1.959963984540054


def wilson_95(successes, total):
    if total <= 0:
        return None
    p = successes / total
    z2 = Z95 * Z95
    denom = 1.0 + z2 / total
    center = (p + z2 / (2.0 * total)) / denom
    half = (Z95 * math.sqrt((p * (1.0 - p) / total) + (z2 / (4.0 * total * total)))) / denom
    return {"lower": max(0.0, center - half), "upper": min(1.0, center + half)}


def finite_distribution(values):
    vals = [v for v in values if v is not None and math.isfinite(v)]
    if not vals:
        return {"median": None, "min": None}
    return {"median": statistics.median(vals), "min": min(vals)}


def read_canonical_records(path):
    records = []
    for line in path.read_text(encoding="utf8", errors="strict").splitlines():
        value = line.strip()
        if value:
            records.append(value)
    if len(records) != EXPECTED_RECORD_COUNT:
        raise RuntimeError(f"RECORD_COUNT_MISMATCH:{len(records)}")
    if len(set(records)) != len(records):
        raise RuntimeError("DUPLICATE_RECORD_ID")
    if not all(record.isdigit() for record in records):
        raise RuntimeError("NON_NUMERIC_RECORD_ID")
    return records


def run_record(repo_root, temp, record_id, expected_hashes):
    filenames = [f"{record_id}.hea", f"{record_id}.dat", f"{record_id}.atr"]
    for name in filenames:
        pilot.download_exact_release_file(name, temp / name)

    source_hashes = {}
    for name in filenames:
        observed = pilot.sha256_file(temp / name)
        expected = expected_hashes.get(name)
        if expected is None:
            raise RuntimeError(f"SOURCE_HASH_NOT_LISTED:{name}")
        if observed.lower() != expected.lower():
            raise RuntimeError(f"SOURCE_HASH_MISMATCH:{name}")
        source_hashes[name] = observed

    rec = wfdb.rdrecord(str(temp / record_id), physical=True)
    ann = wfdb.rdann(str(temp / record_id), "atr")
    if rec.p_signal is None or rec.p_signal.shape[1] < 1:
        raise RuntimeError(f"NO_PHYSICAL_SIGNAL:{record_id}")

    fs_hz = float(rec.fs)
    lead_name = str(rec.sig_name[0])
    samples = [float(v) for v in rec.p_signal[:, 0]]
    if not all(math.isfinite(v) for v in samples):
        raise RuntimeError(f"NONFINITE_SIGNAL:{record_id}")

    truth = [
        int(sample)
        for sample, symbol in zip(ann.sample, ann.symbol)
        if symbol in pilot.BEAT_SYMBOLS
    ]
    if not truth:
        raise RuntimeError(f"NO_REFERENCE_BEATS:{record_id}")

    input_path = temp / f"{record_id}.target-input.json"
    output_path = temp / f"{record_id}.target-output.json"
    input_path.write_text(
        json.dumps(
            {
                "recordId": record_id,
                "leadName": lead_name,
                "sampleRateHz": fs_hz,
                "samples": samples,
                "signalAssetSha256": source_hashes[f"{record_id}.dat"],
                "config": pilot.CONFIG,
            },
            separators=(",", ":"),
        ),
        encoding="utf8",
    )

    node_runner = repo_root / "validation" / "clinical_accuracy" / "run_target_rpeak.js"
    proc = subprocess.run(
        ["node", str(node_runner), str(input_path), str(output_path)],
        cwd=str(repo_root),
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"TARGET_RUNNER_FAILED:{record_id}:{proc.stderr.strip() or proc.stdout.strip()}"
        )

    target = json.loads(output_path.read_text(encoding="utf8"))
    pred = [int(row["sampleIndex"]) for row in target["events"]]
    tolerance_samples = int(round(pilot.TOLERANCE_MS * fs_hz / 1000.0))
    errors_samples, fp, fn = pilot.match_events(truth, pred, tolerance_samples)
    tp = len(errors_samples)
    errors_ms = [abs(x) * 1000.0 / fs_hz for x in errors_samples]
    m = pilot.metrics(tp, fp, fn)

    return {
        "recordId": record_id,
        "leadName": lead_name,
        "sampleRateHz": fs_hz,
        "referenceBeatCount": len(truth),
        "predictedEventCount": len(pred),
        "matchedEventCount": tp,
        "falsePositiveCount": fp,
        "falseNegativeCount": fn,
        "sensitivity": m["sensitivity"],
        "positivePredictiveValue": m["positivePredictiveValue"],
        "f1": m["f1"],
        "timingMeanAbsoluteErrorMs": (sum(errors_ms) / len(errors_ms)) if errors_ms else None,
        "timingMedianAbsoluteErrorMs": statistics.median(errors_ms) if errors_ms else None,
        "sourceFilesSha256": source_hashes,
        "sourceHashesVerifiedAgainstPhysioNetManifest": True,
        "_errors_ms": errors_ms,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    with tempfile.TemporaryDirectory(prefix="mitbih-rpeak-full-") as td:
        temp = Path(td)

        pilot.download_exact_release_file("SHA256SUMS.txt", temp / "SHA256SUMS.txt")
        expected_hashes = pilot.parse_sha256s(temp / "SHA256SUMS.txt")
        pilot.download_exact_release_file("RECORDS", temp / "RECORDS")

        records_hash = pilot.sha256_file(temp / "RECORDS")
        expected_records_hash = expected_hashes.get("RECORDS")
        if expected_records_hash is not None and records_hash.lower() != expected_records_hash.lower():
            raise RuntimeError("SOURCE_HASH_MISMATCH:RECORDS")

        records = read_canonical_records(temp / "RECORDS")
        record_results = []
        all_errors_ms = []
        total_tp = total_fp = total_fn = 0
        subgroup_counts = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "records": 0})

        for record_id in records:
            row = run_record(repo_root, temp, record_id, expected_hashes)
            all_errors_ms.extend(row.pop("_errors_ms"))
            total_tp += row["matchedEventCount"]
            total_fp += row["falsePositiveCount"]
            total_fn += row["falseNegativeCount"]
            g = subgroup_counts[row["leadName"]]
            g["tp"] += row["matchedEventCount"]
            g["fp"] += row["falsePositiveCount"]
            g["fn"] += row["falseNegativeCount"]
            g["records"] += 1
            record_results.append(row)

        agg = pilot.metrics(total_tp, total_fp, total_fn)
        sens_dist = finite_distribution([row["sensitivity"] for row in record_results])
        ppv_dist = finite_distribution([row["positivePredictiveValue"] for row in record_results])
        f1_dist = finite_distribution([row["f1"] for row in record_results])

        subgroups = []
        for lead_name in sorted(subgroup_counts):
            c = subgroup_counts[lead_name]
            m = pilot.metrics(c["tp"], c["fp"], c["fn"])
            subgroups.append({
                "firstSignalLeadName": lead_name,
                "recordCount": c["records"],
                "referenceBeatCount": c["tp"] + c["fn"],
                "predictedEventCount": c["tp"] + c["fp"],
                "matchedEventCount": c["tp"],
                "falsePositiveCount": c["fp"],
                "falseNegativeCount": c["fn"],
                "sensitivity": m["sensitivity"],
                "positivePredictiveValue": m["positivePredictiveValue"],
                "f1": m["f1"],
            })

        result = {
            "schema": "ekg-mitbih-rpeak-full-result-v1",
            "protocolId": PROTOCOL_ID,
            "codeUnderTest": {
                "commit": "32e74373523512c3fcf3921fcb8e2501b8ea2bbb",
                "tree": "8134669d78b125adbca7d68c3e1f52c7fce63603",
                "targetEntrypoint": "lib/signal_measurement_contract.js::detectCandidateRPeaks",
            },
            "dataset": {
                "name": "MIT-BIH Arrhythmia Database",
                "version": pilot.PHYSIONET_VERSION,
                "physionetDirectory": pilot.PHYSIONET_RELEASE_DIR,
                "physionetBaseUrl": pilot.PHYSIONET_BASE_URL,
                "recordsFileSha256": records_hash,
                "records": records,
                "recordCount": len(records),
                "referenceAnnotation": "atr",
                "selectionRule": "ALL_RECORD_IDS_IN_VERSION_PINNED_PHYSIONET_RECORDS_FILE_NO_RESULT_BASED_EXCLUSIONS",
                "signalSelection": "FIRST_SIGNAL_CHANNEL_AS_STORED_BY_SOURCE",
                "license": "Open Data Commons Attribution License v1.0",
            },
            "configuration": pilot.CONFIG,
            "matching": {
                "toleranceMs": pilot.TOLERANCE_MS,
                "policy": "SORTED_ONE_TO_ONE_WITHIN_TOLERANCE",
            },
            "aggregate": {
                "referenceBeatCount": total_tp + total_fn,
                "predictedEventCount": total_tp + total_fp,
                "matchedEventCount": total_tp,
                "falsePositiveCount": total_fp,
                "falseNegativeCount": total_fn,
                "microSensitivity": agg["sensitivity"],
                "microPositivePredictiveValue": agg["positivePredictiveValue"],
                "microF1": agg["f1"],
                "timingMeanAbsoluteErrorMs": (sum(all_errors_ms) / len(all_errors_ms)) if all_errors_ms else None,
                "timingMedianAbsoluteErrorMs": statistics.median(all_errors_ms) if all_errors_ms else None,
                "eventLevelWilson95CiMicroSensitivity": wilson_95(total_tp, total_tp + total_fn),
                "eventLevelWilson95CiMicroPositivePredictiveValue": wilson_95(total_tp, total_tp + total_fp),
            },
            "recordDistribution": {
                "recordSensitivityMedian": sens_dist["median"],
                "recordSensitivityMin": sens_dist["min"],
                "recordPositivePredictiveValueMedian": ppv_dist["median"],
                "recordPositivePredictiveValueMin": ppv_dist["min"],
                "recordF1Median": f1_dist["median"],
                "recordF1Min": f1_dist["min"],
            },
            "descriptiveSubgroups": {
                "dimension": "FIRST_SIGNAL_LEAD_NAME",
                "groups": subgroups,
            },
            "records": record_results,
            "reader": {
                "package": "wfdb",
                "version": wfdb.__version__,
                "validationOnly": True,
            },
            "uncertaintyNote": "Event-level Wilson intervals are descriptive and do not treat beats within a record/patient as statistically independent clinical subjects.",
            "authority": {
                "projectGold": False,
                "sourceLabelsAreProjectGold": False,
                "reportable": False,
                "runtimeAuthority": False,
                "diagnosticRuntime": "GOVERNED_INACTIVE",
                "evidenceAdmission": "NOT_ADMITTED",
                "metrics": "NOT_REPORTABLE",
                "activation": "NOT_ELIGIBLE",
                "clinicalValidityInferred": False,
            },
            "interpretationBoundary": "QUARANTINED_FULL_DATABASE_DETECTOR_BENCHMARK_NOT_FINAL_CLINICAL_VALIDATION_OF_COMPLETE_ECG_SYSTEM",
        }

        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
        print("CLINICAL_FULL_RESULT " + json.dumps({
            "protocolId": PROTOCOL_ID,
            "recordCount": len(records),
            **result["aggregate"],
            **result["recordDistribution"],
            "reportable": False,
            "clinicalValidityInferred": False,
        }, separators=(",", ":")))


if __name__ == "__main__":
    main()
