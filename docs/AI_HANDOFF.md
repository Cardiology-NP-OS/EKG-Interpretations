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

At the prepared handoff basis, 13/21 primary donors are accepted and the next frontier is DONOR-014 `HeartWise-AI/ECG_tokenizer`. Treat that only as a handoff hint; the live registry wins.

## Owner-directed product priority

The owner confirmed photo/PDF ECG submissions and excluded live monitor integration. After DONOR-013 acceptance, prioritize executable photo/PDF intake, durable cases, calibrated trace extraction, connected measurements, and the eventual evidence-backed interpretation/report workflow. This owner direction takes precedence over mechanically starting another donor audit. Keep the remaining donor queue visible; registered capabilities and model names do not count as working product functions.

## Canonical ownership
The executable image input increment is documented in `docs/IMAGE_INPUT_WORKFLOW.md`. Run both `python tests/image_case_pipeline_test.py` and `npm run test:images` with the pinned decoder environment. Review extraction geometry, operator-confirmed calibration, uncertainty rejection, per-lead timing, saved-analysis integrity, and decoder limits before promotion. It does not perform validated diagnosis or automatic arbitrary-photo digitization. Next functional work is an image region/calibration correction UI, broader image recovery backed by reference cases, and evidence-backed interpretation/reporting after review.

Donor identity is provenance; capability identity belongs to EKG. `donors/` is audit history, not architecture. Consolidate overlapping donor ideas into one strongest brand-neutral target capability while preserving exact provenance/licensing and useful failure tests.

## Models
Require exact checkpoint identity/hash, preprocessing/input contract, source-code and weight licenses separately, leads, sample rate, duration, training data/populations, objective/labels, validation basis, calibration/threshold assumptions, compute burden, unsupported populations, and reproducibility gaps. Missing required evidence => fail closed. Public availability does not equal runtime admission.

## Datasets
Keep SOURCE LABELS / PROJECT GOLD / MODEL PREDICTIONS distinct. Store cards/metadata unless bytes are explicitly authorized. Track access/version/license/split/patient grouping/leakage/overlap/annotations/limitations. Zero adjudicated project gold => diagnostic metrics remain NOT_REPORTABLE.

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
