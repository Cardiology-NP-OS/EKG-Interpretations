# Image ECG Research

Canonical image-ECG research families are waveform/paper rendering, bounded source decoding, grid/calibration simulation, scan degradation, ROI localization, grid estimation, image-to-signal digitization, immutable extraction, and governed analysis. Donor assets, fonts, textures, checkpoints, and generated samples are not imported by normalization.

Target-owned executable engineering now lives in:

- `lib/image_decoder.py`
- `lib/image_decoder_bridge.js`
- `lib/image_file_intake.js`
- `lib/image_png_codec.js`
- `lib/paper_ecg_raster.js`
- `lib/image_roi_localization.js`
- `lib/image_roi_discovery.js`
- `lib/image_grid_calibration.js`
- `lib/image_digitization.js`
- `lib/image_intake_pipeline.js`
- `lib/image_case_store.js`
- `lib/image_extraction_store.js`
- `lib/image_signal_analysis.js`
- `lib/image_analysis_store.js`

## Encoded source boundary

PNG, JPEG, and PDF source files have a bounded engineering decoder path.

PNG has both the repository's strict stdlib subset decoder and the isolated native decoder path. JPEG and PDF use the isolated Python worker pinned by `requirements-image.txt` to Pillow and pypdfium2/PDFium. The worker preserves the exact original bytes, normalizes decoded pages to RGB PNG, applies EXIF orientation, flattens alpha over white, and emits source/raster hashes plus decoder identity.

The decoder rejects unsupported/corrupt input, animated image input, encrypted/security-handler PDFs, PDF forms, excessive page count, excessive dimensions/pixels, unsupported DPI, non-regular source files, source substitution, non-empty output targets, and artifact budget violations. The Node bridge independently verifies the worker manifest, canonical page paths, decoder limits, aggregate decoded pixels, exact source bytes, normalized raster hashes, and raster geometry before handing a page to canonical intake.

Multi-page PDFs are page-addressed. Case identity includes the source hash and selected page index, and durable case persistence retains the full original encoded source plus the selected normalized page.

## Authority and evidence boundary

Every external file still requires a bound input-quality preflight. External named-lead measurement/analysis requires explicit ROI-to-lead identity verification. Preflight permissions are content-addressed into extraction generations and enforced during later analysis.

The native worker is a bounded process boundary, **not a hardened OS sandbox or memory cgroup**. Current evidence uses synthetic/generated fixtures and adversarial engineering tests. Real clinical-image digitization performance, clinical validity, evidence admission, project gold, diagnostic runtime, and reportable metrics remain unestablished/inactive.

This is not a clinically validated ECG digitizer.
