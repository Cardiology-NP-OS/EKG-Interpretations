# EKG Research

**Authority boundary:** everything under `research/` is NONRUNTIME_AUTHORITY. It is research context, provenance synthesis, negative findings, model/dataset cards, and unresolved questions.

Nothing in this tree constitutes project clinical gold, evidence admission, diagnostic validation, runtime authority, activation, or independently established clinical validity. The governing assertions are always:

- `project_gold = false`
- `source_labels_are_project_gold = false`
- `runtime_authority = false`
- `clinical_validity_inferred = false`

## Evidence model

Research assertions use **source -> locator -> assertion -> evidence**. A source identifies an exact repository/dataset/document revision; a locator identifies the exact file, section, capability, or dataset record; an assertion states only what that source supports; evidence binds the assertion to hashes, receipts, tests, or other exact artifacts. Conflicts are preserved rather than silently reconciled, and later evidence may supersede an assertion only with an explicit supersession reference.

The machine-readable assertion contract is `research/RESEARCH_ASSERTION_SCHEMA.json`; current normalized assertions are in `research/RESEARCH_ASSERTION_REGISTRY.json`. Donor directories remain the immutable provenance packages.
