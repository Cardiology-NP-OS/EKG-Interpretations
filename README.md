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
- `npm test` — deterministic recovery/clinical smoke tests.
- `npm run verify:clinical` — verify PTB-XL source bytes and paired 100/500 Hz consistency.
- `npm run render:blind` — render blinded review derivative outside Git.
- `npm run gate` — run the complete recovered-baseline release gate.

See `RECOVERY_PROVENANCE.md`, `docs/V12_EVIDENCE_SEMANTICS.md`, and `docs/V13_REAL_SIGNAL_EXECUTION.md`.
