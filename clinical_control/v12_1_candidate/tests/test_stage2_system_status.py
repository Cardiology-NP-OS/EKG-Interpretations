from __future__ import annotations
import copy
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
GEN = ROOT / "validation_generated"
sys.path.insert(0, str(GEN))
import system_status_adapter as m

FIXTURE = GEN / "EP3_PKT01_STATUS_FIXTURES.json"
passed = 0

def check(name, value):
    global passed
    assert value, name
    passed += 1
    print("PASS", name)

def expect(name, code, fn):
    global passed
    try:
        fn()
    except (ValueError, RuntimeError) as exc:
        assert code in str(exc), (name, exc)
    else:
        raise AssertionError(name)
    passed += 1
    print("PASS", name)

def ref(ref_id, kind, char):
    return m.evidence_ref(ref_id, kind, char * 64)
def snapshot():
    substrate = m.current_substrate_state()
    return {
        "repository_binding": copy.deepcopy(m.accepted_authority()),
        "source": {
            "source_id": "synthetic-source-status",
            "source_sha256": "a" * 64,
            "state": "AVAILABLE",
            "raw_source_available": True,
            "raw_source_in_git": False,
            "source_verified": True,
            "evidence_refs": [ref("source-verification", "SOURCE_VERIFICATION", "1")],
        },
        "inspection": {
            "state": "AVAILABLE",
            "verified": True,
            "limitations": [],
            "evidence_refs": [ref("source-inspection", "SOURCE_INSPECTION", "2")],
        },
        "waveform_qc": {
            "state": "AVAILABLE",
            "verified": True,
            "limitations": [],
            "evidence_refs": [ref("waveform-qc", "WAVEFORM_QC", "3")],
        },
        "candidate_control": {
            "candidate_active": substrate["candidate_active"],
            "clinical_accuracy_claimed": substrate["clinical_accuracy_claimed"],
            "automatic_selection_allowed": substrate["automatic_selection_allowed"],
            "runtime_status": substrate["runtime_status"],
            "native_dataset_annotations_are_project_gold": False,
            "synthetic_fixtures_are_clinical_gold": False,
            "evidence_refs": [ref("candidate-control", "CANDIDATE_CONTROL", "4")],
        },
        "evaluation": {
            "approved_adjudicated_gold_count": substrate["approved_adjudicated_gold_count"],
            "diagnostic_performance_reporting_allowed": substrate["diagnostic_performance_reporting_allowed"],
            "clinical_accuracy_promotion_allowed": substrate["clinical_accuracy_promotion_allowed"],
            "evidence_refs": [ref("evaluation", "EVALUATION", "5")],
        },
    }

def set_path(value, dotted, replacement):
    node = value
    parts = dotted.split(".")
    for part in parts[:-1]:
        node = node[part]
    node[parts[-1]] = replacement
    return value

authority = m.accepted_authority()
check("authority_repository", authority["repository"] == "Cardiology-NP-OS/EKG-Interpretations")
check("authority_commit", authority["commit"] == "3d04986dcce2b20ed19a226e6596002878f8f031")
check("authority_tree", authority["tree"] == "245ebbe924befaf2a9ca510c59551554a2305baf")
check("authority_stage1_correction", authority["stage1_acceptance_receipt_sha256"] == "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")
check("authority_pattern_registry", authority["registry_binding"]["sha256"] == m.PATTERN_REGISTRY_SHA256)
check("authority_source_registry", authority["source_registry_sha256"] == m.SOURCE_REGISTRY_SHA256)

