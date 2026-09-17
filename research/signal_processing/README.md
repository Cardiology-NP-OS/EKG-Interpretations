# Signal Processing Research

Brand-neutral signal-processing concepts include event detection, fiducial delineation, beat/rhythm representations, annotation ingestion, averaging, RR/heart-rate utilities, and format interoperability. Challenger algorithms remain non-authoritative unless separately implemented and admitted.

## Executable measurement checkpoint

The target now includes a brand-neutral, evaluation-only waveform measurement baseline in lib/signal_measurement_contract.js. It can decode calibrated WFDB lead samples, emit explicitly configured unvalidated R-peak candidates, and calculate RR/rate plus PR/QRS/QT/QTc from explicit fiducials. Synthetic verification does not establish clinical validity, project gold, evidence admission, diagnostic runtime authority, or activation.

## Candidate fiducial delineation baseline

The target-owned evaluation baseline in lib/signal_delineation_contract.js uses explicit provenance, thresholds, and search windows to produce unvalidated P/QRS/T candidate fiducials from calibrated waveforms and R-peak candidates. It is synthetic-tested, may feed measurement evaluation, does not diagnose rhythms or morphology, and does not establish clinical validity or runtime authority.

## Executable rhythm-feature workflow

The target-owned evaluation workflow in `lib/signal_intelligence_workflow.js` composes accepted waveform measurement with deterministic RR/interval/coverage/amplitude features and explicit-threshold candidate phenotypes. Candidate states are descriptive engineering outputs only; insufficient data abstains, and no candidate state is a diagnosis or clinical runtime authority.
