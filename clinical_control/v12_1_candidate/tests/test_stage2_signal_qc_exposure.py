from __future__ import annotations

import copy
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
GEN = ROOT / "validation_generated"
sys.path.insert(0, str(GEN))

import signal_qc_exposure as exposure
import source_evidence_bridge as bridge
import system_status_adapter as status

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
def sref(ref_id, kind, char):
    return status.evidence_ref(ref_id, kind, char * 64)

def status_snapshot():
    substrate = status.current_substrate_state()
    snap = {
        "repository_binding": copy.deepcopy(status.accepted_authority()),
        "source": {
            "source_id": "synthetic-source", "source_sha256": "a" * 64,
            "state": "AVAILABLE", "raw_source_available": True,
            "raw_source_in_git": False, "source_verified": True,
            "evidence_refs": [sref("source", "SOURCE_VERIFICATION", "1")],
        },
        "inspection": {
            "state": "AVAILABLE", "verified": True, "limitations": [],
            "evidence_refs": [sref("inspection", "SOURCE_INSPECTION", "2")],
        },
        "waveform_qc": {
            "state": "AVAILABLE", "verified": True, "limitations": [],
            "evidence_refs": [sref("qc", "WAVEFORM_QC", "3")],
        },
        "candidate_control": {
            **{k: substrate[k] for k in (
                "candidate_active", "clinical_accuracy_claimed",
                "automatic_selection_allowed", "runtime_status",
                "native_dataset_annotations_are_project_gold",
                "synthetic_fixtures_are_clinical_gold",
            )},
            "evidence_refs": [sref("candidate", "CANDIDATE_CONTROL", "4")],
        },
        "evaluation": {
            **{k: substrate[k] for k in (
                "approved_adjudicated_gold_count",
                "diagnostic_performance_reporting_allowed",
                "clinical_accuracy_promotion_allowed",
            )},
            "evidence_refs": [sref("evaluation", "EVALUATION", "5")],
        },
    }
    return status.build_status(snap)
def packet2(extra_state="AVAILABLE"):
    extra = bridge.bridge_ref(
        "lineage", "SOURCE_LINEAGE", "6" * 64, "Cardiology-NP-Evidence",
        state=extra_state, limitations=[],
    )
    return bridge.build_bridge(status_snapshot=status_snapshot(), evidence_refs=[extra])

def inspection():
    return {
        "evidence_ref_id": "inspection", "artifact_sha256": "2" * 64,
        "state": "AVAILABLE", "verified": True,
        "lead_names": ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"],
        "lead_count": 12, "sample_rate_hz": 100, "sample_count": 1000,
        "duration_seconds": 10, "source_identity_state": "VERIFIED",
        "limitations": [],
    }

def qc():
    return {
        "evidence_ref_id": "qc", "artifact_sha256": "3" * 64,
        "state": "AVAILABLE", "verified": True, "engineering_usable": True,
        "flags": [], "limitations": [],
    }

def preview():
    return {
        "preview_id": "preview-001", "summary_artifact_sha256": "7" * 64,
        "point_count": 256, "lead_count": 12, "bounded": True,
        "diagnostic_interpretation_included": False, "limitations": [],
    }

def transformation():
    return {
        "kind": "ORIGINAL", "source_artifact_sha256": "1" * 64,
        "derived_artifact_sha256": "1" * 64, "authority_state": "PRESERVED",
        "limitations": [],
    }
def calibration():
    return {
        "state": "TRUSTED", "evidence_ref_id": "inspection",
        "artifact_sha256": "2" * 64, "measurement_eligible": True,
        "paper_speed_mm_s": 25, "gain_mm_mv": 10, "limitations": [],
    }

def build(**changes):
    args = {
        "bridge_envelope": packet2(),
        "source_artifact_sha256": "1" * 64,
        "inspection": inspection(), "waveform_qc": qc(),
        "preview": preview(), "transformation": transformation(),
        "calibration": calibration(),
        "untrusted_metadata": [{
            "channel": "MACHINE_INTERPRETATION",
            "artifact_sha256": "8" * 64, "present": True,
        }],
    }
    args.update(changes)
    return exposure.build_exposure(**args)

check("baseline_commit", exposure.BASELINE_COMMIT == "e18739ea03bf1db800d27d5f9ae40d55efb66ad7")
check("baseline_tree", exposure.BASELINE_TREE == "b54b363ca8a7700a43983970fbaddd5f7f0a91fe")
check("stage1_receipt", exposure.STAGE1_RECEIPT_SHA256 == "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb")
check("prior_packet_receipt", exposure.PRIOR_PACKET_RECEIPT_SHA256 == "f0f8cd6b330ce56dc02267fd23cc85175d4d02037fb4f2f0b974508d078996eb")

