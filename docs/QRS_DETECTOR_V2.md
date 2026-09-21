# QRS detector V2 engineering boundary

## State

`target-owned-adaptive-qrs-energy-v2` is a separate, governed-inactive engineering path. It does not replace or mutate `detectCandidateRPeaks()` V1. It is not clinically validated, does not create project gold, and is not authorized for diagnostic runtime or the locked MIT-BIH V2 evaluation.

The opt-in single-lead path is `lib/qrs_detector_v2.js::detectCandidateRPeaksV2`. The quality-ranked multilead path is `lib/qrs_multilead_v2.js::detectCandidateRPeaksMultiLeadV2`. `lib/signal_measurement_pipeline.js` selects V2 only when `config.detector.algorithm` exactly equals `target-owned-adaptive-qrs-energy-v2`; existing configurations continue to select V1.

## Architecture

1. Validate calibrated finite samples, sample rate, provenance, and configuration.
2. Reuse target-owned zero-phase Butterworth primitives for 5–18 Hz QRS-oriented band-limiting.
3. Apply a five-point slope transform, squaring, and centered moving-window integration.
4. Generate deterministic local transform candidates.
5. Maintain adaptive signal/noise estimates and separate primary/search-back thresholds.
6. Reject slow P/T-like morphology using band-limited width, normalized slope, relative timing, and prior-QRS slope.
7. Reject narrow pacing-spike candidates, associate preceding spikes with QRS complexes, and penalize spikes during raw-waveform fiducial refinement.
8. Enforce a refractory interval with deterministic stronger-QRS replacement.
9. Search back only across implausibly long RR gaps and only for lower-threshold, morphology-qualified candidates.
10. Refine the final R fiducial on the calibrated waveform; transformed-signal locations are never emitted directly as R locations.

Multilead input is not assumed to use channel zero. Leads receive deterministic, label-free engineering quality scores based on robust span, derivative-tail-to-background ratio, and flatline burden. The highest-ranked usable lead is attempted first, with deterministic failover. Single-lead input remains supported. This is lead selection, not a claim of clinically optimal lead arbitration.

## Frozen synthetic-development inputs

- Configuration: `evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json`
- Cohort: `validation/development/QRS_V2_SYNTHETIC_DEV_V1.json`
- Fixtures: `evaluation/fixtures/QRS_V2_SYNTHETIC_REGRESSIONS.json`
- Matcher: `evaluation/protocols/RPEAK_EVENT_MATCHER_V2.json`

The synthetic cohort contains no signal bytes, record identifiers, or labels from `MITBIH-RPEAK-FULL-V1`. It covers low amplitude, P/T confusion, pacing, broad/inverted QRS, rapid rhythm, long RR/search-back, noise, baseline wander, morphology transitions, lead degradation, and lead competition. Synthetic success is necessary regression evidence, not evidence of clinical accuracy or dataset generalization.

## Real-signal development cohort

LUDB 1.0.1 is admitted only for nonclinical detector development by `validation/development/LUDB_QRS_V2_DEV_V1.json`. Its official PhysioNet ODC-By 1.0 terms were independently checked, its 2,805 source files were verified against the version-pinned source SHA-256 inventory, and no data bytes are committed to this repository. The frozen split contains 160 tuning records and a 40-record internal holdout. The holdout is inaccessible to the real-signal development runner until detector configuration and implementation are frozen after tuning-split development.

`evaluation/protocols/LUDB_QRS_V2_DEVELOPMENT_V1.json` fixes the detector, lead-selection, annotation, matching, metric, and governance semantics before tuning metrics are computed. Record `1`, whose annotation encoding was inspected during loader development, is forced into the tuning split and exchanged with record `8` so it cannot contaminate the internal holdout claim.

The first predeclared training-split execution is frozen in `validation/development/results/LUDB_QRS_V2_TRAIN_V1_RECEIPT.json`; continuation details and the discovered annotation-coverage limitation are in `docs/QRS_V2_HANDOFF.md`. Its PPV and F1 did not meet the declared development targets, so the internal holdout and locked evaluation remain closed.

QTDB remains excluded because it contains excerpts from other databases and record-level MIT-BIH overlap has not been resolved. BUT PDB remains blocked because its canonical source and license are unresolved. INCART is reserved for a separately frozen long-duration development extension.

## Evaluation matcher

`matchEventsV2()` uses ordered dynamic programming. It maximizes one-to-one match count within an inclusive tolerance and then minimizes total absolute timing error. Candidate reuse is impossible. Ties and resource limits are explicit. The matcher must not be used to rewrite the historical V1 result; any V1-vs-V2-matcher comparison requires a distinct artifact.

## Verification

Focused verification:

```sh
npm run test:qrs-v2
npm run validate:qrs-v2-development
```

Repository verification:

```sh
npm test
npm run gate:ci
```

## Locked V2 gate

Do not predeclare or run a locked MIT-BIH V2 protocol until a separately approved real-signal development corpus has been frozen and executed, no catastrophic per-record failure remains, all repository CI is green, and the detector configuration and matcher semantics are committed before locked labels/results are observed.
