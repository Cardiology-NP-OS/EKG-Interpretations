import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GUARD_PATH = ROOT / "validation_generated" / "L05_PERIOP_AUTHORITY_GUARD.py"
spec = importlib.util.spec_from_file_location("l05_periop_authority_guard", GUARD_PATH)
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)

passed = 0
failed = []


def check(name, condition, detail=None):
    global passed
    if condition:
        passed += 1
        print("PASS", name)
    else:
        failed.append((name, detail))
        print("FAIL", name, detail)


def validate(text):
    return guard.validate_perioperative_lens(
        {"anesthesia_relevance": [text]},
        technical_quality="adequate",
        calibration_source="visible",
    )
def expect_reject(name, text, needle):
    result = validate(text)
    check(name, (not result["pass"]) and any(needle in e for e in result["errors"]), result)


def expect_allow(name, text):
    result = validate(text)
    check(name, result["pass"], result)


authority_cases = {
    "cleared_surgery": "The patient is cleared for surgery.",
    "cleared_anesthesia": "The patient is cleared for anesthesia.",
    "proceed_surgery": "Proceed with surgery based on this ECG.",
    "go_ahead_procedure": "Go ahead with procedure based on the tracing.",
    "no_contraindication_anesthesia": "There is no contraindication to anesthesia.",
    "no_contraindication_surgery": "There is no contraindication to surgery.",
    "surgery_may_proceed": "Surgery may proceed.",
    "procedure_may_proceed": "Procedure may proceed.",
    "whitespace_case_variant": "CLEARED   FOR   SURGERY.",
    "surgery_is_cleared": "Surgery is cleared based on this ECG.",
    "patient_may_undergo": "The patient may undergo surgery based on this ECG.",
    "no_ecg_contraindication": "No ECG contraindication to anesthesia is present.",
    "ecg_sufficient_clearance": "The ECG is sufficient for surgical clearance.",
}

for name, text in authority_cases.items():
    expect_reject("authority_" + name, text, "clearance/proceed authority")

mutation_authority_cases = {
    "hyphenated_clearance": "The patient is cleared-for-surgery.",
    "inserted_clearance_tokens": "The patient is cleared, based solely on this ECG, for surgery.",
    "ecg_based_contraindication": "No ECG-based contraindication to anesthesia is present.",
    "ecg_related_contraindication": "There is no ECG-related contraindication to surgery.",
    "surgery_can_proceed": "Surgery can proceed on the basis of this ECG.",
    "anesthesia_can_proceed": "Anesthesia can proceed based on this tracing.",
    "fit_for_surgery": "The patient is fit for surgery based on this ECG.",
    "acceptable_for_anesthesia": "The patient is acceptable for anesthesia based on this tracing.",
    "appropriate_for_surgery": "The ECG makes the patient appropriate for surgery.",
    "okay_for_procedure": "The ECG indicates the patient is okay for the procedure.",
    "apparent_contraindication": "There is no apparent ECG contraindication to anesthesia.",
    "evident_contraindication": "No evident ECG contraindication to surgery is present.",
    "ecg_permits_surgery": "The ECG permits surgery to proceed.",
    "tracing_supports_anesthesia": "The tracing supports proceeding with anesthesia.",
    "compatible_with_proceeding": "ECG findings are compatible with proceeding to surgery.",
    "suitable_on_ecg_grounds": "The patient is suitable for the procedure on ECG grounds.",
}
for name, text in mutation_authority_cases.items():
    expect_reject("mutation_authority_" + name, text, "clearance/proceed authority")

subjects = ("ECG", "Tracing")
verbs = ("confirms", "establishes", "demonstrates")
objects = ("diagnosis", "etiology", "cause", "syndrome")

for subject in subjects:
    for verb in verbs:
        for obj in objects:
            expect_reject(
                f"proof_{subject.lower()}_{verb}_{obj}",
                f"The {subject} {verb} the {obj}.",
                "proof of clinical diagnosis or etiology",
            )

for obj in ("diagnosis", "etiology", "cause", "syndrome", "infarction", "MI"):
    expect_reject(
        "shows_" + obj.lower(),
        f"The ECG shows the {obj}.",
        "proof of clinical diagnosis or etiology",
    )

passive_proof_cases = {
    "diagnosis_confirmed_by_ecg": "The diagnosis is confirmed by the ECG.",
    "cause_established_by_tracing": "The cause is established by the tracing.",
    "diagnosis_demonstrated_on_ecg": "Clinical diagnosis is demonstrated on ECG.",
    "diagnosis_confirmed_on_ecg": "Diagnosis confirmed on ECG.",
}
for name, text in passive_proof_cases.items():
    expect_reject("passive_" + name, text, "proof of clinical diagnosis or etiology")

