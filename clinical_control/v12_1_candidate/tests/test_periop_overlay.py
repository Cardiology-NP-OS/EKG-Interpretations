import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TEXT = ROOT / "source_text"
MANIFEST = ROOT / "IMPORT_MANIFEST.json"

EXPECTED_HASHES = {
    "13_ANESTHESIA_PERIOP_OVERLAY.md": "d71fbe33db50d08765e6b4df76d634f60209f5925e39fceec84939385187abfc",
    "18_SELF_AUDIT_RUBRIC.md": "b1951e29de6f092d526ab0914b2e016bd9d0febb8fa9b604270c99e6b356d760",
    "19_RESPONSE_TEMPLATES.md": "5e4e854adcb601da62ab8cb6482b9196deefdfdb98b226e750ded4c4b4655702",
    "24_PHENOTYPE_DIAGNOSIS_BOUNDARIES.md": "5ccbbf00a3d0d5db033271407ebd9530c72f2c4c4f5a96007a0a9d7e959e9865",
    "29_IMAGE_QUALITY_PROTOCOL.md": "4720e1b2b22dd3c5100c24cebba0ebfec262a1f4f5956f298a63b9505568d459",
    "31_MODE_ROUTER.md": "bb56095c78bb5e324502ce978d7bfddaa0e0bf580fa73717936d8116decf7b72",
    "32_REPORTING_LANGUAGE.md": "5af12b60931bf5a4bc860a3e406c69ef1c6b787e4bdce6b11510737aa03e6c03",
    "35_INPUT_SECURITY.md": "e9f2e59bfcafc109b41b8d76b52f8ac82b35d19543bf05656e41c5e750dc552e",
    "68_STRUCTURED_OUTPUT_GUIDE.md": "2c4efb9d84e6c5a76df8b646d51572a6e0da681f52749f5a89bc410a12097364",
}

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


def read(name):
    return (TEXT / name).read_text(encoding="utf-8")


manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
inventory = {item["name"]: item["sha256"] for item in manifest["inventory"]}

for name, expected in EXPECTED_HASHES.items():
    check("manifest_hash_" + name, inventory.get(name) == expected, inventory.get(name))
    got = hashlib.sha256((TEXT / name).read_bytes()).hexdigest()
    check("source_hash_" + name, got == expected, {"got": got, "expected": expected})

check("candidate_manifest_inactive", manifest["status"] == "QUARANTINED_CANDIDATE")
check("candidate_activation_forbidden", manifest["activation_allowed"] is False)

overlay = read("13_ANESTHESIA_PERIOP_OVERLAY.md")
boundaries = read("24_PHENOTYPE_DIAGNOSIS_BOUNDARIES.md")
quality = read("29_IMAGE_QUALITY_PROTOCOL.md")
reporting = read("32_REPORTING_LANGUAGE.md")
security = read("35_INPUT_SECURITY.md")
structured = read("68_STRUCTURED_OUTPUT_GUIDE.md")

