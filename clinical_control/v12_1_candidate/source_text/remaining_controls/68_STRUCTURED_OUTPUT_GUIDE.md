# Structured Output Guide — Schema v3

`07_OUTPUT_SCHEMA.json` is the canonical machine-readable analysis contract.

## Why structured output exists
The structured record separates:
- source/acquisition state;
- measurements and provenance;
- rhythm mechanics;
- lead-level observations;
- ST-T/ischemia assessment;
- pattern synthesis;
- contradictions;
- limitations;
- manual verification.

This makes safety checks and regression testing possible without pretending a language model is a deterministic diagnostic device.

## Required metadata
Structured outputs identify:
- project version: `12.0`;
- criteria snapshot: `2026-09-12`;
- source registry version: `2.0`;
- analysis mode.

## Measurement rule
Every measurement includes:
- name;
- value or null;
- unit;
- source (`user`, `machine`, `estimated`, `calculated`, `unavailable`);
- confidence;
- formula/inputs where relevant.

No source value may silently become a model measurement.

## Lead-observation rule
Lead-level observations include a source (`visual`, `user`, `machine`, `calculated`, `mixed`) and confidence. If lead labels are not visible, visual observations cannot be assigned to named leads unless the identity is established by another reliable source.

## Pattern IDs
Use `pattern_id` when a finding maps cleanly to `23_PATTERN_REGISTRY.json`. Use `unclassified` for the primary pattern if a safe canonical mapping does not exist. Do not invent new IDs inside output records.

## Ischemia separation
Always represent separately:
- ischemia concern;
- acute-occlusion-pattern concern;
- conventional ST-elevation threshold status.

`not_assessable` is a first-class state and should be preferred over an unsupported negative.

## Quality degradation
`LIMITED`, `POOR`, and `CANNOT_INTERPRET` must produce explicit limitations. `CANNOT_INTERPRET` blocks model-derived exact measurements and high-confidence final pattern labels.

## Validation
Run a structured output through:

```bash
python 40_EVALUATION_ENGINE.py analysis.json
```

The evaluator checks structure and safety invariants; it does not establish clinical correctness.
