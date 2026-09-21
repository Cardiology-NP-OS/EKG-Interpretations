# EKG Interpretations agent instructions

Read this file, README.md, docs/AI_HANDOFF.md, docs/REPOSITORY_ARCHITECTURE.md and relevant manifests/registries before changes. Canonical policy: [PRODUCT_INVARIANTS.md](https://github.com/Cardiology-NP-OS/cardiology-np-build/blob/main/PRODUCT_INVARIANTS.md); sibling checkout: [../cardiology-np-build/PRODUCT_INVARIANTS.md](../cardiology-np-build/PRODUCT_INVARIANTS.md). Owner-directed product constraints govern intent; historical checkpoints and live code establish implementation, not permission to override these constraints.

Canonical workflow/content contract: [PRODUCT_WORKFLOW.md](https://github.com/Cardiology-NP-OS/cardiology-np-build/blob/main/PRODUCT_WORKFLOW.md); sibling: [../cardiology-np-build/PRODUCT_WORKFLOW.md](../cardiology-np-build/PRODUCT_WORKFLOW.md). Read alongside PRODUCT_INVARIANTS.md; requirements are not implementation evidence.

## Required in every repository

1. **Clinician-facing only.** The cardiology clinician is the sole user. The patient is the subject of the record, never an application user. No patient app, portal, login, screens, patient-facing exports, summaries, education materials or consent UI. A clinician may independently choose to print or share clinical work; that is not a patient product surface. Where consent is required, the clinician obtains it and records who obtained it; the clinician records revocation on the patient's behalf and the system honours it.
2. **Standalone, no clinical interop.** No FHIR integration, HL7, SMART-on-FHIR, EMR connection or assumed structured feed. Data arrives through documents, photographs, dictation and manual input. Retain local FHIR-bundle file parsing and medication reconciliation as document import, not a live connection. The owner authorized retirement of SMART connection-contract exports and promises on 2026-09-21; preserve historical receipts and require blocking no-egress tests for local clinical processing. Do not build interop hooks.
3. **Real PHI in production, synthetic data in development.** Production records require the identity vault, encryption/key hierarchy, encrypted artifacts, audit and deletion guarantees. Development, tests, fixtures and repository content use synthetic data only. Opaque IDs do not de-identify clinical content. Never send PHI to a destination without explicit approval; Azure hosting alone is not approval. Never commit secrets or patient data.
4. **Honest capability manifests.** module.json safety flags describe what a module does and does not do. Never set a flag true without applicable evidence. Preserve quarantine, inactive status and negative capability declarations until exact acceptance earns a change. A present donor, model, dependency or interface is not an accepted runtime.
5. **Validation before clinical claims.** Clinical accuracy requires appropriate held-out data, a frozen protocol and published metrics with uncertainty, subgroup and failure analysis. Clinician review does not validate an engine; acquisition quality is not diagnostic validity; workflow improvement is not an accuracy result. Preserve failed results and spent holdouts; do not retune or rerun them as independent confirmation.
6. **Provenance and corrections persist.** SOURCE_REPORTED, SYSTEM_DERIVED and CLINICIAN_REVIEWED describe origin/review, not ascending levels of truth. Every displayed claim retains its source and review state. Corrections are append-only with explicit supersession; original source and extraction remain traceable. Unknown is neither zero nor normal. Models do not regenerate canonical events during replay.
7. **Never weaken tests to obtain green.** Do not delete assertions, loosen comparisons, reduce iteration counts, add skips or mock out durability checks to evade a failure. A skipped or unavailable check is a gap, not a pass. Report PASS, FAIL, BLOCKED and NOT RUN separately and bind results to the exact tested revision.
8. **Archive before destruction.** Before any branch deletion, push the lightweight archive/<branch-name> tag at that exact tip, verify the remote tag, and recheck the branch tip. A mismatched existing tag blocks deletion. Never force-push, rewrite main history, delete a tag or delete a repository. Preserve unrelated work and immutable evidence; do not destructively reset unarchived work.
9. **A clinical instrument, not a generic AI app.** No chat-bubble-first surface, sparkles, decorative gradients or assistant persona. Use restrained, purposeful clinical information hierarchy; models are invisible infrastructure behind sourced content. Optimise for one-handed clinician work under time pressure without hiding provenance, review state or unavailable capabilities.
10. **Documentation integrity, not reimbursement optimisation.** Clinical notes support accuracy, completeness and fidelity to what happened. Generated notes are drafts until signed by a clinician. Never steer wording or codes toward higher reimbursement or upcoding.

## Workflow and content requirements

- Source-bound ECG findings contribute to one integrated longitudinal complex-patient picture, not an isolated specialist report. At least two cardiology clinicians independently score frozen synthetic cases for accuracy, completeness, important findings surfaced, significant omissions, potential decision impact and claim-level traceability. Preserve rubric, scorer identity, disagreements and critical-error flags; fluent wrong synthesis fails and critical errors are not averaged away.
- Capability depth must match or exceed the relevant per-capability alternative; usability and clinician time savings must substantially exceed the current workflow. Use Build's one-hour baseline before UI freeze, freeze owner-approved targets before product timing and report per-task p50/p95, sample sizes, failures and device/conditions; ECG interpretation needs dedicated evaluation beyond that baseline. Verify Cardiologs/Philips, AliveCor/Kardia, Eko, Anumana, Idoven and PMcardio against current capabilities and intended use. Workflow wins and acquisition quality are not diagnostic accuracy. No comparator parity or clinical activation is established.
- Quick ECG requires framing/capture, acquisition-quality checks, retake for glare/perspective/uncertain calibration and authorized analysis only. Preserve source identity/location, original raster, calibration/lead evidence, extraction generations, time spans and review state. Separate paired-reference waveform digitization, lead/calibration, measurements, rhythm, interpretation/report agreement and workflow evidence. Missing clinical evidence must remain unavailable; do not reuse spent holdouts.
- Dictation is first-class product input: compare Dragon Medical One with Azure AI Speech, Whisper, Deepgram and AWS Transcribe Medical for cardiology terms, dose/unit errors and approved PHI handling. Retain transcript/audio source-time spans and review state; transcription is not fact. Procedure/post-op notes are unsigned clinician drafts optimized for accuracy/completeness, never reimbursement. Ambient capture is deferred because consent law varies and patient audio adds PHI retention/deletion risk; no EMR payoff is assumed.
- Cardiac Reference is the library; Pocket is access/cache, not another subsystem/tab. ECG reference content needs governed sources, rights, versions and review/status; My Notes are not guidance or project gold. Evidence owns knowledge, Mobile the encrypted record and native clinician-only Home / Patients / Ask, Platform headless orchestration and Core portable contracts. EKG owns scoped signal processing, not a duplicate record or chat-first/persona app.

## Repository boundaries and guardrails

- EKG owns canonical ECG intake, signal engineering and evaluation, not a duplicate patient record. Mobile owns the local-first record/lifecycle; Core owns shared contracts; Platform orchestrates; Evidence owns governed knowledge. Donor identity is provenance, not a parallel runtime architecture.
- Preserve `SPECIALIST_COMPLETE_INACTIVE`, `GOVERNED_INACTIVE`, `NOT_ADMITTED`, project gold `0`, `NOT_REPORTABLE`, `NOT_ELIGIBLE` and `NOT_INFERRED`. There is no root module.json; existing manifests/clinical controls express quarantine, not a replacement claim of manifest compliance or clinical readiness.
- Photo/PDF intake and opt-in strict trace/uncertainty handling use the canonical libraries documented in docs/IMAGE_DECODER_DEPENDENCIES.md. Generated fixtures do not validate arbitrary photographs, interpretation or reports. Do not restore the archived parallel Python runtime.
- Preserve immutable MITBIH-RPEAK-FULL-V1, failed results and the SPENT/FAILED LUDB holdout. V1 remains default. Do not run `validate:qrs-v2-ludb-coverage-v2-holdout`, clinical dataset runners or `.github/workflows/clinical_accuracy_pilot.yml` for ordinary verification; a new confirmatory claim requires a new authorised protocol and fresh protected data.
- One writer per repository, including controllers and subagents. Confirm ownership and recheck branch, status, diff, history, remote main and exact CI before mutation, commit or push. Parallel work uses disjoint repositories or read-only review. Never silently repin Platform or change accepted evidence.
- Dictation is the first voice input. Ambient visit recording is deferred: do not build it. Later authorised capture requires clinician-recorded consent/revocation, approved PHI processing and retention/deletion first.
- Branding cleanup is not schema migration. Preserve persisted identifiers, subject IDs, hashes and checkpoints until enumerated dual-read mappings, old-byte compatibility tests, migrated artifacts and rollback/identity provenance are proven. Do not bulk-rename legacy dad-cardiac contracts or rewrite historical evidence.
- Keep README purpose, capabilities, limitations, maturity, manifest posture, next work and exact commands current. Documentation-only work does not authorise runtime, frozen source, protocol, receipt or test changes.

## Discovered verification commands

Normal CI uses Node 22 and Python 3.12. The package has no Node dependencies or lockfile. Run repository acceptance checks serially:

```bash
npm test
npm run gate:ci
python tools/ep5_pkt09_terminal_specialist_completion_gate.py
git diff --check
```

`npm test` delegates to the existing synthetic/contract/preservation `test:ci` suite; preservation tests are not execution of the spent holdout. For native decoder verification, install the pinned wrappers in an isolated Python environment and use its Python on PATH:

```bash
python -m pip install --disable-pip-version-check -r requirements-image.txt
npm run test:image-decoder
```

Set `EKG_IMAGE_PYTHON` to that same interpreter for the Node bridge. `.github/workflows/ci.yml` additionally runs the historical quarantined-control gates and Ubuntu/Windows decoder jobs; inspect exact-SHA outcomes, not the manual clinical-accuracy workflow. No lint/typecheck script is configured; do not invent one. Missing source data, unavailable native dependencies, skipped checks and unrun gates are gaps, not passes. Retain exact environment, commit/tree and command outcomes in verification receipts.
