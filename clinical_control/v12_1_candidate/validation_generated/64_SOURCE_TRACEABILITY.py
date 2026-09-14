from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "validation_generated"
CORE = ROOT / "source_core"
TEXT = ROOT / "source_text"

EXPECTED = {
    TEXT / "12_CLINICAL_CRITERIA_REGISTRY.md":
        "7c771f498304ebdaaf3cfd98c0ea7d14e08e8d35c01180c7b91c76f7a35c6f1e",
    TEXT / "30_CURRENT_SOURCE_MAP_2026.md":
        "5d9fc89a372c702fed968770e83dc8de2d6b78a35105b93b93780e69c7368f16",
    CORE / "63_SOURCE_REGISTRY.json":
        "c1d9d116755931487a9b5434832aa2827763bf7ef772449963588da20b20b89e",
    CORE / "23_PATTERN_REGISTRY.json":
        "05764e9437862f6c4f1948c6f0385abb320764c4cb0f2007ce7c426df7d31fdb",
}

ORIGINAL_ARCHIVE_SHA256 = (
    "c8d911ec42dc09ece708f8bafe4956a9f90853129ead04a8851383ebdb845ef5"
)
DERIVATIVE_ARCHIVE_SHA256 = (
    "61aa14599f66df4067b0e3e8671a6860e6d324c97b891e4b18a391a61c89e396"
)

def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))

def normalize_doi(value: str) -> str:
    return value.strip().lower().rstrip(".")

def render_matrix(rows: list[dict]) -> str:
    lines = [
        "# V12.1 Criteria → Source Traceability Matrix",
        "",
        "Generated validation artifact. The uploaded clinical-control sources remain unchanged.",
        "",
        "| Criteria section | Source key | Registry title | Human map coverage |",
        "| --- | --- | --- | --- |",
    ]
    for row in rows:
        title = row["title"].replace("|", "\\|")
        lines.append(
            f'| {row["section_id"]} | `{row["source_key"]}` | {title} | '
            f'{row["coverage"]} |'
        )
    lines += [
        "",
        "Candidate activation: **false**.",
        "",
        f"Original user archive SHA-256: `{ORIGINAL_ARCHIVE_SHA256}`.",
        f"Generated derivative SHA-256: `{DERIVATIVE_ARCHIVE_SHA256}`.",
        "",
    ]
    return "\n".join(lines)

