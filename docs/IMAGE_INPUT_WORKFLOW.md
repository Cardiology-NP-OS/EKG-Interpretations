# Local photo/PDF operator

This is executable engineering functionality for PNG, JPEG and PDF pictures, with manually selected, calibrated lead regions. It preserves input bytes, produces normalized page images, extracts bounded traces, runs existing candidate measurements and rhythm features, and persists an immutable analysis that reopens in a fresh process. It is a CLI increment; automatic arbitrary-photo digitization, a correction UI, validated diagnostic interpretation and clinician reports remain unfinished.

## Setup

Use Python 3.12 and Node 22. Install `python -m pip install -r requirements-image.txt`. Select the Python interpreter with `--python` in the Node operator or `EKG_IMAGE_PYTHON`. Dependency versions and source implementation hashes are recorded in the artifacts. See [decoder dependencies](IMAGE_DECODER_DEPENDENCIES.md) for upstream notices and limits.

## Intake and region selection

```
python tools/image_ecg.py ingest --store runtime/image-cases --input /path/to/ecg.pdf --dpi 200
python tools/image_ecg.py list --store runtime/image-cases
python tools/image_ecg.py show --store runtime/image-cases --case-id case-<hash>
```

JSON output supplies the content-addressed case ID and page dimensions. A case contains `original.bin` (exact original bytes), `manifest.json` and `page-0001.png` etc. Coordinates always refer to these normalized RGB PNGs, after EXIF/PDF rotation. PDF rasterization DPI is explicit and does not establish ECG paper speed or gain. Originals and visible ECG images may contain identifying text; normalization is not de-identification. Use a private operator-owned store; access control, encryption and retention policies are deployment work.

Create a JSON plan with exact fields. The following values describe the synthetic test picture only; they must be measured and confirmed for each submitted ECG, never copied as defaults:

```json
{"schema":"ekg-image-extraction-plan-v1","leads":[{"leadName":"II","pageIndex":0,"roi":{"x":10,"y":10,"width":1000,"height":260},"startTimeSeconds":0,"calibration":{"confirmed":true,"pixelsPerSecond":250,"pixelsPerMv":80,"baselineYPx":130,"positiveUp":true},"trace":{"maxChannelValue":120,"maxThicknessPx":60}}]}
```

ROI x/y are page coordinates; baselineYPx is relative to the top of the ROI. `pixelsPerSecond` is horizontal distance per second, `pixelsPerMv` is vertical distance per mV. For confirmed paper speed s mm/s and gain g mm/mV with measured horizontal/vertical scales h/v pixels/mm, use h*s pixels/s and v*g pixels/mV. These are operator inputs, not automatically inferred facts. `positiveUp` defines polarity. Each lead retains its own start time; unknown cross-lead acquisition relationships must not be inferred from the page layout.

The extractor accepts 1–12 unique canonical lead names and non-overlapping regions. Each pixel column must contain exactly one contiguous dark run whose maximum RGB channel is at or below `maxChannelValue`. Missing columns, separate dark runs, clipped traces, excessive run thickness and missing/unconfirmed calibration fail. Text, black gridlines, shadows and skew can therefore cause explicit rejection. There is no interpolation, perspective correction, automatic lead identification or automatic calibration. Width is sample count; samples per second equal pixels per second. Recalibration or region correction creates a new immutable extraction instead of overwriting the old one.

```
python tools/image_ecg.py extract --store runtime/image-cases --case-id case-<hash> --plan /path/to/plan.json
python tools/image_ecg.py show-extraction --store runtime/image-cases --case-id case-<hash> --extraction-id extract-<hash>
```

Inspect the saved overlay before using the recovered measurements. Blue marks the ROI; red shows the recovered center path. The extraction carries page coordinates, per-lead timing, calibration, coverage and uncertainty. Amplitude uncertainty is conservatively half the largest vertical dark-run extent divided by pixels/mV; steep slopes can make it large. Time pixel uncertainty is half a horizontal pixel duration. These bounds do not quantify calibration, skew, paper deformation, decoder or clinical uncertainty.

## Connected measurement and reopening

Supply an explicit configuration with exactly `measurement`, `phenotypes`, `thresholdAuthority`, `maxAmplitudeUncertaintyMv`, and `maxTimePixelUncertaintyMs`. Measurement and phenotype configurations use the existing signal pipeline contracts. Quality limits are caller-selected acceptance bounds; exceeding either excludes the lead. No usable leads fails; some excluded leads produce an explicit PARTIAL result. The repository's synthetic configuration is for engineering tests only and is not a clinically validated set of thresholds.

```
node tools/analyze_image_case.js --store runtime/image-cases --case-id case-<hash> --extraction-id extract-<hash> --config /path/to/config.json --python python
python tools/image_ecg.py show-analysis --store runtime/image-cases --case-id case-<hash> --analysis-id analysis-<hash>
```

The analysis connects each accepted trace to candidate fiducials, intervals, amplitudes, rhythm features and configured descriptive phenotype candidates. It records exact extraction bytes/hash, source hash, full configuration, implementation hashes and per-lead quality. All leads are analyzed independently; even twelve accepted leads do not imply simultaneous acquisition or completed twelve-lead clinical interpretation. It includes no diagnosis. Governance stays inactive, gold=false and metrics NOT_REPORTABLE.

The Python `save-analysis` subcommand accepts the Node-produced analysis through bounded stdin; it is a local persistence boundary, not an authenticated clinical authority or a validator of measurement correctness. Content hashes detect drift; they do not authenticate an actor or prevent an actor with write access from constructing a new consistent case. The worker rechecks case/extraction bytes and overlays when saving and reopening.

## Persistence and limits

Files are flushed and fsynced, then a flat staging directory is atomically renamed into place. Duplicate intake/extraction/analysis is idempotent for identical bytes, policy, dependencies and implementation. Abandoned dot-staging directories are ignored; invalid published cases are reported CORRUPT rather than substituted. Originals, normalized PNGs, manifests, extraction JSON, overlays and saved analyses are hash-checked on reopen. Windows directory fsync is unavailable here; power-loss durability depends on the filesystem/hardware. This is not a multi-user database or a hostile shared-filesystem security boundary.

Default intake limits: 32 MiB input, 8 PDF pages, 24 million pixels/page, 48 million pixels total, dimension <=10000, PDF DPI 72–600 (default 200). Extraction regions total <=12 million pixels. JSON artifact limits and a 60-second spawned-worker deadline bound operations. Limits do not constitute an OS memory sandbox for native PDF decoding; no strict address-space cap or isolated service deployment is provided. Encrypted/form PDFs, animations and other image formats are unsupported.

## Engineering verification

```
python tests/image_case_pipeline_test.py
npm run test:images
npm test
npm run gate:ci
python tools/ep5_pkt09_terminal_specialist_completion_gate.py
git diff --check
```

Image CI installs the pinned decoders and exercises PNG/JPEG orientation, transparency, PDF pages and trace recovery, budgets, original preservation, fresh-process reopening, interrupted publication, substitution, calibration/region rejection, uncertain traces, connected measurements and saved-analysis corruption. All image fixtures are generated synthetic data. No real-image diagnostic accuracy, reference-case validation or clinical readiness is established.
