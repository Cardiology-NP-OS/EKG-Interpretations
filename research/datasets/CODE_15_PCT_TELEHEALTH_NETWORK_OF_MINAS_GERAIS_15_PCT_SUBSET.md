# CODE-15% (Telehealth Network of Minas Gerais, 15% subset)

- Canonical dataset ID: `ECG-DATASET-CODE-15-PCT-TELEHEALTH-NETWORK-OF-MINAS-GERAIS-15-PCT-SUBSET`
- Canonical source: https://doi.org/10.5281/zenodo.4916206
- Exact version/release: 1.0.0
- Access: open
- License/access terms: CC BY 4.0
- License verification: SOURCE_METADATA_INDEPENDENTLY_VERIFIED_2026-09-17_LICENSE_VALUE_NOT_EXPOSED_BY_RETRIEVED_ZENODO_PAGE
- Subject count: 233770 patients
- Record count: 345779 exams
- Leads: 12 leads: DI, DII, DIII, AVR, AVL, AVF, V1-V6
- Sample rate: 400
- Duration: source traces may be 7 or 10 seconds; stored as 4096 samples with zero padding as described by source
- Annotation type: SOURCE_SPECIFIC_REVIEW_REQUIRED
- Label origin: SOURCE_DATASET_LABELS_OR_METADATA_REVIEW_REQUIRED
- Adjudication/source process: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Train/validation/test structure: SOURCE_OR_PROJECT_EVALUATION_CONTRACT_REQUIRED
- Patient-level split properties: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Leakage risks: PATIENT_OR_RECORD_OVERLAP_MUST_BE_ASSESSED_BEFORE_EVALUATION
- Overlap with other datasets: REQUIRES_SOURCE_LEVEL_IDENTITY_REVIEW
- Current project disposition: DATA_ONLY_LICENSE_REVIEW_REQUIRED_PER_DATASET

## Suitable evaluation uses
- dataset identity/provenance validation
- split/leakage evaluation when identifiers permit

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
- bowang-lab/ecg-fm; locator: `data/code_15/; notebooks/infer_quickstart.ipynb`; commit: `9f926f1911bb9f24789b5c6407677d58ad753054`; tree: `8a8fd9ff5152ab119f1ef1b0e349065740bbc691`

Machine-readable normalized companion: `evaluation/datasets/ECG_DATASET_CATALOG.json`. Governance authority: `ECG_DATASET_REGISTRY.json`.

## Independent source verification
- Zenodo v1.0.0: https://zenodo.org/records/4916206 — DOI `10.5281/zenodo.4916206`; exact license still requires review.
