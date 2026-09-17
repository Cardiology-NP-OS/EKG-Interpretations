# BUT PDB

- Canonical dataset ID: `ECG-DATASET-BUT-PDB`
- Canonical source: SOURCE_URL_NOT_CAPTURED_IN_DONOR_002_REGISTER
- Exact version/release: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Access: SOURCE_SPECIFIC_REVIEW_REQUIRED
- License/access terms: LICENSE_REVIEW_REQUIRED
- License verification: NOT_ESTABLISHED_IN_ACCEPTED_PROVENANCE
- Subject count: UNKNOWN_IN_CURRENT_DONOR_AUDIT
- Record count: UNKNOWN_IN_CURRENT_DONOR_AUDIT
- Leads: UNKNOWN_IN_CURRENT_DONOR_AUDIT
- Sample rate: SOURCE_SPECIFIC_REVIEW_REQUIRED
- Duration: UNKNOWN_IN_CURRENT_DONOR_AUDIT
- Annotation type: SOURCE_SPECIFIC_REVIEW_REQUIRED
- Label origin: source annotations/record metadata
- Adjudication/source process: not target adjudication
- Train/validation/test structure: SOURCE_OR_PROJECT_EVALUATION_CONTRACT_REQUIRED
- Patient-level split properties: UNKNOWN
- Leakage risks: source-specific analog low-pass characteristics materially affect pacer detection
- Overlap with other datasets: REQUIRES_SOURCE_LEVEL_IDENTITY_REVIEW
- Current project disposition: SOURCE_DATA_ONLY_LICENSE_REVIEW_REQUIRED

## Suitable evaluation uses
- pacing and morphology failure analysis

## Known limitations
- Identity/details are limited to accepted donor provenance; independent source audit remains required.

## Prohibited interpretations
- Source labels are not project clinical gold.
- Donor benchmark metrics are not target-reportable metrics.

## Authority boundary
- Project gold: **false**
- Source labels are project gold: **false**
- Runtime authority: **false**
- Clinical validity inferred: **false**

## Provenance
- vitaldb/openecg; locator: `donors/vitaldb_openecg/DATASET_BENCHMARK_REGISTER.json`; commit: `843698d5b4621b74145bce405c74e115b6daa6c6`; tree: `886095776a1f79f600a7ad269176ccc0fbd2d37d`

Machine-readable normalized companion: `evaluation/datasets/ECG_DATASET_CATALOG.json`. Governance authority: `ECG_DATASET_REGISTRY.json`.
