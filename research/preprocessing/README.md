# Preprocessing Research

Brand-neutral preprocessing concepts retained from accepted sources include resampling, filtering, baseline handling, normalization, segmentation/windowing, missing-sample policy, inversion handling, and artifact workflows. No donor implementation is activated by this document.

## Executable target-owned DSP profile

The engine now provides the target-owned `foundation-pretraining-dsp-v1` engineering profile in `lib/signal_dsp_filtering.js`. The profile executes 50 Hz Q30 notch filtering, 0.67–40 Hz fourth-order Butterworth edge filtering, 0.4-second median-baseline subtraction, and matrix-wide z-score normalization. It is integrated into `lib/signal_preprocessing_pipeline.js` and exposed through `tools/preprocess_wfdb.js`.

A reusable operator configuration is committed at `evaluation/protocols/FOUNDATION_PRETRAINING_DSP_CONFIG.json`. The executable contract and provenance boundary are in `evaluation/protocols/FOUNDATION_PRETRAINING_DSP_CONTRACT.json`.

This is a non-diagnostic engineering transform. It does not activate donor models, admit source labels as project gold, or establish clinical validity.
