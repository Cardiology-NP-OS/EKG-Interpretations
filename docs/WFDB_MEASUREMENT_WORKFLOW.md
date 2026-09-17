# WFDB Measurement Workflow

This workflow is a target-owned engineering/evaluation path from local WFDB bytes to structured candidate fiducials and measurements.

It is **not** diagnostic runtime authority. It does not create project clinical gold, admit evidence, establish clinical validity, or activate diagnostic interpretation.

## Command

```text
npm run measure:wfdb -- --header <record.hea> --data <record.dat> --lead <lead> --config <config.json> --source-id <non-identifying-id> --out <measurement.json>
```

Required arguments are `--header`, `--data`, `--lead`, `--config`, and `--source-id`. `--out` is optional; without it, JSON is written to stdout.

The emitted artifact contains SHA-256 hashes of the input header and data bytes but does not embed the local input paths.

Do not commit PHI, raw patient payloads, or generated patient artifacts to this repository.
## Configuration

```json
{
  "detector": {
    "minAbsoluteDeviation": 0.9,
    "refractoryMs": 200
  },
  "delineation": {
    "baseline": 0,
    "qrs": {"threshold": 0.5, "beforeMs": 80, "afterMs": 80},
    "p": {"threshold": 0.15, "searchStartMsBeforeR": 240, "searchEndMsBeforeR": 80},
    "t": {"threshold": 0.2, "searchStartMsAfterR": 100, "searchEndMsAfterR": 400}
  }
}
```

Thresholds and windows are explicit engineering configuration, not clinically validated defaults. They must be provenance-bound and separately evaluated before any broader use.
