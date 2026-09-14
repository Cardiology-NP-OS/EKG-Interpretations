# Current Authoritative Source Map — 2026-09-12

This file is the human-readable companion to `63_SOURCE_REGISTRY.json`. It maps high-impact ECG criteria to dated authoritative sources without reproducing copyrighted guideline tables.

## Source-selection rule

Use the newest applicable professional-society guideline, consensus definition, or scientific statement. Older ECG-standardization statements remain active where they still define measurement/terminology and have not been superseded for that narrow purpose.

## MI / acute ischemia

**Fifth Universal Definition of Myocardial Infarction (2026)** — ESC/ACC/AHA/WHF Task Force, *European Heart Journal*, published 28 Aug 2026. DOI: `10.1093/eurheartj/ehag101`.

Use for:
- ECG features of acute myocardial ischemia/infarction;
- conventional new ST-elevation thresholds;
- ischemic ST depression and T-wave findings;
- posterior findings;
- hyperacute T waves, de Winter morphology, Wellens morphology, pathologic Q waves, and Sgarbossa context;
- the boundary that no single ECG criterion establishes a final clinical MI diagnosis.

## Acute coronary syndromes

**2025 ACC/AHA/ACEP/NAEMSP/SCAI Guideline for the Management of Patients With Acute Coronary Syndromes.** DOI: `10.1161/CIR.0000000000001309`.

Use for:
- ACS workflow context;
- serial 12-lead ECGs when the initial ECG is nondiagnostic and suspicion remains high;
- additional lead acquisition when clinically appropriate;
- integration of ECG with symptoms, biomarkers, and imaging.

## AV block / bradycardia terminology

**2018 ACC/AHA/HRS Guideline on Bradycardia and Cardiac Conduction Delay.** DOI: `10.1161/CIR.0000000000000628`.

Use for:
- first-degree AV delay terminology;
- Mobitz I / Mobitz II definitions;
- explicit separation of pure 2:1 AV block from a forced Mobitz I/II label;
- high-grade and complete AV-block terminology.

## Intraventricular conduction and axis

**AHA/ACCF/HRS ECG Standardization, Part III (2009).** DOI: `10.1161/CIRCULATIONAHA.108.191095`.

Use for:
- adult QRS duration framework;
- RBBB/LBBB morphology and duration requirements;
- fascicular/conduction terminology;
- adult frontal-axis framework.

## ECG diagnostic terminology

**AHA/ACCF/HRS ECG Standardization, Part II (2007).** DOI: `10.1161/CIRCULATIONAHA.106.180201`.

Use for standardized rhythm/diagnostic terminology where newer disease-specific guidance does not supersede it.

## ST/T/U and QT measurement

**AHA/ACCF/HRS ECG Standardization, Part IV (2009).** DOI: `10.1161/CIRCULATIONAHA.108.191096`.

Use for:
- ST/T/U terminology;
- QT measurement conventions;
- correction-method cautions.

Disease-specific interpretation should defer to newer guidance when applicable.

## Chamber hypertrophy / voltage

**AHA/ACCF/HRS ECG Standardization, Part V (2009).** DOI: `10.1161/CIRCULATIONAHA.108.191097`.

Use for ECG voltage/chamber-hypertrophy criteria as imperfect electrical markers. Do not equate an ECG voltage criterion with imaging-confirmed anatomy.

## Ventricular arrhythmias / inherited electrical disease

**2022 ESC Guidelines for Ventricular Arrhythmias and Prevention of Sudden Cardiac Death.** DOI: `10.1093/eurheartj/ehac262`.

Use for:
- ventricular-arrhythmia framework;
- long-QT/short-QT/Brugada context;
- inherited-arrhythmia syndrome boundaries.

**2025 multi-society consensus on pharmacological provocation testing in cardiac electrophysiology.** DOI: `10.1093/europace/euaf067`.

Use for type-1 Brugada ECG-pattern morphology, J-point measurement, and standard/high right-precordial lead context. A phenotype-level ECG pattern is not automatically a complete syndrome diagnosis.

## Myocarditis / pericarditis

**2025 ESC Guidelines for the Management of Myocarditis and Pericarditis.** DOI: `10.1093/eurheartj/ehaf192`.

Use for:
- current inflammatory myopericardial/pericardial diagnostic context;
- ECG as one component of a broader diagnostic assessment;
- the boundary that a pericarditis-like ECG pattern does not by itself establish clinical pericarditis.

The **2015 ESC Pericardial Disease Guideline is superseded for active project guidance** by the 2025 combined myocarditis/pericarditis guideline.

## Pacing

**2021 ESC Guidelines on Cardiac Pacing and Cardiac Resynchronization Therapy.** DOI: `10.1093/eurheartj/ehab364`.

Use for pacing/device context. From a tracing alone, restrict conclusions to supportable visible pacing, capture, and sensing observations. Do not infer programming, battery state, dependency, or magnet behavior.

## Pre-excitation / accessory pathways

**2015 ACC/AHA/HRS Guideline for the Management of Adult Patients With Supraventricular Tachycardia.** DOI: `10.1161/CIR.0000000000000311`.

Use for adult pre-excitation/accessory-pathway context. ECG pattern alone does not provide a complete accessory-pathway risk assessment.

## Update rule

When a newer guideline/consensus supersedes a criterion:
1. update `63_SOURCE_REGISTRY.json`;
2. update this map;
3. update `12_CLINICAL_CRITERIA_REGISTRY.md` and `23_PATTERN_REGISTRY.json`;
4. update affected deterministic helpers and tests;
5. add/modify benchmark cases;
6. update `59_TRACEABILITY_MATRIX.md`;
7. record the change in `17_CHANGELOG.md`.

## Narrow supporting primary literature

**Smith et al., modified Sgarbossa rule (2012).** DOI: `10.1016/j.annemergmed.2012.07.119`.

Use narrowly for the proportional discordance concept in LBBB. This is supporting primary evidence, not a replacement for current guideline/consensus context.
