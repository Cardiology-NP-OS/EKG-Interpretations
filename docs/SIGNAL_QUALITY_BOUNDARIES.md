# Signal Quality / QC Boundaries

The V13 QC layer evaluates waveform **engineering integrity**, not clinical meaning.

## Current deterministic checks

For each lead it may report:
- raw minimum and maximum;
- raw span;
- number of distinct sample values;
- zero-sample fraction;
- longest identical-sample run and fraction;
- signed-int16 ADC rail-hit count;
- exact-flatline flag;
- engineering-usability status.

These checks run only after the source files pass their pinned SHA-256 manifest unless a synthetic test explicitly rebinds a checksum to exercise downstream QC behavior.

## Not claimed

The QC layer does not determine:
- rhythm or arrhythmia;
- ischemia or infarction;
- conduction disease;
- diagnostic image quality in a clinical sense;
- sensitivity, specificity, or diagnostic accuracy;
- whether an ECG is safe for patient-specific clinical decision-making.

A waveform may pass engineering QC and still be clinically uninterpretable for reasons outside the current deterministic checks. Conversely, a flagged lead is an engineering warning, not a diagnosis.

## Evidence order

1. Source integrity verifies exact bytes.
2. WFDB structure validates header/data shape.
3. QC evaluates engineering waveform usability.
4. Signal inspection may generate deterministic engineering summaries.
5. Any diagnostic reasoning layer remains separately governed and inactive until independently validated.
