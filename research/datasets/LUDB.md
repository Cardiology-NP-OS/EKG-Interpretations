# Lobachevsky University ECG Database (LUDB)

- Canonical dataset ID: `ECG-DATASET-LUDB`
- Canonical source: https://physionet.org/content/ludb/1.0.1/
- Exact version/release: 1.0.1
- Access: open
- License/access terms: ODC-By 1.0
- License verification: DONOR_REPORTED_NOT_INDEPENDENTLY_VERIFIED
- Subject count: 200
- Record count: 200
- Leads: 12-lead
- Sample rate: 500
- Duration: 10 seconds per record
- Annotation type: PER_LEAD_WAVE_DELINEATION
- Label origin: expert per-lead wave delineation annotations
- Adjudication/source process: not established as target project adjudication
- Train/validation/test structure: SOURCE_OR_PROJECT_EVALUATION_CONTRACT_REQUIRED
- Patient-level split properties: true
- Leakage risks: record/patient overlap if split discipline is not preserved
- Overlap with other datasets: REQUIRES_SOURCE_LEVEL_IDENTITY_REVIEW
- Current project disposition: DATA_ONLY_LICENSE_REVIEW_REQUIRED_PER_DATASET

## Suitable evaluation uses
- delineation timing and event agreement
- annotation ingestion regression

## Known limitations
- Catalogue metadata is not independent verification of the source dataset.
- No dataset bytes are stored by this normalization checkpoint.

## Prohibited interpretations
- Source labels are not project clinical gold.
- Donor or source benchmark metrics are not target-reportable metrics.
- Dataset availability does not imply runtime or clinical authority.

## Authority boundary
- Project gold: **false**
- Source labels are project gold: **false**
- Runtime authority: **false**
- Clinical validity inferred: **false**

## Provenance
- vlbthambawita/ECGBench; locator: `donors/vlbthambawita_ecgbench/DATASET_BOUNDARY.json`; commit: `31b5050002622a72a8f3558f731929c3e3a6c68e`; tree: `9f52c3f551b443ff660f7b112bca84684f4f1239`
- vitaldb/openecg; locator: `donors/vitaldb_openecg/DATASET_BENCHMARK_REGISTER.json`; commit: `843698d5b4621b74145bce405c74e115b6daa6c6`; tree: `886095776a1f79f600a7ad269176ccc0fbd2d37d`

Machine-readable normalized companion: `evaluation/datasets/ECG_DATASET_CATALOG.json`. Governance authority: `ECG_DATASET_REGISTRY.json`.
