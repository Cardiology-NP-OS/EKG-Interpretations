# Signal Inspection Boundaries

The V13 signal-inspection layer converts verified WFDB bytes into deterministic engineering structures.

## It may report
- source file hashes already verified by the source gate;
- WFDB record metadata;
- sample rate, sample count, and duration;
- lead names, gain, baseline, and units;
- calibrated per-lead minimum, maximum, mean, RMS, and dynamic range;
- bounded deterministic preview samples;
- low-rate/high-rate lead-order and duration consistency.

## It must not report
- rhythm diagnosis;
- ischemia or infarction interpretation;
- conduction diagnosis;
- interval-based clinical conclusions;
- disease probability;
- sensitivity, specificity, PPV, NPV, or diagnostic accuracy;
- any claim that PTB-XL labels are adjudicated project gold.

## Evidence order

1. PTB-XL source bytes must pass the pinned SHA-256 source manifest.
2. WFDB headers and data lengths must pass structural validation.
3. Signal decoding and calibration may then occur.
4. Inspection output remains engineering evidence only.
5. Any later diagnostic layer requires a separate governed evidence tier and independently adjudicated gold data.

The real-source inspection artifact is written under `runtime/` and is intentionally excluded from Git. Its hash may be recorded in external provenance without committing clinical-source derivatives.
