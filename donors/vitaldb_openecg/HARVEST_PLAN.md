# Donor 002 Harvest Plan — vitaldb/openecg

## Scope fence

This donor may improve **engineering/evaluation infrastructure only**. It may not alter the accepted governed engine identity or the terminal clinical state. In particular, this donor work must preserve `SPECIALIST_COMPLETE_INACTIVE`, `GOVERNED_INACTIVE`, `NOT_ADMITTED`, zero approved adjudicated gold, `NOT_REPORTABLE`, `NOT_ELIGIBLE`, and `NOT_INFERRED`.

No OpenECG model weight, clinical classifier, AF rule set, pacing threshold, rhythm label, or structured diagnostic report becomes runtime authority in this donor packet.

## Approved high-value harvests

### 1. Governed challenger-output contract — CLEAN REIMPLEMENTATION

**Donor idea:** `openecg/layered.py` keeps wave/frame, beat, and rhythm outputs as separate layers rather than collapsing heterogeneous evidence into one label stream.

**Target subsystem:** non-clinical evaluation/challenger infrastructure.

**Implementation:** add a small target-owned schema/validator that records independent challenger outputs by abstraction level and source, including model/algorithm identity, preprocessing identity, input hash, confidence/abstention state, and whether an output lies inside a valid context band. The contract must explicitly mark all challenger predictions as `NON_RUNTIME_AUTHORITY`.

**Expected improvement:** enables future donor models/algorithms to be benchmarked under one provenance-preserving contract without contaminating canonical interpretation or project gold.

**Risk:** accidental authority escalation if downstream code interprets labels as diagnoses. Mitigation: schema invariants and adversarial tests must reject authority flags, clinical-validity claims, or evidence-admission claims.

**Rollback:** remove the isolated contract module/tests; no canonical engine files should depend on it.

### 2. Window-context guard for challenger evaluation — CLEAN REIMPLEMENTATION

**Donor idea:** `openecg/layered.py` masks context-poor window edges and emits only an inner band for stitchable continuous inference.

**Target subsystem:** challenger/evaluation contract only.

**Implementation:** generic deterministic calculation of a valid evaluation interval from `{sample_rate, window_samples, left_context_seconds, right_context_seconds}`. No fixed 2-second clinical assumption is imported; the margin must be explicit in the challenger descriptor and bound into provenance.

**Expected improvement:** prevents optimistic/unstable evaluation at model window boundaries and makes stream stitching auditable.

**Tests:** zero/negative/oversized margins, sample-rate changes, exact boundary behavior, truncation, repeatability, mismatched descriptor hashes.

### 3. Independent-source disagreement telemetry — CLEAN REIMPLEMENTATION

**Donor idea:** `openecg/report.py` cross-checks independent model/rule sources and records disagreement/fallback rather than silently choosing one.

**Target subsystem:** challenger evaluation.

**Implementation:** a non-clinical disagreement record containing source identities, comparable output domain, agreement/disagreement/abstention status, and explicit `decision_authority: NONE`.

**Expected improvement:** makes ensemble/challenger conflicts observable for later adjudication and error analysis.

**Risk:** downstream selection of a "winner" without evidence. Mitigation: contract provides no automatic promotion or diagnostic resolution field.

### 4. Boundary timing metric methodology — EVALUATION ONLY

**Donor components:** `openecg/eval.py`, `scripts/eval_boundary_sweep.py`.

**Use:** register methodology for sensitivity, PPV, F1, and boundary timing-error distributions with explicit tolerance configuration. Do not copy implementation at this stage; later metric implementation must be independently specified and tested for one-to-one matching, empty-set semantics, tolerance inclusivity, and bootstrap confidence intervals.

### 5. Record-level split and missing-label masking discipline — EVALUATION ONLY

**Donor components:** `scripts/build_real_multilayer_cache.py`, Stage-2 multi-dataset code.

**Use:** register requirements that train/validation/test splits are record/patient-level when identifiers permit, that unknown/unmodeled labels are masked rather than inherited, and that a dataset only supervises the layer for which it has legitimate annotations.

### 6. Physiology-aware robustness perturbation ideas — EVALUATION ONLY

**Donor component:** `openecg/stage2/augment.py`.

**Use:** future robustness fixtures may include power-line interference, bounded white/sine noise, amplitude scaling, aligned time shifts, and carefully bounded time stretching. The target must not assume donor augmentation ranges are clinically safe; every perturbation must be labeled synthetic and remain evaluation-only.

## Challenger-only items

- OpenECG QRS-width heuristics.
- OpenECG pacemaker-spike algorithms.
- OpenECG AF irregularity rule set.
- OpenECG boundary/codec neural models.
- TFLite/ONNX deployment architecture for those models.

These may inform future challenge tests but require separate validation and, for trained weights, license clearance. None is approved for canonical runtime integration.

## Explicit rejections / deferrals

- **Do not copy `openecg/qrs.py` as OpenECG-original code.** Its own notice attributes the underlying implementation to NeuroKit2/Makowski. Canonical audit is deferred to DONOR-003.
- **Do not integrate `openecg/delineate.py`.** It is a NeuroKit2 wrapper; evaluate the original dependency under DONOR-003.
- **Do not import bundled `.pt`, `.onnx`, or `.tflite` weights.** `LICENSE_REVIEW_REQUIRED` until explicit artifact rights and training-data compatibility are established.
- **Do not import the agent-facing `report()` behavior.** It emits rhythm/interval/AF/pacing conclusions that are incompatible with the target's governed inactive clinical state.
- **Do not treat README/model-card performance numbers as target evidence.** They remain donor-reported claims until target-controlled reproduction under identical contracts.

## Associated donor queue additions

- `vitaldb/opendsp` — material first-party core dependency/extracted DSP implementation.
- `vuno/ST-MEM` — upstream currently resolving from the historical `bakqui/ST-MEM` reference.

The already-scheduled original donors ECG-FM, ECGFounder, HuBERT-ECG, and NeuroKit remain authoritative audit points over OpenECG wrappers.

## Acceptance criteria for this donor

1. Every adopted code change is non-clinical evaluation infrastructure only.
2. No donor weights/data are committed.
3. All new records bind exact donor commit/tree and target rollback identity.
4. New contracts fail closed on authority escalation, malformed provenance, unsupported output domains, invalid context windows, and nondeterministic identifiers.
5. Existing full target CI and terminal gates pass on the donor branch.
6. Donor-specific adversarial tests pass in GitHub Actions.
7. Before/after proof demonstrates a new auditable challenger capability rather than merely unchanged tests.
8. Final donor receipt records the fresh-clone DNS limitation and does not claim an upstream local test run.

## Stop conditions

Stop and classify the relevant item `LICENSE_REVIEW_REQUIRED` or `REJECTED` if artifact licensing cannot be established, if implementation would require clinical-authority escalation, if source-label/project-gold separation cannot be preserved, or if comparative proof does not show a material engineering/evaluation improvement.
