import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "validation_generated" / "64_SOURCE_TRACEABILITY.py"
spec = importlib.util.spec_from_file_location("source_traceability", TOOL)
trace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trace)

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

result = trace.audit()
manifest = json.loads((ROOT / "IMPORT_MANIFEST.json").read_text(encoding="utf-8"))
matrix_path = ROOT / "validation_generated" / "59_TRACEABILITY_MATRIX.md"

check("traceability_audit_passes", result["pass"], result["errors"])
check("traceability_errors_empty", result["errors"] == [], result["errors"])
check("eight_criteria_sections_bound", result["criteria_sections_bound"] == 8)
check("eight_unique_bound_source_keys", result["bound_source_keys"] == 8)
check("source_registry_has_21_records", result["source_registry_records"] == 21)
check("human_source_map_has_13_resolved_dois", result["source_map_dois"] == 13)
check("source_map_dois_all_resolve", result["unresolved_source_map_dois"] == [])
check("pattern_source_keys_all_resolve", result["pattern_source_keys_unresolved"] == [])
check(
    "supplement_is_exactly_two_known_omissions",
    result["supplement_source_keys"] == ["aha_ecg_part1_2007", "aha_monitoring_2017"],
)
check(
    "original_user_archive_identity",
    manifest["source_pack"]["sha256"] == trace.ORIGINAL_ARCHIVE_SHA256,
)
check(
    "generated_derivative_has_distinct_identity",
    manifest["archive_validation"]["generated_derivative"]["sha256"]
    == trace.DERIVATIVE_ARCHIVE_SHA256
    and trace.DERIVATIVE_ARCHIVE_SHA256 != trace.ORIGINAL_ARCHIVE_SHA256,
)
check("original_bundled_validator_passes", manifest["source_pack"]["runtime_validator_pass"] is True)
check(
    "traceability_matrix_is_current",
    matrix_path.exists()
    and matrix_path.read_text(encoding="utf-8") == result["matrix"],
)

if failed:
    print({
        "schema": "ekg-v12-1-traceability-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-traceability-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
})
