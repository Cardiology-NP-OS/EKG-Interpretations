#!/usr/bin/env python3
import argparse
import hashlib
import json
import math
import os
import statistics
import subprocess
import tempfile
import urllib.request
from pathlib import Path

import wfdb

RECORDS = ["100", "101", "102", "103", "104"]
PHYSIONET_DB = "mitdb"
PHYSIONET_VERSION = "1.0.0"
PHYSIONET_RELEASE_DIR = f"{PHYSIONET_DB}/{PHYSIONET_VERSION}"
PHYSIONET_BASE_URL = f"https://physionet.org/files/{PHYSIONET_RELEASE_DIR}"
BEAT_SYMBOLS = {
    "N","L","R","B","A","a","J","S","V","r","F","e","j","n","E","/","f","Q","?"
}
CONFIG = {"minAbsoluteDeviation": 0.9, "refractoryMs": 200}
TOLERANCE_MS = 150

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

def parse_sha256s(path):
    out = {}
    with open(path, "r", encoding="utf8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or "  " not in line:
                continue
            digest, name = line.split("  ", 1)
            out[name.lstrip("*")] = digest
    return out

def download_exact_release_file(name, destination):
    url = f"{PHYSIONET_BASE_URL}/{name}"
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "EKG-Interpretations-Clinical-Validation/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        if response.status != 200:
            raise RuntimeError(f"SOURCE_DOWNLOAD_STATUS:{name}:{response.status}")
        destination.write_bytes(response.read())


def safe_ratio(n, d):
    return None if d == 0 else n / d

def match_events(truth, pred, tolerance_samples):
    i = j = 0
    matched = []
    fp = fn = 0
    while i < len(truth) and j < len(pred):
        t = truth[i]
        p = pred[j]
        if p < t - tolerance_samples:
            fp += 1
            j += 1
        elif p > t + tolerance_samples:
            fn += 1
            i += 1
        else:
            matched.append(p - t)
            i += 1
            j += 1
    fn += len(truth) - i
    fp += len(pred) - j
    return matched, fp, fn

def metrics(tp, fp, fn):
    sensitivity = safe_ratio(tp, tp + fn)
    ppv = safe_ratio(tp, tp + fp)
    f1 = None
    if sensitivity is not None and ppv is not None and sensitivity + ppv > 0:
        f1 = 2 * sensitivity * ppv / (sensitivity + ppv)
    return {"sensitivity": sensitivity, "positivePredictiveValue": ppv, "f1": f1}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]
    node_runner = repo_root / "validation" / "clinical_accuracy" / "run_target_rpeak.js"

    with tempfile.TemporaryDirectory(prefix="mitbih-rpeak-pilot-") as td:
        temp = Path(td)
        download_exact_release_file("SHA256SUMS.txt", temp / "SHA256SUMS.txt")
        expected_hashes = parse_sha256s(temp / "SHA256SUMS.txt")

        record_results = []
        all_errors_ms = []
        total_tp = total_fp = total_fn = 0

        for record_id in RECORDS:
            filenames = [f"{record_id}.hea", f"{record_id}.dat", f"{record_id}.atr"]
            for name in filenames:
                download_exact_release_file(name, temp / name)

            source_hashes = {}
            for name in filenames:
                observed = sha256_file(temp / name)
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
                if symbol in BEAT_SYMBOLS
            ]
            if not truth:
                raise RuntimeError(f"NO_REFERENCE_BEATS:{record_id}")

            input_path = temp / f"{record_id}.target-input.json"
            output_path = temp / f"{record_id}.target-output.json"
            input_obj = {
                "recordId": record_id,
                "leadName": lead_name,
                "sampleRateHz": fs_hz,
                "samples": samples,
                "signalAssetSha256": source_hashes[f"{record_id}.dat"],
                "config": CONFIG,
            }
            input_path.write_text(json.dumps(input_obj, separators=(",", ":")), encoding="utf8")

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

            tolerance_samples = int(round(TOLERANCE_MS * fs_hz / 1000.0))
            errors_samples, fp, fn = match_events(truth, pred, tolerance_samples)
            tp = len(errors_samples)
            errors_ms = [abs(x) * 1000.0 / fs_hz for x in errors_samples]

            total_tp += tp
            total_fp += fp
            total_fn += fn
            all_errors_ms.extend(errors_ms)

            record_metrics = metrics(tp, fp, fn)
            record_results.append({
                "recordId": record_id,
                "leadName": lead_name,
                "sampleRateHz": fs_hz,
                "referenceBeatCount": len(truth),
                "predictedEventCount": len(pred),
                "matchedEventCount": tp,
                "falsePositiveCount": fp,
                "falseNegativeCount": fn,
                "sensitivity": record_metrics["sensitivity"],
                "positivePredictiveValue": record_metrics["positivePredictiveValue"],
                "f1": record_metrics["f1"],
                "timingMeanAbsoluteErrorMs": (sum(errors_ms) / len(errors_ms)) if errors_ms else None,
                "timingMedianAbsoluteErrorMs": statistics.median(errors_ms) if errors_ms else None,
                "sourceFilesSha256": source_hashes,
                "sourceHashesVerifiedAgainstPhysioNetManifest": True,
            })

        agg = metrics(total_tp, total_fp, total_fn)
        result = {
            "schema": "ekg-mitbih-rpeak-pilot-result-v1",
            "pilotId": "MITBIH-RPEAK-PILOT-V1",
            "codeUnderTest": {
                "commit": "32e74373523512c3fcf3921fcb8e2501b8ea2bbb",
                "tree": "8134669d78b125adbca7d68c3e1f52c7fce63603",
                "targetEntrypoint": "lib/signal_measurement_contract.js::detectCandidateRPeaks",
            },
            "dataset": {
                "name": "MIT-BIH Arrhythmia Database",
                "version": "1.0.0",
                "physionetDirectory": PHYSIONET_RELEASE_DIR,
                "physionetBaseUrl": PHYSIONET_BASE_URL,
                "acquisition": "DIRECT_VERSION_PINNED_HTTPS_WITH_SHA256_MANIFEST_VERIFICATION",
                "records": RECORDS,
                "referenceAnnotation": "atr",
                "license": "Open Data Commons Attribution License v1.0",
            },
            "configuration": CONFIG,
            "matching": {
                "toleranceMs": TOLERANCE_MS,
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
            },
            "records": record_results,
            "reader": {
                "package": "wfdb",
                "version": wfdb.__version__,
                "validationOnly": True,
            },
            "authority": {
                "projectGold": False,
                "sourceLabelsAreProjectGold": False,
                "runtimeAuthority": False,
                "diagnosticRuntime": "GOVERNED_INACTIVE",
                "evidenceAdmission": "NOT_ADMITTED",
                "metrics": "NOT_REPORTABLE",
                "activation": "NOT_ELIGIBLE",
                "clinicalValidityInferred": False,
            },
            "interpretationBoundary": "QUARANTINED_REAL_REFERENCE_PILOT_NOT_FINAL_CLINICAL_VALIDATION",
        }

        out = Path(args.output)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
        print("CLINICAL_PILOT_RESULT " + json.dumps({
            "pilotId": result["pilotId"],
            **result["aggregate"],
            "reportable": False,
            "clinicalValidityInferred": False,
        }, separators=(",", ":")))

if __name__ == "__main__":
    main()
