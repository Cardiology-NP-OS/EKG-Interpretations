import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "validation_generated"

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

engine = load("pkt08_engine", GEN / "pattern_candidate_engine.py")
measurement = load("pkt07_measurement", GEN / "measurement_evidence_adapter.py")
fixtures = json.loads((GEN / "PKT08_SYNTHETIC_PATTERN_FIXTURES.json").read_text(encoding="utf-8"))

passed = 0
def check(condition, label):
    global passed
    if not condition:
        raise AssertionError(label)
    passed += 1

hashes = engine.verify_source_hashes()
check(set(hashes) == {"pattern_registry","calculation_engine","criteria_registry"}, "source hash keys")
registry = engine.load_registry()
check(len(registry["patterns"]) == 59, "59 patterns")
check(len({p["id"] for p in registry["patterns"]}) == 59, "unique pattern ids")
rules = engine.load_rules()
check(rules["default_behavior"] == "NOT_EXECUTABLE", "default fail closed")
check(set(rules["executable_patterns"]) == {"left_axis","right_axis","stemi_threshold"}, "explicit executable set")
check(rules["candidate_active"] is False, "rules inactive")
check(rules["clinical_accuracy_claimed"] is False, "no accuracy claim")

axis_left = measurement.axis_measurement("axis.left", -45)
axis_normal = measurement.axis_measurement("axis.normal", 40)
axis_right = measurement.axis_measurement("axis.right", 120)

left = engine.evaluate_pattern("left_axis", [axis_left], {"population":"adult"})
check(left["status"] == "PRESENT_CANDIDATE", "left axis present")
check(left["diagnosis"] is None, "left no diagnosis")
check(left["candidate_active"] is False, "left inactive")
check(left["automatic_selection_allowed"] is False, "left no auto select")
check(left["rule_provenance"]["function"] == "axis_category", "left provenance")

left_absent = engine.evaluate_pattern("left_axis", [axis_normal], {"population":"adult"})
check(left_absent["status"] == "ABSENT_BY_RULE", "left absent")
right = engine.evaluate_pattern("right_axis", [axis_right], {"population":"adult"})
check(right["status"] == "PRESENT_CANDIDATE", "right present")
confounded = engine.evaluate_pattern("left_axis", [axis_left], {
    "population":"adult", "confounders":["lead reversal not excluded"]
})
check(confounded["status"] == "INDETERMINATE", "confounder blocks candidate")

contradicted = engine.evaluate_pattern("left_axis", [axis_left], {
    "population":"adult", "contradictions":["repeat tracing normal axis"]
})
check(contradicted["status"] == "INDETERMINATE", "contradiction blocks candidate")

pediatric = engine.evaluate_pattern("left_axis", [axis_left], {"population":"pediatric"})
check(pediatric["status"] == "INELIGIBLE", "population gate")

unsupported = engine.evaluate_pattern("af", [], {"population":"adult"})
check(unsupported["status"] == "NOT_EXECUTABLE", "unsupported AF")
check(unsupported["diagnosis"] is None, "unsupported no diagnosis")

unsupported2 = engine.evaluate_pattern("complete_lbbb", [], {"population":"adult"})
check(unsupported2["status"] == "NOT_EXECUTABLE", "unsupported LBBB")

st_ii = measurement.st_from_display_mm(
    "st.ii", 1.2, lead="II", gain_mm_per_mv=10, calibration_id="cal.std"
)
st_iii = measurement.st_from_display_mm(
    "st.iii", 1.4, lead="III", gain_mm_per_mv=10, calibration_id="cal.std"
)
fixture_map = {x["id"]: x for x in fixtures["fixtures"]}
for fid in ["left_axis_present","left_axis_absent","right_axis_present","right_axis_absent"]:
    fx = fixture_map[fid]
    env = measurement.axis_measurement("fixture." + fid, fx["axis_deg"])
    result = engine.evaluate_pattern(fx["pattern_id"], [env], {"population":"adult"})
    check(result["status"] == fx["expected"], "fixture " + fid)

for fid in ["unsupported_af","unsupported_complete_lbbb"]:
    fx = fixture_map[fid]
    result = engine.evaluate_pattern(fx["pattern_id"], [], {"population":"adult"})
    check(result["status"] == fx["expected"], "fixture " + fid)

helper = engine.component_helper_evidence("rate_from_rr_seconds", rr_s=1.0)
check(helper["value"] == 60.0, "rate helper")
check(helper["pattern_completed"] is False, "helper cannot complete pattern")

qrs = engine.component_helper_evidence("qrs_duration_category", qrs_ms=120)
check(qrs["value"] == "wide_120_ms_or_more", "QRS helper")
check(qrs["pattern_completed"] is False, "QRS helper cannot complete pattern")
fx = fixture_map["stemi_inferior_present"]
st_result = engine.evaluate_pattern(fx["pattern_id"], [st_ii, st_iii], {"population":"adult"})
check(st_result["status"] == fx["expected"], "regional threshold fixture")
check(set(st_result["supporting_leads"]) == {"II","III"}, "regional lead provenance")
check(st_result["diagnosis"] is None, "regional result not diagnosis")

again = engine.evaluate_pattern("left_axis", [axis_left], {"population":"adult"})
check(again["candidate_id"] == left["candidate_id"], "candidate id deterministic")

aggregate = engine.aggregate_candidates([left, unsupported])
check(aggregate["automatic_winner"] is None, "no automatic winner")
check(aggregate["automatic_selection_allowed"] is False, "aggregate no auto select")
check(aggregate["candidate_active"] is False, "aggregate inactive")
check(aggregate["clinical_accuracy_claimed"] is False, "aggregate no accuracy claim")

bad = dict(axis_left)
bad["candidate_active"] = True
try:
    engine.evaluate_pattern("left_axis", [bad], {"population":"adult"})
except ValueError as exc:
    check(str(exc) == "MEASUREMENT_AUTHORITY_ESCALATION", "authority escalation rejected")
else:
    raise AssertionError("authority escalation accepted")
try:
    engine.evaluate_pattern("left_axis", [axis_left, axis_left], {"population":"adult"})
except ValueError as exc:
    check(str(exc) == "DUPLICATE_MEASUREMENT_ID", "duplicate measurement rejected")
else:
    raise AssertionError("duplicate measurement accepted")

try:
    engine.evaluate_pattern("not_a_pattern", [], {})
except ValueError as exc:
    check(str(exc) == "UNKNOWN_PATTERN_ID", "unknown pattern rejected")
else:
    raise AssertionError("unknown pattern accepted")

check(fixtures["clinical_gold"] is False, "synthetic fixtures not clinical gold")
fixture_ids = {x["id"] for x in fixtures["fixtures"]}
check("unsupported_af" in fixture_ids, "unsupported fixture present")
check("axis_confounded" in fixture_ids, "confounded fixture present")
check("stemi_v2v3_demographics_missing" in fixture_ids, "indeterminate fixture present")

print(json.dumps({
    "schema":"ekg-pkt08-pattern-engine-test-v1",
    "pass":True,
    "assertions":passed,
    "candidate_active":False,
    "clinical_accuracy_claimed":False,
}, sort_keys=True))
