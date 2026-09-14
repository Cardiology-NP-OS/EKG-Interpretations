# EKG INTERPRETATIONS — V12 Recovery → V13 Execution

This repository was reconstructed on Machine B after the original local V12 Git tree became unavailable.

It is **not byte-identical to the lost V12 repository**. The known V12 release semantics are preserved in `V12_RECOVERED_BASELINE.json`, and all new work is built forward from those semantics.

## Current evidence boundary
- Evidence tier: `engineering_harness_only`
- Adjudicated clinical gold ECGs: 0
- Raw PTB-XL clinical bytes live outside Git under `EKG_INTERPRETATIONS_DATA`.
- Native PTB-XL labels are source metadata, not project gold labels.
- Passing this repository's gate does not establish clinical diagnostic accuracy.

## Commands
- `npm test` / `npm run test:ci` — self-contained synthetic contract tests; no clinical data.
- `npm run gate:ci` — GitHub CI gate; proves engineering contracts only.
- `npm run test:source` — tests against the external verified PTB-XL smoke source.
- `npm run verify:source` — verify PTB-XL source bytes and paired 100/500 Hz consistency.
- `npm run render:blind` — render blinded review derivative outside Git.
- `npm run gate:source` / `npm run gate` — full external-source engineering gate.

The CI gate never substitutes synthetic evidence for source evidence. Signal inspection remains non-diagnostic engineering output; see `docs/SIGNAL_INSPECTION_BOUNDARIES.md`. Also see `docs/CI_EVIDENCE_BOUNDARIES.md`, `RECOVERY_PROVENANCE.md`, `docs/V12_EVIDENCE_SEMANTICS.md`, and `docs/V13_REAL_SIGNAL_EXECUTION.md`.
