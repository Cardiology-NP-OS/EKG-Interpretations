# V12.1 Candidate Validation Status

Status: **QUARANTINED / INACTIVE**

## Original uploaded archive

User upload:

`EKG_CHATGPT_PROJECT_V12_1_HARDENED.zip`

SHA-256:

`c8d911ec42dc09ece708f8bafe4956a9f90853129ead04a8851383ebdb845ef5`

Direct audit of the original upload:
- manifest entries expected: **27**
- manifest entries present and hash-matched: **27**
- hash mismatches: **0**
- missing manifest entries: **0**
- archive complete against manifest: **true**
- bundled runtime validator: **PASS**
- active runtime sources: **16**
- runtime: **12.0**
- structured output schema: **3.1**
- criteria snapshot: **2026-09-12**
- source registry: **2.0**

This supersedes the temporary provenance correction that incorrectly identified a generated derivative archive as the original upload.

## Generated derivative distinction

A generated quarantine derivative also exists:

`v12_1_clinical_control_candidate.zip`

SHA-256:

`61aa14599f66df4067b0e3e8671a6860e6d324c97b891e4b18a391a61c89e396`

That derivative is not the user-uploaded source pack and must not be used as the source-pack identity.

## Runtime-source integrity

All 16 active clinical/control runtime-source files match the hashes registered in `IMPORT_MANIFEST.json`.

The machine-readable core currently imported into quarantine contains:
- output schema;
- 59-pattern registry;
- 30-failure-mode registry;
- 21-source registry;
- deterministic calculation engine.

Exact source bytes are preserved with Git `-text` attributes.

## Candidate validation

- engineering CI: **30/30 PASS**
- verified PTB-XL source tests: **5/5 PASS**
- candidate calculation engine: **40/40 PASS**
- candidate registry/schema contracts: **27/27 PASS**
- total quarantined candidate tests: **67/67 PASS**

The candidate remains inactive clinical runtime code. Validator PASS and contract-test PASS do not establish diagnostic accuracy.

## Criteria/source traceability closure

The original package references traceability artifacts that were not included in the uploaded archive:
- `64_SOURCE_TRACEABILITY.py`;
- `59_TRACEABILITY_MATRIX.md`;
- `17_CHANGELOG.md`.

The quarantine now supplies governed validation-side replacements under `validation_generated/`. They do not alter the uploaded source files.

The audit verifies:
- all eight existing criteria sections bind to known machine-registry source keys;
- all 13 DOI references in the original human source map resolve to the machine source registry;
- all pattern-registry source keys resolve;
- the generated matrix is deterministic and current.

Two criteria-bound source keys were present in the machine registry but omitted from the original human-readable source map:
- `aha_ecg_part1_2007`;
- `aha_monitoring_2017`.

They are represented only in a validation-side supplement; the uploaded source map remains byte-identical.

Current quarantined candidate gate: **80/80 PASS**:
- registry/schema contracts: 27;
- calculation engine: 40;
- criteria/source traceability: 13.

No diagnostic-accuracy claim is made and the candidate remains inactive.
