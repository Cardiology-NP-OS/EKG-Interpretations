# EKG Interpretations

Canonical governed ECG engineering, research-evaluation, provenance, and donor-integration subsystem for the clinician-facing Cardiology OS.

Read [AGENTS.md](AGENTS.md) for all ten inline product invariants and repository guardrails. Canonical policy: [PRODUCT_INVARIANTS.md](https://github.com/Cardiology-NP-OS/cardiology-np-build/blob/main/PRODUCT_INVARIANTS.md) and [PRODUCT_WORKFLOW.md](https://github.com/Cardiology-NP-OS/cardiology-np-build/blob/main/PRODUCT_WORKFLOW.md); sibling checkout: [../cardiology-np-build/PRODUCT_INVARIANTS.md](../cardiology-np-build/PRODUCT_INVARIANTS.md).

**Maturity and manifest posture:** this is quarantined engineering infrastructure, not a clinically active specialist. There is no root module.json; that is a manifest-standardisation gap, not implicit safety permission. `manifests/V12_RECOVERED_BASELINE.json` declares `clinical_accuracy_claimed: false`; `manifests/PRECLINICAL_VALIDATION_CHECKPOINT_V1.json` and the clinical controls preserve the inactive/nonreportable state below. Historical readiness language is not permission to repeat a spent evaluation. Real submissions can contain PHI; the fixture-based pipeline does not establish the production vault, privacy, retention/deletion or deployment security guarantees.

## Product input and current implementation

The product goal is to accept photographs or PDF images of ECGs and produce calibrated traces, measurements, evidence-backed interpretation, and a saved report for clinician review. Live monitor integration is outside scope.

The current engineering path can bounded-decode PNG/JPEG/PDF source files, normalize selected pages, require external-input preflight, digitize governed traces, preserve the original source and normalized raster, and create immutable extraction/analysis generations. JPEG/PDF decoding runs through a pinned Pillow/pypdfium2 worker process and is separately exercised in CI.

The development-only R-peak harness verifies signed dataset and candidate manifests, spent-dataset exclusions, a restricted full-partition index, and the exact transitive execution bytes before loading signals. It derives patient, exact-waveform, near-duplicate, parent-role, and executable-manifest checks from pseudonymous partition rows; privately loads the signed detector graph; and remains quarantined until separately approved regression policy, baseline, infrastructure, and real development data exist. A separately provisioned digest-pinned signer image validates governed records and creates a canonical attempt-scoped execution package containing only opaque record IDs, sample rates, and waveform samples before publishing the signed start. The dedicated candidate runtime image receives that package read-only with only its individual manifest, signature, and trust file; it receives no host checkout, reference labels, governance/corpus mounts, signing key, artifact store, prior bundle, or signer run configuration. Both current-engine and candidate-side Pan-Tompkins detector code run only in bounded child processes under one aggregate deadline and a separate VM realm with no ambient `process`, filesystem, cryptography, or built-in-module access; the trusted candidate parent validates the narrow prediction responses and alone constructs the handoff. The v2 handoff binds the detector's exact transitive identity and execution-input digest to explicitly non-authoritative local isolation evidence. The signer image owns the exact evaluation protocol and regression-policy bytes, rejects any candidate-signed control drift before creating an attempt, rereads both the package and governed corpus, rejects drift or extra files, independently reruns its own Pan-Tompkins implementation, requires exact agreement with candidate-submitted baseline predictions, scores from the signer-generated baseline, verifies the published bundle and parses requested artifacts from the exact signed/hash-checked byte snapshot, and only then signs the terminal receipt. The signed pre-launch binding is `PENDING_EXTERNAL_CONTROL_PLANE_ATTESTATION` and makes no positive image, policy, mount, or reference-isolation claim. Synthetic and container-local observations are both non-authoritative and always keep `candidateReferenceIsolation=false`; the finite launch-policy mount list and five-file detector closure do not prove that an image contains no reference material. No independently provisioned control-plane attestor or trust root exists here, so production executions may complete but remain `QUARANTINED`; a production run also requires a trusted candidate signer with `productionAuthority=true`, exact mandatory integrity controls, approved policy, and an approved comparable baseline before any other pass criteria are considered. Missing, malformed, oversized, nondeterministic, or semantically inconsistent inputs and handoffs fail closed without a completed bundle binding. Waveform input remains sensitive. A GitHub-hosted control-plane workflow separately records each completed source run/retry that it successfully observes; exhausted or inconsistent job metadata is `OBSERVATION_INCOMPLETE`, not an invented pre-launch failure. The observer receives no evaluation signing key, corpus, governance mount, or artifact-root access and has no evaluation authority. This accounting does not validate the detector. Candidate execution and key custody use separate digest-pinned images and process/mount boundaries but still share one self-hosted machine; this is not separate-host, KMS/HSM, or external WORM attestation. The image definitions are `evaluation/signer/Dockerfile` and `evaluation/candidate/Dockerfile`; full development execution remains blocked until both images are independently reviewed, published, and configured with immutable digests. No actual production isolation evidence exists until that canonical image-based run is provisioned; synthetic in-process evidence remains false and quarantined. Published artifacts remain tested not to serialize protected-row identifiers.

Signed bundle publication and verification enforce fixed control-file, run-manifest, per-artifact, and aggregate byte ceilings. Verification authenticates the exact checksum map before artifact reads, opens bundle members with no-follow descriptor semantics where the host supports them, and rejects descriptor/path identity drift, growth, truncation, duplicate checksum rows, and inventory changes. Signed attempt start/terminal verification and development governance/control ingestion apply the same bounded descriptor snapshots and aggregate accounting; candidate workers bind their control reads to the exact parent snapshots. These are local integrity and resource bounds, not host trust, object lock, or external attestation.

The legacy single-process `evaluate:development -- --config ...` invocation now fails with `DEVELOPMENT_EVALUATION_SPLIT_REQUIRED`. Use `evaluate:development:candidate` only in the keyless candidate container and `evaluate:development:signer` only in the independently pinned signer image; the workflow is the canonical orchestration. Changes to either development workflow, every harness CLI, `package.json`, and every test declared by `test:evaluation-harness` trigger the development workflow's hosted synthetic boundary. Concurrency applies only to the externally provisioned full-development job, so an unavailable self-hosted runner cannot suppress hosted synthetic checks for newer commits.

Strict analyses now bind the eight compatibility hashes and a versioned transitive JS/JSON execution identity to the exact UTF-8 bytes compiled by a private CommonJS loader, independent of the ambient module cache. Generation, persistence and normal reopening reject missing artifacts, changed loaded bytes, false hashes and mismatched execution identities. This is source-byte provenance, not actor authentication, extraction replay, native-binary attestation or clinical validation.

Previously stored strict analyses retain their original bytes and hashes. `auditImageAnalysis(casePath, analysisId)` in `lib/image_analysis_store.js` checks stored content/source identities without loading the analysis implementation or rerunning measurements; it explicitly reports implementation provenance `NOT_VERIFIED` and semantic validation `NOT_PERFORMED`. Normal reopening requires the current exact implementation identity; old or differently versioned records are audit-only, never silently relabeled as current. Non-strict legacy records retain their existing validation path. No stored records are migrated or overwritten.

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

The unchanged independent R10 probe and the negative execution/legacy compatibility tests are included in `npm test`; focused commands are `node tests/review_adversarial_strict_provenance.test.js`, `node tests/image_analysis_provenance.test.js` and `node tests/image_analysis_store.test.js`. The legacy fixture preserves an actual synthetic analysis generated at `f3e38bb87d93c937e5ba457ee8e4ffc8a03d6b75`, not a replay using the repaired implementation. Existing synchronization-failure, collision and race assertions remain intact.

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

The source/review-bound ECG contribution must support one integrated complex-patient picture with independent clinician six-axis scoring. Capability comparisons are per intended use, not blanket parity; workflow baseline, frozen targets and per-task p50/p95 remain unmeasured here and do not establish clinical accuracy. Quick ECG capture/retake and Cardiac Reference/Pocket requirements preserve quarantine. Dictation-first input and accurate unsigned procedure/post-op notes are product requirements, not an EKG UI or report-authority grant.

For the development harness, independently provision and review both digest-pinned signer and candidate images plus the external governed resources; even after those are provisioned, this repository still lacks an independently signed control-plane attestor and exclusive daemon/OCI image and mount provenance, so it cannot set `candidateReferenceIsolation=true`. The self-hosted runner account must own the writable artifact root and ephemeral input/handoff directories because every container runs with that account's host UID/GID. The implemented signal-only boundary does not remove waveform sensitivity or the same-host limitation, and regression policy plus an approved prior baseline remain unavailable. Prioritise the canonical photo/PDF workflow over mechanically advancing the donor queue: real-image paired-reference validation with separately proven lead/calibration evidence, clinician correction/review UI, and evidence-backed interpretation/reporting remain unfinished. The opt-in strict trace/uncertainty path is documented in [docs/IMAGE_DECODER_DEPENDENCIES.md](docs/IMAGE_DECODER_DEPENDENCIES.md); it does not validate arbitrary photographs. Native decoder isolation, access control, PHI retention/deletion and binary distribution review remain deployment prerequisites. Any new confirmatory study requires a separately authorised frozen protocol and fresh protected data, not spent holdout reuse.

## Continuation

When told **Continue**, first do live repository/tool work. Reading state or writing another plan is not completion. Resume the first unfinished permitted gate and execute it. A valid blocker must identify the exact gate, reason, tool evidence, last verified commit/tree, and safe next action.
