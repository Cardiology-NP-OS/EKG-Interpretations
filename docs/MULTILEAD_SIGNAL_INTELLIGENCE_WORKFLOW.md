# Multilead Signal Intelligence Workflow

This workflow executes the repository's accepted waveform measurement, candidate fiducial, rhythm-feature, and candidate-evidence pipeline across multiple WFDB leads.

It is an engineering/evaluation workflow. It does not create a clinical diagnosis, project gold, reportable diagnostic metrics, or runtime authority.

## Operator surface

```text
node tools/analyze_wfdb_12lead.js \
  --header <record.hea> \
  --data <record.dat> \
  --config <config.json> \
  --source-id <non-PHI-id> \
  [--leads II,V1,V5] \
  [--out analysis.json]
```

The default lead set is every lead declared in the WFDB header. An explicit comma-separated subset may be supplied.

The configuration must contain `measurement`, `phenotypes`, and an explicit `thresholdAuthority`. Thresholds remain configuration provenance; they do not become clinical truth by execution.

## Output structure

The artifact contains per-lead workflow outputs, categorized failures, cross-lead consistency summaries, structured candidate evidence, source/config hashes, and governance state.

Candidate aggregation preserves three kinds of lead evidence separately:

- supporting leads: the configured candidate threshold was met;
- counter-evidence leads: it was not met;
- insufficient leads: the input did not support that comparison.

A candidate-evidence state is not a disease label. Consumers must inspect the contributing measurements, configured threshold, supporting leads, counter-evidence, and provenance.

Cross-lead summaries currently report engineering consistency for beat count, ventricular rate, PR, QRS, QT, and Fridericia QTc when those measurements are available. They do not assert clinically acceptable agreement limits.

## Failure behavior

A failed lead is categorized and retained in `failureAccounting`; usable leads continue. If every requested lead fails, the record fails closed. Duplicate or unknown requested leads are rejected before execution.

Local filesystem paths are not embedded in the output artifact. Source bytes and configuration bytes are bound by SHA-256 in the CLI artifact.

## Current evidence boundary

Verification is synthetic and engineering-only. `approvedAdjudicatedGoldCount` remains zero, `metrics` remain `NOT_REPORTABLE`, and clinical validity is not inferred.