base = build()
check("exposure_schema", base["schema"] == exposure.SCHEMA)
check("packet_id", base["packet_id"] == "PKT-EP3-03")
check("bundle_bound", base["binding"]["packet2_bundle_sha256"] == packet2()["bundle_sha256"])
check("exposure_hash", len(base["exposure_sha256"]) == 64)
check("exposure_id", base["exposure_id"] == "sqc_" + base["exposure_sha256"][:24])
check("deterministic", base == build())
check("engineering_usable_state", base["engineering_state"] == "USABLE")
check("engineering_usable_true", base["engineering_usable"] is True)
check("diagnostic_inactive", base["diagnostic_state"] == "GOVERNED_INACTIVE")
check("no_diagnostic_validity_inference", base["diagnostic_validity_inferred"] is False)
check("no_diagnostic_interpretation", base["diagnostic_interpretation_included"] is False)
check("no_diagnostic_activation", base["diagnostic_runtime_activation_allowed"] is False)
check("candidate_inactive", base["candidate_active"] is False)
check("zero_gold", base["approved_adjudicated_gold_count"] == 0)
check("reporting_blocked", base["diagnostic_performance_reporting_allowed"] is False)
check("no_accuracy_claim", base["clinical_accuracy_claimed"] is False)
check("native_labels_not_gold", base["native_dataset_annotations_are_project_gold"] is False)
check("synthetic_not_gold", base["synthetic_fixtures_are_clinical_gold"] is False)
check("no_raw_payload", base["raw_clinical_waveform_or_image_bytes_included"] is False)
check("no_authority_rewrite", base["authority_rewritten"] is False)
check("no_silent_fallback", base["silent_fallback_allowed"] is False)
check("inspection_nonclinical", base["inspection"]["diagnostic_interpretation_included"] is False)
check("qc_not_diagnostic_validity", base["waveform_qc"]["diagnostic_validity"] == "NOT_INFERRED")
check("preview_no_values", base["preview"]["raw_signal_values_included"] is False)
check("transform_no_restoration", base["transformation"]["authority_restored"] is False)
check("calibration_nonclinical", base["calibration"]["diagnostic_interpretation_included"] is False)
check("machine_text_inert", base["untrusted_metadata"][0]["authority"] == "UNTRUSTED_INERT")
check("machine_text_no_clinical_authority", base["untrusted_metadata"][0]["clinical_authority"] is False)

nav = exposure.navigation_descriptor(base)
check("navigation_read_only", nav["read_only"] is True)
check("navigation_no_payload", nav["raw_payload_included"] is False)
check("navigation_no_diagnosis", nav["diagnostic_interpretation"] is False)
check("navigation_no_authority_effect", nav["authority_effect"] == "NONE")
check("navigation_exact_exposure", nav["exposure_sha256"] == base["exposure_sha256"])
check("navigation_refs", len(nav["evidence_refs"]) == 3)
degraded_qc = qc()
degraded_qc.update(state="DEGRADED", engineering_usable=False, flags=["ALL_SAMPLES_IDENTICAL"], limitations=["ENGINEERING_QC_LIMITATION"])
degraded = build(waveform_qc=degraded_qc)
check("degraded_qc_state", degraded["engineering_state"] == "DEGRADED")
check("degraded_qc_not_usable", degraded["engineering_usable"] is False)
check("degraded_limitation_preserved", "ENGINEERING_QC_LIMITATION" in degraded["limitations"])

unavailable = build(bridge_envelope=packet2("UNAVAILABLE"))
check("unavailable_bridge_state", unavailable["engineering_state"] == "UNAVAILABLE")
check("unavailable_not_usable", unavailable["engineering_usable"] is False)

unknown_inspection = inspection()
unknown_inspection.update(state="UNKNOWN", verified=False, source_identity_state="UNKNOWN")
unknown = build(inspection=unknown_inspection)
check("unknown_inspection_state", unknown["engineering_state"] == "UNKNOWN")
check("unknown_not_usable", unknown["engineering_usable"] is False)

