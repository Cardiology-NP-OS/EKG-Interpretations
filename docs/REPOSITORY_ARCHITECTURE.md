# Repository Architecture

This repository is one Cardiology-NP-OS ECG engineering/research/evaluation system. **Donor identity is provenance; capability identity belongs to EKG.**

## Authority map

- `lib/` ? target-owned non-diagnostic engineering implementation. Public capability names are functional, not donor-branded.
- `evaluation/` ? target-owned reproducible evaluation contracts, datasets, split/leakage validation, robustness, fixtures, and failure modes. It has no clinical authority.
- `research/` ? non-runtime scientific context, model/dataset cards, comparisons, negative findings, and unresolved questions.
- `donors/` ? immutable per-source provenance/audit packages: manifests, inventories, gap matrices, license boundaries, receipts, hashes, and verification. Donor folders are not canonical runtime homes.
- `clinical_control/` ? governed inactive clinical-control quarantine. It remains `SPECIALIST_COMPLETE_INACTIVE`; diagnostic runtime is `GOVERNED_INACTIVE`.
- `tests/` ? target-owned engineering and governance verification, including normalization and authority-boundary tests.
- root `ECG_*_REGISTRY.json` files ? machine-readable governance compatibility interfaces. Existing donor-centric registries remain in place; `ECG_CAPABILITY_REGISTRY.json` is the target-centric capability view.
- `manifests/` ? source and engineering manifests.

## Finding a capability

Start with `ECG_CAPABILITY_REGISTRY.json`, locate the functional capability ID, then follow `canonical_target_path`, `test_paths`, `evaluation_paths`, and `research_paths`. Follow `source_provenance` only when exact upstream provenance is needed.

Dataset identity is canonicalized under `evaluation/datasets/ECG_DATASET_CATALOG.json` and explained by cards in `research/datasets/`; the authoritative project disposition remains `ECG_DATASET_REGISTRY.json`.

## Governance invariants

Normalization must not alter: `evidence_admission = NOT_ADMITTED`, `approved_adjudicated_gold_count = 0`, `metrics = NOT_REPORTABLE`, `activation = NOT_ELIGIBLE`, or `clinical_validity = NOT_INFERRED`.
