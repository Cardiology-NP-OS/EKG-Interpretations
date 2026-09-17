# DONOR-004 HARVEST PLAN — DeepPSP/torch_ecg

Pinned upstream: `master` / `11967474e46023dc7a82acf264e426c1ce4eacfa` / tree `307435b2cb11819f2dc8946866ecc54aab6bff1a`
Target rollback point: `295cb2434b06ea4d125b806a93288cd231f463ea` / tree `01fa509025f126ce8371241e18eb2ce115767acf`

## Governance fence

This donor may improve research/evaluation governance only. It must not change:

- `SPECIALIST_COMPLETE_INACTIVE`
- `diagnostic_runtime = GOVERNED_INACTIVE`
- `evidence_admission = NOT_ADMITTED`
- `approved_adjudicated_gold_count = 0`
- `metrics = NOT_REPORTABLE`
- `activation = NOT_ELIGIBLE`
- `clinical_validity = NOT_INFERRED`

No donor model weights, physiological data, source labels, training pipelines, Python/PyTorch runtime dependency, diagnostic conclusions, or clinical authority may enter canonical target runtime. Software MIT licensing does not license checkpoints or datasets by implication.

## Approved implementation

No runtime algorithm, model execution path, data import, Python dependency, or checkpoint loader is approved.

The approved harvest is **governance-only**:

1. register all 34 material capability dispositions from `GAP_MATRIX.json`;
2. record software, model/checkpoint, and dataset licensing as separate boundaries;
3. record donor architecture families as non-executable challenger/research references only;
4. preserve cross-donor provenance and defer canonical source review to original upstream donors where applicable;
5. add target-owned closure tests proving no dependency, data, gold, metric, evidence-admission, activation, or authority escalation.

## Retained as challengers or evaluation references

- `ECG_CRNN`, `ECG_FCN`, sequence-label, U-Net/subtract-U-Net, and `RR_LSTM` architecture families: `CHALLENGER`, but not executable without an exact checkpoint identity, weight license, preprocessing contract, lead/sample-rate/duration contract, training-population/label metadata, validation evidence, calibration assumptions, compute burden, unsupported-population analysis, and reproducibility evidence.
- Classification, R-peak, and wave-delineation metrics: `EVALUATION_ONLY`; zero adjudicated project gold means target diagnostic metrics remain `NOT_REPORTABLE`.
- Baseline-wander, MixUp/CutMix, masking, renormalization, and stretch/compress augmentation ideas: `EVALUATION_ONLY` for synthetic/offline robustness work only.
- Safetensors-first loading and checkpoint metadata conventions: `EVALUATION_ONLY` as future challenger-security requirements, not as an approved target loader.
- Local database adapters, generic training infrastructure, architecture registries, and benchmark pipelines: `RESEARCH_ONLY` unless a future governed need justifies a separately scoped adapter or challenger.

## Superseded / provenance-deferred

- WFDB XQRS/GQRS and WFDB-derived utilities are `SUPERSEDED` by canonical DONOR-001 review.
- Preprocessing/detector/augmentation concepts already covered by DONOR-003 NeuroKit or DONOR-002 OpenECG are not reimplemented.
- `torch_ecg/utils/_ecg_plot.py` identifies `alphanumericslab/ecg-image-kit` lineage; canonical image-rendering review is deferred to scheduled DONOR-005.
- BioSPPy-derived detector logic and architecture-source repositories remain provenance references; audit the original upstream before any future source reuse.

## Rejected / blocked

- Whole-package `torch_ecg` runtime dependency: `REJECTED`.
- Mutable remote HTTP/S3/Google Drive database acquisition for canonical governed evidence: `REJECTED`.
- Remote model download followed by checkpoint loading without target-owned exact hash/license/provenance admission: `REJECTED`.
- Pickle-capable `torch.load(..., weights_only=False)` for untrusted governed artifacts: `REJECTED`.
- Bundled `sample-data/` and benchmark physiological assets: `LICENSE_REVIEW_REQUIRED`; no donor bytes are copied.
- Historical donor benchmark results and logs remain research evidence only and cannot become project clinical gold or reportable target metrics.

## Closure implementation and tests

The only target mutation approved before acceptance is donor governance/evidence integration: donor manifest/inventory/gap/plan/model-boundary artifacts, global registry and attribution updates, receipt/comparative proof, and a focused closure test. No file under `lib/` is approved for Donor-004 modification.

Focused closure tests must prove:

1. upstream commit/tree/license identity matches the manifest;
2. all 34 material capabilities have allowed final dispositions and no ambiguous row remains;
3. no Donor-004 capability is marked `INTEGRATED`, `DEPENDENCY`, or `ADAPTER`;
4. no torch/Python runtime dependency was added to `package.json`;
5. no donor physiological data or checkpoint bytes were imported;
6. zero executable Donor-004 model challenger is registered without an exact checkpoint/license/preprocessing/population contract;
7. dataset/sample assets remain license-review-required and separate from project gold;
8. governed clinical state remains unchanged;
9. `git diff --check`, focused tests, and the complete target regression pass.

## Comparative-proof requirement

Acceptance must demonstrate an engineering/governance gain only: the target records a complete, machine-readable disposition of torch_ecg's broad model/data/checkpoint/training surface while adding no runtime dependency or clinical authority.

No published torch_ecg or challenge accuracy score will be used as target performance evidence. No cross-dataset headline metric will be treated as equivalent target performance.

## Rollback

Rollback to target commit `295cb2434b06ea4d125b806a93288cd231f463ea` / tree `01fa509025f126ce8371241e18eb2ce115767acf` removes Donor-004 governance artifacts and registry entries. There is no Donor-004 runtime code or dependency to unwind.