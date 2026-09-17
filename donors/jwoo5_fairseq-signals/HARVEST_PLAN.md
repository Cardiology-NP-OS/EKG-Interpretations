# Donor 009 Harvest Plan

Repository: Jwoo5/fairseq-signals  
Audited commit: f8f0ff1c788a82c2059cb452cd5462898867489e  
Audited tree: 59535a7b9bf1d321831caa81558dfaa884664d7a

## Decision

GOVERNANCE_AND_CHALLENGER_METADATA_ONLY_NO_MODEL_EXECUTION.

The target will not import the fairseq-signals runtime, donor model source, checkpoint bytes, raw ECG datasets, processed waveform/report derivatives, or the tracked translated PTB-XL table. The donor contributes architecture/provenance and evaluation methodology only.

## Approved harvest

- Register model architecture families as non-executed challengers, bound to the exact donor commit/tree.
- Preserve model-weight status as fail-closed: no checkpoint is executable without exact identity, hash, preprocessing, training-population/label context, weight license, calibration/threshold assumptions, and reproducibility limits.
- Map random/grouped/temporal/grouped-temporal split methodology to existing evaluation-only patient-split/leakage capabilities.
- Map powerline, EMG, baseline-shift/wander, and lead-masking perturbation concepts to existing evaluation-only robustness capabilities.
- Add one brand-neutral multimodal-model challenger capability in target research metadata if not already represented.
- Record the 6.35 MB translated PTB-XL report table as LICENSE_REVIEW_REQUIRED and do not copy it.
- Preserve root MIT and fairseq-derived attribution.

## Non-harvest

- No Python/PyTorch/Hydra/CUDA runtime dependency.
- No donor model code or native extension copied into runtime.
- No model weights/checkpoints imported or executed.
- No external ECG waveform, report, QA, label, split, challenge-weight, or processed derivative bytes imported.
- No donor paper result becomes a target metric.
- No source label becomes PROJECT GOLD.
- No diagnostic runtime activation or clinical-authority transfer.

## Required verification

Focused donor closure must prove exact upstream identity, license/data/model separation, all 31 terminal dispositions, challenger non-execution, no dependency/data/weight import, and unchanged governed state. Full regression, exact-SHA CI, independent fresh-clone verification, parent-guarded promotion, target-main CI, receipt hashing, and final acceptance are required before incrementing the donor count.
