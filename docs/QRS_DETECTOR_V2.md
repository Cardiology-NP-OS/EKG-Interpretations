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

## External development-data blocker

The repository registers potentially useful non-MIT sources such as LUDB 1.0.1, QTDB 1.0.0, St Petersburg INCART 1.0.0, and BUT PDB. Current repository authority still marks their use as requiring license, provenance, split, overlap, and annotation-scope review. They were not downloaded, scored, or used for tuning in this implementation session.

Before any real-signal development run, commit a versioned manifest containing exact file hashes, record/patient inclusion and exclusion rules, split identity, lead-selection rules, annotation source/scope, license determination, and an explicit exclusion of all 48 locked MIT-BIH V1 records.

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
