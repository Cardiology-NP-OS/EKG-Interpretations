# Image Quality & Measurement Reliability Protocol

## 1. Classify the source
- original digital ECG/PDF;
- scanned paper ECG;
- phone photo;
- screenshot;
- monitor capture;
- cropped lead strip.

Original digital sources are generally preferable to transformed screenshots/photos because geometry and text are more reliable.

## 2. Geometry checks
Before box counting, check:
- perspective skew;
- nonuniform scaling;
- rotation;
- resampling/compression;
- cropped grid/calibration;
- whether the tracing was stretched by an app or document viewer.

If geometry is distorted, do not use pixel distance as equivalent to paper millimeters unless a local calibration reference in the same plane allows reliable correction.

## 3. Calibration confidence
### High
Speed and gain are printed/clearly visible and geometry is undistorted.

### Moderate
Scale can be inferred from an intact calibration pulse/grid with limited transformation.

### Low
Screenshot/photo is rescaled or partially cropped; precise conversion is unreliable.

### Unavailable
No trustworthy scale reference.

## 4. Lead identity confidence
If lead labels are missing/cropped:
- do not guess based solely on expected layout;
- do not make regional ischemia/localization claims that require the missing identity;
- broad rhythm conclusions may still be possible.

## 5. Artifact classes
- baseline wander;
- skeletal muscle noise;
- motion artifact;
- AC/electrical interference;
- clipping/saturation;
- lead dropout;
- pseudo-spikes;
- image compression artifacts.

For each artifact state whether it affects:
- P-wave recognition;
- QRS onset/offset;
- T-wave termination;
- ST baseline;
- rhythm regularity.

## 6. Measurement-specific minimums

### Rate
Needs reliable RR timing or a known time window.

### PR/QRS/QT
Needs known paper speed and discernible waveform onset/offset.

### ST deviation in millimeters
Needs trustworthy gain/grid geometry and identifiable J point/baseline.

### QTc
Needs reliable QT and RR plus stated formula.

### Exact axis degrees
Needs adequate limb leads and enough fidelity; otherwise report category/quadrant.

## 7. Non-destructive UI rule
Image enhancement may improve visibility but cannot replace the source. Always allow comparison with the untouched original.
