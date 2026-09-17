# Lydus hospital rhythm dataset

- Canonical dataset ID: `ECG-DATASET-LYDUS-HOSPITAL-RHYTHM-DATASET`
- Canonical source: SOURCE_URL_NOT_CAPTURED_IN_DONOR_002_REGISTER
- Exact version/release: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Access: SOURCE_SPECIFIC_REVIEW_REQUIRED
- License/access terms: LICENSE_REVIEW_REQUIRED
- License verification: NOT_ESTABLISHED_IN_ACCEPTED_PROVENANCE
- Subject count: NOT_PUBLICLY_ESTABLISHED_IN_CURRENT_AUDIT
- Record count: donor AF rule documentation references 167K-window source and a 293-window curated evaluation subset
- Leads: single-lead/windowed ECG in donor paths
- Sample rate: SOURCE_SPECIFIC_REVIEW_REQUIRED
- Duration: short windows, commonly about 10 seconds in donor pipeline
- Annotation type: SOURCE_SPECIFIC_REVIEW_REQUIRED
- Label origin: donor-described cardiologist/hospital rhythm labels
- Adjudication/source process: not target project adjudication
- Train/validation/test structure: SOURCE_OR_PROJECT_EVALUATION_CONTRACT_REQUIRED
- Patient-level split properties: must be independently verified
- Leakage risks: large window count can conceal patient-level leakage if patient identifiers are not held out
- Overlap with other datasets: REQUIRES_SOURCE_LEVEL_IDENTITY_REVIEW
- Current project disposition: RESEARCH_ONLY_PROVENANCE_AND_LICENSE_REVIEW_REQUIRED

## Suitable evaluation uses
- hospital rhythm head
- AF rule tuning/validation

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
