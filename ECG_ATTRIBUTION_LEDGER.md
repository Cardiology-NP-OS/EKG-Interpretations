# ECG Attribution Ledger

## DONOR-001 Ã¢â‚¬â€ MIT-LCP/wfdb-python

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
- Provenance files: `donors/mit-lcp_wfdb-python/DONOR_MANIFEST.json`, `INVENTORY.json`, `GAP_MATRIX.json`, `HARVEST_PLAN.md`, `COMPARATIVE_PROOF.json`, and `DONOR_RECEIPT.json`.

The donor remains credited for the engineering ideas and test strategies that informed the target hardening even though no upstream source file was copied.

## DONOR-002 Ã¢â‚¬â€ vitaldb/openecg

- Repository: `vitaldb/openecg`
- Audited commit: `843698d5b4621b74145bce405c74e115b6daa6c6`
- Audited tree: `886095776a1f79f600a7ad269176ccc0fbd2d37d`
- Stable release reference: `v0.11.0` Ã¢â€ â€™ commit `60ac8887ab0d640fbab6ef094d023b72a9f630c5`
- Software license: Apache-2.0
- Upstream license blob: `4ec4b63eb48dead8c9a54c033d9440bc0b8c1b11`
- Copyright notice: Copyright 2026 Hyung-Chul Lee and OpenECG contributors
- Integration: clean reimplementation of non-clinical challenger/evaluation abstractions: provenance-bound challenger envelopes, explicit valid-context bands, abstention/failure state, and disagreement telemetry.
- Donor source code copied: **no**.
- Donor checkpoints/ONNX/TFLite artifacts copied: **no**.
- Donor physiological data copied: **no**.
- Trained-weight status: **LICENSE_REVIEW_REQUIRED**; repository software licensing is not treated as proof of trained-artifact rights.
- Dataset status: **LICENSE_REVIEW_REQUIRED_PER_DATASET**; source labels remain separate from project gold.
- Provenance files: `donors/vitaldb_openecg/DONOR_MANIFEST.json`, `INVENTORY.json`, `GAP_MATRIX.json`, `MODEL_CARD_DONOR.json`, `HARVEST_PLAN.md`, `DATASET_BENCHMARK_REGISTER.json`, `COMPARATIVE_PROOF.json`, and `DONOR_RECEIPT.json`.

OpenECG is credited for the layered representation, context-margin, disagreement/fallback, evaluation, split-discipline, robustness-testing, and deployment ideas identified during audit. The implementation in `lib/challenger_contract.js` is target-owned and was written without copying OpenECG source.

### Cross-donor provenance preserved

`openecg/qrs.py` identifies NeuroKit2/Makowski lineage, and `openecg/delineate.py` is a NeuroKit2 wrapper. Those algorithms are not reattributed to OpenECG or imported under DONOR-002; their canonical review is deferred to DONOR-003 (`neuropsychology/NeuroKit`).

## Associated repositories requiring separate review

- `bemoody/wfdb` Ã¢â‚¬â€ associated WFDB implementation with mixed GPL/LGPL-family licensing reported during DONOR-001. No code is imported until an independent file-level audit permits it.
- `vitaldb/opendsp` Ã¢â‚¬â€ OpenECG core dependency/extracted DSP implementation. Queued as associated donor; its license and implementation must be audited independently.
- `vuno/ST-MEM` Ã¢â‚¬â€ current repository resolved from OpenECG's historical `bakqui/ST-MEM` clone instruction. Model/software/checkpoint terms require independent audit before use.


## DONOR-003 -- neuropsychology/NeuroKit

- Repository: `neuropsychology/NeuroKit`
- Audited release: `v0.2.13`
- Audited commit: `ff419d983568ef492eb8d229af643c0ef0100b32`
- Audited tree: `2a735eae4761375a0a322aac0dc05c468a88041c`
- Software license: MIT
- Upstream license blob: `d95473208e8eb18fd06c42e4f77ece6a5a720cf5`
- Integration: target-owned clean reimplementation of generic tolerance-aware challenger event agreement plus target-owned synthetic regression tests.
- Donor source code copied: **no**.
- NeuroKit runtime dependency added: **no**.
- Donor model/checkpoint weights copied: **no**.
- Donor physiological/example/test data copied: **no**.
- Physiological asset/data-use status: **LICENSE_REVIEW_REQUIRED_PER_DATASET**.
- Project clinical gold created from donor labels: **no**.
- Provenance files: `donors/neuropsychology_neurokit/DONOR_MANIFEST.json`, `INVENTORY.json`, `GAP_MATRIX.json`, `HARVEST_PLAN.md`, `COMPARATIVE_PROOF.json`, and `INDEPENDENT_VERIFICATION.json`.

NeuroKit is credited for the multi-method agreement and adversarial/golden-regression engineering patterns that informed the target-owned challenger-evaluation hardening. No NeuroKit detector, delineator, data asset, or clinical conclusion was imported as target authority.
