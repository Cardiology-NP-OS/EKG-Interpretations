# PhysioNet/CinC Challenge 2021

- Canonical dataset ID: `ECG-DATASET-PHYSIONET-CINC-CHALLENGE-2021`
- Canonical source: https://physionet.org/content/challenge-2021/1.0.3/
- Exact version/release: 1.0.3
- Access: open
- License/access terms: Creative Commons Attribution 4.0 International Public License
- License verification: INDEPENDENTLY_VERIFIED_PHYSIONET_2026-09-17
- Subject count: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Record count: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Leads: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Sample rate: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Duration: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Annotation type: SOURCE_SPECIFIC_REVIEW_REQUIRED
- Label origin: SOURCE_DATASET_LABELS_OR_METADATA_REVIEW_REQUIRED
- Adjudication/source process: NOT_CAPTURED_IN_ACCEPTED_PROVENANCE
- Train/validation/test structure: Donor010 tracked split metadata: train 68823; valid 8603; test 8603
- Patient-level split properties: NOT_INDEPENDENTLY_ESTABLISHED_FROM_MULTI-SOURCE_CHALLENGE_PATHS
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
- bowang-lab/ecg-fm; locator: `splits/meta_split_physionet.csv; README.md`; commit: `9f926f1911bb9f24789b5c6407677d58ad753054`; tree: `8a8fd9ff5152ab119f1ef1b0e349065740bbc691`

Machine-readable normalized companion: `evaluation/datasets/ECG_DATASET_CATALOG.json`. Governance authority: `ECG_DATASET_REGISTRY.json`.

## Independent source verification
- PhysioNet v1.0.3: https://physionet.org/content/challenge-2021/1.0.3/ — DOI `10.13026/34va-7q14`.
