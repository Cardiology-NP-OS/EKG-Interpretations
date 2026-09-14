# V12.1 Candidate Validation Status

Status: **QUARANTINED / INACTIVE**

## Archive provenance

Actual uploaded archive SHA-256:

`61aa14599f66df4067b0e3e8671a6860e6d324c97b891e4b18a391a61c89e396`

The archive manifest lists 27 expected files. Of those:
- 21 are present and match their manifest SHA-256 values;
- 0 present files have hash mismatches;
- 6 expected files are absent.

Because the bundled validator requires one of the absent files, the validator is currently blocked/fail-closed. This supersedes the earlier provisional archive SHA/validator-pass claim.

## Runtime-source integrity

All 16 active clinical/control runtime-source files present in the archive match the hashes registered in `IMPORT_MANIFEST.json`.

This establishes byte identity only. It does not establish clinical correctness or activation authority.

## Calculation engine

`25_CALCULATION_ENGINE.py` was imported byte-for-byte into the quarantine.

SHA-256:

`872d7df0df0a6d50604583fe6ff8f6fdce0d50e14da4669f408f8a4c9235d82d`

Permanent deterministic suite:

`tests/test_calculation_engine.py`

Current result: **40/40 PASS**.

The calculation engine remains inactive clinical runtime code.
