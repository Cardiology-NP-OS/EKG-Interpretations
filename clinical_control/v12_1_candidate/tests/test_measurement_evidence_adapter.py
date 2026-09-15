import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "validation_generated" / "measurement_evidence_adapter.py"
spec = importlib.util.spec_from_file_location("pkt07_measurements", MODULE)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

passed = 0
failed = []

def check(name, condition):
    global passed
    if condition:
        passed += 1
        print("PASS", name)
    else:
        failed.append(name)
        print("FAIL", name)

def raises(name, fn, contains=None):
    global passed
    try:
        fn()
    except Exception as exc:
        ok = contains is None or contains in str(exc)
        check(name, ok)
        return
    check(name, False)

check("engine_bytes_unchanged",
      m.ENGINE_SHA256 == "872d7df0df0a6d50604583fe6ff8f6fdce0d50e14da4669f408f8a4c9235d82d")
check("candidate_inactive_contract", m._envelope("AVAILABLE", {}, None)["candidate_active"] is False)
schema = json.loads((ROOT / "source_core" / "07_OUTPUT_SCHEMA.json").read_text(encoding="utf-8"))
me = schema["properties"]["measurement_evidence"]["items"]
check("reuses_source_measurement_schema", me["properties"]["version"]["const"] == "1.0")
check("source_schema_has_required_provenance",
      {"measurement_id","metric","source_kind","method","evidence_source"}.issubset(set(me["required"])))

taxonomy = json.loads((ROOT / "validation_generated" / "MEASUREMENT_ERROR_TAXONOMY.json").read_text())
check("taxonomy_matches_adapter", set(taxonomy["reasons"]) == m.ERRORS)
check("taxonomy_nonclinical", taxonomy["clinical_accuracy_claimed"] is False)

manual = m.manual_measurement("m.manual.qrs", "qrs", 100, "ms", record_id="fixture")
r = manual["measurement_evidence"]
check("manual_origin_preserved", r["source_kind"] == "user_provided" and r["method"] == "user_input")
check("manual_not_waveform_derived", "not waveform-derived" in r["notes"])
check("manual_exact_value", r["value"] == 100.0 and r["unit"] == "ms")

missing_lead = m.manual_measurement("m.st.none", "st_deviation", 1.0, "mm")
check("st_missing_lead_indeterminate",
      missing_lead["status"] == "INDETERMINATE" and missing_lead["reason"] == "MISSING_LEAD_IDENTITY")
asset_hash = "a" * 64
digital = m.digital_measurement(
    "m.digital.qt", "qt", 400, "ms", asset_id="fixture-ecg", asset_sha256=asset_hash,
    calibration_id="cal-1", record_id="record-1"
)
dr = digital["measurement_evidence"]
check("digital_origin_preserved", dr["source_kind"] == "digital_signal" and dr["method"] == "digital_sample")
check("digital_asset_bound", dr["evidence_source"]["asset_sha256"] == asset_hash)
check("digital_calibration_bound", dr["calibration_id"] == "cal-1")

no_cal = m.digital_measurement(
    "m.digital.qrs.nocal", "qrs", 100, "ms", asset_id="fixture-ecg", asset_sha256=asset_hash
)
check("digital_missing_calibration_fails_closed",
      no_cal["status"] == "INDETERMINATE" and no_cal["reason"] == "MISSING_CALIBRATION")

wf = m.waveform_measurement_request("m.auto.qt", "qt", "ms")
check("waveform_extraction_not_implemented",
      wf["status"] == "NOT_IMPLEMENTED" and wf["measurement_evidence"]["value"] is None)

rate = m.rate_from_rr("m.rate", 1.0, dependency_id="m.rr")
check("rate_rr_60", abs(rate["measurement_evidence"]["value"] - 60.0) < 1e-12)
check("rate_formula_bound", "formula=rate_from_rr_seconds" in rate["measurement_evidence"]["notes"])
qtcs = m.qtc_records("m.qtc", 400, 1.0, qt_dependency="m.qt", rr_dependency="m.rr")
check("four_qtc_formulas", len(qtcs) == 4)
check("qtc_identity_values", all(abs(x["measurement_evidence"]["value"] - 400.0) < 1e-9 for x in qtcs))
check("qtc_formula_identity", {x["derived"]["formula"] for x in qtcs} ==
      {"bazett","fridericia","framingham","hodges"})

qrs = m.interval_measurement("m.qrs", "qrs", 110)
check("qrs_category_deterministic", qrs["derived"]["duration_category"] == "prolonged_110_119_ms")
check("qrs_category_not_diagnosis", qrs["derived"]["diagnostic_interpretation"] is False)

axis = m.axis_measurement("m.axis", -31)
check("axis_category_deterministic", axis["derived"]["axis_category"] == "left_axis_deviation")
check("axis_no_etiology", axis["derived"]["etiology_inferred"] is False)

st = m.st_from_display_mm(
    "m.st.v2", 0.75, lead="V2", gain_mm_per_mv=5,
    calibration_id="cal-v2", sex="female", age_years=50
)
check("st_gain_normalized", abs(st["measurement_evidence"]["value"] - 1.5) < 1e-12)
check("st_threshold_helper_provenance", st["derived"]["threshold_mm"] == 1.5)
check("st_threshold_not_diagnosis", st["derived"]["diagnosis"] is None)
st_no_cal = m.st_from_display_mm("m.st.nocal", 1.0, lead="II")
check("st_missing_calibration_indeterminate",
      st_no_cal["status"] == "INDETERMINATE" and st_no_cal["reason"] == "MISSING_CALIBRATION")

