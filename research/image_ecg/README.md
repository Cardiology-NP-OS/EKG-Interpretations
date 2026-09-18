# Image ECG Research

Canonical image-ECG research families are waveform/paper rendering, grid/calibration simulation, scan degradation, ROI localization, grid estimation, and image-to-signal digitization. Donor assets, fonts, textures, checkpoints, and generated samples are not imported by normalization.

Target-owned executable engineering for synthetic paper rasters now lives in:

- `lib/paper_ecg_raster.js`
- `lib/image_roi_localization.js`
- `lib/image_roi_discovery.js`
- `lib/image_grid_calibration.js`
- `lib/image_digitization.js`
- `lib/image_intake_pipeline.js`
- `lib/image_case_store.js`

Photo/JPEG/PNG/PDF bytes are not decoded in-process. Encoded files fail closed until an explicit grayscale raster matrix is supplied. This is not a clinical digitizer and does not admit project gold, diagnostic runtime, or published digitization accuracy.