substrate = m.current_substrate_state()
check("substrate_candidate_inactive", substrate["candidate_active"] is False)
check("substrate_no_auto_selection", substrate["automatic_selection_allowed"] is False)
check("substrate_zero_gold", substrate["approved_adjudicated_gold_count"] == 0)
check("substrate_reporting_blocked", substrate["diagnostic_performance_reporting_allowed"] is False)
base = snapshot()
status = m.build_status(base)
check("available_is_governed_inactive", status["state"] == "GOVERNED_INACTIVE")
check("governance_always_inactive", status["governance_state"] == "GOVERNED_INACTIVE")
check("status_read_supported", status["capabilities"]["status.read"] == "SUPPORTED")
check("diagnostic_execute_unsupported", status["capabilities"]["diagnostic.execute"] == "UNSUPPORTED")
check("clinical_performance_blocked", status["capabilities"]["clinical_performance.read"] == "BLOCKED_ZERO_GOLD")
check("adapter_never_claims_accuracy", status["clinical_accuracy_claimed"] is False)
check("adapter_never_activates_diagnostic", status["diagnostic_runtime_activation_allowed"] is False)
check("adapter_no_silent_fallback", status["silent_fallback_allowed"] is False)
check("adapter_zero_gold", status["evaluation"]["approved_adjudicated_gold_count"] == 0)
check("adapter_native_labels_not_gold", status["candidate_control"]["native_dataset_annotations_are_project_gold"] is False)
check("adapter_synthetic_not_gold", status["candidate_control"]["synthetic_fixtures_are_clinical_gold"] is False)
check("status_hash_deterministic", status == m.build_status(copy.deepcopy(base)))
expect("diagnostic_execute_rejected", "DIAGNOSTIC_EXECUTION_UNSUPPORTED_GOVERNED_INACTIVE", lambda: m.diagnostic_execute({}))

expected_refs = sorted(
    [item for section in ("source", "inspection", "waveform_qc", "candidate_control", "evaluation")
     for item in base[section]["evidence_refs"]],
    key=lambda item: item["ref_id"],
)
check("provenance_refs_preserved_exactly", status["provenance_refs"] == expected_refs)
rendered = json.dumps(status, sort_keys=True).lower()
check("status_contains_no_diagnosis_surface", '"diagnosis"' not in rendered)
check("status_contains_no_raw_payload", "raw_source_bytes" not in rendered and "waveform_bytes" not in rendered)
missing = snapshot()
missing["source"].update({"state": "UNAVAILABLE", "raw_source_available": False, "source_verified": False})
missing["inspection"].update({"state": "UNAVAILABLE", "verified": False})
missing["waveform_qc"].update({"state": "UNAVAILABLE", "verified": False})
check("missing_source_unavailable", m.build_status(missing)["state"] == "UNAVAILABLE")

degraded = snapshot()
degraded["waveform_qc"]["state"] = "DEGRADED"
degraded["waveform_qc"]["limitations"] = ["SYNTHETIC_QC_DEGRADED"]
degraded_status = m.build_status(degraded)
check("degraded_qc_state", degraded_status["state"] == "DEGRADED")
check("degraded_reason_preserved", "SYNTHETIC_QC_DEGRADED" in degraded_status["limitations"])

unknown = snapshot()
unknown["inspection"].update({"state": "UNKNOWN", "verified": False})
check("unknown_inspection_unknown", m.build_status(unknown)["state"] == "UNKNOWN")

for name, path, value, code in [
    ("stale_commit", "repository_binding.commit", "0" * 40, "STALE_COMMIT"),
    ("stale_tree", "repository_binding.tree", "1" * 40, "STALE_TREE"),
    ("stale_stage1", "repository_binding.stage1_acceptance_receipt_sha256", "2" * 64, "STALE_STAGE1_ACCEPTANCE"),
    ("stale_source_registry", "repository_binding.source_registry_sha256", "3" * 64, "STALE_SOURCE_REGISTRY"),
]:
    case = set_path(snapshot(), path, value)
    out = m.build_status(case)
    check(name + "_fails_unknown", out["state"] == "UNKNOWN" and code in out["limitations"])
registry_stale = snapshot()
registry_stale["repository_binding"]["registry_binding"]["sha256"] = "4" * 64
registry_out = m.build_status(registry_stale)
check("stale_pattern_registry_unknown", registry_out["state"] == "UNKNOWN" and "STALE_PATTERN_REGISTRY" in registry_out["limitations"])

active = snapshot()
active["candidate_control"]["candidate_active"] = True
active_out = m.build_status(active)
check("candidate_active_snapshot_fails_closed", active_out["state"] == "UNKNOWN" and active_out["candidate_control"]["candidate_active"] is False)

