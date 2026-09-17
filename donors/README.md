# Donor Provenance Index

`donors/` contains source-specific audit and provenance packages only. These directories preserve exact upstream identity, inventory, gap decisions, license/data/model boundaries, comparative proof, verification, and acceptance receipts.

They are intentionally **not** the canonical architecture for reusable ECG capabilities. Use `ECG_CAPABILITY_REGISTRY.json`, `lib/`, `evaluation/`, and `research/` to locate target-owned capability homes. Never infer runtime authority, project gold, or clinical validity from a donor package.

The authoritative donor-program frontier remains `ECG_DONOR_REGISTRY.json`.
