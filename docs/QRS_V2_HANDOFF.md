# QRS detector V2 engineering handoff

## Live checkpoint

- Repository: `Cardiology-NP-OS/EKG-Interpretations`
- Live main commit/tree: `55792ee32b90542184d530937865f29dfe79149e` / `709b9f41f7e7c639516a6ee3fe308275635e7b83`
- Working branch: `eng/rpeak-qrs-detector-v2`
- Exact result commit/tree: `ef2efdcb559e0264fc0721f8c0c2283ce12b0113` / `08dd37b6c23b7f4db62ec9f2d66fdb954045761c`
- Review surface: draft PR #21; keep it draft
- Unrelated draft PR #20 / `work/specialist-provider-v1-20260920` was not touched
- The commit containing this file is a handoff-only continuation of the exact result commit above; the live PR head remains the source of truth for its own identity.

The detector remains `target-owned-adaptive-qrs-energy-v2`, opt-in and governed inactive. V1 remains the default and its locked artifacts remain SHA-256 guarded.

## Completed in this continuation

The LUDB evaluator boundary was repaired before detector tuning. Protocol `LUDB-QRS-V2-ANNOTATION-COVERAGE-V2` was committed at `11ac6712ab52ed802c49d6f4bc2c896fe08adc03`, tree `e98a715129bb89ca979d86cf7074f984ca2c61b6`, before the new aggregate was observed. Deterministic evaluator tests were also committed before execution.

The protocol defines a closed annotation-observable core interval from the first through last selected-lead `N` reference. Predictions exactly on either boundary are included. Matcher tolerance may rescue an outside prediction only by matching it to a boundary reference; an unmatched prediction before or after the core interval is excluded and counted separately. Empty, malformed, duplicate/nonmonotonic, and single-reference coverage fail closed.

The detector implementation, configuration, lead selection, source cohort, split, and matcher were unchanged. The historical full-record view was reproduced exactly before the coverage-aware view was accepted.

## Historical versus coverage-aware result

| Metric | Historical full record | Annotation observable |
|---|---:|---:|
| References | 1,466 | 1,466 |
| Predictions | 1,797 | 1,466 |
| Matched | 1,465 | 1,465 |
| False positives | 332 | 1 |
| False negatives | 1 | 1 |
| Sensitivity | 0.9993178717598908 | 0.9993178717598908 |
| PPV | 0.8152476349471341 | 0.9993178717598908 |
| F1 | 0.8979466748391052 | 0.9993178717598908 |
| Timing MAE | 14.501023890784984 ms | 14.501023890784984 ms |
| Timing median | 4 ms | 4 ms |

Of the historical 332 apparent false positives, 331 were unmatched detections outside annotation-observable coverage: 167 before the first selected-lead reference and 164 after the last. One internal false positive remains. Ordered matched pairs were identical, so timing did not change. Median observable record PPV/F1 is `1`; minimum observable record PPV is `0.875`, minimum F1 is `0.9333333333333333`, and minimum sensitivity is `0.9`. No record is catastrophic under the predeclared rule of sensitivity strictly below `0.9`.

Aggregate subgroup inspection found no residual FP in the pacing, bundle-branch, ventricular-extrasystole, or sinus-tachycardia metadata groups. The one remaining FP occurs in the sinus-bradycardia metadata group; the one FN occurs in overlapping bundle-branch and ventricular-extrasystole metadata. The two errors occur on selected V5 and V3 respectively, which is insufficient to infer a lead-selection pattern.

## Remaining detector failure modes

Train-only inspection found:

1. One FN: an early, morphology-qualified selected-lead candidate was below the adaptive primary threshold. It was above the secondary threshold, but search-back was not yet armed because too little accepted RR history existed. Source metadata includes bundle-branch and ventricular-extrasystole descriptors; no causal clinical inference is made.
2. One internal FP: a low-strength accepted selected-lead event between annotated QRS references. Its broad raw half-height morphology and position before an annotated P-wave interval make non-QRS waveform or noise confusion plausible, but source labels do not establish a definitive mechanism.

The unchanged detector meets all predeclared open-train aggregate targets and has no catastrophic record. Detector tuning is therefore not justified at this checkpoint; changing parameters for two residual errors would risk train overfit. Preserve these mechanisms as candidates for future synthetic regressions if a later evidence-based configuration change is proposed.

