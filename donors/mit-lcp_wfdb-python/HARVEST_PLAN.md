# DONOR-001 Harvest Plan — MIT-LCP/wfdb-python

## Authority and scope

Target accepted engine remains pinned to `7961425ecd5f5aa09d5e7e8d7bf296e6845e1d82`
(tree `dc9d10b741d486319da01b7ef68e7afc80d6e3c6`). Donor work is additive on
`donor/001-wfdb-python-20260916` and MUST NOT alter the governed inactive clinical state.

Donor pin: `MIT-LCP/wfdb-python@f627b5ff9dcfdb11d4c3150f9c1ebb47cfc3909d`.
Software license: MIT. No donor physiological fixture bytes or remote datasets may be
copied because their redistribution rights are not established by the software license.

## Approved harvest

### H1 — Narrow WFDB header/data-file invariant adapter

- **Donor component:** `wfdb/io/_header.py`, `wfdb/io/_signal.py`, `wfdb/io/record.py`
- **Capability:** stronger field/cohesion validation before decoding.
- **Target subsystem:** `lib/wfdb_signal.js`.
- **Integration method:** **CLEAN REIMPLEMENTATION / ADAPTER CONCEPT**. No donor source
  code copied.
- **Expected improvement:** fail closed when a nominally format-16 header attempts to
  escape the target's single-file, single-segment decoding contract or contains
  ambiguous/unsafe signal identity.
- **Planned target invariants:**
  - record identifier is a bounded simple token; reject multi-segment syntax;
  - each signal data-file reference is a safe basename, not an absolute/traversal path;
  - all signals in this narrow decoder reference one shared `.dat` file;
  - the shared data-file basename matches the record identifier;
  - lead labels are non-empty and unique;
  - unsupported WFDB encodings continue to fail closed rather than being guessed.
- **License status:** compatible; conceptual reimplementation only.
- **Security risk:** low after implementation; intended to reduce source-substitution
  and path-confusion surface.
- **Clinical risk:** low; parsing becomes stricter and remains non-diagnostic.
- **Dependency cost:** none.
- **Compute cost:** negligible.
- **Rollback:** revert the donor implementation commit; accepted engine remains
  separately pinned and untouched.

### H2 — Target-owned WFDB adversarial/golden test corpus

- **Donor component:** `tests/test_record.py`, `tests/target-output/`.
- **Capability:** field-validation, malformed-record, and golden-output testing
  methodology.
- **Target subsystem:** new donor-specific contract tests under `tests/`.
- **Integration method:** **CLEAN REIMPLEMENTATION** using only synthetic target-owned
  headers/data.
- **Expected improvement:** demonstrate that newly enforced support boundaries reject
  unsupported/malicious variants deterministically and that the supported synthetic
  path remains stable.
- **Required cases:**
  - normal supported format-16 case;
  - duplicate lead;
  - unsafe/path-traversal data file;
  - multiple signal data files;
  - record/data-file identity mismatch;
  - multi-segment record syntax;
  - unsupported encoding;
  - lead-order perturbation;
  - truncated/oversized data mismatch;
  - deterministic repeated parse/inspection;
  - fixed golden parse result for a target-owned synthetic header.
- **License status:** no donor fixture bytes copied.
- **Rollback:** remove the test file and test-script entry together with H1.

## Retained outside canonical runtime

### C1 — XQRS / GQRS / peak correction

- **Donor components:** `wfdb/processing/qrs.py`, `wfdb/processing/peaks.py`.
- **Disposition:** **CHALLENGER**.
- **Reason:** useful independent beat-localization algorithms, but no governed gold is
  admitted and the donor algorithms must not become diagnostic truth. They will be
  benchmarked later under target-controlled evaluation contracts, with exact donor
  pin/preprocessing disclosed.
- **Current implementation:** none. No dependency added in this donor pass.

### E1 — Annotation parser and detector comparison metrics

- **Donor components:** `wfdb/io/annotation.py`,
  `wfdb/processing/evaluate.py`.
- **Disposition:** **EVALUATION_ONLY**.
- **Reason:** high value for later source-label/evaluation tooling. External annotations
  remain SOURCE LABELS and MUST NOT be converted into PROJECT GOLD.

### E2 — Wider WFDB/EDF/CSV/MAT support

- **Donor components:** signal-format and conversion modules.
- **Disposition:** **EVALUATION_ONLY / RESEARCH_ONLY** according to `GAP_MATRIX.json`.
- **Reason:** widening supported formats without format-specific provenance,
  calibration, malformed-input and source-identity contracts would weaken the
  current fail-closed boundary.

## Explicit rejects for this donor pass

- Remote HTTP/PhysioNet runtime resolution — **REJECTED** for governed execution.
- Cloud object-store runtime I/O — **REJECTED**.
- Whole-package direct runtime dependency — **REJECTED FOR NOW** because upstream
  dependency ranges are not lockfile-pinned and the target does not need the package
  to obtain H1/H2.
- Bundled physiological sample-data — **LICENSE_REVIEW_REQUIRED**, no import.
- Automatic normalization/resampling as canonical clinical preprocessing —
  **RESEARCH_ONLY** pending cross-donor comparison and provenance rules.

## Acceptance criteria

H1/H2 are retained only if all of the following hold:

1. Existing target tests and every terminal EKG gate remain green.
2. New donor-specific tests prove the supported format-16 path is unchanged for valid
   synthetic inputs.
3. Unsupported/path-confused/multi-file/multi-segment inputs fail closed with stable
   error codes.
4. No new package dependency, dataset, checkpoint, PHI, credential, or remote source is
   introduced.
5. No change occurs to:
   - `diagnostic_runtime = GOVERNED_INACTIVE`
   - `evidence_admission = NOT_ADMITTED`
   - `approved_adjudicated_gold_count = 0`
   - `metrics = NOT_REPORTABLE`
   - `activation = NOT_ELIGIBLE`
   - `clinical_validity = NOT_INFERRED`
6. Before/after evidence demonstrates a real rejection capability that did not exist
   in the baseline, not merely "tests still pass".
7. The resulting donor receipt records exact commits, tests, rejected components,
   limitations, and rollback identity.

## Stop conditions

Stop and do not merge this donor if implementation requires copying uncleared
physiological fixtures, loosening source identity, adding mutable remote resolution,
changing clinical authority, or importing code whose licensing/provenance cannot be
shown from the pinned donor.
