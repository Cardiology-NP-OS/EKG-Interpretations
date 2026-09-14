# Clinical Criteria Registry — Adult ECG Reference

**Snapshot date:** 2026-09-12  
**Purpose:** Standardize terminology and thresholds used by this project.  
**Important:** This is a compact implementation reference, not a replacement for the source guidelines.

---

# 1. Acquisition / Measurement

## Scale
Only convert boxes to time or voltage when speed/gain are confirmed.

At **25 mm/s**:
- small box = 40 ms
- large box = 200 ms

At **50 mm/s**:
- small box = 20 ms
- large box = 100 ms

At **10 mm/mV**:
- 10 mm = 1 mV

---

# 2. Frontal QRS Axis — Adults

A practical adult classification:
- normal: approximately −30° to +90°
- left-axis deviation: < −30°
- right-axis deviation: > +90°
- extreme axis: upper-right quadrant / indeterminate “northwest” axis

When image quality is limited, use a category rather than an exact degree.

Reference: AHA/ACCF/HRS ECG standardization recommendations, Part III.

---

# 3. QRS Duration / Conduction

For adults:
- QRS >110 ms is abnormal by the AHA/ACCF/HRS standardization framework.
- Complete RBBB and complete LBBB use QRS ≥120 ms plus morphology criteria.
- Incomplete patterns generally occupy the 110–119 ms range and still require morphology.

## Complete RBBB pattern
Use only when the duration and expected morphology align, including:
- QRS ≥120 ms;
- terminal rightward conduction pattern in V1/V2 (e.g. rsR′/rSR′-type morphology);
- broad/delayed terminal S in lateral leads;
- other supporting morphology.

## Complete LBBB pattern
Use only when duration and morphology align, including:
- QRS ≥120 ms;
- broad/notched or slurred lateral R waves;
- absent expected lateral q waves except permitted small aVL q;
- delayed lateral R-wave peak;
- secondary ST-T discordance is common.

## Nonspecific IVCD
QRS is prolonged without sufficient morphology for RBBB or LBBB.

## Fascicular patterns
Do not diagnose from axis alone.
A left anterior fascicular pattern should have a compatible superior/leftward axis plus expected limb-lead morphology.
A left posterior fascicular pattern requires a compatible rightward axis plus expected limb-lead morphology and exclusion of more common causes of right-axis deviation.

References:
- AHA/ACCF/HRS Recommendations, Part III.
- 2018 ACC/AHA/HRS Bradycardia and Conduction Delay Guideline terminology.

---

# 4. AV Block Terminology

## Second-degree AV block
Atrial activity continues while some P waves fail to conduct.

### Mobitz I
Progressive/inconstant AV conduction behavior around a nonconducted P wave.

### Mobitz II
Nonconducted P wave(s) with otherwise constant PR intervals in conducted beats.

### 2:1 AV block
Every other P wave conducts. Do **not** automatically label Mobitz I or II solely from a 2:1 strip.

### High-grade AV block
At least two consecutive P waves fail to conduct while some AV conduction remains.

### Third-degree AV block
No evidence of AV conduction; atrial and ventricular activity are dissociated.

Reference: 2018 ACC/AHA/HRS Bradycardia and Cardiac Conduction Delay Guideline.

---

# 5. QT / QTc

QT is measured from QRS onset to T-wave end.

Implementation rules:
- visually verify machine-reported QT prolongation when possible;
- avoid including a separable U wave;
- prefer a lead with a well-defined T-wave end;
- state the correction formula;
- recognize formula dependence.

Common formulas:
- Bazett: QTc = QT / √RR
- Fridericia: QTc = QT / RR^(1/3)

Use seconds for QT and RR inside formulas.

AHA hospital-monitoring guidance notes:
- Bazett commonly overestimates at faster heart rates;
- alternatives such as Fridericia, Framingham, or Hodges can perform better in some settings;
- QTc >500 ms is clinically important as a higher-risk marker for torsades, but no single threshold makes risk zero below it.

Do not turn a threshold into a patient-specific risk prediction.

