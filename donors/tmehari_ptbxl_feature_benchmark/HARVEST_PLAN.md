# DONOR-006 HARVEST PLAN -- tmehari/ptbxl_feature_benchmark

Pinned upstream: `main` / `4c37b775e56d23e2c844fcd0aec52d2cd05cb35e` / tree `b9be6b9546e2b437493b286532ffbbba00e01a8c`.
Target rollback point: `8d2d03539b539f13cc8a8f4c1a14ff4b1a4110a9` / tree `245a8bec4d46c9c33702d2def58df0180d59a4f9`.

## Governance fence
Donor-006 may improve benchmark/evaluation provenance only. It must not change `SPECIALIST_COMPLETE_INACTIVE`, `diagnostic_runtime = GOVERNED_INACTIVE`, `evidence_admission = NOT_ADMITTED`, `approved_adjudicated_gold_count = 0`, `metrics = NOT_REPORTABLE`, `activation = NOT_ELIGIBLE`, or `clinical_validity = NOT_INFERRED`.

The audited head contains no license file: commit `4c37b775...` removes `LICENSE.txt`. The historical `v1.0.0` MIT license is recorded as history only and is not inherited to the audited head. Therefore donor source reuse is fail-closed as `LICENSE_REVIEW_REQUIRED`.

## Approved implementation
No donor runtime code, Python/Conda dependency, model architecture, pickle/PyTorch checkpoint loader, external feature table, waveform, label file, statement file, or notebook output is approved for target runtime. The approved harvest is governance-only:

1. register all material benchmark, data, model, metric and QA dispositions;
2. bind the current-head license ambiguity and historical-release license separately;
3. keep PTB-XL/PTB-XL+ feature/statement assets external and non-gold;
4. keep XResNet/classical-model execution ineligible because no approved checkpoint exists and source-code reuse is license-blocked;
5. record the validation/test naming defect, non-deterministic RandomForest configuration, pickle deserialization, and unrestricted `torch.load` checkpoint path as rejected behaviors;
6. add target-owned closure tests proving no dependency, source, model, dataset, gold, metric-reporting or authority escalation.

## Retained evaluation/research value
Feature-family comparison, same-record cohort intersection, semantic feature harmonization, standard PTB-XL folds, classical baselines, ROC/PR/bootstrap methodology and label-mapping workflows may inform controlled offline evaluation. They remain `EVALUATION_ONLY` or `RESEARCH_ONLY`; donor benchmark scores are not target evidence.

The XResNet1D family is retained only as a non-executable `CHALLENGER` architecture reference. No checkpoint is tracked or admitted.

## Cross-donor deduplication
- PTB-XL remains the existing target/DONOR-002 dataset registration; no duplicate waveform dataset authority is created.
- WFDB provenance remains DONOR-001.
- Generic preprocessing, ResNet-family architecture, training/checkpoint and classification-metric concepts already dispositioned under DONOR-004 are not duplicated.

## Closure tests
Focused closure tests must prove exact upstream identity; complete 20-file inventory; all 36 terminal dispositions; audited-head license fail-closed behavior; zero donor runtime dependency/source/weight/data import; no executable Donor-006 model registry entry; notebook-output quarantine; zero project-gold promotion; metrics `NOT_REPORTABLE`; and unchanged governed clinical state. `git diff --check`, focused closure tests and the full target regression must pass.

## Comparative proof
Acceptance may claim only improved engineering benchmark/provenance coverage. No feature benchmark, raw-model result, ROC-AUC value, published result, or source label becomes target clinical evidence.

## Rollback
Rollback to `8d2d03539b539f13cc8a8f4c1a14ff4b1a4110a9` / tree `245a8bec4d46c9c33702d2def58df0180d59a4f9` removes Donor-006 governance artifacts and registry entries; there is no Donor-006 runtime code or dependency to unwind.