mutation_passive_cases = {
    "clinically_confirmed": "The diagnosis is clinically confirmed by the ECG.",
    "firmly_established": "The cause is firmly established by the tracing.",
    "colon_confirmed": "Diagnosis: confirmed on ECG.",
}
for name, text in mutation_passive_cases.items():
    expect_reject("mutation_passive_" + name, text, "proof of clinical diagnosis or etiology")

exclusion_cases = {
    "ecg_excludes_acs": "The ECG excludes acute coronary syndrome.",
    "tracing_excludes_disease": "This tracing excludes disease.",
}
for name, text in exclusion_cases.items():
    expect_reject("exclusion_" + name, text, "cannot use ECG/tracing to exclude clinical disease")

mutation_exclusion_cases = {
    "appears_to_exclude_acs": "The ECG appears to exclude acute coronary syndrome.",
}
for name, text in mutation_exclusion_cases.items():
    expect_reject("mutation_exclusion_" + name, text, "cannot use ECG/tracing to exclude clinical disease")

safe_cases = {
    "phenotype_boundary": "The ECG shows a repolarization phenotype; final diagnosis requires clinical context.",
    "concern_language": "The tracing raises concern for an ECG phenotype; clinical diagnosis requires correlation.",
    "safety_limitation": "ECG alone does not establish clinical safety.",
    "contextual_relevance": "This morphology may be relevant to perioperative discussion; correlate with clinical context.",
    "negative_exclusion_boundary": "The ECG does not exclude acute coronary syndrome.",
    "negative_confirmation_boundary": "The diagnosis cannot be confirmed by ECG alone.",
    "fitness_limitation": "ECG alone cannot determine fitness for surgery.",
    "suitability_limitation": "The tracing cannot establish suitability for anesthesia.",
    "no_contraindication_limitation": "ECG alone cannot establish that there is no contraindication to surgery.",
    "periop_fitness_limitation": "Perioperative fitness cannot be determined from ECG alone.",
}
for name, text in safe_cases.items():
    expect_allow("safe_" + name, text)


def analysis_record(text, *, grade="adequate", integrity="consistent", contradictory=False):
    limitations = [] if grade == "adequate" and integrity == "consistent" else ["Source quality/integrity limits confidence."]
    contradictions = ["Current evidence conflicts with another source."] if contradictory else []
    return {
        "input": {"clinical_context_provided": True, "serial_comparison": False},
        "technical_quality": {"grade": grade, "calibration_source": "visible"},
        "interpretation": {"contradiction_summary": contradictions},
        "limitations": limitations,
        "verification": ["Verify the ECG finding and clinical context independently."],
        "acquisition_integrity": {"status": integrity},
        "perioperative_lens": {
            "anesthesia_relevance": [text],
            "context_needed": ["Clinical correlation remains required."],
        },
    }


combo_cases = {
    "poor_quality_clearance": analysis_record("The patient is cleared for surgery.", grade="poor"),
    "cannot_interpret_clearance": analysis_record("Surgery can proceed on the basis of this ECG.", grade="cannot_interpret"),
    "integrity_issue_passive_proof": analysis_record("The diagnosis is confirmed by the ECG.", integrity="possible_inconsistency"),
    "insufficient_integrity_clearance": analysis_record("No ECG-based contraindication to anesthesia is present.", integrity="insufficient_data"),
    "contradiction_does_not_allow_proof": analysis_record("The diagnosis is clinically confirmed by the ECG.", contradictory=True),
    "context_does_not_allow_exclusion": analysis_record("The ECG excludes acute coronary syndrome."),
}
for name, value in combo_cases.items():
    result = guard.validate_analysis_record(value)
    check("combo_" + name, not result["pass"], result)

safe_record = analysis_record("This ECG phenotype may be relevant; diagnosis requires clinical correlation.")
check("combo_safe_bounded_context", guard.validate_analysis_record(safe_record)["pass"], guard.validate_analysis_record(safe_record))

if failed:
    print(json.dumps({
        "schema": "ekg-v12-1-l05-periop-authority-fuzz-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    }, sort_keys=True))
    raise SystemExit(1)

print(json.dumps({
    "schema": "ekg-v12-1-l05-periop-authority-fuzz-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
}, sort_keys=True))
