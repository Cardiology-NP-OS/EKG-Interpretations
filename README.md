# EKG Interpretations

Governed ECG signal-processing, interpretation-support, validation, and release-control subsystem for the Cardiology NP OS.

This repository is the dedicated EKG specialist. It owns ECG ingestion/verification, waveform quality controls, bounded signal inspection, measurement and pattern-candidate contracts, review/adjudication workflows, evidence admission controls, diagnostic-activation gates, and the provenance needed to reproduce or revoke an accepted engineering release.

## Current status

**Engineering state:** `SPECIALIST_COMPLETE_INACTIVE`  
**Integration state:** ready for governed integration  
**Diagnostic runtime:** `GOVERNED_INACTIVE`  
**Evidence admission:** `NOT_ADMITTED`  
**Approved adjudicated clinical gold:** `0`  
**Diagnostic metrics:** `NOT_REPORTABLE`  
**Activation eligibility:** `NOT_ELIGIBLE`

The accepted engineering release is pinned to:

- Commit: `7961425ecd5f5aa09d5e7e8d7bf296e6845e1d82`
- Tree: `dc9d10b741d486319da01b7ef68e7afc80d6e3c6`

All nine terminal EKG engineering packets are complete, independently verified, and included in the accepted Stage-3 Cardiac OS release. The current engineering program has no open EKG packet or engineering blocker.

**Important:** engineering completion is not clinical validation. This repository does not currently claim diagnostic accuracy and is not authorized to act as a live diagnostic engine.

## What it does

### ECG source and signal handling

- Verifies expected source identity and fails closed on missing, substituted, malformed, or tampered inputs.
- Reads supported WFDB waveform data and preserves lead/sample structure.
- Converts stored samples using declared gain/baseline metadata.
- Checks source shape, calibration, lead identity, duration, and paired-sampling consistency.
- Produces deterministic, bounded signal-inspection output.
- Produces engineering waveform-quality output without converting quality checks into diagnoses.

### Input-quality and safety controls

The input guard explicitly handles conditions such as:

- missing, duplicate, mislabeled, or unverified leads
- cropped or incomplete tracings
- unknown or conflicting paper speed/gain
- distorted or resampled geometry
- contradictory measurements or metadata
- malformed structured input
- hidden/untrusted text and source instructions
- path, filename, Unicode, symlink/junction, and source-substitution attacks
- oversized/deep/wide structured inputs
- insufficient signal/image quality

Unsafe or ambiguous conditions fail closed or constrain downstream claims rather than silently producing certainty.

### Measurement and interpretation support

The governed candidate layer includes:

- measurement-evidence contracts
- deterministic measurement/calculation support
- structured pattern-candidate generation
- clinical-criteria and pattern registries
- phenotype/diagnosis boundary controls
- reporting-language and structured-output contracts
- failure-mode traceability
- explicit uncertainty and evidence references

These capabilities are designed to support a governed interpretation workflow. They do not independently authorize diagnostic runtime use.

### Review, adjudication, and evaluation

The repository includes infrastructure for:

- blinded review
- adjudication-dataset contracts
- candidate-control reconciliation
- evidence/source traceability
- evaluation contracts
- metric-reporting eligibility
- source-evidence bridging
- deterministic synthetic fixtures
- independent reproducibility checks

### Release and governance controls

The EKG specialist includes gates for:

- system status
- signal/QC exposure
- evidence admission readiness
- compatibility
- recovery reproduction
- repin authorization
- reconciliation acknowledgement
- engineering release candidacy
- evidence intake quarantine
- diagnostic activation
- integration freeze
- terminal specialist completion

Release state is content-addressed and bound to Git commits/trees, packet receipts, verification receipts, correction receipts, semantic-output identities, and independent-machine verification.

The terminal state is intentionally fail-closed: source substitution, fabricated gold/metric claims, unauthorized evidence admission, clinical-authority escalation, or runtime activation attempts are rejected.

## What is still required

