# DONOR-003 HARVEST PLAN — neuropsychology/NeuroKit

Pinned upstream: `v0.2.13` / `ff419d983568ef492eb8d229af643c0ef0100b32` / tree `2a735eae4761375a0a322aac0dc05c468a88041c`
Target rollback point: `62841e1ab7380d2ce634d720d94fedd50f0486b4` / tree `530d4691745df2aaaae0d39648dd9f00783ca70a`

## Governance fence

This donor may improve engineering/evaluation capability only. It must not change:

- `SPECIALIST_COMPLETE_INACTIVE`
- `diagnostic_runtime = GOVERNED_INACTIVE`
- `evidence_admission = NOT_ADMITTED`
- `approved_adjudicated_gold_count = 0`
- `metrics = NOT_REPORTABLE`
- `activation = NOT_ELIGIBLE`
- `clinical_validity = NOT_INFERRED`

No NeuroKit physiological waveform, annotation, trained weight, or source label is imported.

## Approved implementation

### 1. Tolerance-aware event agreement for independent challengers

- **Donor component/idea:** `neurokit2/ecg/ecg_findpeaks.py` ProMAC multi-detector method agreement and the broad independent R-peak detector family.
- **Why useful:** the target already has provenance-bound challenger envelopes and exact two-source disagreement, but exact JSON equality is too strict for independent beat/wave event localizers that legitimately differ by a few samples.
- **Target subsystem:** `lib/challenger_contract.js`.
- **Integration method:** **CLEAN REIMPLEMENTATION** of the engineering idea, not donor code. Add generic deterministic pairwise event-timing comparison plus a multi-source agreement matrix. Do not implement or copy any NeuroKit detector.
- **Expected improvement:** permits reproducible tolerance-aware disagreement analysis across multiple independent algorithms while retaining source identity, input hash, preprocessing hash, valid-window constraints and zero clinical decision authority.
- **License status:** NeuroKit source MIT; implementation will be target-owned and independently written. Attribution/provenance remains recorded in donor artifacts and global attribution ledger.
- **Security risk:** malformed envelopes, duplicate challenger identities, huge tolerance values, source substitution or nonfinite/invalid values. Fail closed using existing envelope validation and explicit bounds.
- **Clinical risk:** algorithm agreement could be mistaken for correctness. Output must explicitly state `decisionAuthority: NONE`, `clinicalResolutionPerformed: false`, `evidenceAdmissionPerformed: false`, `runtimeActivationPerformed: false`, and engineering-only semantics. No majority winner or clinical consensus label may be emitted.
- **Dependency cost:** none; pure existing Node.js runtime.
- **Compute cost:** bounded pairwise comparison over existing envelope outputs; enforce source/output limits already present in challenger envelopes and a small source-count limit for matrix generation.
- **Tests required:** exact match, within tolerance, outside tolerance, label mismatch, one-to-one matching, output-order invariance, source-order invariance, abstention, invalid envelope, input/source substitution, domain mismatch, window/rate mismatch, invalid tolerance, duplicate challenger identity, deterministic digest, governance invariants, no raw payload/PHI fields.
- **Rollback:** revert the Donor-003 implementation commit(s); pre-donor target remains `62841e1...`.

### 2. NeuroKit-derived adversarial regression testing pattern

- **Donor components:** `tests/tests_ecg.py`, `tests/tests_ecg_findpeaks.py`, `tests/tests_ecg_delineate.py`.
- **Why useful:** donor explicitly tests all detector implementations on all-zero input and distinguishes change-aversion golden outputs from clinical correctness.
- **Target subsystem:** challenger-contract donor-specific tests.
- **Integration method:** **CLEAN REIMPLEMENTATION / EVALUATION_ONLY** using target-owned synthetic envelopes only.
- **Expected improvement:** catches accidental agreement-contract drift and malformed/degenerate event streams without importing donor waveform fixtures.
- **License status:** testing ideas are documented under MIT donor provenance; no donor fixture bytes copied.
- **Security/clinical risk:** low if fixtures remain synthetic and engineering-only.
- **Dependency/compute cost:** none/minimal.
- **Tests required:** deterministic repeatability and malformed/degenerate cases above.
- **Rollback:** remove donor-specific tests and package-script entry.

## Retained as challengers/evaluation references only

### R-peak detector ensemble

- **Disposition:** `CHALLENGER`.
- **Reason:** large independent algorithm family is valuable for future controlled comparison, but installing the full package or selecting a detector would add preprocessing/dependency assumptions and no clinical validity.
- **Current implementation:** none. The agreement contract is deliberately detector-agnostic so future pinned adapters can participate without becoming runtime authority.

### P/QRS/T delineation methods

- **Disposition:** `CHALLENGER`.
- **Reason:** peak/CWT/DWT/prominence methods are useful independent measurement challengers. Upstream issue #1138 documents T-wave inversion misdetection for CWT; no method is promoted.

### ECG quality indices

- **Disposition:** `EVALUATION_ONLY`.
- **Reason:** morphology/template/spectral and detector-agreement SQIs can later challenge target quality. They do not replace the stronger raw-byte rail/constant-run/source-integrity checks. Relative SQIs are not absolute usability truth.

### RR artifact correction

- **Disposition:** `EVALUATION_ONLY`.
- **Reason:** ectopic/missed/extra/long-short taxonomy is useful, but automatic correction changes derived evidence. Future adapters must preserve original peaks plus correction provenance.

### Deterministic signal distortion generation

- **Disposition:** `EVALUATION_ONLY`.
- **Reason:** noise/powerline/artifact/drift concepts strengthen future robustness fixtures, but current donor scope does not justify another synthetic-signal runtime implementation after prior donor augmentation work. Add cases only when a target subsystem needs them.

### HRV feature suite

- **Disposition:** `RESEARCH_ONLY`.
- **Reason:** broad beat-to-beat metrics are useful but depend on trustworthy interval extraction and have no current governed clinical role.

### AcqKnowledge / BITalino / XDF readers

- **Disposition:** `RESEARCH_ONLY`.
- **Reason:** genuine format expansion but not a current governed ECG source requirement; direct dependency would substantially expand attack/dependency surface.

## Rejected / blocked

### Automatic missing-waveform interpolation

- **Disposition:** `REJECTED` for canonical target preprocessing.
- **Reason:** can manufacture waveform samples and weaken fail-closed source semantics. A future derived-signal research adapter would require explicit transformation provenance.

### Donor ECG/test waveform files and annotations

- **Disposition:** `LICENSE_REVIEW_REQUIRED` / `DATA_ONLY` only after separate review.
- **Reason:** repository MIT software license is not sufficient evidence of dataset-specific patient-data redistribution/use rights. No bytes are copied.

### Whole-package direct dependency

- **Disposition:** `REJECTED` for current runtime.
- **Reason:** broad NumPy/Pandas/SciPy/scikit-learn/matplotlib/PyWavelets stack is unnecessary for the approved harvest and would weaken the target's narrow dependency surface. Upstream full CI also depends on downloaded MNE data.

## Comparative-proof requirement

Retain the implementation only if donor-specific tests demonstrate capabilities unavailable before Donor-003:

1. timing-tolerant event agreement succeeds where exact-envelope comparison reports disagreement;
2. out-of-tolerance and label-mismatched events remain disagreements;
3. results are deterministic and invariant to source/output ordering;
4. source/input/window mismatches fail closed;
5. no clinical governance field changes and no diagnostic metric becomes reportable;
6. existing full target suite remains green.

No published NeuroKit accuracy claim will be used as target performance evidence.
