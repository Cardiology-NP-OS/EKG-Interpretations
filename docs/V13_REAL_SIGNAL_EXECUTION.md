# V13 Real-Signal Execution

V13 begins from the recovered V12 semantic baseline and uses independently verifiable PTB-XL bytes for ingestion/integrity work.

## Current smoke scope
Record `00001` only:
- 100 Hz pair: `00001_lr.hea` + `00001_lr.dat`
- 500 Hz pair: `00001_hr.hea` + `00001_hr.dat`
- source row database: `ptbxl_database.csv`

All five files must match the SHA-256 values in the upstream PTB-XL v1.0.3 checksum manifest.

## Allowed claims
- exact source-byte integrity
- WFDB header shape and lead-count consistency
- paired low/high-rate record identity
- deterministic blinded derivative generation

## Disallowed claims
- clinical diagnostic accuracy
- sensitivity/specificity or model performance
- treating native PTB-XL annotations as adjudicated project gold
- equivalence to the unavailable V12 Git tree

The release gate fails closed if these boundaries or source-integrity checks fail.
