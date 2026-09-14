# Phenotype → Diagnosis Boundaries — V5

## Core rule

An ECG **phenotype is evidence**, not automatically the clinical diagnosis with the same name. The reporting layer must preserve the boundary between:

**observation → ECG pattern → clinical hypothesis → final diagnosis**.

| ECG-level statement allowed | Do not automatically promote to | Additional context commonly needed |
|---|---|---|
| Type-1 Brugada ECG pattern | Brugada syndrome | clinical context, phenocopy exclusion, specialist assessment; provocation/genetics where appropriate |
| QT/QTc prolongation | congenital long-QT syndrome | repeat ECGs, drugs/electrolytes, history, diagnostic score/genetics where appropriate |
| Ventricular pre-excitation pattern | WPW syndrome / pathway risk | symptoms/arrhythmias, pathway assessment, rhythm history |
| LVH voltage/repolarization pattern | anatomic LV hypertrophy | imaging/clinical context |
| Right-heart strain pattern | pulmonary embolism | symptoms, hemodynamics, imaging/labs as appropriate |
| Electrical alternans | cardiac tamponade | hemodynamics and echocardiography |
| Pericarditis-like ST/PR pattern | acute pericarditis | clinical criteria, inflammatory/imaging context, differential diagnosis |
| Hyperkalemia-like morphology | hyperkalemia | measured serum potassium and clinical context |
| Hypokalemia-like morphology | hypokalemia | measured serum potassium |
| Calcium-associated QT pattern | hypo-/hypercalcemia | measured calcium and clinical context |
| Pathologic-Q-wave pattern | previous myocardial infarction | clinical/imaging context; alternative causes exist |
| Ischemic ST-T changes | acute MI | acute myocardial injury evidence plus ischemic clinical/imaging context |
| Conventional ST-elevation threshold met | final MI diagnosis | clinical integration; treat the ECG pattern as time-sensitive where appropriate |
| Posterior occlusion-type pattern | proven posterior MI | additional ECG leads/clinical evidence/biomarkers as appropriate |
| de Winter morphology | proven acute coronary occlusion | urgent clinical correlation and definitive clinical evaluation |
| Wellens-type morphology | Wellens syndrome | appropriate clinical context and mimic exclusion |
| Sgarbossa/modified-Sgarbossa concern | proven acute coronary occlusion | clinical integration and appropriate definitive evaluation |
| Wide-complex tachycardia | definitive VT vs SVT-aberrancy mechanism | morphology, AV relationship, prior ECG, clinical context; uncertainty may remain |
| Irregularly irregular rhythm | atrial fibrillation | assess atrial activity and artifact; other irregular rhythms exist |
| 2:1 AV block | Mobitz I or Mobitz II | additional conduction behavior/localization evidence |
| QRS ≥120 ms | complete RBBB/LBBB | morphology criteria in addition to duration |
| Fascicular-axis pattern | isolated fascicular block | compatible limb-lead morphology and exclusion of alternative axis causes |
| Paced complexes | device mode/programming | device history/interrogation; ECG alone cannot reveal full programming |
| Apparent pacing spike without depolarization | definitive device hardware failure | verify artifact, lead morphology, device interrogation, clinical state |
| Low voltage | pericardial effusion/infiltrative disease/etc. | clinical/imaging context |
| J/Osborn-wave pattern | hypothermia | measured temperature/context; other causes exist |
| Early-repolarization pattern | benign prognosis | symptoms/history and phenotype context; ECG label does not guarantee risk status |
| ST depression during tachycardia | obstructive coronary disease | rate/context/serial change and clinical evaluation |
| Poor R-wave progression | prior anterior MI | lead placement, body habitus, conduction, LVH, normal variant, serial comparison |
| “Normal” automated interpretation | absence of important disease | independent visual review and clinical context |

## Urgency boundary

Urgency is also not diagnosis. A pattern can warrant **emergent/urgent review** even when the final disease mechanism remains uncertain.

Examples:
- wide-complex tachycardia with unresolved mechanism;
- acute occlusion-type ECG pattern without biomarker confirmation;
- suspected high-grade AV block;
- possible pacing failure in a symptomatic patient.

The correct output may therefore be:

> “Potentially dangerous ECG pattern; mechanism not fully established.”

rather than either false certainty or false reassurance.

## Required language

Prefer:
- “pattern compatible with…”
- “raises concern for…”
- “ECG phenotype of…”
- “can be seen with…”
- “visually consistent with…”
- “cannot exclude…”
- “requires clinical correlation…”

Avoid unless the full evidentiary boundary is crossed:
- “proves”
- “definitive”
- “this patient has…”
- “rules out…”
- “safe”
- “cleared”

## Machine-interpretation boundary

Automated ECG interpretation is a separate evidence source. It can be:
- concordant;
- discordant;
- partially concordant;
- not assessable.

It is never promoted to ground truth merely because it is printed on the tracing.
