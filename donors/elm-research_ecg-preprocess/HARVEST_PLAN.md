# DONOR-008 Harvest Plan — ELM-Research/ECG-Preprocess

## Approved scope

Harvest only the engineering concepts that improve canonical preprocessing provenance without importing donor runtime authority:

1. Add a target-owned `signal_preprocessing_contract` for deterministic 12-lead identity/order validation and reorder-index derivation.
2. Record source and target sampling rates, whether resampling is required, and a declared resampling method. The contract does not perform interpolation and does not endorse the donor's cubic interpolation choice.
3. Record fixed segment length in samples and derive segment duration from the target sampling rate.
4. Fail closed for unknown, duplicate, or missing required lead identities; non-finite or impossible sampling rates; impossible segment lengths; and undeclared resampling methods when a rate change is requested.
5. Require auditable attempted/processed/skipped preprocessing accounting with categorized failure reasons; reject silent or aggregate-only exception handling.
6. Require exact implementation provenance (source, locator, commit, tree) for execution-accounting records.
7. Add synthetic/adversarial tests only. No patient payloads, source dataset rows, donor labels, donor model outputs, or donor binary artifacts are test fixtures.
8. Preserve donor/upstream commit/tree and licensing provenance in donor artifacts and global ledgers.

## Explicitly excluded

- No Python dependency stack or runtime dependency on ECG-Preprocess.
- No copied donor source implementation.
- No waveform/report/dataset payloads.
- No ECG-QA vendored data.
- No TranslateGemma checkpoint, translation output, or runtime model dependency.
- No ECG Byte tokenizer pickle files.
- No claim that cubic interpolation, 250 Hz, 2500 samples, or the donor's `PTB_ORDER` is a universally correct clinical standard.
- No project clinical gold, diagnostic metric, clinical-validity claim, runtime activation, or authority transfer.

## Capability disposition

| Donor capability | Final planned disposition | Canonical target home |
|---|---|---|
| WFDB loading | SUPERSEDED | `lib/wfdb_signal.js` |
| Lead-order mapping concept | INTEGRATED | `lib/signal_preprocessing_contract.js` |
| Sampling-rate normalization concept | INTEGRATED as metadata/validation contract | `lib/signal_preprocessing_contract.js` |
| Fixed-sample segmentation provenance | INTEGRATED as metadata/validation contract | `lib/signal_preprocessing_contract.js` |
| Auditable failure accounting | INTEGRATED | `lib/signal_preprocessing_contract.js` |
| Base dataset adapters | DATA_ONLY | donor audit + dataset registry boundary |
| Research QA/text mapping | RESEARCH_ONLY | donor audit/research provenance |
| PTB-XL TranslateGemma translation | LICENSE_REVIEW_REQUIRED | no target runtime home |
| ECG Byte BPE algorithm | CHALLENGER | research-only donor provenance |
| Trained tokenizer pickles | LICENSE_REVIEW_REQUIRED | no target import |
| HF upload/publishing utilities | REJECTED | none |
| Generated cache/pyc files | REJECTED | none |

## Acceptance proof required

- Focused preprocessing-contract tests pass.
- Existing full regression passes.
- Donor closure test proves upstream pin, license/data/model boundaries, no copied donor assets, and governed inactive clinical state.
- Candidate commit/tree frozen and exact-SHA CI green.
- Before/after comparison records only engineering capability gain; metrics remain `NOT_REPORTABLE`.
- Fresh-clone verification when available.
- Parent/ancestry-guarded promotion and exact target-main CI green before donor acceptance.
