# Signal Intelligence Workflow

This is the target-owned executable engineering/evaluation path above the accepted WFDB measurement workflow.

It produces reproducible rhythm/interval features and descriptive candidate phenotypes. It does **not** diagnose ECG conditions, create project clinical gold, admit evidence, or activate diagnostic runtime authority.

## Command

```text
npm run analyze:wfdb -- --header <record.hea> --data <record.dat> --lead <lead> --config <config.json> --source-id <non-identifying-id> --out <analysis.json>
```

The `source-id` is deliberately constrained to a non-path identifier. Do not put names, MRNs, dates of birth, raw patient identifiers, or local filesystem paths into it.

## Executed path

1. Read local WFDB header and signal bytes.
2. Calibrate the requested lead from WFDB gain/baseline metadata.
3. Detect explicitly configured R-peak candidates.
4. Delineate target-owned P/QRS/T candidates.
5. Compute interval and calibrated amplitude measurements.
6. Derive RR variability, interval, coverage, and amplitude features.
7. Apply explicit evaluation-only candidate thresholds.
8. Emit a structured JSON artifact with source/configuration SHA-256 bindings.

## Candidate semantics

Current candidate codes describe measured behavior only:

- `RR_IRREGULARITY`
- `RR_PAUSE`
- `QRS_DURATION_ABOVE_CONFIGURED_THRESHOLD`
- `PR_DURATION_ABOVE_CONFIGURED_THRESHOLD`
- `P_WAVE_COVERAGE_LOW`

A detected candidate means only that the configured engineering threshold was met. It is not equivalent to AF, AV block, bundle-branch block, ectopy, or any other diagnosis.

`INSUFFICIENT_DATA` is a first-class result when required measurements are unavailable.

## Data handling

WFDB input bytes remain local. Do not commit patient/raw waveform payloads or generated patient analysis artifacts to this repository. The CLI artifact stores hashes and the caller-supplied non-identifying source ID, not the input paths.

## Reproducibility

The analysis artifact binds the header bytes, signal bytes, and configuration file with SHA-256. The configuration must declare its threshold authority. Synthetic fixture thresholds are explicitly not clinically validated defaults.