def audit() -> dict:
    errors: list[str] = []

    for path, expected in EXPECTED.items():
        if not path.exists():
            errors.append(f"MISSING_SOURCE:{path.name}")
            continue
        got = sha256(path)
        if got != expected:
            errors.append(f"SOURCE_SHA256_MISMATCH:{path.name}:{got}")

    criteria = (TEXT / "12_CLINICAL_CRITERIA_REGISTRY.md").read_text(encoding="utf-8")
    source_map = (TEXT / "30_CURRENT_SOURCE_MAP_2026.md").read_text(encoding="utf-8")
    registry = load_json(CORE / "63_SOURCE_REGISTRY.json")
    patterns = load_json(CORE / "23_PATTERN_REGISTRY.json")
    bindings = load_json(GEN / "CRITERIA_SOURCE_BINDINGS.json")
    supplement = load_json(GEN / "SOURCE_MAP_SUPPLEMENT.json")
    import_manifest = load_json(ROOT / "IMPORT_MANIFEST.json")

    if import_manifest["source_pack"]["sha256"] != ORIGINAL_ARCHIVE_SHA256:
        errors.append("ORIGINAL_ARCHIVE_IDENTITY_MISMATCH")
    if import_manifest["source_pack"].get("runtime_validator_pass") is not True:
        errors.append("ORIGINAL_ARCHIVE_VALIDATOR_NOT_PASS")
    av = import_manifest.get("archive_validation", {})
    if av.get("manifest_entries_expected") != 27:
        errors.append("ORIGINAL_ARCHIVE_MANIFEST_COUNT_MISMATCH")
    if av.get("manifest_entries_matched") != 27:
        errors.append("ORIGINAL_ARCHIVE_MATCH_COUNT_MISMATCH")
    if av.get("manifest_hash_mismatches") != 0:
        errors.append("ORIGINAL_ARCHIVE_HASH_MISMATCH_PRESENT")
    if av.get("manifest_entries_missing") != 0:
        errors.append("ORIGINAL_ARCHIVE_MISSING_ENTRY_PRESENT")
    derivative = av.get("generated_derivative", {})
    if derivative.get("sha256") != DERIVATIVE_ARCHIVE_SHA256:
        errors.append("GENERATED_DERIVATIVE_IDENTITY_MISMATCH")

    sources = {item["key"]: item for item in registry["sources"]}
    if len(sources) != 21:
        errors.append(f"SOURCE_COUNT_NOT_21:{len(sources)}")

    map_dois = {
        normalize_doi(v)
        for v in re.findall(r"DOI:\s*\`([^\`]+)\`", source_map, flags=re.I)
    }
    registry_by_doi = {
        normalize_doi(item["doi"]): item["key"]
        for item in registry["sources"]
        if item.get("doi")
    }
    unresolved_map_dois = sorted(map_dois - set(registry_by_doi))
    if unresolved_map_dois:
        errors.append("UNRESOLVED_SOURCE_MAP_DOIS:" + ",".join(unresolved_map_dois))

    section_ids = [item["section_id"] for item in bindings["sections"]]
    if len(section_ids) != 8 or len(section_ids) != len(set(section_ids)):
        errors.append("CRITERIA_SECTION_BINDING_COUNT_OR_UNIQUENESS_FAILED")

    supplement_keys = [item["source_key"] for item in supplement["entries"]]
    if len(supplement_keys) != len(set(supplement_keys)):
        errors.append("SUPPLEMENT_SOURCE_KEYS_NOT_UNIQUE")
    if supplement.get("original_source_map_sha256") != EXPECTED[
        TEXT / "30_CURRENT_SOURCE_MAP_2026.md"
    ]:
        errors.append("SUPPLEMENT_SOURCE_MAP_HASH_MISMATCH")

    rows: list[dict] = []
    directly_covered: set[str] = set()
    bound_keys: set[str] = set()

    for section in bindings["sections"]:
        heading = section["criteria_heading_prefix"]
        if heading not in criteria:
            errors.append(f"CRITERIA_HEADING_NOT_FOUND:{section['section_id']}")
        if not section["source_keys"]:
            errors.append(f"CRITERIA_SECTION_HAS_NO_SOURCE:{section['section_id']}")
        for key in section["source_keys"]:
            bound_keys.add(key)
            if key not in sources:
                errors.append(f"UNKNOWN_BOUND_SOURCE_KEY:{section['section_id']}:{key}")
                continue
            source = sources[key]
            doi = normalize_doi(source["doi"]) if source.get("doi") else None
            if doi and doi in map_dois:
                coverage = "original source map DOI"
                directly_covered.add(key)
            elif key in supplement_keys:
                coverage = "validation supplement → registry"
            else:
                coverage = "MISSING"
                errors.append(f"BOUND_SOURCE_NOT_IN_MAP_OR_SUPPLEMENT:{section['section_id']}:{key}")
            rows.append({
                "section_id": section["section_id"],
                "source_key": key,
                "title": source["title"],
                "coverage": coverage,
            })

    expected_supplement = sorted(bound_keys - directly_covered)
    if sorted(supplement_keys) != expected_supplement:
        errors.append(
            "SUPPLEMENT_DRIFT:expected="
            + ",".join(expected_supplement)
            + ":actual="
            + ",".join(sorted(supplement_keys))
        )

    pattern_unknown = sorted({
        key
        for pattern in patterns["patterns"]
        for key in pattern["source_keys"]
        if key not in sources
    })
    if pattern_unknown:
        errors.append("PATTERN_SOURCE_KEY_UNRESOLVED:" + ",".join(pattern_unknown))

    required_criteria_tokens = [
        "63_SOURCE_REGISTRY.json",
        "30_CURRENT_SOURCE_MAP_2026.md",
        "23_PATTERN_REGISTRY.json",
        "64_SOURCE_TRACEABILITY.py",
    ]
    for token in required_criteria_tokens:
        if token not in criteria:
            errors.append(f"CRITERIA_AUTHORITY_TOKEN_MISSING:{token}")

    for token in ["59_TRACEABILITY_MATRIX.md", "17_CHANGELOG.md"]:
        if token not in source_map:
            errors.append(f"SOURCE_MAP_UPDATE_TOKEN_MISSING:{token}")

    if "candidate_active" not in bindings or bindings["candidate_active"] is not False:
        errors.append("BINDINGS_CANDIDATE_ACTIVE_NOT_FALSE")
    if supplement.get("candidate_active") is not False:
        errors.append("SUPPLEMENT_CANDIDATE_ACTIVE_NOT_FALSE")

    matrix = render_matrix(rows)
    matrix_path = GEN / "59_TRACEABILITY_MATRIX.md"

    return {
        "schema": "ekg-v12-1-source-traceability-audit-v1",
        "pass": not errors,
        "candidate_active": False,
        "criteria_sections_bound": len(bindings["sections"]),
        "bound_source_keys": len(bound_keys),
        "source_registry_records": len(sources),
        "source_map_dois": len(map_dois),
        "unresolved_source_map_dois": unresolved_map_dois,
        "supplement_source_keys": sorted(supplement_keys),
        "pattern_source_keys_unresolved": pattern_unknown,
        "errors": errors,
        "matrix": matrix,
        "matrix_path": str(matrix_path),
    }

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-matrix", action="store_true")
    args = parser.parse_args()

    result = audit()
    matrix_path = Path(result["matrix_path"])

    if result["pass"] and args.write_matrix:
        matrix_path.write_text(result["matrix"], encoding="utf-8", newline="\n")
    elif result["pass"]:
        if not matrix_path.exists():
            result["pass"] = False
            result["errors"].append("TRACEABILITY_MATRIX_MISSING")
        elif matrix_path.read_text(encoding="utf-8") != result["matrix"]:
            result["pass"] = False
            result["errors"].append("TRACEABILITY_MATRIX_STALE")

    public = {k: v for k, v in result.items() if k not in {"matrix", "matrix_path"}}
    print(json.dumps(public, sort_keys=True))
    return 0 if result["pass"] else 1

if __name__ == "__main__":
    raise SystemExit(main())
