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

## DONOR-004 -- DeepPSP/torch_ecg

- Repository: `DeepPSP/torch_ecg`
- Audited branch: `master`
- Audited commit: `11967474e46023dc7a82acf264e426c1ce4eacfa`
- Audited tree: `307435b2cb11819f2dc8946866ecc54aab6bff1a`
- Latest release reference: `v0.0.31` (audited HEAD is newer than the release tag).
- Software license: MIT
- Upstream license blob: `40d9a25369b4fd1f3315f16f932eebf297dbd549`
- Copyright notice: Copyright (c) 2021 WEN Hao and KANG Jingsu
- Integration: governance-only audit of architecture, checkpoint, data, training, metric, and provenance boundaries; no runtime algorithm is integrated.
- Donor source code copied: **no**.
- `torch_ecg` / PyTorch runtime dependency added: **no**.
- Donor checkpoint/model weights copied or executed: **no**.
- Donor physiological/sample/benchmark data copied: **no**.
- Checkpoint status: **LICENSE_REVIEW_REQUIRED_PER_ARTIFACT** before any future execution.
- Physiological asset/data-use status: **LICENSE_REVIEW_REQUIRED_PER_DATASET**.
- Donor benchmark scores promoted to target metrics: **no**.
- Project clinical gold created from donor labels: **no**.
- Provenance files: `donors/deeppsp_torch_ecg/DONOR_MANIFEST.json`, `INVENTORY.json`, `GAP_MATRIX.json`, `MODEL_BOUNDARY.json`, `ASSOCIATED_REPOSITORY_DISPOSITIONS.json`, `HARVEST_PLAN.md`, `COMPARATIVE_PROOF.json`, `INDEPENDENT_VERIFICATION.json`, and `DONOR_RECEIPT.json`.

torch_ecg is credited for its ECG architecture catalog, database/dataset abstractions, augmentation and benchmark patterns, and safer checkpoint-loading concepts. No donor checkpoint, data asset, diagnostic output, or benchmark result is admitted as target clinical evidence or runtime authority.

## DONOR-005 -- alphanumericslab/ecg-image-kit

- Repository: `alphanumericslab/ecg-image-kit`
- Audited branch/tag: `main` / `v1.0.0`
- Audited commit: `27b90f56896c9fc78b05a83ca14844ea2637aa0b`
- Audited tree: `529bfe2cadae767c4851cc2be0fb194a25511674`
- Root software license: BSD-3-Clause; upstream license blob `2611ac54c9dd7abc9d11f1007b31f18295fb21e6`.
- Vendored ROI/YOLOv7 subtrees contain GPLv3 license text and remain `LICENSE_REVIEW_REQUIRED` for reuse.
- Integration: governance-only audit of ECG image synthesis, image-to-waveform digitization, ROI-model, checkpoint, font, texture, sample-data, and provenance boundaries.
- Donor source code copied: **no**.
- Python/MATLAB/TensorFlow/YOLO runtime dependency added: **no**.
- Donor checkpoint/model weights copied or executed: **no**.
- Donor ECG/image/ROI sample bytes, fonts, textures, or pickle state copied: **no**.
- Source labels promoted to project clinical gold: **no**.
- Donor digitization or benchmark results promoted to target metrics: **no**.
- External lineage preserved: `WongKinYiu/yolov7`, `Grzego/handwriting-generation`, and optional `allenai/scispacy`.
- Provenance files: `donors/alphanumericslab_ecg-image-kit/DONOR_MANIFEST.json`, `INVENTORY.json`, `GAP_MATRIX.json`, `HARVEST_PLAN.md`, `MODEL_BOUNDARY.json`, `ASSOCIATED_REPOSITORY_DISPOSITIONS.json`, `COMPARATIVE_PROOF.json`, `INDEPENDENT_VERIFICATION.json`, and `DONOR_RECEIPT.json`.

ECG-Image-Kit is credited for image-synthesis, image-distortion, grid-estimation, waveform-extraction, and ROI-localization engineering ideas. All such capabilities remain evaluation/challenger/research references or license-blocked assets; none gains clinical authority.

## DONOR-006 -- tmehari/ptbxl_feature_benchmark

- Repository: `tmehari/ptbxl_feature_benchmark`
- Audited branch: `main`
- Audited commit: `4c37b775e56d23e2c844fcd0aec52d2cd05cb35e`
- Audited tree: `b9be6b9546e2b437493b286532ffbbba00e01a8c`
- Audited-head software license: **LICENSE_REVIEW_REQUIRED** because the current head contains no license file.
- Historical release `v1.0.0` contained MIT `LICENSE.txt` blob `520db0363d5543a04a129574e4c06f0a9622c6a5`; that historical grant is recorded but not assumed to license the audited head.
- Integration: governance-only audit of PTB-XL/PTB-XL+ feature-benchmark, dataset, model, metric, checkpoint-loader, and provenance boundaries.
- Donor source code copied: **no**.
- Python/Conda/PyTorch/scikit-learn runtime dependency added: **no**.
- Donor checkpoint/model weights copied or executed: **no**.
- PTB-XL/PTB-XL+ waveform, feature, statement, label, or notebook-output bytes copied: **no**.
- Source labels promoted to project clinical gold: **no**.
- Donor ROC-AUC/bootstrap/published benchmark results promoted to target metrics: **no**.
- XResNet1D retained only as a non-executable challenger architecture reference; no checkpoint is tracked or admitted.
- `data_preprocessing.ipynb` embedded outputs remain quarantined and are not copied into target evidence.
- Provenance files: `donors/tmehari_ptbxl_feature_benchmark/DONOR_MANIFEST.json`, `INVENTORY.json`, `GAP_MATRIX.json`, `HARVEST_PLAN.md`, `LICENSE_BOUNDARY.json`, `DATASET_BOUNDARY.json`, `MODEL_BOUNDARY.json`, and `ASSOCIATED_REPOSITORY_DISPOSITIONS.json`.

The donor is credited for engineered-feature benchmark methodology, fold-based evaluation design, feature harmonization, and bootstrap evaluation concepts. No donor source, external dataset asset, model artifact, benchmark score, or diagnostic conclusion is admitted as target runtime authority or clinical evidence.