transformed = transformation()
transformed.update(
    kind="RESAMPLED", derived_artifact_sha256="9" * 64,
    authority_state="REDUCED", limitations=["RESAMPLED_SOURCE"],
    resample_rate_hz=500,
)
transformed_out = build(transformation=transformed)
check("transformed_degraded", transformed_out["engineering_state"] == "DEGRADED")
check("transformed_not_usable", transformed_out["engineering_usable"] is False)
check("transformed_limitation", "RESAMPLED_SOURCE" in transformed_out["limitations"])
check("transformed_no_authority_restore", transformed_out["transformation"]["authority_restored"] is False)
bad_bridge = copy.deepcopy(packet2())
bad_bridge["binding"]["baseline_tree"] = "0" * 40
expect("stale_bridge_rejected", "PACKET2_BUNDLE_HASH_MISMATCH", lambda: build(bridge_envelope=bad_bridge))

rehash_bridge = copy.deepcopy(packet2())
rehash_bridge["binding"]["baseline_tree"] = "0" * 40
body = copy.deepcopy(rehash_bridge)
body.pop("bundle_sha256")
rehash_bridge["bundle_sha256"] = hashlib.sha256(
    json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
).hexdigest()
expect("rehash_stale_authority_rejected", "PACKET2_BRIDGE_AUTHORITY_STALE", lambda: build(bridge_envelope=rehash_bridge))

expect("wrong_source_hash", "SOURCE_ARTIFACT_NOT_BOUND_TO_PACKET2", lambda: build(source_artifact_sha256="f" * 64))
wrong_inspection = inspection(); wrong_inspection["evidence_ref_id"] = "qc"
expect("inspection_kind_mismatch", "EVIDENCE_REF_KIND_MISMATCH", lambda: build(inspection=wrong_inspection))
wrong_artifact = inspection(); wrong_artifact["artifact_sha256"] = "f" * 64
expect("inspection_artifact_mismatch", "EVIDENCE_ARTIFACT_MISMATCH", lambda: build(inspection=wrong_artifact))
bad_leads = inspection(); bad_leads["lead_count"] = 11
expect("lead_count_mismatch", "LEAD_COUNT_MISMATCH", lambda: build(inspection=bad_leads))
bad_rate = inspection(); bad_rate["sample_rate_hz"] = float("inf")
expect("nonfinite_rate", "SAMPLE_RATE", lambda: build(inspection=bad_rate))
bad_duration = inspection(); bad_duration["duration_seconds"] = 0
expect("bad_duration", "DURATION_SECONDS", lambda: build(inspection=bad_duration))
raw_inspection = inspection(); raw_inspection["waveform_bytes"] = "synthetic"
expect("raw_waveform_rejected", "RAW_CLINICAL_PAYLOAD_FORBIDDEN", lambda: build(inspection=raw_inspection))
phi_inspection = inspection(); phi_inspection["patient_name"] = "synthetic"
expect("phi_rejected", "DIRECT_IDENTIFIER_FORBIDDEN", lambda: build(inspection=phi_inspection))
secret_qc = qc(); secret_qc["api_key"] = "synthetic"
expect("secret_rejected", "SECRET_MATERIAL_FORBIDDEN", lambda: build(waveform_qc=secret_qc))
clinical_qc = qc(); clinical_qc["diagnosis"] = "synthetic"
expect("clinical_field_rejected", "CLINICAL_INTERPRETATION_FIELD_FORBIDDEN", lambda: build(waveform_qc=clinical_qc))

raw_preview = preview(); raw_preview["samples"] = [1, 2, 3]
expect("preview_samples_rejected", "RAW_CLINICAL_PAYLOAD_FORBIDDEN", lambda: build(preview=raw_preview))
large_preview = preview(); large_preview["point_count"] = 513
expect("preview_bounded", "PREVIEW_POINT_COUNT", lambda: build(preview=large_preview))
diagnostic_preview = preview(); diagnostic_preview["diagnostic_interpretation_included"] = True
expect("preview_diagnostic_rejected", "PREVIEW_BOUNDARY", lambda: build(preview=diagnostic_preview))

resampled_no_limit = transformation()
resampled_no_limit.update(kind="RESAMPLED", derived_artifact_sha256="9" * 64)
expect("transformation_limitation_required", "TRANSFORMATION_LIMITATION_REQUIRED", lambda: build(transformation=resampled_no_limit))
resampled_same = transformation()
resampled_same.update(kind="RESAMPLED", limitations=["RESAMPLED"])
expect("transformation_new_hash_required", "TRANSFORMATION_DERIVED_HASH_REQUIRED", lambda: build(transformation=resampled_same))
restored = transformation(); restored["authority_state"] = "RESTORED"
expect("authority_restore_state_rejected", "TRANSFORMATION_AUTHORITY_STATE", lambda: build(transformation=restored))
wrong_transform_source = transformation(); wrong_transform_source["source_artifact_sha256"] = "f" * 64
expect("transform_source_mismatch", "TRANSFORMATION_SOURCE_MISMATCH", lambda: build(transformation=wrong_transform_source))
nonfinite_resample = transformation()
nonfinite_resample.update(kind="RESAMPLED", derived_artifact_sha256="9" * 64, limitations=["RESAMPLED"], resample_rate_hz=float("nan"))
expect("nonfinite_resample", "RESAMPLE_RATE", lambda: build(transformation=nonfinite_resample))

