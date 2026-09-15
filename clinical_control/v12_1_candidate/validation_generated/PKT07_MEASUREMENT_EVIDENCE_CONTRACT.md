# PKT-EP1-07 Measurement Evidence Contract

Generated validation material only. It does not modify the original V12.1 source.

- Reuses the existing `measurement_evidence` shape in `07_OUTPUT_SCHEMA.json`.
- Preserves input origin: user-provided, validated digital, calculated, or unavailable.
- Automatic waveform fiducial extraction is explicitly `NOT_IMPLEMENTED`.
- Existing V12.1 calculation-engine bytes remain unchanged.
- Rate/QTc/axis/QRS-category/ST helpers are provenance-bound and non-diagnostic.
- Missing lead identity, calibration, malformed/nonfinite input, or conflicts fail closed.
- Synthetic vectors are engineering fixtures, not adjudicated clinical gold.
- Structured-output mapping emits only `measurements` and `measurement_evidence`.
- No rhythm, morphology, interpretation, diagnosis, or clinical activation is produced.
- Candidate remains inactive and no diagnostic-performance claim is made.
