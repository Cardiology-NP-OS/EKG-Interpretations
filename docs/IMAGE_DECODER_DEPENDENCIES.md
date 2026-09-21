# Image decoder dependencies and boundary

The encoded-file decoder is deliberately isolated from case, extraction, analysis, and clinical-authority logic.

`requirements-image.txt` pins **Pillow 12.3.0** and **pypdfium2 5.13.0**. No donor source, model weights, real ECG datasets, credentials, or clinical evidence are imported.

## Decoder role

`lib/image_decoder.py` accepts a regular local PNG, JPEG, or PDF file and writes only:

- `original.bin` — the exact bytes read after file-identity checks;
- one or more normalized `page-NNNN.png` RGB rasters;
- `decoder-result.json` — source/raster hashes, dimensions, decoder versions, limits, and governed-inactive metadata.

`lib/image_decoder_bridge.js` executes the fixed worker script with `shell:false`, a wall-clock timeout, bounded stdout, fixed canonical page filenames, SHA-256 verification, and automatic temporary-directory cleanup. The normalized PNG is then decoded through the repository's existing strict PNG codec and handed to the canonical image-intake path.

The worker does **not** create cases, extractions, analyses, reports, gold evidence, diagnoses, or runtime authority.

## Limits

Current decoder limits are intentionally conservative:

- source bytes: 32 MiB maximum;
- pages: 8 maximum;
- pixels per page: 4,000,000 maximum;
- aggregate pixels: 8,000,000 maximum;
- single dimension: 4,000 pixels maximum;
- normalized PNG artifact: 16 MiB maximum;
- PDF render DPI: 72–300;
- Node worker deadline: 60 seconds.

JPEG/PNG are accepted by file signature, not extension. Animated/multiframe image input fails closed. EXIF orientation is normalized. Alpha is flattened on white. PDF forms and encrypted/security-handler PDFs fail closed. Native decoder failures are returned as bounded `IMAGE_DECODER_*` errors.

## Security boundary

Pillow and PDFium are native/compiled parsing dependencies. The spawned worker is a process boundary with input/page/pixel/time limits, **not** a hardened OS sandbox or memory cgroup. A network-facing deployment still requires process isolation, access control, dependency patching, and distribution review.

Pillow license information: https://pillow.readthedocs.io/en/stable/about/

pypdfium2 licensing information: https://pypdfium2.readthedocs.io/en/stable/readme.html#licensing

pypdfium2 API/lifecycle information: https://pypdfium2.readthedocs.io/en/stable/python_api.html

Preserve the distributed Pillow, pypdfium2, PDFium, and binary dependency license notices when packaging the decoder. Pinning the wrapper versions is not equivalent to a completed commercial distribution review.

## Canonical strict trace extraction and analysis

The canonical library path is `runImageFileIntake` / `runAndPersistImageFileIntake` in `lib/image_file_intake.js`, then `persistImageExtraction`, `runImageSignalAnalysis`, and `persistImageAnalysis` in their existing modules. It does not use the archived parallel Python case/extraction/analysis runtime or its CLI/schema. `npm run test:image-decoder` exercises generated JPEG/PDF pictures through this path, including fresh-process analysis reopening; `npm test` covers the existing intake, analysis and persistence contracts.

Opt in with `strictTraceMaxThicknessPx`, an integer from 1 to the smaller of 100 and ROI height minus two. It requires one contiguous dark run per column, rejects ink touching either vertical ROI boundary, missing columns, separated runs and excessive vertical thickness, and uses the run center (including half-pixel coordinates). Ink is canonical grayscale strictly below `inkCeiling` (default 80), not the archived maximum-RGB-channel inclusive comparison. Dark grids, text, noise, clipping and steep strokes can therefore be explicit failures, not silently repaired. Strict mode defaults to zero held columns and rejects nonzero `maxHeldColumns`. Existing darkest-pixel/two-column-hold behavior is unchanged when the option is absent; that default is not a strict-trace guarantee. Strict mode does not grant image calibration or lead-identity permissions.

Strict quality records preserve ROI coordinates, threshold, configured and observed maximum vertical run thickness, complete coverage, zero held columns, half-run-height amplitude uncertainty (`maxStrokeThicknessPx / 2 / pxPerMv`) and half-horizontal-pixel time uncertainty (`500 / sampleRateHz` ms). These are pixel-geometry bounds only, not statistical confidence intervals or clinical accuracy. They do not quantify calibration, baseline estimation, deformation, decoder or clinical uncertainty; `calibrationUncertaintyQuantified` remains false. Sloping traces can have large vertical runs even when their physical pen stroke is thin. The retained normalized raster, ROI and calibrated samples allow geometry review; this increment does not add a correction UI or render the archived colored overlay.

For strict analysis, provide both positive finite `quality.maxAmplitudeUncertaintyMv` and `quality.maxTimePixelUncertaintyMs`, in addition to the existing hold limits and explicit measurement/phenotype configuration and `thresholdAuthority`. There are no default pixel-acceptance limits. Strict traces without those limits, or legacy traces without strict geometry evidence when limits are requested, cannot be accepted by analysis. Exceeding a limit or inconsistent geometry metadata yields `IMAGE_ANALYSIS_QUALITY_GATE`; failed canonical leads remain in PARTIAL accounting and zero usable canonical leads fails with `IMAGE_ANALYSIS_NO_USABLE_LEADS`. Supplemental panel failures remain separately accounted for, without changing the existing canonical-result status contract. The direct `connectMeasurements` shortcut is deliberately unsupported for strict intake (`INTAKE_STRICT_TRACE_ANALYSIS_REQUIRED`); use the downstream policy-gated analysis instead.

Strict analyses additionally retain a full configuration snapshot and hashes of eight processing modules. These declared execution identities do not authenticate an actor or constitute a complete dependency/binary admission record; retain exact repository commit/tree, decoder environment and acceptance receipts separately. Persistence binds both canonical and supplemental analysis quality back to the exact extraction and rechecks strict quality acceptance before publication/reopening. Historical analyses are not rewritten to current implementation hashes. Hashes detect byte drift, not a privileged writer constructing a new internally consistent artifact.

Paper timing remains canonical: only matching declared row/column time windows form simultaneous groups, with the rhythm strip excluded and its duplicate panel retained as supplemental evidence. Arbitrary per-lead calibration, inverted polarity and the archived blanket denial of all simultaneous groups are not imported. Unsupported calibration/acquisition relationships need separate evidence and explicit contracts, not invented defaults. Original images/PDFs may contain identifying text; preserving or normalizing them is not de-identification. Use a private store with appropriate access, encryption and retention controls before handling real submissions. No generated fixture, gate, saved analysis or branch reconciliation establishes real-image diagnostic validity or clinical authority.
