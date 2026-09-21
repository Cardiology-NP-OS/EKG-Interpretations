# QRS detector V2 engineering handoff

## Generation2 engineering preservation merge

The owner explicitly authorized resolving and landing PR #21 as an engineering preservation merge, not acceptance of clinical ability. This supersedes the historical keep-draft directions below only for repository integration. No detector configuration promotion, clinical authority, holdout reuse, or locked MIT-BIH execution is authorized.

- Merge inputs: PR head `0931059aa9ef4f05cfed829c807d49830c64507a` and main `fb2202fc08c7af0ba1b7eb4f57994e79c0b1c1cd`. All eleven PR commits and prior PR #11 ancestry are retained by a normal merge of main into the PR branch.
- The sole conflict was `package.json`: retain every script and the exact 85-invocation test union (75 main, 83 PR). Main's provider implementation and both provider tests remain byte-identical.
- Added one synthetic integration regression in `tests/qrs_detector_v2.test.js`: provider dispatch and JSON-stdin CLI preserve V1 before and after explicit V2 opt-in, bind persisted artifacts to direct detector events, and retain inactive authority.
- Detector implementations, configuration, matcher, evaluator, protocols, splits, fixtures, historical receipts, clinical controls, and workflows remain unchanged. V1 stays the default. LUDB's spent holdout failure remains `HOLDOUT_ENGINEERING_TARGETS_NOT_MET` with minimum sensitivity `0.875 < 0.9`.
- Local verification: `npm test` exit 0 on WSL Ubuntu / Node 22.20.0 / npm 10.9.3; `npm run test:image-decoder` exit 0 on that environment with Python 3.14.4, Pillow 12.3.0, and pypdfium2 5.13.0 (7 Python and 14 bridge tests).
- Windows verification: `npm run test:qrs-v2` exit 0 (87/87); both focused provider tests exit 0; `npm run gate:ci` exit 0 (30/30); `python tools/ep5_pkt09_terminal_specialist_completion_gate.py` exit 0 (360/360); `git diff --check` exit 0. No lint/typecheck command or configuration was found.
- Residual Windows defect: full tests and decoder bridge persistence fail with `EPERM` at `lib/image_case_store.js:45` because file fsync uses a read-only descriptor. This code is unchanged from main; Linux verification does not establish Windows persistence support. No fsync bypass or unrelated fix was introduced.
- Historical runner caution: the frozen holdout runner checks predeclaration flags and fresh output paths, not a durable spent-receipt lock. Its historical script remains preserved, not authorized for reuse. No real LUDB or MIT-BIH signals or annotations were parsed or scored in this merge continuation.
- Exact-head and post-merge CI must be checked against live GitHub identities before declaring landing complete. Do not delete branches here; the main controller owns archiving and lease release. Workspace shared notes are outside this writer's scope.

## Historical checkpoint

- Repository: `Cardiology-NP-OS/EKG-Interpretations`
- Live main commit/tree: `55792ee32b90542184d530937865f29dfe79149e` / `709b9f41f7e7c639516a6ee3fe308275635e7b83`
- Working branch: `eng/rpeak-qrs-detector-v2`
- Exact result commit/tree: `96a0883db0429e1e3b43156b2b8d4673900e374c` / `1e01d5d87140ed228d7f3c09094b312f5226eb2a`
- Review surface: draft PR #21; keep it draft
- Exact result CI: run `35602016607`, run number `700`, success; all three jobs succeeded
- The commit containing this file is a handoff-only descendant of the exact result checkpoint above. Live remote Git remains authoritative for the handoff commit's own identity.
- Unrelated draft PR #20 / `work/specialist-provider-v1-20260920` was not touched.

The detector remains opt-in `target-owned-adaptive-qrs-energy-v2`. V1 remains the historical default and its locked artifacts remain SHA-256 guarded.

## Completed in this continuation

The annotation-coverage evaluator repair and 160-record open-train result were preserved unchanged. A separate one-shot holdout protocol, `LUDB-QRS-V2-COVERAGE-V2-HOLDOUT-V1`, was committed before any holdout annotation parse or score at commit `577d2488dc06daabc73b625cb89eb9594b393d2c`, tree `d032f661e52e12dcc197e77d89bea7ab3d1cee44`. Its exact-SHA CI run `35601184795` succeeded with all jobs green before execution.

