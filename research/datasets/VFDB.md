# MIT-BIH Malignant Ventricular Ectopy Database (VFDB)

- Canonical dataset ID: `ECG-DATASET-VFDB`
- Canonical source: SOURCE_URL_NOT_CAPTURED_IN_DONOR_002_REGISTER
- Exact version/release: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Access: SOURCE_SPECIFIC_REVIEW_REQUIRED
- License/access terms: LICENSE_REVIEW_REQUIRED
- License verification: NOT_ESTABLISHED_IN_ACCEPTED_PROVENANCE
- Subject count: UNKNOWN_IN_CURRENT_DONOR_AUDIT
- Record count: donor split enumerates 22 record IDs
- Leads: ambulatory ECG
- Sample rate: SOURCE_SPECIFIC_REVIEW_REQUIRED
- Duration: long-duration recordings
- Annotation type: RHYTHM_ANNOTATIONS
- Label origin: rhythm annotations
- Adjudication/source process: source benchmark labels only
- Train/validation/test structure: SOURCE_OR_PROJECT_EVALUATION_CONTRACT_REQUIRED
- Patient-level split properties: record-level lists are explicitly defined by donor
- Leakage risks: window-level random split is unsafe
- Overlap with other datasets: REQUIRES_SOURCE_LEVEL_IDENTITY_REVIEW
- Current project disposition: SOURCE_DATA_ONLY_LICENSE_REVIEW_REQUIRED

## Suitable evaluation uses
- ventricular rhythm supervision/evaluation

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
