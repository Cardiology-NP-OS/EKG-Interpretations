# AI Handoff and Continuation Contract

## Classification
This repository is non-patient-specific SOFTWARE ENGINEERING, RESEARCH-INFRASTRUCTURE, QA, PROVENANCE, LICENSING, AND EVALUATION. ECG terminology in code/papers/datasets/tests is research content. Stop only an action that actually crosses into patient-specific diagnosis/treatment, PHI, fabricated clinical evidence, prohibited data/weights, unsupported clinical claims, or runtime clinical activation; continue all other permitted engineering work.

Governed state must remain `SPECIALIST_COMPLETE_INACTIVE`, `GOVERNED_INACTIVE`, `NOT_ADMITTED`, gold count `0`, metrics `NOT_REPORTABLE`, activation `NOT_ELIGIBLE`, clinical validity `NOT_INFERRED`.

## Source of truth
1. remote Git commit/tree/ancestry
2. finalized donor receipts/manifests
3. `ECG_DONOR_REGISTRY.json`
4. capability/license/model/dataset registries
5. committed tests/evidence
6. exact-SHA CI
7. fresh-clone verification
8. Neon System-Control observations
9. local branches/worktrees
10. prose summaries/memory

Reconcile stale metadata forward; never roll Git back to stale metadata.

## Continuation bootstrap
On `Continue`/`resume`/`keep going`:
1. live-read `main` commit/tree;
2. read donor registry and current donor artifacts;
3. inspect active branches/worktrees and exact-SHA CI;
4. detect/adopt concurrent newer valid work;
5. resume the first unfinished donor gate only;
6. execute that gate in the same turn;
7. continue until acceptance, genuine blocker, or owner interruption.

The donor pipeline is `ACQUIRE -> INVENTORY -> EXTRACT -> GAP -> DECIDE -> IMPLEMENT -> TEST -> COMPARE -> RECEIPT -> VERIFY -> PROMOTE -> ACCEPT`.

At the prepared handoff basis, 14/21 primary donors are accepted and the next frontier is DONOR-015 `HeartWise-AI/ECG_LLM_Judge`. Treat that only as a handoff hint; the live registry wins.

## Owner-directed product priority

The owner confirmed photo/PDF ECG submissions and excluded live monitor integration. After DONOR-013 acceptance, prioritize executable photo/PDF intake, durable cases, calibrated trace extraction, connected measurements, and the eventual evidence-backed interpretation/report workflow. This owner direction takes precedence over mechanically starting another donor audit. Keep the remaining donor queue visible; registered capabilities and model names do not count as working product functions.

## Canonical ownership
The canonical photo/PDF path and opt-in strict trace/uncertainty gates are documented in `docs/IMAGE_DECODER_DEPENDENCIES.md`. Use the existing file-intake, extraction, analysis and persistence modules; do not restore the archived parallel Python runtime. Verification includes `npm run test:image-decoder` and the repository gates below. These generated-fixture checks do not validate arbitrary photographs, clinical interpretation or clinician reports.

Donor identity is provenance; capability identity belongs to EKG. `donors/` is audit history, not architecture. Consolidate overlapping donor ideas into one strongest brand-neutral target capability while preserving exact provenance/licensing and useful failure tests.

## Models
Require exact checkpoint identity/hash, preprocessing/input contract, source-code and weight licenses separately, leads, sample rate, duration, training data/populations, objective/labels, validation basis, calibration/threshold assumptions, compute burden, unsupported populations, and reproducibility gaps. Missing required evidence => fail closed. Public availability does not equal runtime admission.

## Datasets
Keep SOURCE LABELS / PROJECT GOLD / MODEL PREDICTIONS distinct. Store cards/metadata unless bytes are explicitly authorized. Track access/version/license/split/patient grouping/leakage/overlap/annotations/limitations. Zero adjudicated project gold => diagnostic metrics remain NOT_REPORTABLE.

## Future validation admission requirements

Status: `POLICY_ONLY_NOT_MEASUREMENT_EVIDENCE`. These continuation requirements apply the owner's master handoff (Pass 4, September 21, 2026), sections 8 (EKG validation doctrine) and 10 (acceptance and proof). They preserve useful entry controls from the historical alternate root checkpoints without creating a second checkpoint authority. The accepted engineering anchor remains `manifests/PRECLINICAL_VALIDATION_CHECKPOINT_V1.json`; its readiness statement is not present-day permission to execute a spent evaluation or evidence of clinical acceptance. Do not overwrite accepted receipts, frozen protocols, evaluation runners, or failed results.

