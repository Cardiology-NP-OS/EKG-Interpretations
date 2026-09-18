# Photo/PDF implementation review checkpoint

Implementation commit: `b3498b8006be9df57db5cc1b156dbadeefd36a23`.
Implementation tree: `35b59ebd44f21ec68dd79da63c9b159751c0ac75`.
Base accepted main: `18ed847c6888754508106b713d3d14191108ee6a`.
Branch: `candidate/photo-pdf-intake`.

The owner requested a safe stop with 6% usage remaining. Implementation is committed and pushed; preserve this active branch until review and accepted-main verification. Main has not been promoted. No detached agent or local operation remains pending.

Local verification passed: 23 Python image tests; 12 Node image integration/persistence tests; all 62 existing Node test commands; CI evidence-boundary gate (30 assertions); terminal specialist gate (360 assertions); staged whitespace check. Decoder environment: Pillow 12.3.0, pypdfium2 5.13.0/PDFium 153.0.7999.0. Local Node is 24.12.0; CI targets Node 22/Python 3.12 and must be checked at the exact candidate head. These are same-principal engineering checks, not independently attested clinical validation.

Actual CLI demonstrations used generated PNG and PDF pictures. Both preserved original bytes, recovered 1000 samples, detected four beats at 75 bpm, saved analysis, and reopened it in a fresh process. Maximum recovered amplitude error was 0.069809 mV; RMSE 0.011230 mV. These are synthetic fixture results, never clinical performance claims. Local demonstrations and handoff are saved in this task's `outputs/` directory.

Use **Sol XHigh next** for the extraction/measurement numerical and failure review. First inspect live main and this branch, exact commit/tree and candidate Actions results; adopt legitimate concurrent work. Read `docs/IMAGE_INPUT_WORKFLOW.md` and `docs/IMAGE_DECODER_DEPENDENCIES.md`. Reproduce image tests with installed pinned dependencies. Review dark-run geometry/center conversion, explicitly confirmed calibration and polarity, uncertainty gates, timing separation, immutable provenance and storage failure/reopen behavior, resource limits and governance. Hashes detect drift, not actor authenticity. Windows rename/fsync behavior and native PDF decoder limits need careful review; there is no strict OS memory ceiling.

Coverage is deliberately bounded to a single dark trace in each selected non-overlapping ROI. Arbitrary photos, skew/perspective recovery, OCR/automatic lead/calibration identification, the correction UI, real reference-case validation, evidence-backed diagnostic interpretation and durable clinician reports remain unfinished. Do not silently apply synthetic thresholds to submitted clinical ECGs. Encrypted/form PDF rejection is implemented but has no dedicated encrypted/form fixture test yet.

After review fixes and fresh candidate checks, verify exact candidate CI and main ancestry before guarded promotion; verify target-main CI and record acceptance before retiring this branch. Then return to **Sol High** for the next functional implementation. Clinical governance and donor frontier remain unchanged: inactive, gold zero, NOT_REPORTABLE/NOT_ELIGIBLE; donors 13/21, next DONOR-014. Owner-directed photo/PDF functionality remains the priority.

The previously accepted donor-013 remote branch was retired with an exact-head lease after explicit owner approval; it is no longer a cleanup blocker.