The engineering subsystem itself is complete for the current Cardiac OS program. What remains is **clinical validation and activation work**, not another unfinished engineering packet.

Before diagnostic runtime can be enabled, the system still requires:

1. **Governed adjudicated clinical gold**
   - Admit an approved ECG reference corpus through the evidence-admission process.
   - Preserve provenance, reviewer/adjudication identity, dataset version, and exact source hashes.

2. **Reportable clinical-performance evaluation**
   - Evaluate the frozen EKG release against the admitted gold corpus.
   - Produce governed metrics with predefined endpoints, exclusions, subgroup handling, and uncertainty.
   - Keep research labels, source metadata, and project gold labels distinct.

3. **Independent clinical review**
   - Review error modes, disagreements, unsafe edge cases, and clinically important misses/false positives.
   - Resolve or explicitly accept material limitations before activation.

4. **Separate governed activation authority**
   - Clinical validation alone must not silently activate the engine.
   - A distinct approval step must authorize a specific validated release for a defined runtime use.

Until those conditions are met, the correct state remains `GOVERNED_INACTIVE`.

### Future enhancements that are not current completion blockers

Potential future upgrades may include additional waveform adapters, larger benchmark/evaluation corpora, external signal-processing or model challengers, image-to-waveform digitization, ambulatory/Holter support, and other donor integrations. These should enter through the same evidence, licensing, testing, and governance gates rather than being added directly to runtime authority.

## Repository layout

```text
EKG-Interpretations/
├── lib/                  # WFDB signal handling, quality logic, input guard
├── tools/                # verification, inspection, reporting, and release gates
├── tests/                # deterministic contract and signal tests
├── manifests/            # source/quality schemas and source manifests
├── clinical_control/     # governed candidate, evaluation, and release-control layer
├── docs/                 # evidence and signal-boundary documentation
└── .github/workflows/    # CI gates
```

## Common commands

### Self-contained engineering tests

```bash
npm test
```

Runs the deterministic synthetic/contract suite without requiring clinical data.

### CI engineering gate

```bash
npm run gate:ci
```

Verifies the repository's engineering and evidence-boundary contracts.

### Verify an external waveform source

```bash
npm run verify:source
```

The expected external source is intentionally kept outside Git.

### Inspect a verified source

```bash
npm run inspect:source
npm run quality:source
```

These commands emit bounded engineering inspection/QC output; they do not establish a clinical diagnosis.

### Full external-source engineering gate

```bash
npm run gate:source
```

Requires the configured external source and fails closed if the source is absent or does not match its registered identity.

### Terminal specialist conformance gate

```bash
python tools/ep5_pkt09_terminal_specialist_completion_gate.py
```

Confirms the frozen specialist-completion state and its non-activation boundaries.

## Data and privacy boundary

Raw clinical waveform data is not committed to this repository. External data is referenced and verified by governed identity rather than silently copied into Git.

The accepted engineering release contains no PHI, raw clinical payloads, or credentials. Adding production clinical data handling is a separate deployment/compliance concern and must not weaken the repository's source, evidence, or activation controls.

## Integration contract

Cardiology NP Platform may consume the EKG specialist's governed status, structured outputs, and integration metadata.

It must not treat:

- an engineering PASS as proof of clinical accuracy
- source metadata as adjudicated clinical truth
- an unadmitted evidence candidate as runtime authority
- an inactive release as permission to diagnose
- a newer Git commit as automatically replacing the pinned governed release

A new clinical/runtime authority requires explicit governed admission, validation, and activation.

## Verification snapshot

The accepted terminal EKG release has:

- all 9 final-stage EKG packets complete
- no remaining EKG engineering packets
- no recorded EKG engineering blockers
- independent-machine verification for every final-stage packet
- successful GitHub CI on the accepted terminal commit
- deterministic terminal-completion, recovery, evidence-intake, and release-candidate gates
- preserved fail-closed diagnostic and evidence boundaries

The next meaningful milestone is therefore **clinical evidence admission and validation**, not additional unscoped EKG feature work.