d100 = m.duration_ms_from_samples(100, 100)
d500 = m.duration_ms_from_samples(500, 500)
check("cross_rate_duration_consistent", d100 == d500 == 1000.0)
r100 = m.rate_from_rr("m.rate100", d100 / 1000.0, dependency_id="samples100")
r500 = m.rate_from_rr("m.rate500", d500 / 1000.0, dependency_id="samples500")
check("cross_rate_calculation_consistent",
      r100["measurement_evidence"]["value"] == r500["measurement_evidence"]["value"] == 60.0)

mapped = m.map_to_structured_output([manual, rate] + qtcs[:1])
check("structured_map_only_measurement_surfaces",
      set(mapped) == {"measurements","measurement_evidence","candidate_active","clinical_accuracy_claimed"})
check("structured_map_no_interpretation", "interpretation" not in mapped and "rhythm" not in mapped)
check("structured_refs_resolve",
      {x["measurement_id"] for x in mapped["measurement_evidence"]} ==
      {x["measurement_evidence_ref"] for x in mapped["measurements"]})

raises("reject_unit_mismatch",
       lambda: m.manual_measurement("bad.unit", "qrs", 100, "bpm"), "UNIT_MISMATCH")
raises("reject_nan", lambda: m.manual_measurement("bad.nan", "qrs", math.nan, "ms"), "NONFINITE_INPUT")
raises("reject_inf", lambda: m.manual_measurement("bad.inf", "qrs", math.inf, "ms"), "NONFINITE_INPUT")
raises("reject_bad_asset_hash",
       lambda: m.digital_measurement("bad.hash","qt",400,"ms",asset_id="x",asset_sha256="bad",
                                     calibration_id="cal"), "asset_sha256")
a = m.manual_measurement("conflict.1", "qrs", 100, "ms")
b = m.manual_measurement("conflict.2", "qrs", 120, "ms")
raises("reject_conflicting_measurements", lambda: m.map_to_structured_output([a,b]), "CONFLICTING_EVIDENCE")
raises("reject_negative_sample_delta", lambda: m.duration_ms_from_samples(-1, 100), "MALFORMED_INPUT")
raises("reject_zero_sample_rate", lambda: m.duration_ms_from_samples(1, 0), "MALFORMED_INPUT")

vectors = json.loads((ROOT / "validation_generated" / "PKT07_SYNTHETIC_GOLDEN_VECTORS.json").read_text())
check("synthetic_vectors_not_clinical_gold", vectors["clinical_gold"] is False)
check("synthetic_vectors_candidate_inactive", vectors["candidate_active"] is False)
ids = {v["id"] for v in vectors["vectors"]}
check("golden_vector_coverage",
      {"rate_rr_1s","rate_100hz","rate_500hz","qtc_identity","qrs_110",
       "axis_minus31","st_v2_gain5_female","waveform_auto_unimplemented"}.issubset(ids))

def source_record_compatible(rec):
    props = me["properties"]
    if not set(me["required"]).issubset(rec):
        return False
    if set(rec) - set(props):
        return False
    if rec["version"] != props["version"]["const"]:
        return False
    if rec["metric"] not in props["metric"]["enum"]:
        return False
    if rec["source_kind"] not in props["source_kind"]["enum"]:
        return False
    if rec["method"] not in props["method"]["enum"]:
        return False
    return True

for idx, env in enumerate([manual, digital, rate, qrs, axis, st] + qtcs):
    check(f"source_schema_record_{idx}", source_record_compatible(env["measurement_evidence"]))

envelope_schema = json.loads(
    (ROOT / "validation_generated" / "PKT07_MEASUREMENT_EVIDENCE_SCHEMA.json").read_text()
)
def envelope_compatible(env):
    props = envelope_schema["properties"]
    return (
        set(envelope_schema["required"]).issubset(env)
        and not (set(env) - set(props))
        and env["schema"] == props["schema"]["const"]
        and env["status"] in props["status"]["enum"]
        and env["quality_state"] in props["quality_state"]["enum"]
        and env["confidence"] in props["confidence"]["enum"]
        and env["candidate_active"] is False
        and env["clinical_accuracy_claimed"] is False
    )
for idx, env in enumerate([manual, missing_lead, digital, no_cal, wf, rate, qrs, axis, st, st_no_cal]):
    check(f"generated_envelope_schema_{idx}", envelope_compatible(env))
check("quality_state_resolved", manual["quality_state"] == "resolved" and manual["confidence"] == "high")
check("quality_state_fail_closed", wf["quality_state"] == "unsupported" and wf["confidence"] == "low")

if failed:
    print({"schema":"ekg-pkt07-measurement-tests-v1","pass":False,
           "passed":passed,"failed":failed,"candidate_active":False})
    raise SystemExit(1)
print({"schema":"ekg-pkt07-measurement-tests-v1","pass":True,
       "passed":passed,"total":passed,"candidate_active":False,
       "clinical_accuracy_claimed":False})