The protocol froze the detector, configuration, evaluator, matcher, split, all 40 validation records, thresholds, catastrophic-record rule, result paths, and one-shot/spent-holdout policy. It exposed no split argument and rejected train records. The unchanged candidate was then executed once on all 40 validation records. No detector or evaluator setting was selected after observing the result.

The immutable outcome is `HOLDOUT_ENGINEERING_TARGETS_NOT_MET`. Aggregate annotation-observable sensitivity, PPV, and F1 all exceeded the predeclared 0.99 minima, but one record had sensitivity `0.875`, below the strictly-less-than-0.9 catastrophic threshold. Aggregate success cannot override that record gate.

A later bounded continuation added `QRS-V2-POST-HOLDOUT-SYNTHETIC-CHARACTERIZATION-V1`. It contains only target-owned deterministic synthetic signals and reproduces two generic limitations of the unchanged candidate: transient amplitude collapse on the globally selected lead produces exactly one FN, and a selected-lead-local QRS-like transient produces exactly one FP. In each fixture, the alternate synthetic lead scores all references with zero FP/FN when isolated. These fixtures characterize the current failure surface; they do not define a passing future configuration, reuse holdout record identities or sample indices, or authorize parameter selection.

## Train versus one-shot holdout

| Annotation-observable metric | Frozen open train (160) | One-shot holdout (40) |
|---|---:|---:|
| References | 1,466 | 364 |
| Predictions | 1,466 | 365 |
| Matched | 1,465 | 363 |
| False positives | 1 | 2 |
| False negatives | 1 | 1 |
| Sensitivity | 0.9993178717598908 | 0.9972527472527473 |
| PPV | 0.9993178717598908 | 0.9945205479452055 |
| F1 | 0.9993178717598908 | 0.9958847736625515 |
| Timing MAE | 14.501023890784984 ms | 18.429752066115704 ms |
| Timing median | 4 ms | 8 ms |

The holdout full-record context had 445 predictions, 82 apparent FPs, and one FN. Coverage-aware scoring retained 365 predictions and two internal apparent FPs; 80 detections were outside selected-lead annotation coverage, split 41 before and 39 after. The matched pairs were identical between the holdout full-record and observable views, so coverage repair did not change holdout timing. Train-to-holdout timing differences reflect different frozen records.

Holdout record medians were sensitivity/PPV/F1 `1`. Minimum sensitivity was `0.875`, minimum PPV `0.8`, and minimum F1 `0.888888888888889`. One catastrophic record is present under the frozen criterion.

## Failure mechanisms

The two records with observable errors are retained by identity only in the hash-bound outside-Git artifacts.

1. Catastrophic FN record: the missed reference had a selected-lead 100 ms local peak-to-peak amplitude of about `0.160`, versus about `0.860` to `0.988` for the other references on that selected lead. Other leads retained larger excursions. This is consistent with transient selected-lead amplitude collapse. Source metadata contains cardiac-pacing and ventricular-extrasystole descriptors, but no causal clinical inference is made.
2. Internal apparent FP record: one event is a large excursion confined primarily to the selected lead and has no nearby `N` annotation on any lead, consistent with a lead-local transient or artifact. The second aligns within 27 samples of an `N` annotation on every other lead, with exact alignment on one lead, but is absent from the selected lead annotation. The latter exposes internal per-lead source-annotation incompleteness and is not sufficient evidence of a detector error.

The failure outcome remains unchanged by this analysis. LUDB source labels are external labels, not project gold. This spent holdout must not be used for parameter, feature, threshold, morphology, lead-selection, matcher, or evaluator selection.

## Evidence identities

