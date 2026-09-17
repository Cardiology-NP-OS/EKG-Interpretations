# Donor 010 Harvest Plan — bowang-lab/ecg-fm

## Decision
Harvest exact provenance, model-checkpoint identity, reproducibility configuration, split/leakage evidence, and dataset corrections into brand-neutral target registries. Do not import donor runtime code, checkpoints, or dataset bytes.

## Integrate
- Pin source commit/tree and Hugging Face revision plus exact LFS SHA-256 for both checkpoints.
- Register pretrained and finetuned models as inactive CHALLENGERS.
- Map quickstart preprocessing to existing target-owned lead-order/resampling/windowing capabilities; donor implementation is SUPERSEDED.
- Preserve MIMIC-IV-ECG and Challenge 2021 split metadata as EVALUATION_ONLY evidence.
- Correct canonical MIMIC-IV-ECG metadata from independently verified PhysioNet source.
- Preserve labeler, probing and saliency workflows as research/evaluation methodology only.

## Reject from target runtime
- No fairseq-signals/PyTorch runtime dependency.
- No checkpoint loading or model execution.
- No tracked CODE-15, MIMIC-derived, or split bytes copied into target.
- No source label becomes project gold.
- No published/donor metric becomes target-reportable performance.

## Verification
Run Donor 010 closure tests, repository normalization tests, full npm test, git diff --check, exact candidate CI, independent/fresh-clone verification, ancestry-guarded promotion, and target-main CI.
