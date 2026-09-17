# Dataset identity and source-asset compatibility

`evaluation/datasets/ECG_DATASET_CATALOG.json` is the normalized evaluation view. Entries that identify an original ECG dataset use `ECG-DATASET-*` IDs and the original dataset identity, independent of which donor exposed it.

Six legacy global-registry entries describe unresolved bundled/derived assets or a catalogue aggregate rather than an original dataset. Their normalized entries use brand-neutral `ECG-ASSET-BUNDLE-*` or `ECG-SOURCE-CATALOG-*` IDs plus an explicit `identityClass`. Donor names remain only in provenance locators and compatibility mappings.

These compatibility entries are not admitted datasets, do not contain data bytes, do not create project gold, and require source/license resolution before evaluation use.
