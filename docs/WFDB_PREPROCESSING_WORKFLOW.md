# WFDB Preprocessing Workflow

This target-owned engineering workflow turns local narrow-WFDB format-16 signal bytes into deterministic, provenance-bound preprocessing artifacts.

It is not diagnostic runtime authority and does not create project clinical gold, reportable clinical metrics, or clinical validity.

## Command

```text
npm run preprocess:wfdb -- --header <record.hea> --data <record.dat> --config <config.json> --source-id <non-identifying-id> --out <artifact.json>
```

Required arguments are `--header`, `--data`, `--config`, and `--source-id`. `--out` is optional.

The executable pipeline performs calibrated physical-sample decoding, canonical lead reordering, deterministic linear resampling when explicitly requested, fixed-size segmentation, explicit remainder handling, and categorized preprocessing failures.

Supported resampling method identifiers are `linear-v1` and `linear-interpolation-v1`. Supported remainder policies are `drop` and `zero-pad`.

The emitted artifact contains source-byte hashes and does not embed local source paths. Do not commit PHI, raw patient payloads, or generated patient artifacts to the repository.
