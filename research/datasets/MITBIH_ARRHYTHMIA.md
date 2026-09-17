# MIT-BIH Arrhythmia Database

- Canonical dataset ID: `ECG-DATASET-MITBIH-ARRHYTHMIA`
- Canonical source: https://physionet.org/content/mitdb/1.0.0/
- Exact version/release: 1.0.0
- Access: open
- License/access terms: ODC-By 1.0
- License verification: DONOR_REPORTED_NOT_INDEPENDENTLY_VERIFIED
- Subject count: 47
- Record count: 48
- Leads: two-channel ambulatory ECG
- Sample rate: 360
- Duration: approximately 30 minutes per record
- Annotation type: BEAT_AND_RHYTHM_ANNOTATIONS
- Label origin: expert beat/rhythm annotations
- Adjudication/source process: source benchmark labels only
- Train/validation/test structure: SOURCE_OR_PROJECT_EVALUATION_CONTRACT_REQUIRED
- Patient-level split properties: true
- Leakage risks: record-level split must preserve DS1/DS2 separation
- Overlap with other datasets: REQUIRES_SOURCE_LEVEL_IDENTITY_REVIEW
- Current project disposition: DATA_ONLY_LICENSE_REVIEW_REQUIRED_PER_DATASET

## Suitable evaluation uses
- record/patient-held-out rhythm evaluation
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
