# DONOR-005 HARVEST PLAN — alphanumericslab/ecg-image-kit

Pinned upstream: `v1.0.0` / `27b90f56896c9fc78b05a83ca14844ea2637aa0b` / tree `529bfe2cadae767c4851cc2be0fb194a25511674`
Target rollback point: `60b0193ef9cf0753658f5e31b0f532dc02baf243` / tree `5555e82ed2c43fa92c0f87b3c34506c2a6deebe9`

## Governance fence

Donor-005 may improve research/evaluation governance only. It must not change `SPECIALIST_COMPLETE_INACTIVE`, `diagnostic_runtime = GOVERNED_INACTIVE`, `evidence_admission = NOT_ADMITTED`, `approved_adjudicated_gold_count = 0`, `metrics = NOT_REPORTABLE`, `activation = NOT_ELIGIBLE`, or `clinical_validity = NOT_INFERRED`.

No donor image, physiological sample, font, texture, checkpoint, pickle, vendored GPL source, remote-scraped text, or source label may enter canonical target runtime. Root BSD-3-Clause terms are not treated as licensing the GPL subtree, fonts, model weights, or datasets.

## Approved implementation

No runtime image digitizer, model execution path, Python/MATLAB dependency, data import, network fetcher, or donor algorithm is approved. The approved harvest is governance-only:

1. register all material image-generation/digitization capability dispositions;
2. bind root BSD and vendored GPL source licensing separately;
3. bind exact checkpoint identities/hashes while keeping execution ineligible;
4. keep sample ECGs, PTB-XL-derived files, ROI labels, textures, fonts and handwriting state outside target;
5. preserve YOLOv7 and handwriting-generation provenance without copying their source;
6. add target-owned closure tests proving no dependency, model/data import, image-to-waveform runtime activation, gold promotion, metric reporting, or authority escalation.

## Retained as evaluation/challenger references

- waveform-to-paper rendering, grid/calibration rendering, lead-layout variation, bounding-box metadata, image resolution variation, QR/text overlays, rotation/crop/noise/color changes, and crease/wrinkle scenarios: `EVALUATION_ONLY` using target-owned synthetic fixtures only;
- marginal, matched-filter and spectral grid estimators plus `image_to_sequence.m`: `CHALLENGER`, non-authoritative and not executed in target;
- image-resolution guidance: `EVALUATION_ONLY` for controlled engineering tests;
- optional NLP and low-level helper details: `RESEARCH_ONLY`.

## Rejected / license blocked

- whole-package Python/MATLAB runtime and mutable remote text scraping: `REJECTED`;
- vendored YOLOv7 code and `yolov7_custom.pt`: `LICENSE_REVIEW_REQUIRED`;
- handwriting-generation lineage and TensorFlow checkpoints/pickle state: `LICENSE_REVIEW_REQUIRED`;
- fonts, wrinkle textures, ROI training images/labels, PTB-XL-derived assets and bundled illustrative ECG images: `LICENSE_REVIEW_REQUIRED`;
- donor timings and narrative performance claims remain research-only and are not target diagnostic metrics.

## Cross-donor deduplication

- WFDB Python dependency is superseded by DONOR-001 canonical review.
- DONOR-004 plotting lineage explicitly resolves to this donor; do not retain a duplicate torch_ecg implementation.
- Existing target image-quality controls already gate crop, perspective, calibration, QR/OCR and transformed geometry; Donor-005 adds evaluation scenarios, not authority.

## Closure tests

Focused closure tests must prove exact upstream identity; complete 346-file inventory; all 33 capability dispositions; mixed-license boundaries; zero donor runtime dependency; zero model/checkpoint execution; zero donor image/data/font/texture import; zero project-gold promotion; no image-to-waveform runtime activation; and unchanged governed clinical state. `git diff --check`, focused closure tests and the full target regression must pass.

## Comparative proof

Acceptance may claim only improved engineering provenance/evaluation coverage: the target gains a machine-readable map of image-generation/digitization capabilities and risks without activating a digitizer or diagnostic model. No donor benchmark or digitization accuracy claim becomes target evidence.

## Rollback

Rollback to target commit `60b0193ef9cf0753658f5e31b0f532dc02baf243` / tree `5555e82ed2c43fa92c0f87b3c34506c2a6deebe9` removes Donor-005 governance artifacts and registry entries; there is no Donor-005 runtime code or dependency to unwind.
