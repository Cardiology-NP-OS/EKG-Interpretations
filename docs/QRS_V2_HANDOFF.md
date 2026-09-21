# QRS detector V2 engineering handoff

## Canonical stopping point

The commit containing this file is the handoff checkpoint on `eng/rpeak-qrs-detector-v2`. Its predeclared real-signal protocol parent is commit `a216fa831f96f7539fe353adced6b633953f37e2`, tree `4808ed45d788177a2dcbfcaae16a5900a0f73b24`. Draft pull request 21 is the GitHub review surface.

Development is intentionally stopped after the first predeclared LUDB 1.0.1 training-split run. The 40-record internal holdout annotations have not been parsed or scored. The locked 48-record MIT-BIH cohort has not been run with V2 and remains prohibited for parameter selection.

## Implemented state

- V1 remains the default and is byte-hash guarded by `tests/qrs_v2_preservation.test.js`.
- V2 is opt-in through `target-owned-adaptive-qrs-energy-v2` and is runtime inactive.
- The detector uses QRS-band filtering, slope energy and integration, adaptive signal/noise thresholds, morphology screening, pacing-spike association, refractory replacement, search-back, calibrated-waveform fiducial refinement, and deterministic lead-quality selection with failover.
- Event matcher V2 provides deterministic maximum-cardinality, minimum-total-error, one-to-one assignment within an inclusive tolerance.
- Synthetic regression fixtures cover the named low-amplitude, P/T, pacing, noise, morphology, refractory, search-back, timing, and multilead failure mechanisms.
- LUDB dataset/version/license, source hashes, split, lead rule, annotations, matcher, metrics, and authority boundary were frozen before the first cohort-wide training result.

## First real-signal training result

The immutable compact receipt is `validation/development/results/LUDB_QRS_V2_TRAIN_V1_RECEIPT.json`. The full record-level result remains outside Git because it contains source-label comparisons:

- result file: `ludb-qrs-v2-train-v1.json`
- SHA-256: `a7d5500b481d37807f40798695d017332dd4aff3036e63eeff95d976bd4a077e`
- records: 160 training, 40 internal holdout unopened
- events: 1,466 reference, 1,797 predicted, 1,465 matched, 332 FP, 1 FN
- sensitivity: `0.9993178717598908`
- PPV: `0.8152476349471341`
- F1: `0.8979466748391052`
- timing mean absolute error: `14.501023890784984 ms`
- timing median absolute error: `4 ms`
- worst-record sensitivity: `0.9`
- worst-record PPV: `0.5833333333333334`
- worst-record F1: `0.7368421052631579`

These are nonclinical development observations and remain `NOT_REPORTABLE`; source labels are not project gold.

## Important evaluator finding

Inspection of selected training records found that LUDB's manual QRS annotations may start after the signal begins or end before it finishes. The predeclared V1 development evaluator scores the full ten-second signal, so detections outside the first-to-last annotated-QRS interval become false positives even when the edge waveform may contain a real or partial complex. At least one inspected false positive was internal, so this does not explain every error.

Do not rewrite the initial result. The next evaluator must be a newly versioned, predeclared development protocol with an annotation-observable interval and a separate full-record detection count. It must produce a side-by-side comparison artifact. Detector tuning should resume only after that scoring boundary is frozen.

## Reproduction

The external dataset root must be the independently hash-verified LUDB 1.0.1 distribution and the validation-only environment must contain `wfdb==4.3.1`.

```sh
npm run test:qrs-v2
npm test
npm run gate:ci
python tools/ep5_pkt09_terminal_specialist_completion_gate.py
git diff --check
python3 validation/development/run_ludb_qrs_v2_dev.py \
  --dataset-root /absolute/path/to/ludb-1.0.1 \
  --output /absolute/path/to/ludb-qrs-v2-train-v1.json
```

The repository runner has no split argument and asserts that the protocol authorizes only `train` while the holdout is closed.

## External coordination boundary

GitHub is the code and evidence source of truth. Neon project `sparkling-morning-59395715` may receive only an idempotent system coordination event through `public.system_append_event`. Do not write ECG bytes, annotations, predictions, project gold, clinical claims, or a new immutable release identity to Neon. The Neon event identifier and hash are recorded in the final session report rather than this file because the event is appended only after the exact Git commit exists.

## Resume point

The single highest-value next action is to predeclare and test an annotation-coverage-aware LUDB development evaluator V2, then rerun the already-open training split to separate edge-coverage accounting from detector false positives. Keep the internal holdout and locked MIT-BIH cohort closed.

Locked-evaluation state: `NOT_READY_FOR_LOCKED_V2_EVALUATION`.
