# EKG Interpretations

Canonical governed ECG engineering, research-evaluation, provenance, and donor-integration subsystem for the clinician-facing Cardiology OS.

Read [AGENTS.md](AGENTS.md) for all ten inline product invariants and repository guardrails. Canonical policy: [PRODUCT_INVARIANTS.md](https://github.com/Cardiology-NP-OS/cardiology-np-build/blob/main/PRODUCT_INVARIANTS.md); sibling checkout: [../cardiology-np-build/PRODUCT_INVARIANTS.md](../cardiology-np-build/PRODUCT_INVARIANTS.md).

**Maturity and manifest posture:** this is quarantined engineering infrastructure, not a clinically active specialist. There is no root module.json; that is a manifest-standardisation gap, not implicit safety permission. `manifests/V12_RECOVERED_BASELINE.json` declares `clinical_accuracy_claimed: false`; `manifests/PRECLINICAL_VALIDATION_CHECKPOINT_V1.json` and the clinical controls preserve the inactive/nonreportable state below. Historical readiness language is not permission to repeat a spent evaluation. Real submissions can contain PHI; the fixture-based pipeline does not establish the production vault, privacy, retention/deletion or deployment security guarantees.

## Product input and current implementation

The product goal is to accept photographs or PDF images of ECGs and produce calibrated traces, measurements, evidence-backed interpretation, and a saved report for clinician review. Live monitor integration is outside scope.

The current engineering path can bounded-decode PNG/JPEG/PDF source files, normalize selected pages, require external-input preflight, digitize governed traces, preserve the original source and normalized raster, and create immutable extraction/analysis generations. JPEG/PDF decoding runs through a pinned Pillow/pypdfium2 worker process and is separately exercised in CI.

This is generated-fixture engineering evidence, not clinical validation. Bounded automatic perspective detection, supported printed-label lead identity, trace-baseline verification, calibrated digitization, immutable extraction/analysis, and temporally scoped multi-lead aggregation are implemented for governed engineering fixtures. Real-photo/reference-case clinical accuracy, evidence-backed clinical interpretation, diagnostic runtime, project gold, and reportable clinical metrics remain inactive/unestablished.

## Live operating state

The immutable pre-donor engineering baseline remains:
- commit `7961425ecd5f5aa09d5e7e8d7bf296e6845e1d82`
- tree `dc9d10b741d486319da01b7ef68e7afc80d6e3c6`

That baseline is a comparison anchor, **not current main**. Always read live GitHub `main` before acting.

Current governed state:
- `SPECIALIST_COMPLETE_INACTIVE`
- `diagnostic_runtime = GOVERNED_INACTIVE`
- `evidence_admission = NOT_ADMITTED`
- `approved_adjudicated_gold_count = 0`
- `metrics = NOT_REPORTABLE`
- `activation = NOT_ELIGIBLE`
- `clinical_validity = NOT_INFERRED`

The donor program is active. At this handoff checkpoint **14 of 21 primary donors are accepted** and the first unfinished donor is **DONOR-015, `HeartWise-AI/ECG_LLM_Judge`**. Verify the live registry before starting because another lane may have advanced it.

This is software/research/evaluation infrastructure. It does not authorize patient-specific ECG diagnosis, treatment, project clinical-gold creation, fabricated diagnostic performance, runtime activation, or transfer of clinical authority.

## Start here for a new AI

Read, in order:
1. [`docs/AI_HANDOFF.md`](docs/AI_HANDOFF.md) — execution contract, source-of-truth order, continuation semantics.
2. [`docs/REPOSITORY_ARCHITECTURE.md`](docs/REPOSITORY_ARCHITECTURE.md) — canonical ownership and filesystem map.
3. [`ECG_DONOR_REGISTRY.json`](ECG_DONOR_REGISTRY.json) — live donor frontier.
4. [`ECG_CAPABILITY_REGISTRY.json`](ECG_CAPABILITY_REGISTRY.json) and [`ECG_DONOR_CAPABILITY_REGISTRY.json`](ECG_DONOR_CAPABILITY_REGISTRY.json) — brand-neutral capabilities and donor provenance.
5. [`ECG_DATASET_REGISTRY.json`](ECG_DATASET_REGISTRY.json), [`ECG_MODEL_CHALLENGER_REGISTRY.json`](ECG_MODEL_CHALLENGER_REGISTRY.json), [`ECG_LICENSE_LEDGER.json`](ECG_LICENSE_LEDGER.json).
6. [`docs/NEON_AND_CROSS_REPO_OPERATIONS.md`](docs/NEON_AND_CROSS_REPO_OPERATIONS.md) — System-Control, Platform, Build-Ledger, and research-holding-area boundaries.
7. [`docs/RESEARCH_EVIDENCE_FORMAT.md`](docs/RESEARCH_EVIDENCE_FORMAT.md) — exact article/source evidence format.
8. [`ECG_EDGE_CASE_COVERAGE.json`](ECG_EDGE_CASE_COVERAGE.json) — adversarial/edge-case coverage contract.
9. [`ECG_BRANCH_RETIREMENT_AUDIT.json`](ECG_BRANCH_RETIREMENT_AUDIT.json) — branch cleanup evidence.

## Architecture rule

**Donor identity is provenance. Capability identity belongs to EKG.**

`donors/` is immutable audit history. Canonical target behavior lives in brand-neutral target-owned code, tests, evaluation contracts, research cards, and registries. Never install donor projects as parallel runtime architectures.

Repository surfaces:
- `lib/` — target-owned executable signal/preprocessing/measurement/evaluation engineering.
- `tests/` — deterministic unit, integration, acceptance, adversarial, donor-closure, and governance proof.
- `evaluation/` — benchmark, dataset, split/leakage, fixture, robustness, and reproducibility contracts.
- `research/` — non-runtime dataset/model/literature knowledge and limitations.
- `donors/` — exact upstream manifests, inventories, gap matrices, boundaries, verification, receipts.
- `clinical_control/` — governed inactive clinical-control boundary.
- `manifests/` — source/provenance manifests.
- root `ECG_*` JSON/ledgers — machine-readable governed state.

## Donor workflow

One donor at a time:

`ACQUIRE -> INVENTORY -> EXTRACT -> GAP -> DECIDE -> IMPLEMENT -> TEST -> COMPARE -> RECEIPT -> VERIFY -> PROMOTE -> ACCEPT`

Before mutation: fetch current main, inspect ancestry, active donor branches/worktrees, receipts/registries, and exact-SHA CI. If another lane advanced the donor, adopt valid newer work rather than replaying it.

Every material capability ends as one of:
`INTEGRATED`, `DEPENDENCY`, `ADAPTER`, `CHALLENGER`, `EVALUATION_ONLY`, `DATA_ONLY`, `RESEARCH_ONLY`, `SUPERSEDED`, `REJECTED`, `LICENSE_REVIEW_REQUIRED`.

Models remain inactive challengers unless separately governed. Dataset/source labels never become project gold. Code/model/data licensing is tracked separately.

## Proof commands

Run before accepting repository changes:

```bash
npm test
npm run gate:ci
python tools/ep5_pkt09_terminal_specialist_completion_gate.py
git diff --check
```

CI uses Node 22 and Python 3.12. No lint or typecheck script is configured. For native image-decoder verification, install the pinned wrappers in an isolated environment and put its Python on PATH:

```bash
python -m pip install --disable-pip-version-check -r requirements-image.txt
npm run test:image-decoder
```

Set `EKG_IMAGE_PYTHON` to the same interpreter for the Node bridge. These commands test generated fixtures, not a clinical cohort. Do not dispatch `clinical_accuracy_pilot.yml` or run `validate:qrs-v2-ludb-coverage-v2-holdout`: MITBIH-RPEAK-FULL-V1 is immutable and the LUDB holdout is SPENT/FAILED; V1 remains the default. Contract/preservation tests do not authorise retuning or repeating those evaluations.

Also run donor-focused tests and exact-SHA GitHub CI. Fresh-clone verification is required when available. Skipped/unavailable evidence is not PASS.

## Research

Research claims are source-grounded, non-runtime evidence. Use `research/literature/ARTICLE_EVIDENCE_SCHEMA.json` and the rules in `docs/RESEARCH_EVIDENCE_FORMAT.md`.

Keep `PUBLISHED_PERFORMANCE_CLAIM` distinct from target-controlled reproduction. Published metrics do not make target metrics reportable. Prefer final peer-reviewed publications over preprints when available; preserve predecessor links.

The separate private `sethburkhardt21-dev/EKG-RESEARCH-HOLDING-AREA` is a NON_RUNTIME extraction/evidence warehouse. Nothing moves from it into canonical EKG merely because it was collected there.

## Cross-repository / Neon boundary

Neon Cardiology-NP-System-Control is coordination/metadata authority, not a patient ECG database. Preserve the immutable accepted engineering baseline separately from the latest observed GitHub main. Append system events only through the governed idempotent event function documented in `docs/NEON_AND_CROSS_REPO_OPERATIONS.md`.

`Cardiology-NP-OS/Cardiology-NP-Platform` is a downstream consumer. Do not silently repin or mutate it during donor work.

## Data / authority boundary

Do not commit PHI, restricted raw datasets, credentials, or unlicensed weights. Do not infer model-weight or dataset rights from source-code licenses. Missing checkpoint identity, preprocessing, license, or source version fails closed for reuse.

`SOURCE LABELS != PROJECT GOLD` and `MODEL PREDICTIONS != PROJECT GOLD`.

## Next unfinished product work

Prioritise the canonical photo/PDF workflow over mechanically advancing the donor queue: real-image paired-reference validation with separately proven lead/calibration evidence, clinician correction/review UI, and evidence-backed interpretation/reporting remain unfinished. The opt-in strict trace/uncertainty path is documented in [docs/IMAGE_DECODER_DEPENDENCIES.md](docs/IMAGE_DECODER_DEPENDENCIES.md); it does not validate arbitrary photographs. Native decoder isolation, access control, PHI retention/deletion and binary distribution review remain deployment prerequisites. Any new confirmatory study requires a separately authorised frozen protocol and fresh protected data, not spent holdout reuse.

## Continuation

When told **Continue**, first do live repository/tool work. Reading state or writing another plan is not completion. Resume the first unfinished permitted gate and execute it. A valid blocker must identify the exact gate, reason, tool evidence, last verified commit/tree, and safe next action.
