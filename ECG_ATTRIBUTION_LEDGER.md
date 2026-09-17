# ECG Attribution Ledger

## DONOR-001 — MIT-LCP/wfdb-python

- Repository: `MIT-LCP/wfdb-python`
- Audited commit: `f627b5ff9dcfdb11d4c3150f9c1ebb47cfc3909d`
- Audited tree: `a861ed52e8c655770beef2540e0802e63e806f18`
- Software license: MIT
- Upstream license blob: `8d3513fef628f57c03c597676c351cca1aabb811`
- Copyright notice: Copyright (c) 2016 MIT Laboratory for Computational Physiology
- Integration: clean reimplementation of validation/cohesion concepts plus target-owned synthetic test methodology.
- Donor source code copied into target runtime: **no**.
- Donor physiological/sample fixture bytes copied: **no**.
- Data/fixture reuse status: **LICENSE_REVIEW_REQUIRED**.
- Provenance files: `donors/mit-lcp_wfdb-python/DONOR_MANIFEST.json`, `INVENTORY.json`,
  `GAP_MATRIX.json`, `HARVEST_PLAN.md`, `COMPARATIVE_PROOF.json`, and
  `DONOR_RECEIPT.json`.

The donor remains credited for the engineering ideas and test strategies that informed
the target hardening even though no upstream source file was copied.

## Associated repository requiring separate review

`bemoody/wfdb` is recorded as an associated WFDB implementation with mixed GPL/LGPL
licensing. No code is imported from it unless a later independent audit establishes an
allowed integration mechanism.
