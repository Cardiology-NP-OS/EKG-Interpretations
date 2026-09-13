# Recovery Provenance

## Why this repository exists
The original EKG INTERPRETATIONS V12 sandbox/Git working tree was no longer available when work resumed on Machine B. Machine A is intentionally untouched because another agent is using it.

## Known original V12 release reference
The prior release record reported:
- commit: `b41f5705532d19bc738f59600bd0234b5414422d`
- tag: `v12-endpoint-evidence-claim-integrity`
- deterministic tests: 533 passed
- packaged files: 394
- release gate: PASS

Those values are **historical reference metadata only**. The original commit object was not found on Machine B and is not claimed to have been restored.

## Recovery policy
This repository starts a new Git history. It preserves the known V12 behavioral/evidence contract, imports only independently verifiable surviving runtime artifacts, and records any reconstructed component explicitly.

No commit in this recovered repository may claim byte-for-byte identity with the lost V12 tree.
