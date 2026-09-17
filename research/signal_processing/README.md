# Signal Processing Research

Brand-neutral signal-processing concepts include event detection, fiducial delineation, beat/rhythm representations, annotation ingestion, averaging, RR/heart-rate utilities, and format interoperability. Challenger algorithms remain non-authoritative unless separately implemented and admitted.

## Executable measurement checkpoint

The target now includes a brand-neutral, evaluation-only waveform measurement baseline in lib/signal_measurement_contract.js. It can decode calibrated WFDB lead samples, emit explicitly configured unvalidated R-peak candidates, and calculate RR/rate plus PR/QRS/QT/QTc from explicit fiducials. Synthetic verification does not establish clinical validity, project gold, evidence admission, diagnostic runtime authority, or activation.