References:
- AHA/ACCF/HRS ECG standardization recommendations, Part IV.
- AHA Practice Standards for ECG Monitoring in Hospital Settings.

---

# 6. Acute Ischemia / Infarction ECG Findings

## Conventional ST-elevation thresholds
Current international definitions continue to use new ST elevation at the J point in at least two contiguous leads:
- ≥1 mm in leads other than V2–V3;
- V2–V3: ≥2.5 mm in males <40 years;
- ≥2.0 mm in males ≥40 years;
- ≥1.5 mm in females regardless of age;

with important caveats such as bundle branch block/LVH and overall clinical context.

## ST depression
New horizontal/downsloping ST depression ≥0.5 mm in at least two contiguous leads is an ischemic finding in the appropriate context.

## T-wave inversion
New/dynamic T-wave inversion in contiguous leads can be ischemic but is not specific in isolation.

## Posterior pattern
Posterior MI/occlusion may be suggested by anterior ST depression in V1–V3, especially with dominant R waves, and can be supported by posterior leads V7–V9.

## Occlusion-associated patterns without classic ST elevation
Current definitions/guidance recognize that acute coronary occlusion may occur without classic STEMI thresholds. Patterns of concern include:
- posterior pattern;
- de Winter pattern;
- Wellens pattern in the appropriate clinical setting;
- hyperacute T waves;
- ischemic findings in BBB/paced rhythms using Sgarbossa-type frameworks.

## Sgarbossa context
In LBBB or ventricular pacing, concordant and disproportionate ST changes can raise concern for acute coronary occlusion. Modified Sgarbossa uses proportional discordance (ST/S relationship) rather than only an absolute discordant-ST threshold.

## Critical distinction
An ECG can show evidence of ischemia or an occlusion pattern, but a **final diagnosis of myocardial infarction requires clinical integration and evidence of acute myocardial injury**.

References:
- Fifth Universal Definition of Myocardial Infarction (2026), European Heart Journal.
- 2025 ACC/AHA/ACEP/NAEMSP/SCAI Acute Coronary Syndromes Guideline.

---

# 7. Pathologic Q Waves

Treat Q waves as evidence requiring context, not proof of “old MI.”

Current MI definitions include pathologic-Q-wave criteria, but specificity is imperfect and imaging can be needed to confirm prior infarction.

Implementation:
- identify leads;
- assess contiguous distribution;
- verify duration/depth if calibration allows;
- consider normal septal q waves and conduction/lead-placement confounders.

Reference: Fifth Universal Definition of Myocardial Infarction (2026).

---

# 8. Important Negative Rule

A normal or nondiagnostic ECG does **not** exclude acute coronary syndrome.

Serial ECGs can be important when symptoms are persistent/recurrent or suspicion remains high.

References:
- 2025 ACC/AHA Acute Coronary Syndromes Guideline.
- Fifth Universal Definition of MI (2026).

---

# 9. Source Authority

The machine-readable source of truth is `63_SOURCE_REGISTRY.json`; the human-readable current map is `30_CURRENT_SOURCE_MAP_2026.md`. Pattern-specific source bindings live in `23_PATTERN_REGISTRY.json`.

Do **not** maintain an independent duplicate bibliography here. This file intentionally references source keys rather than copying the registry, which reduces source-version drift.

Key source families used by this criteria layer include:
- AHA/ACCF/HRS ECG standardization statements (technology, terminology, conduction, ST-T/QT, hypertrophy);
- 2018 ACC/AHA/HRS bradycardia and conduction-delay guideline;
- AHA hospital ECG-monitoring standards for QT monitoring context;
- 2025 ACC/AHA acute coronary syndromes guideline;
- Fifth Universal Definition of Myocardial Infarction (2026);
- 2025 ESC myocarditis/pericarditis guideline;
- 2021 ESC pacing guideline;
- 2022 ESC ventricular-arrhythmia guideline;
- 2025 Brugada provocation consensus;
- Smith et al. 2012 modified Sgarbossa primary study where proportional discordance is specifically discussed.

Run `python 64_SOURCE_TRACEABILITY.py` after any criteria/source change.
