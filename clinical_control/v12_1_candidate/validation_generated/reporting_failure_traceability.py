import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "source_core"
TESTS = ROOT / "tests"

def structural_limitations():
    schema = json.loads(
        (CORE / "07_OUTPUT_SCHEMA.json").read_text(encoding="utf-8")
    )
    primary = schema["properties"]["interpretation"]["properties"]["primary_pattern"]
    primary_props = primary["properties"]
    evidence_items = primary_props["evidence_for"]["items"]
    limitations = []

    if (
        evidence_items == {"type": "string"}
        and not any(
            key in primary_props
            for key in ("observation_refs", "evidence_refs", "supporting_lead_refs")
        )
    ):
        limitations.append({
            "id": "F02",
            "finding": "primary_evidence_for_is_free_text_without_machine_linked_independent_evidence_provenance",
            "effect": "machine_anchoring_cannot_be_fully_determined_from_primary_conclusion_evidence_structure",
        })

    return limitations

def build_traceability():
    registry = json.loads(
        (CORE / "36_FAILURE_MODE_REGISTRY.json").read_text(encoding="utf-8")
    )
    reporting_tests = sorted(
        path for path in TESTS.glob("test_reporting*.py")
        if path.name != "test_reporting_failure_traceability.py"
    )
    test_text = {
        path.name: path.read_text(encoding="utf-8")
        for path in reporting_tests
    }

    entries = []
    for item in registry["failure_modes"]:
        failure_id = item["id"]
        pattern = re.compile(r"\b" + re.escape(failure_id) + r"\b")
        referenced_by = [
            name for name, text in test_text.items()
            if pattern.search(text)
        ]
        entries.append({
            "id": failure_id,
            "name": item["name"],
            "detection": item["detection"],
            "response": item["response"],
            "severity": item["severity"],
            "direct_l03_test_reference": bool(referenced_by),
            "referenced_by": referenced_by,
        })

    return {
        "schema": "ekg-v12-1-l03-failure-mode-traceability-v1",
        "failure_mode_count": len(entries),
        "entries": entries,
        "directly_referenced_ids": [
            item["id"] for item in entries if item["direct_l03_test_reference"]
        ],
        "not_directly_referenced_ids": [
            item["id"] for item in entries if not item["direct_l03_test_reference"]
        ],
        "structural_limitations": structural_limitations(),
        "candidate_active": False,
    }

def render_json():
    return json.dumps(build_traceability(), indent=2, sort_keys=True) + "\n"

if __name__ == "__main__":
    print(render_json(), end="")
