# MIMIC-IV-ECG

- Canonical dataset ID: `ECG-DATASET-MIMIC-IV-ECG`
- Canonical source: https://physionet.org/content/mimic-iv-ecg/1.0/
- Exact version/release: 1.0
- Access: open
- License/access terms: Open Data Commons Open Database License v1.0
- License verification: INDEPENDENTLY_VERIFIED_PHYSIONET_2026-09-17
- Subject count: approximately 160000 unique subjects
- Record count: approximately 800000 ECGs
- Leads: 12 leads: I, II, III, aVR, aVL, aVF, V1-V6
- Sample rate: 500
- Duration: 10 seconds
- Annotation type: DIAGNOSTIC_ECG_WAVEFORMS_WITH_OPTIONAL_LINK_TO_CARDIOLOGIST_REPORT
- Label origin: SOURCE_DATASET_METADATA_AND_OPTIONAL_LINKED_REPORTS_NOT_PROJECT_GOLD
- Adjudication/source process: Source documentation states cardiologist report link is provided when available; no project adjudication inferred
- Train/validation/test structure: Donor010 tracked split metadata: train 630178; valid 79129; test 78370
- Patient-level split properties: Donor010 local aggregate audit: 160821 parsed patient groups; 0 patients spanning multiple splits
- Leakage risks: Donor010 split metadata passed patient-group non-overlap audit; linked clinical/report data remain separately governed
- Overlap with other datasets: Derived from/matched to MIMIC-IV clinical database; cross-dataset identity review still required
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
- bowang-lab/ecg-fm; locator: `splits/meta_split_mimic_iv_ecg.csv; README.md`; commit: `9f926f1911bb9f24789b5c6407677d58ad753054`; tree: `8a8fd9ff5152ab119f1ef1b0e349065740bbc691`

Machine-readable normalized companion: `evaluation/datasets/ECG_DATASET_CATALOG.json`. Governance authority: `ECG_DATASET_REGISTRY.json`.

## Independent source verification
- PhysioNet v1.0: https://physionet.org/content/mimic-iv-ecg/1.0/ — DOI `10.13026/4nqg-sb35`.
