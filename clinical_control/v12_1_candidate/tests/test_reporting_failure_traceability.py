import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "validation_generated" / "reporting_failure_traceability.py"
ARTIFACT = ROOT / "validation_generated" / "L03_FAILURE_MODE_TRACEABILITY.json"
spec = importlib.util.spec_from_file_location("reporting_failure_traceability", TOOL)
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

data = trace.build_traceability()
expected_direct = [
    "F03", "F04", "F05", "F06", "F07", "F08", "F12", "F15", "F16", "F19",
    "F20", "F21", "F22", "F23", "F24", "F28", "F30",
]
expected_unreferenced = [
    "F01", "F02", "F09", "F10", "F11", "F13",
    "F14", "F17", "F18", "F25", "F26", "F27", "F29",
]
expected_structural_limitations = [{
    "id": "F02",
    "finding": "primary_evidence_for_is_free_text_without_machine_linked_independent_evidence_provenance",
    "effect": "machine_anchoring_cannot_be_fully_determined_from_primary_conclusion_evidence_structure",
}]

check("registry_traceability_has_30_entries", data["failure_mode_count"] == 30, data["failure_mode_count"])
check(
    "registry_traceability_ids_unique",
    len({item["id"] for item in data["entries"]}) == 30,
    [item["id"] for item in data["entries"]],
)
check(
    "direct_reporting_test_reference_set_exact",
    data["directly_referenced_ids"] == expected_direct,
    data["directly_referenced_ids"],
)
check(
    "unreferenced_failure_id_set_exact",
    data["not_directly_referenced_ids"] == expected_unreferenced,
    data["not_directly_referenced_ids"],
)
check(
    "f02_structural_limitation_exact",
    data["structural_limitations"] == expected_structural_limitations,
    data["structural_limitations"],
)
check(
    "traceability_artifact_current",
    json.loads(ARTIFACT.read_text(encoding="utf-8-sig")) == data,
    None,
)
check("traceability_candidate_inactive", data["candidate_active"] is False, data["candidate_active"])

if failed:
    print({
        "schema": "ekg-v12-1-l03-failure-mode-traceability-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-l03-failure-mode-traceability-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
})