## Evidence identities

- Protocol: `evaluation/protocols/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2.json`, SHA-256 `63d7023fd3ae535df1d427bf13b6cc52cf999f93bbf6048f9e7a1528565e15a1`
- Compact result receipt: `validation/development/results/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2_TRAIN_RECEIPT.json`, SHA-256 `44747991a5dcc4d576e003dd0bf46e20c382bf4d4f204e50dc175961d34cb872`
- Compact comparison: `validation/development/results/LUDB_QRS_V2_EVALUATOR_V1_V2_COMPARISON.json`, SHA-256 `de3fd47f94b55d5921569a69a5715cefd943595fa7b4fa963e44b4a193333134`
- Historical receipt remains unchanged: `validation/development/results/LUDB_QRS_V2_TRAIN_V1_RECEIPT.json`, SHA-256 `34738b112f033a9cb699afc1ea840c89ef79f5e0a4d47c6c2b0a02aa5bb58daf`
- Outside-Git record-level result: `ludb-qrs-v2-coverage-v2-train-result.json`, 292,616 bytes, SHA-256 `ec3842a6654666426129e4055f813567e02f63bd4ca020d66de9cf91c3a34acb`
- Outside-Git record-level comparison: `ludb-qrs-v2-evaluator-v1-v2-comparison.json`, 12,236 bytes, SHA-256 `d2c7e5bb03fb46ae0728b59c11c4bbf188a66d98bc7bf1f63b6e499d5cc3b7c4`

The outside-Git artifacts contain the per-record source-label comparisons, poor-record identities, sample-level accounting, and worst-record ordering. They were not committed.

## Data access statement

- Executed corpus: LUDB 1.0.1, existing frozen `train` split only, 160 records.
- LUDB archive SHA-256: `d03192c7361ab5deeaba3f0d46e274b9ecb0b74c9caf8964151e20f1b5a7df06`.
- All 2,805 manifest entries were byte-hash verified against source manifest SHA-256 `cccef1f3529519db8f26a333c97a6872a7d0e3e5c64a1448b76b161fd87fb75f`.
- The 40-record LUDB internal holdout was not parsed, scored, or used for selection. Whole-archive cryptographic verification read source bytes only; no holdout WFDB annotation loader call occurred.
- The locked 48-record MIT-BIH cohort was not run, parsed, or used for V2 evaluator or detector selection. Repository preservation tests only rechecked the committed locked-artifact byte hashes.
- Source labels remain external labels, not project gold.

## Verification

- `npm run test:qrs-v2`: 66/66 focused assertions passed across detector, matcher, preservation, LUDB V1, evaluator, protocol, and result suites.
- `npm test`: exit 0; all wired suites passed.
- `npm run gate:ci`: 30/30; `synthetic-contract-ci-only`; no clinical accuracy claim.
- `python tools/ep5_pkt09_terminal_specialist_completion_gate.py`: 360/360.
- `git diff --check`: exit 0.
- LUDB train command: exit 0; historical aggregate reproduced exactly; holdout and MIT-BIH non-use emitted in the result.
- Predeclaration exact-SHA CI: run `35598586487`, commit `11ac6712ab52ed802c49d6f4bc2c896fe08adc03`, success.
- Result exact-SHA CI: run `35599645055`, commit `ef2efdcb559e0264fc0721f8c0c2283ce12b0113`, success.

## Governance and next gate

State remains: `diagnostic_runtime = GOVERNED_INACTIVE`, `evidence_admission = NOT_ADMITTED`, `metrics = NOT_REPORTABLE`, `activation = NOT_ELIGIBLE`, `clinical_validity = NOT_INFERRED`, project gold absent, locked V2 evaluation `NOT_READY_FOR_LOCKED_V2_EVALUATION`.

The first unfinished gate is a separately predeclared LUDB internal-holdout protocol and immutable receipt path for the frozen detector/configuration/evaluator candidate. Do not improvise a holdout run. Keep PR #21 draft while that owner-reviewed gate remains unfinished. DONOR-015 remains pending in the root donor queue and was not started in this branch.