untrusted_cal = calibration(); untrusted_cal.update(state="UNTRUSTED", measurement_eligible=True)
expect("measurement_requires_trusted_calibration", "MEASUREMENT_REQUIRES_TRUSTED_CALIBRATION", lambda: build(calibration=untrusted_cal))
qc_cal = calibration(); qc_cal["evidence_ref_id"] = "qc"; qc_cal["artifact_sha256"] = "3" * 64
expect("calibration_ref_kind", "EVIDENCE_REF_KIND_MISMATCH", lambda: build(calibration=qc_cal))
bad_gain = calibration(); bad_gain["gain_mm_mv"] = float("nan")
expect("calibration_finite", "CALIBRATION_NUMERIC", lambda: build(calibration=bad_gain))

expect(
    "untrusted_text_content_rejected", "UNTRUSTED_TEXT_CONTENT_FORBIDDEN",
    lambda: build(untrusted_metadata=[{
        "channel": "OCR_TEXT", "artifact_sha256": "8" * 64,
        "present": True, "text": "synthetic",
    }]),
)
expect(
    "untrusted_channel_rejected", "UNTRUSTED_METADATA_CHANNEL",
    lambda: build(untrusted_metadata=[{
        "channel": "DIAGNOSIS", "artifact_sha256": "8" * 64, "present": True,
    }]),
)
native = build(untrusted_metadata=[{
    "channel": "NATIVE_DATASET_ANNOTATION", "artifact_sha256": "8" * 64, "present": True,
}])
check("native_annotation_inert", native["untrusted_metadata"][0]["authority"] == "UNTRUSTED_INERT")
check("native_annotation_not_gold", native["native_dataset_annotations_are_project_gold"] is False)
fixture = json.loads((GEN / "EP3_PKT03_SIGNAL_QC_FIXTURES.json").read_text(encoding="utf-8"))
check("fixture_non_phi", fixture["phi"] is False)
check("fixture_no_raw_bytes", fixture["raw_clinical_waveform_or_image_bytes_included"] is False)
check("fixture_candidate_inactive", fixture["candidate_active"] is False)
check("fixture_zero_gold", fixture["approved_adjudicated_gold_count"] == 0)
check("fixture_no_reporting", fixture["diagnostic_performance_reporting_allowed"] is False)
check("fixture_no_accuracy", fixture["clinical_accuracy_claimed"] is False)
check("fixture_native_not_gold", fixture["native_dataset_annotations_are_project_gold"] is False)
check("fixture_synthetic_not_gold", fixture["synthetic_fixtures_are_clinical_gold"] is False)
check("fixture_scenarios", len(fixture["scenarios"]) == 8)

release = exposure.release_contract()
check("release_packet", release["packet"] == "PKT-EP3-03")
check("release_baseline", release["baseline_commit"] == exposure.BASELINE_COMMIT and release["baseline_tree"] == exposure.BASELINE_TREE)
check("release_stage1", release["stage1_receipt_sha256"] == exposure.STAGE1_RECEIPT_SHA256)
check("release_prior", release["accepted_prior_packet_receipt_sha256"] == exposure.PRIOR_PACKET_RECEIPT_SHA256)
check("release_no_diagnostic_execution", release["diagnostic_execution_supported"] is False)
check("release_candidate_inactive", release["candidate_active"] is False)
check("release_zero_gold", release["approved_adjudicated_gold_count"] == 0)
check("release_reporting_blocked", release["diagnostic_performance_reporting_allowed"] is False)
check("release_no_accuracy", release["clinical_accuracy_claimed"] is False)
check("release_no_authority_rewrite", release["authority_rewritten"] is False)
check("release_requires_proof", release["independent_machine_verification_required"] is True and release["github_ci_required"] is True)

print(json.dumps({
    "schema": "ekg-ep3-pkt03-signal-qc-tests-v1", "pass": True,
    "passed": passed, "total": passed, "candidate_active": False,
    "approved_adjudicated_gold_count": 0,
    "diagnostic_runtime_activation_allowed": False,
    "diagnostic_performance_reporting_allowed": False,
    "clinical_accuracy_claimed": False,
}, sort_keys=True))