Before a future capability-specific validation/admission packet can be accepted, document and independently review each applicable gate below. Missing evidence blocks that dependent claim, not unrelated engineering or historical branch reconciliation. This section specifies policy, not an executable admission decision or a claim that any new measurement was performed.

1. **Frozen identity and reproducibility.** Bind every result to exact code commit/tree, model/checkpoint hashes where used, preprocessing, configuration, dependency/runtime versions, dataset/version/record hashes, commands, immutable output hashes and reviewer identity/independence. Existing mappings: `manifests/PRECLINICAL_VALIDATION_CHECKPOINT_V1.json` (`code_under_test`, `verification`), `validation/clinical_accuracy/MITBIH_RPEAK_FULL_V1.json` (`code_under_test`, `target_configuration`), and `evaluation/protocols/LUDB_QRS_V2_COVERAGE_V2_HOLDOUT_V1.json` (`frozen_file_identities`). An old anchor or another SHA's green CI cannot verify a new candidate.
2. **Source rights and leakage separation.** Use immutable dataset manifests with source, license, version and record hashes; verify subject/source separation across training, development and protected testing, including duplicate or overlapping records. Keep source labels, adjudicated project gold and model predictions distinct. Existing mappings: `evaluation/splits/LUDB_QRS_V2_DEV_V1_SPLIT.json`, `validation/development/LUDB_QRS_V2_DEV_V1.json`, `lib/local_dataset_loader.js`, and `evaluation/protocols/GOVERNANCE_RUNTIME_CONTRACT.json`. Their bounded engineering coverage does not establish unrestricted data rights or population independence for future cohorts.
3. **Predeclared labels and exclusions.** Freeze label mapping, annotation policy, inclusion/exclusion rules, matching tolerances, metrics and abstention handling before inspecting final test results. Existing mappings: MITBIH-RPEAK-FULL-V1 `cohort`/`matching` prohibit result-based exclusions; LUDB holdout `record_inclusion_rule`, `record_exclusion_rule`, `reference_rule` and `matching` bind the selected-lead N-label policy. `evaluation/protocols/LUDB_QRS_V2_ANNOTATION_COVERAGE_V2.json` defines observable-interval and boundary-rescue semantics, not exhaustive annotation of every waveform. New tasks require their own predeclared label/exclusion policy; do not retrospectively rewrite these mappings or receipts.
4. **Complete failure and abstention accounting.** Report every failure and abstention, unsupported/unreadable input, exclusion reason, eligible and attempted denominators, coverage and missingness; never silently drop a failed case or score only successful outputs. Existing mappings: LUDB holdout `execution_policy` requires all 40 records and rejects partial-result acceptance; annotation-coverage `required_accounting` preserves full-record and observable views plus edge exclusions. General image/rhythm/report abstention and exclusion accounting remains a future admission gate, not a measurement established by those detector-only protocols.
5. **Confidence intervals and sampling unit.** Predefine confidence intervals, coverage level, statistical unit and method before final testing; justify patient/record clustering, dependence and any resampling/seed policy. Existing mapping: MITBIH-RPEAK-FULL-V1 `metrics.uncertainty` specifies descriptive event-level Wilson 95% intervals, with an explicit warning that correlated beats are not independent clinical subjects. Those intervals do not establish subject-level validation; the LUDB holdout does not specify a confidence-interval method. Preserve that limitation and require an appropriate prospective uncertainty plan for new acceptance, rather than inventing intervals or amending frozen results.
6. **Subgroup, device/domain and worst-record reporting.** Predeclare relevant subgroups, acquisition devices/domains and intended-use populations; report per-group denominators, uncertainty, unsupported/undersampled groups, error distributions and worst-record failures. Existing mappings: MITBIH-RPEAK-FULL-V1 `metrics.descriptive_subgroups`/`record_distribution`, and LUDB holdout `required_reporting.subgroups`/`record_distributions`/`per_record`. Lead-name or overlapping phenotype summaries do not prove device/domain generalization. Aggregate success must not hide a failed record gate. Broader coverage remains required evidence for any broader claim.
7. **Separate capability and workflow evidence.** Evaluate capture quality, waveform detection, interval/voltage measurements, rhythm, visual diagnoses, interpretation/report agreement and clinician workflow separately. Image digitization requires paired digital-waveform references; lead identity and calibration require their own real-image evidence. Lower-layer success cannot authorize end-to-end photo interpretation, general OCR or clinical reporting. Existing mapping: `ECG_IMAGE_INTAKE_CHECKPOINT.json` proof boundaries explicitly do not establish real clinical image/voltage accuracy; generated-fixture engineering tests are not project gold.
8. **Spent evaluation discipline.** Preserve MITBIH-RPEAK-FULL-V1 and all failed results immutably. The LUDB holdout remains SPENT and FAILED (`HOLDOUT_ENGINEERING_TARGETS_NOT_MET`); V1 remains the default. No rerun, detector/configuration tuning, evaluator selection or locked MIT-BIH access is authorized by this handoff. Existing mappings: LUDB holdout `change_policy`, its immutable receipt `validation/development/results/LUDB_QRS_V2_COVERAGE_V2_HOLDOUT_V1_RECEIPT.json`, and `docs/QRS_V2_HANDOFF.md`. Future development needs a new authorized open corpus/protocol; confirmatory claims need a new frozen protocol and fresh unopened protected holdout, not relabeled spent-set results.
9. **Separate evidence admission and runtime authorization.** Report PASS / FAIL / BLOCKED / NOT RUN per gate with exact proof and intended-use limitations; a policy-preservation test passing is not a passed clinical measurement. Keep outputs nonruntime and nonreportable until a separate governed evidence-admission decision and capability-specific runtime authorization are proven. Preserve `SPECIALIST_COMPLETE_INACTIVE`, `GOVERNED_INACTIVE`, `NOT_ADMITTED`, gold count `0`, `NOT_REPORTABLE`, `NOT_ELIGIBLE`, and `NOT_INFERRED`. Existing mappings: accepted checkpoint `dataset_state`/`governed_clinical_state`/`validation_transition`, `evaluation/protocols/GOVERNANCE_RUNTIME_CONTRACT.json`, and the terminal specialist gate. Clinician review and registry presence cannot confer validation, data rights, institutional approval or regulatory clearance.