gold = snapshot()
gold["evaluation"]["approved_adjudicated_gold_count"] = 1
gold_out = m.build_status(gold)
check("unexpected_gold_count_fails_closed", gold_out["state"] == "UNKNOWN" and gold_out["evaluation"]["approved_adjudicated_gold_count"] == 0)

native = snapshot()
native["candidate_control"]["native_dataset_annotations_are_project_gold"] = True
native_out = m.build_status(native)
check("native_label_promotion_fails_closed", native_out["state"] == "UNKNOWN" and native_out["candidate_control"]["native_dataset_annotations_are_project_gold"] is False)

synthetic = snapshot()
synthetic["candidate_control"]["synthetic_fixtures_are_clinical_gold"] = True
synthetic_out = m.build_status(synthetic)
check("synthetic_gold_promotion_fails_closed", synthetic_out["state"] == "UNKNOWN" and synthetic_out["candidate_control"]["synthetic_fixtures_are_clinical_gold"] is False)

raw_in_git = snapshot()
raw_in_git["source"]["raw_source_in_git"] = True
raw_out = m.build_status(raw_in_git)
check("raw_source_in_git_fails_closed", raw_out["state"] == "UNKNOWN" and "RAW_SOURCE_MUST_REMAIN_OUTSIDE_GIT" in raw_out["limitations"])
phi = snapshot()
phi["source"]["patient_name"] = "synthetic-name"
expect("phi_key_rejected", "DIRECT_IDENTIFIER_FORBIDDEN", lambda: m.build_status(phi))

raw = snapshot()
raw["source"]["raw_source_bytes"] = "not-allowed"
expect("raw_payload_rejected", "RAW_CLINICAL_PAYLOAD_FORBIDDEN", lambda: m.build_status(raw))

bad_ref = snapshot()
bad_ref["inspection"]["evidence_refs"][0]["artifact_sha256"] = "short"
expect("bad_evidence_hash_rejected", "EVIDENCE_REF_SHA256", lambda: m.build_status(bad_ref))

duplicate_ref = snapshot()
duplicate_ref["inspection"]["evidence_refs"][0]["ref_id"] = duplicate_ref["source"]["evidence_refs"][0]["ref_id"]
expect("cross_section_duplicate_ref_rejected", "EVIDENCE_REF_DUPLICATE_ACROSS_SECTIONS", lambda: m.build_status(duplicate_ref))

fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
check("fixture_non_phi", fixture["phi"] is False)
check("fixture_synthetic_only", fixture["synthetic_engineering_evidence_only"] is True)
check("fixture_no_raw_bytes", fixture["raw_clinical_source_bytes_included"] is False)
for scenario in fixture["scenarios"]:
    case = snapshot()
    for path, value in scenario["overrides"].items():
        set_path(case, path, value)
    check("fixture_" + scenario["id"], m.build_status(case)["state"] == scenario["expected_state"])

release = m.release_contract()
check("release_packet", release["packet"] == "PKT-EP3-01")
check("release_stage1_correction", release["stage1_acceptance_receipt_sha256"] == m.STAGE1_ACCEPTANCE_RECEIPT_SHA256)
check("release_status_read_only", release["status_read_supported"] is True and release["diagnostic_execution_supported"] is False)
check("release_zero_gold", release["approved_adjudicated_gold_count"] == 0)
check("release_no_accuracy", release["clinical_accuracy_claimed"] is False)
check("release_no_raw_source_git", release["raw_source_bytes_stored_in_git"] is False)
check("release_requires_independent_verification", release["independent_machine_verification_required"] is True)
check("release_requires_github_ci", release["github_ci_required"] is True)

print(json.dumps({
    "schema": "ekg-ep3-pkt01-system-status-tests-v1",
    "pass": True,
    "passed": passed,
    "total": passed,
    "candidate_active": False,
    "clinical_accuracy_claimed": False,
    "approved_adjudicated_gold_count": 0,
    "diagnostic_runtime_activation_allowed": False,
}, sort_keys=True))
