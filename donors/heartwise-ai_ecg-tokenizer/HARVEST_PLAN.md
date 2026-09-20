# DONOR-014 Harvest Plan — HeartWise-AI/ECG_tokenizer

## Decision

Harvest only target-owned behavioral contracts and architecture metadata.

Do **not** import the donor runtime, checkpoints, generated outputs, datasets, or clinical-performance claims.

## Integrated target-owned behavior

1. **Residual-VQ additivity**
   - Residual codebooks must reconstruct with additive semantics.
   - Convex softmax averaging across residual codebooks is rejected.
   - Target implementation: `lib/representation_contract.js`.

2. **Explicit representation-axis semantics**
   - Token positions must declare whether they represent time, channels, leads, or features.
   - Ambiguous shape-based axis inference is rejected.
   - A bridge must consume the same declared semantic axis and position count.

3. **Structural checkpoint/config binding**
   - Bridge structure that changes token-axis interpretation must be bound to checkpoint/config identity.
   - This remains evaluation-only and nonruntime.

## Challenger / research-only material

- Scalable convolutional tokenizer encoder: architecture-only challenger.
- Residual-VQ tokenizer: architecture-only challenger.
- Q-Former ECG-to-LLM bridge: architecture-only challenger.
- Auxiliary-loss/split-codebook training experiments: research-only.
- Per-endpoint text/margin/numeric readout policies: research-only.

## Explicit rejections

- Direct import of PyTorch/CUDA/Transformers/PEFT/W&B donor runtime stack.
- Donor checkpoints without exact admitted weight identity and license.
- Donor dataset paths/labels as project gold.
- Donor-reported metrics as target reportable evidence.
- Any diagnostic runtime activation.

## Source identity

- Repository: HeartWise-AI/ECG_tokenizer
- Branch: main
- Commit: 64f7963a7f55b90895dce31f1e7d55c7eba2d51d
- Git tree SHA: 6c0d631ca1ca9dad892ae8343362d20147fdd44e (verified from the upstream Git commit object).
- Source license: MIT.

## Target basis

- Pre-donor target commit: dd2b7a0bc3c2fd0576db4c7de05b1f2eb887e456
- Pre-donor target tree: 11c01cb7505b9b9dbe8e9d247ff2fb5d5bc24bd4

## Acceptance boundary

DONOR-014 remains `IMPLEMENTED_UNVERIFIED` until exact-head CI, same-principal review verification with no independence claim, and promotion are separately recorded.
