# DONOR-007 HARVEST PLAN -- vlbthambawita/ECGBench

Pinned upstream: `main` / `31b5050002622a72a8f3558f731929c3e3a6c68e` / tree `9f52c3f551b443ff660f7b112bca84684f4f1239`.
Target rollback point: `4befd43c048ffff36841f45e4ee800c023ef4b0d` / tree `2dc5b6209a61a65ad9a218ac5ef59cb48723831d`.

## Governance fence
DONOR-007 may improve dataset/evaluation provenance only. It must not change `SPECIALIST_COMPLETE_INACTIVE`, `diagnostic_runtime = GOVERNED_INACTIVE`, `evidence_admission = NOT_ADMITTED`, `approved_adjudicated_gold_count = 0`, `metrics = NOT_REPORTABLE`, `activation = NOT_ELIGIBLE`, or `clinical_validity = NOT_INFERRED`.

## Approved harvest
No ECGBench Python runtime, remote dataset downloader, Hugging Face split artifact, physiological waveform, source-label table, or model artifact is approved for target runtime. The approved implementation is governance-only:

1. register all material dataset-catalogue, splitting, validation, loader, and QA dispositions;
2. preserve the current-head MIT software license separately from per-dataset/data-use terms;
3. record all 64 catalogue entries as external data references with per-dataset rights review required;
4. retain patient-grouped splitting, deterministic folds, label/source separation, and validation-report patterns as offline evaluation methodology only;
5. reject remote dataset acquisition for governed execution without exact hash/license admission;
6. add target-owned closure tests proving no dependency, source-data, external split, project-gold, metric-reporting, model, or authority escalation.

## Dataset policy
ECGBench catalogue metadata is not project clinical gold. Donor-reported dataset licenses/access terms are provenance hints, not independent legal verification. No underlying dataset bytes are imported. Published Hugging Face fold CSVs are external artifacts and remain unadmitted.

## Model policy
No tracked checkpoint or trained model artifact exists at the audited head. Optional PyTorch support is for dataset loading/collation; no executable model challenger is registered.

## Cross-donor deduplication
WFDB remains DONOR-001. PyTorch/model framework provenance remains DONOR-004. PTB-XL/PTB-XL+ benchmark/data boundaries already appear in DONOR-006 and the global dataset registry; DONOR-007 does not create duplicate authority.

## Closure tests
Focused tests must prove the exact upstream pin, 385-file inventory, 64 catalogue records, 52 YAML files including one template, all 36 terminal capability dispositions, MIT software-license boundary, zero waveform/model/hub artifact import, zero project-gold promotion, no Donor-007 model registry entry, no target runtime dependency, and unchanged governed clinical state.

## Comparative proof
Acceptance may claim only broader dataset/evaluation provenance coverage and governance hardening. No dataset label, split, benchmark score, paper count, or validation result becomes target clinical evidence.

## Rollback
Revert Donor-007 governance commits to return to `4befd43c048ffff36841f45e4ee800c023ef4b0d`; never force-reset shared `main`.