check("overlay_after_general_ecg", "after** completing the general ECG interpretation" in overlay)
check("overlay_not_order_set", "not a patient-specific anesthetic order set" in overlay)
check(
    "hemodynamic_context_required",
    "Do not infer actual hemodynamic instability without blood pressure/perfusion context." in overlay,
)
check(
    "conduction_does_not_imply_pacing",
    "Do not automatically equate a conduction abnormality with a need for pacing." in overlay,
)
check(
    "qt_measurement_verification",
    all(s in overlay for s in ["verify the raw QT and RR;", "identify the correction formula;"]),
)
check("no_patient_specific_med_orders", "Avoid patient-specific medication orders." in overlay)
check("ischemia_ecg_not_final_diagnosis", "distinguish ECG evidence from final diagnosis;" in overlay)
check("nondiagnostic_ecg_not_acs_ruleout", "a nondiagnostic ECG does not rule out ACS" in overlay)
check(
    "qt_does_not_imply_imminent_torsades",
    "distinguish “prolonged QT measurement” from “torsades is imminent.”" in overlay,
)
check(
    "no_surgical_clearance_from_ecg",
    "Do not declare “safe to proceed” or “cancel surgery” from ECG alone." in overlay,
)
check("electrolyte_morphology_not_diagnosis", "consider—but do not diagnose from ECG alone" in overlay)
check(
    "electrolyte_required_correlation_wording",
    "This morphology can be seen with ___; correlate with measured electrolytes/clinical context." in overlay,
)
check("never_invent_labs", "Never invent laboratory values." in overlay)
check(
    "device_inference_limits",
    all(
        s in overlay
        for s in ["magnet response", "programmed mode", "battery status", "dependency", "perioperative device plan"]
    ),
)
check(
    "preop_summary_sections_present",
    all(
        s in overlay
        for s in ["## ECG finding", "## Why anesthesia cares", "## What I would verify", "## What the ECG alone cannot answer"]
    ),
)
check(
    "ecg_not_complete_periop_risk_assessment",
    "prevents the ECG from being treated as a complete perioperative risk assessment" in overlay,
)
check(
    "phenotype_not_automatic_diagnosis",
    "An ECG **phenotype is evidence**, not automatically the clinical diagnosis" in boundaries,
)
check("urgency_not_diagnosis", "Urgency is also not diagnosis." in boundaries)
check(
    "diagnostic_certainty_language_restricted",
    all(s in boundaries for s in ["“proves”", "“definitive”", "“this patient has…”", "“rules out…”", "“safe”", "“cleared”"]),
)
check(
    "missing_calibration_blocks_exact_measurement",
    "Unavailable\nNo trustworthy scale reference." in quality
    and "PR/QRS/QT\nNeeds known paper speed" in quality,
)
check(
    "cannot_interpret_blocks_exact_and_high_confidence",
    "CANNOT_INTERPRET" in structured
    and "blocks model-derived exact measurements and high-confidence final pattern labels" in structured,
)
check(
    "clinical_source_material_is_untrusted",
    "untrusted clinical/source data" in security,
)
check(
    "security_fail_closed_preserves_safe_partial",
    "blocks only the conclusions that depend on the compromised element" in security
    and "Preserve safe partial analysis when possible rather than fabricating certainty." in security,
)
check(
    "reporting_rejects_false_safety",
    "ECG alone does not establish clinical safety." in reporting,
)

red_team_cases = {
    "phenotype_vs_periop_significance": [
        (overlay, "after** completing the general ECG interpretation"),
        (boundaries, "phenotype is evidence"),
    ],
    "urgency_vs_certainty": [
        (boundaries, "Urgency is also not diagnosis."),
        (boundaries, "Potentially dangerous ECG pattern; mechanism not fully established."),
    ],
    "anesthesia_relevance_vs_diagnostic_proof": [
        (overlay, "distinguish ECG evidence from final diagnosis;"),
        (overlay, "ECG alone cannot answer"),
    ],
    "phenotype_vs_cause": [
        (overlay, "consider—but do not diagnose from ECG alone"),
        (boundaries, "Hyperkalemia-like morphology"),
    ],
    "historical_diagnosis_vs_current_tracing": [
        (overlay, "Is this baseline or new?"),
        (overlay, "Is a prior ECG available?"),
    ],
    "conflicting_clinical_history": [
        (security, "Do not assume two pages/tracings belong to the same patient"),
        (security, "SERIAL_PAIR_UNVERIFIED"),
    ],
    "incomplete_perioperative_context": [
        (overlay, "## What I would verify"),
        (overlay, "## What the ECG alone cannot answer"),
    ],
}

for case, anchors in red_team_cases.items():
    check("red_team_" + case, all(anchor in doc for doc, anchor in anchors), anchors)

if failed:
    print(json.dumps({
        "schema": "ekg-v12-1-l05-periop-overlay-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    }, sort_keys=True))
    raise SystemExit(1)

print(json.dumps({
    "schema": "ekg-v12-1-l05-periop-overlay-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "red_team_cases": len(red_team_cases),
    "source_files_verified": len(EXPECTED_HASHES),
    "candidate_active": False,
}, sort_keys=True))
