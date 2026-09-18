# Model agreement is not diagnostic accuracy
The executable lib/probability_comparison.js utility aligns two model prediction tables using exact label IDs, record IDs, dataset-manifest identity, and per-record source hashes. It computes absolute probability differences and frozen-threshold disagreement deterministically.

Neither model is a clinical truth source. No accuracy, sensitivity, specificity, project gold, threshold optimization, or runtime authority is produced. Provenance hashes are supplied by the caller and bound into a fingerprint; independent model/data/policy byte verification remains an upstream requirement.

This is functional evaluation software, not a completed ECG interpreter. Real interpretation needs executable admitted algorithms/models, calibrated inputs, clinically meaningful rule provenance, independent adjudication, reproducible external evaluation, reporting behavior, and validated intended use.
