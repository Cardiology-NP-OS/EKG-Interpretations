# SHDB-AF (Saitama Holter Database â€” Atrial Fibrillation)

- Canonical dataset ID: `ECG-DATASET-SHDB-AF-SAITAMA-HOLTER-DATABASE-ATRIAL-FIBRILLATION`
- Canonical source: https://physionet.org/content/shdb-af/1.0.1/
- Exact version/release: 1.0.1
- Access: open
- License/access terms: ODC-By 1.0
- License verification: DONOR_REPORTED_NOT_INDEPENDENTLY_VERIFIED
- Subject count: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Record count: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Leads: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Sample rate: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Duration: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Annotation type: RHYTHM_EPISODE_ANNOTATIONS
- Label origin: SOURCE_DATASET_LABELS_OR_METADATA_REVIEW_REQUIRED
- Adjudication/source process: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Train/validation/test structure: SOURCE_OR_PROJECT_EVALUATION_CONTRACT_REQUIRED
- Patient-level split properties: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Leakage risks: PATIENT_OR_RECORD_OVERLAP_MUST_BE_ASSESSED_BEFORE_EVALUATION
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

Machine-readable normalized companion: `evaluation/datasets/ECG_DATASET_CATALOG.json`. Governance authority: `ECG_DATASET_REGISTRY.json`.
