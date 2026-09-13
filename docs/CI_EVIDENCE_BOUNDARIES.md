# CI Evidence Boundaries

This repository has two distinct gates.

## Self-contained CI gate
`npm run gate:ci`

The CI gate uses deterministic synthetic WFDB-compatible fixtures. It proves:
- verifier and renderer contracts execute without external data;
- expected 100 Hz and 500 Hz shapes are enforced;
- canonical 12-lead ordering is enforced;
- deterministic blind rendering is preserved;
- source tampering fails closed;
- evidence and clinical-claim boundaries are preserved.

It does **not** use clinical ECG data and does not establish source-data or clinical validity.

## Real-source gate
`npm run gate:source`

The real-source gate requires the external PTB-XL smoke source directory. It verifies the exact files against the pinned SHA-256 manifest before exercising the same shape and rendering path.

Passing this gate establishes only the documented engineering source-integrity evidence. It does not establish diagnostic accuracy.

## CI policy
GitHub Actions runs only the self-contained CI gate. A missing PTB-XL source directory must never cause CI to silently substitute synthetic evidence for real-source evidence. The contract suite explicitly verifies that the real-source gate fails when its external source is absent.
