import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "source_core"

EXPECTED_HASHES = {
    "07_OUTPUT_SCHEMA.json": "11ecf971bfe707ec620501ccf7631da20db6be358393d893c3983facba7a8d1f",
    "23_PATTERN_REGISTRY.json": "05764e9437862f6c4f1948c6f0385abb320764c4cb0f2007ce7c426df7d31fdb",
    "36_FAILURE_MODE_REGISTRY.json": "2d24e87df7296a9f18220f6cba96b2d26c0ad52b7adde22889439dc15d4abae2",
    "63_SOURCE_REGISTRY.json": "c1d9d116755931487a9b5434832aa2827763bf7ef772449963588da20b20b89e",
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

def load(name):
    return json.loads((CORE / name).read_text(encoding="utf-8"))

for name, expected in EXPECTED_HASHES.items():
    got = hashlib.sha256((CORE / name).read_bytes()).hexdigest()
    check("sha256_" + name, got == expected, {"got": got, "expected": expected})

schema = load("07_OUTPUT_SCHEMA.json")
patterns_doc = load("23_PATTERN_REGISTRY.json")
failures_doc = load("36_FAILURE_MODE_REGISTRY.json")
sources_doc = load("63_SOURCE_REGISTRY.json")

patterns = patterns_doc["patterns"]
failures = failures_doc["failure_modes"]
sources = sources_doc["sources"]

check("schema_version_const_3_1", schema["properties"]["schema_version"].get("const") == "3.1")
check("schema_properties_22", len(schema["properties"]) == 22, len(schema["properties"]))
check("schema_required_12", len(schema["required"]) == 12, schema["required"])
check("schema_required_are_properties", set(schema["required"]) <= set(schema["properties"]))
check(
    "analysis_metadata_sentinels",
    set(schema["properties"]["analysis_metadata"].get("required", []))
    == {"project_version", "criteria_snapshot", "source_registry_version", "analysis_mode"},
)
check(
    "interpretation_boundary_fields",
    set(schema["properties"]["interpretation"].get("required", []))
    == {"primary_pattern", "secondary_findings", "differential", "contradiction_summary"},
)

pattern_ids = [item["id"] for item in patterns]
source_keys = [item["key"] for item in sources]
failure_ids = [item["id"] for item in failures]

check("patterns_count_59", len(patterns) == 59, len(patterns))
check("pattern_ids_unique", len(pattern_ids) == len(set(pattern_ids)))
check("failures_count_30", len(failures) == 30, len(failures))
check("failure_ids_unique", len(failure_ids) == len(set(failure_ids)))
check("sources_count_21", len(sources) == 21, len(sources))
check("source_keys_unique", len(source_keys) == len(set(source_keys)))

required_pattern = {
    "id", "label", "domain", "required_or_defining_evidence", "supportive_evidence",
    "major_confounders_or_mimics", "default_urgency", "diagnostic_boundary",
    "must_name_supporting_leads_when_regional", "source_keys", "population",
    "measurement_dependencies", "requires_clinical_context_for_syndrome_or_etiology",
}
check(
    "all_patterns_have_required_fields",
    all(required_pattern <= set(item) for item in patterns),
)
check(
    "all_patterns_have_source_keys",
    all(isinstance(item["source_keys"], list) and len(item["source_keys"]) >= 1 for item in patterns),
)
unknown_refs = sorted({
    key for item in patterns for key in item["source_keys"] if key not in set(source_keys)
})
check("pattern_source_refs_resolve", not unknown_refs, unknown_refs)

check(
    "all_patterns_have_diagnostic_boundaries",
    all(isinstance(item["diagnostic_boundary"], str) and item["diagnostic_boundary"].strip() for item in patterns),
)
check(
    "measurement_dependencies_are_lists",
    all(isinstance(item["measurement_dependencies"], list) for item in patterns),
)
check(
    "failure_severity_major_or_critical",
    all(item.get("severity") in {"major", "critical"} for item in failures),
)
check(
    "failure_contract_fields",
    all({"id", "name", "detection", "response", "severity"} <= set(item) for item in failures),
)
check(
    "source_contract_fields",
    all(
        {"key", "title", "year", "organizations", "type", "status", "url", "applies_to", "notes"}
        <= set(item)
        for item in sources
    ),
)
check(
    "source_registry_versions",
    patterns_doc.get("source_registry") == "63_SOURCE_REGISTRY.json"
    and sources_doc.get("version") == "2.0"
    and patterns_doc.get("version") == "5.0"
    and patterns_doc.get("snapshot_date") == "2026-09-12"
    and sources_doc.get("snapshot_date") == "2026-09-12",
)
check(
    "source_traceability_rule_declared",
    "authoritative source key" in patterns_doc.get("source_traceability_rule", "").lower(),
)
check(
    "candidate_has_no_activation_field",
    all("active" not in item and "activation" not in item for item in patterns),
)

if failed:
    print({
        "schema": "ekg-v12-1-registry-contract-tests-v1",
        "pass": False,
        "passed": passed,
        "failed": failed,
        "candidate_active": False,
    })
    raise SystemExit(1)

print({
    "schema": "ekg-v12-1-registry-contract-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "patterns": len(patterns),
    "failure_modes": len(failures),
    "sources": len(sources),
    "candidate_active": False,
})