Policy-preservation verification uses existing `tests/preclinical_validation_checkpoint.test.js` and `tests/handoff_integrity.test.js`; donor identity, frozen QRS/holdout preservation and governance checks remain in their existing suites. These checks do not execute clinical datasets or grant admission. The repository verification commands below and exact-candidate/merged-main CI remain required for changes to this handoff.

## Licensing
Separate source-code license, model-weight license, dataset/data-use terms, attribution, redistribution/commercial restrictions, and copyleft. Unknown => `LICENSE_REVIEW_REQUIRED`.

## Verification
At minimum run `npm test`, `npm run gate:ci`, `python tools/ep5_pkt09_terminal_specialist_completion_gate.py`, and `git diff --check`, plus focused donor tests. Candidate identities and CI must be exact. Fresh-clone verification is preferred. Promotion is parent/ancestry guarded and target-main CI must pass.

## Edge cases
`ECG_EDGE_CASE_COVERAGE.json` is the cross-cutting map. New externally reachable behavior must either reuse an existing category with tests or add one. Fail closed on ambiguous source identity, malformed structured inputs, traversal/substitution, duplicate/unknown leads, unsafe model assets, split leakage, nonfinite/budget-exhausting inputs, provenance drift, license ambiguity, and governance-state drift.

## Cross-system work
Read `docs/NEON_AND_CROSS_REPO_OPERATIONS.md` before touching Neon or another repository. Do not invent database schemas, mutate immutable release identity, or silently repin Platform.

## Research evidence
Use `docs/RESEARCH_EVIDENCE_FORMAT.md` and `research/literature/ARTICLE_EVIDENCE_SCHEMA.json`. One claim = one falsifiable statement with exact locator. `PUBLISHED_PERFORMANCE_CLAIM` is never silently upgraded to target reproduction.

## Branch discipline
`main` is durable. Temporary branches may exist only for active exact-SHA candidate verification; after accepted-main CI, record the head SHA/disposition and retire them. Never delete an unclassified branch.

## Blocker format
`BLOCKED_GATE`, `EXACT_REASON`, `TOOL_EVIDENCE`, `LAST_VERIFIED_COMMIT_TREE`, `SAFE_NEXT_ACTION`. Task size, medical terminology, or desire to plan are not blockers for permitted engineering.