- Holdout protocol: `evaluation/protocols/LUDB_QRS_V2_COVERAGE_V2_HOLDOUT_V1.json`, SHA-256 `5e5dd8dfbd20c1129fbbafac701b4490aab92e1f3997ae1d38045b8cea78fa88`
- Holdout receipt: `validation/development/results/LUDB_QRS_V2_COVERAGE_V2_HOLDOUT_V1_RECEIPT.json`, SHA-256 `da6a51e7cac19f8f4bdecf5d1c671c9578cb6b547f37acf4f50ec59cab985d7d`
- Compact train/holdout comparison: `validation/development/results/LUDB_QRS_V2_COVERAGE_V2_TRAIN_HOLDOUT_V1_COMPARISON.json`, SHA-256 `39b5a41fec0522d7529428a4755fb7abddded9e3b9f34a58cd8a9f612c7049bf`
- Outside-Git holdout record-level result: `ludb-qrs-v2-coverage-v2-holdout-v1-result.json`, 81,750 bytes, SHA-256 `fc58c88267d84ed2f6f2ce0b4342d9684ca57ce138f63cab9f4bb94a8ed90ded`
- Outside-Git train/holdout record-level comparison: `ludb-qrs-v2-coverage-v2-train-holdout-v1-comparison.json`, 14,366 bytes, SHA-256 `9a80b76d0acea1277be8ddc9afd4560254d5b5bf5eafe71405ee869fda686ffe`
- Frozen coverage-aware train receipt remains SHA-256 `44747991a5dcc4d576e003dd0bf46e20c382bf4d4f204e50dc175961d34cb872`.
- Historical initial train receipt remains SHA-256 `34738b112f033a9cb699afc1ea840c89ef79f5e0a4d47c6c2b0a02aa5bb58daf`.
- Historical locked V1 receipt remains SHA-256 `08dc1f4be4b51a05b29e4c22791ed0c9cd7e4d6cb1d138f143a7d23c4ff6c84a`.
- Post-holdout synthetic characterization manifest: `validation/development/QRS_V2_POST_HOLDOUT_SYNTHETIC_CHARACTERIZATION_V1.json`, SHA-256 `b91c609bf2482716bde80805ca8df0aba96e95248fbcd07aea96ad0ad83723c6`.
- Synthetic characterization generator: `validation/development/qrs_v2_post_holdout_synthetic_corpus.js`, SHA-256 `5ea2524fdb8c4a5eb23d66723e930ca882057849a5d50598b34342469f50be2a`.
- Synthetic characterization test: `tests/qrs_v2_post_holdout_synthetic.test.js`, SHA-256 `74e7e557623f286624cc5d8257fc803cb7c6f0b077ab337292a137e40ab6c8aa`.

Record identities, sample indices, source-label comparisons, and worst-record ordering remain outside Git.

## Data access statement

- LUDB 1.0.1 open train: previously accessed and scored, 160 records; not rerun for candidate selection in this continuation.
- LUDB 1.0.1 internal validation holdout: all and only the frozen 40 records parsed and scored once after predeclaration and exact-SHA CI. It was unopened before that execution and is now permanently consumed for candidate selection.
- Dataset archive SHA-256: `d03192c7361ab5deeaba3f0d46e274b9ecb0b74c9caf8964151e20f1b5a7df06`; all 2,805 manifest entries verified against source manifest SHA-256 `cccef1f3529519db8f26a333c97a6872a7d0e3e5c64a1448b76b161fd87fb75f`.
- Locked 48-record MIT-BIH signals/annotations: not run, parsed, or used for V2 selection. Preservation tests only rechecked committed locked-artifact hashes.
- No restricted ECG source data or record-level source-label comparisons were committed.

## Verification

- `npm run test:qrs-v2`: 86/86 focused assertions passed, including 7/7 post-holdout synthetic characterization assertions.
- `npm test`: exit 0; all wired suites passed.
- `npm run gate:ci`: 30/30, `synthetic-contract-ci-only`.
- `python tools/ep5_pkt09_terminal_specialist_completion_gate.py`: 360/360.
- `git diff --check`: exit 0.
- Holdout command: exit 0; exact 40-record one-shot execution; frozen fail outcome emitted.
- Holdout-predeclaration exact-SHA CI: run `35601184795`, commit `577d2488dc06daabc73b625cb89eb9594b393d2c`, success; all jobs successful.
- Holdout-result exact-SHA CI: run `35602016607`, commit `96a0883db0429e1e3b43156b2b8d4673900e374c`, success; all jobs successful.

## Governance and next gate

State remains `diagnostic_runtime = GOVERNED_INACTIVE`, `evidence_admission = NOT_ADMITTED`, `metrics = NOT_REPORTABLE`, `activation = NOT_ELIGIBLE`, `clinical_validity = NOT_INFERRED`; source labels are not project gold and project gold remains absent. Locked V2 evaluation remains `NOT_READY_FOR_LOCKED_V2_EVALUATION`.

The candidate did not pass its one-shot internal holdout and is not promotion-eligible. The first unfinished gate is to establish a new open development corpus under a new protocol before proposing any new detector configuration identity. Use the failure mechanisms above only to design open-corpus and synthetic engineering tests; never score or tune again on this spent holdout, and do not access locked MIT-BIH. Keep PR #21 draft. DONOR-015 remains queued and was not started in this branch.
