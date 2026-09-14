import importlib.util
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "source" / "25_CALCULATION_ENGINE.py"
spec = importlib.util.spec_from_file_location("candidate_calc", ENGINE)
calc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(calc)

passed = 0
failed = []

def check(name, got, expected, tol=1e-9):
    global passed
    ok = (
        abs(got - expected) <= tol
        if isinstance(got, (int, float)) and isinstance(expected, (int, float))
        else got == expected
    )
    if ok:
        passed += 1
        print("PASS", name)
    else:
        failed.append((name, got, expected))
        print("FAIL", name, repr(got), "!=", repr(expected))

def raises(name, fn):
    global passed
    try:
        fn()
    except Exception:
        passed += 1
        print("PASS", name)
        return
    failed.append((name, "NO_EXCEPTION", "EXCEPTION"))
    print("FAIL", name, "did not raise")

check("small_box_25", calc.ms_per_small_box(25), 40)
check("small_box_50", calc.ms_per_small_box(50), 20)
check("large_box_25", calc.ms_per_large_box(25), 200)
check("large_box_50", calc.ms_per_large_box(50), 100)
check("mv_per_mm_10", calc.mv_per_mm(10), 0.1)
check("standardize_gain", calc.standardize_vertical_mm(2, 5), 4)
check("standardize_negative", calc.standardize_vertical_mm(-2, 5), -4)

check("rate_rr", calc.rate_from_rr_seconds(1), 60)
check("rate_large_boxes", calc.rate_from_large_boxes(5, 25), 60)
check("rate_small_boxes", calc.rate_from_small_boxes(25, 25), 60)
check("average_rate", calc.average_rate_from_beats(10, 10), 60)

for key, value in calc.qtc_all(400, 1).items():
    check("qtc_" + key, value, 400)

check("axis_-30", calc.axis_category(-30), "normal")
check("axis_-31", calc.axis_category(-31), "left_axis_deviation")
check("axis_91", calc.axis_category(91), "right_axis_deviation")
check("axis_-91", calc.axis_category(-91), "extreme_axis")

check(
    "qrs_109",
    calc.qrs_duration_category(109),
    "not_prolonged_by_aha_2009_threshold",
)
check("qrs_110", calc.qrs_duration_category(110), "prolonged_110_119_ms")
check("qrs_120", calc.qrs_duration_category(120), "wide_120_ms_or_more")

check("ste_I", calc.st_elevation_threshold_mm("I"), 1.0)
check("ste_V2_female", calc.st_elevation_threshold_mm("V2", "female", 50), 1.5)
check("ste_V2_male_30", calc.st_elevation_threshold_mm("V2", "male", 30), 2.5)
check("ste_V2_male_50", calc.st_elevation_threshold_mm("V2", "male", 50), 2.0)
check("ste_V2_missing_sex", calc.st_elevation_threshold_mm("V2"), None)

check(
    "ste_contiguous_true",
    calc.conventional_st_elevation_met({"II": 1.0, "III": 1.1, "AVF": 0.2}),
    True,
)
check(
    "ste_contiguous_false",
    calc.conventional_st_elevation_met({"II": 1.0, "V5": 1.0}),
    False,
)
check(
    "ste_indeterminate_missing_demographics",
    calc.conventional_st_elevation_met({"V2": 2.0, "V3": 2.0}),
    None,
)
check(
    "ste_confounded",
    calc.conventional_st_elevation_met(
        {"II": 5.0, "III": 5.0},
        bbb_or_lvh_confounded=True,
    ),
    None,
)

check(
    "std_horizontal",
    calc.ischemic_st_depression_threshold_met(
        {"V4": -0.5, "V5": -0.6},
        {"V4": "horizontal", "V5": "downsloping"},
    ),
    True,
)
check(
    "std_upsloping_not_counted",
    calc.ischemic_st_depression_threshold_met(
        {"V4": -1.0, "V5": -1.0},
        {"V4": "upsloping", "V5": "upsloping"},
    ),
    False,
)

sg = calc.classic_sgarbossa_components(
    concordant_ste_mm=1.0,
    concordant_std_v1_v3_mm=1.0,
    discordant_ste_mm=5.0,
)
check("sgarbossa_concordant_ste", sg["concordant_st_elevation_ge_1mm"], True)
check("sgarbossa_concordant_std", sg["concordant_st_depression_v1_v3_ge_1mm"], True)
check("sgarbossa_discordant_ste", sg["discordant_st_elevation_ge_5mm"], True)

raises("reject_zero_speed", lambda: calc.ms_per_small_box(0))
raises("reject_negative_rr", lambda: calc.rate_from_rr_seconds(-1))
raises("reject_axis_out_of_range", lambda: calc.axis_category(181))
raises("reject_nonfinite_st", lambda: calc.conventional_st_elevation_met({"II": math.inf, "III": 1.0}))

if failed:
    print({"schema": "ekg-v12-1-calculation-tests-v1", "pass": False, "passed": passed, "failed": failed})
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-calculation-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
})
