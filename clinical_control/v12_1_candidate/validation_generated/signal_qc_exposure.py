"""EP3 Packet 3 engineering-only signal inspection and waveform-QC exposure.

This is a metadata boundary over the accepted Packet-2 source-evidence bridge.
It never exposes raw waveform/image bytes, performs diagnostic interpretation,
or changes governed-inactive EKG authority.
"""
from __future__ import annotations

import hashlib
import json
import math
from copy import deepcopy

import source_evidence_bridge as bridge
import system_status_adapter as status

SCHEMA = "ekg-ep3-pkt03-signal-qc-exposure-v1"
BASELINE_COMMIT = "e18739ea03bf1db800d27d5f9ae40d55efb66ad7"
BASELINE_TREE = "b54b363ca8a7700a43983970fbaddd5f7f0a91fe"
STAGE1_RECEIPT_SHA256 = "76990f505563655ca9ca98a29520cb43dc22e9e46f3ef4af5c4427b4ab923ddb"
PRIOR_PACKET_RECEIPT_SHA256 = "f0f8cd6b330ce56dc02267fd23cc85175d4d02037fb4f2f0b974508d078996eb"

EVIDENCE_STATES = {"AVAILABLE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"}
ENGINEERING_STATES = {"USABLE", "DEGRADED", "UNAVAILABLE", "UNKNOWN"}
TRANSFORM_KINDS = {"ORIGINAL", "RESAMPLED", "CROPPED", "TRANSFORMED"}
AUTHORITY_STATES = {"PRESERVED", "REDUCED", "UNKNOWN"}
CALIBRATION_STATES = {"TRUSTED", "UNTRUSTED", "UNKNOWN"}
UNTRUSTED_CHANNELS = {"MACHINE_INTERPRETATION", "OCR_TEXT", "NATIVE_DATASET_ANNOTATION", "EMBEDDED_LABEL"}
RAW_KEYS = set(status.RAW_PAYLOAD_KEYS) | {
    "raw_image_bytes", "image_bytes", "pixels", "samples", "sample_values",
    "waveform", "waveform_data", "ecg", "signal", "raw_payload",
}
CLINICAL_KEYS = {
    "diagnosis", "diagnoses", "interpretation", "clinical_interpretation",
    "rhythm_classification", "morphology_diagnosis", "treatment", "prescription",
    "clinical_validity", "clinical_gold",
}
CONTENT_KEYS = {"text", "content", "ocr_text", "machine_interpretation_text", "label_text"}


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _digest(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _sha(value, code, length=64):
    if not isinstance(value, str) or len(value) != length:
        raise ValueError(code)
    try:
        int(value, 16)
    except ValueError as exc:
        raise ValueError(code) from exc
    return value.lower()


def _required(value, fields, code):
    if not isinstance(value, dict):
        raise ValueError(code)
    missing = sorted(set(fields) - set(value))
    if missing:
        raise ValueError(code + ":" + ",".join(missing))
def _walk_safe(value, path="$"):
    if isinstance(value, list):
        for index, item in enumerate(value):
            _walk_safe(item, f"{path}[{index}]")
        return
    if not isinstance(value, dict):
        return
    for key, item in value.items():
        lowered = str(key).lower()
        if lowered in status.PHI_KEYS:
            raise ValueError("DIRECT_IDENTIFIER_FORBIDDEN:" + path + "." + str(key))
        if lowered in status.SECRET_KEYS:
            raise ValueError("SECRET_MATERIAL_FORBIDDEN:" + path + "." + str(key))
        if lowered in RAW_KEYS:
            raise ValueError("RAW_CLINICAL_PAYLOAD_FORBIDDEN:" + path + "." + str(key))
        if lowered in CLINICAL_KEYS:
            raise ValueError("CLINICAL_INTERPRETATION_FIELD_FORBIDDEN:" + path + "." + str(key))
        _walk_safe(item, path + "." + str(key))


def _safe_strings(values, code, max_items=64, max_length=160):
    if not isinstance(values, list) or len(values) > max_items:
        raise ValueError(code)
    if any(not isinstance(item, str) or len(item) > max_length for item in values):
        raise ValueError(code)
    return sorted(set(values))


def _validate_bridge(envelope):
    if not isinstance(envelope, dict):
        raise ValueError("PACKET2_BRIDGE_REQUIRED")
    _walk_safe(envelope)
    if envelope.get("schema") != bridge.SCHEMA:
        raise ValueError("PACKET2_BRIDGE_SCHEMA")
    _required(envelope, {
        "schema", "binding", "state", "status_sha256", "evidence_refs", "limitations",
        "raw_clinical_source_bytes_in_git", "native_dataset_annotations_are_project_gold",
        "synthetic_fixtures_are_clinical_gold", "candidate_active",
        "approved_adjudicated_gold_count", "diagnostic_runtime_activation_allowed",
        "diagnostic_performance_reporting_allowed", "clinical_accuracy_claimed",
        "authority_rewritten", "silent_fallback_allowed", "bundle_sha256",
    }, "PACKET2_BRIDGE_FIELDS")
    body = deepcopy(envelope)
    declared = body.pop("bundle_sha256")
    if _sha(declared, "PACKET2_BUNDLE_SHA256") != _digest(body):
        raise ValueError("PACKET2_BUNDLE_HASH_MISMATCH")
    if envelope["binding"] != bridge.accepted_packet1_binding():
        raise ValueError("PACKET2_BRIDGE_AUTHORITY_STALE")
    if envelope["state"] not in bridge.BRIDGE_STATES:
        raise ValueError("PACKET2_BRIDGE_STATE")
    _sha(envelope["status_sha256"], "PACKET2_STATUS_SHA256")
    if envelope["raw_clinical_source_bytes_in_git"] is not False:
        raise ValueError("RAW_SOURCE_IN_GIT_FORBIDDEN")
    if envelope["candidate_active"] is not False:
        raise ValueError("CANDIDATE_ACTIVE_FORBIDDEN")
    if envelope["approved_adjudicated_gold_count"] != 0:
        raise ValueError("UNAPPROVED_GOLD_COUNT")
    if envelope["diagnostic_runtime_activation_allowed"] is not False:
        raise ValueError("DIAGNOSTIC_ACTIVATION_FORBIDDEN")
    if envelope["diagnostic_performance_reporting_allowed"] is not False:
        raise ValueError("DIAGNOSTIC_REPORTING_FORBIDDEN")
    if envelope["clinical_accuracy_claimed"] is not False:
        raise ValueError("CLINICAL_ACCURACY_CLAIM_FORBIDDEN")
    if envelope["native_dataset_annotations_are_project_gold"] is not False:
        raise ValueError("NATIVE_LABEL_GOLD_FORBIDDEN")
    if envelope["synthetic_fixtures_are_clinical_gold"] is not False:
        raise ValueError("SYNTHETIC_GOLD_FORBIDDEN")
    if envelope["authority_rewritten"] is not False or envelope["silent_fallback_allowed"] is not False:
        raise ValueError("PACKET2_AUTHORITY_BOUNDARY_CHANGED")
    return envelope


def _bridge_refs(envelope):
    refs = {}
    for row in envelope["evidence_refs"]:
        _required(row, {"origin", "ref"}, "PACKET2_REF_ROW")
        ref = row["ref"]
        _required(ref, {"ref_id", "kind", "artifact_sha256"}, "PACKET2_REF")
        _sha(ref["artifact_sha256"], "PACKET2_REF_SHA256")
        ref_id = str(ref["ref_id"])
        if ref_id in refs and refs[ref_id] != row:
            raise ValueError("PACKET2_REF_CONFLICT:" + ref_id)
        refs[ref_id] = deepcopy(row)
    return refs
def _bound_ref(refs, ref_id, expected_kind, artifact_sha256=None):
    if not isinstance(ref_id, str) or not ref_id.strip():
        raise ValueError("EVIDENCE_REF_ID_REQUIRED")
    row = refs.get(ref_id)
    if row is None:
        raise ValueError("EVIDENCE_REF_MISSING:" + ref_id)
    ref = row["ref"]
    if ref.get("kind") != expected_kind:
        raise ValueError("EVIDENCE_REF_KIND_MISMATCH:" + ref_id)
    if artifact_sha256 is not None and ref.get("artifact_sha256") != _sha(artifact_sha256, "ARTIFACT_SHA256"):
        raise ValueError("EVIDENCE_ARTIFACT_MISMATCH:" + ref_id)
    return deepcopy(row)


def inspection_descriptor(value, refs):
    _walk_safe(value, "$.inspection")
    _required(value, {
        "evidence_ref_id", "artifact_sha256", "state", "verified",
        "lead_names", "lead_count", "sample_rate_hz", "sample_count",
        "duration_seconds", "source_identity_state",
    }, "INSPECTION_FIELDS")
    allowed = {
        "evidence_ref_id", "artifact_sha256", "state", "verified",
        "lead_names", "lead_count", "sample_rate_hz", "sample_count",
        "duration_seconds", "source_identity_state", "limitations",
    }
    extra = sorted(set(value) - allowed)
    if extra:
        raise ValueError("INSPECTION_FIELD_FORBIDDEN:" + ",".join(extra))
    if value["state"] not in EVIDENCE_STATES:
        raise ValueError("INSPECTION_STATE")
    if not isinstance(value["verified"], bool):
        raise ValueError("INSPECTION_VERIFIED")
    artifact = _sha(value["artifact_sha256"], "INSPECTION_ARTIFACT_SHA256")
    bound = _bound_ref(refs, value["evidence_ref_id"], "SOURCE_INSPECTION", artifact)
    lead_names = _safe_strings(value["lead_names"], "LEAD_NAMES", max_items=32, max_length=16)
    if type(value["lead_count"]) is not int or value["lead_count"] < 1 or value["lead_count"] > 32:
        raise ValueError("LEAD_COUNT")
    if len(lead_names) != value["lead_count"]:
        raise ValueError("LEAD_COUNT_MISMATCH")
    if not isinstance(value["sample_rate_hz"], (int, float)) or not math.isfinite(value["sample_rate_hz"]) or value["sample_rate_hz"] <= 0 or value["sample_rate_hz"] > 10000:
        raise ValueError("SAMPLE_RATE")
    if type(value["sample_count"]) is not int or value["sample_count"] < 1:
        raise ValueError("SAMPLE_COUNT")
    if not isinstance(value["duration_seconds"], (int, float)) or not math.isfinite(value["duration_seconds"]) or value["duration_seconds"] <= 0:
        raise ValueError("DURATION_SECONDS")
    if value["source_identity_state"] not in {"VERIFIED", "UNKNOWN", "CONFLICT"}:
        raise ValueError("SOURCE_IDENTITY_STATE")
    return {
        "schema": "ekg-engineering-inspection-descriptor-v1",
        "evidence_ref": bound,
        "artifact_sha256": artifact,
        "state": value["state"], "verified": value["verified"],
        "lead_names": lead_names, "lead_count": value["lead_count"],
        "sample_rate_hz": value["sample_rate_hz"], "sample_count": value["sample_count"],
        "duration_seconds": value["duration_seconds"],
        "source_identity_state": value["source_identity_state"],
        "limitations": _safe_strings(value.get("limitations", []), "INSPECTION_LIMITATIONS"),
        "diagnostic_interpretation_included": False,
        "clinical_validity_inferred": False,
    }


def qc_descriptor(value, refs):
    _walk_safe(value, "$.waveform_qc")
    _required(value, {
        "evidence_ref_id", "artifact_sha256", "state", "verified",
        "engineering_usable", "flags", "limitations",
    }, "WAVEFORM_QC_FIELDS")
    allowed = {
        "evidence_ref_id", "artifact_sha256", "state", "verified",
        "engineering_usable", "flags", "limitations",
    }
    extra = sorted(set(value) - allowed)
    if extra:
        raise ValueError("WAVEFORM_QC_FIELD_FORBIDDEN:" + ",".join(extra))
    if value["state"] not in EVIDENCE_STATES:
        raise ValueError("WAVEFORM_QC_STATE")
    if not isinstance(value["verified"], bool) or not isinstance(value["engineering_usable"], bool):
        raise ValueError("WAVEFORM_QC_BOOLEAN")
    artifact = _sha(value["artifact_sha256"], "WAVEFORM_QC_ARTIFACT_SHA256")
    bound = _bound_ref(refs, value["evidence_ref_id"], "WAVEFORM_QC", artifact)
    return {
        "schema": "ekg-engineering-waveform-qc-descriptor-v1",
        "evidence_ref": bound,
        "artifact_sha256": artifact,
        "state": value["state"], "verified": value["verified"],
        "engineering_usable": value["engineering_usable"],
        "flags": _safe_strings(value["flags"], "WAVEFORM_QC_FLAGS"),
        "limitations": _safe_strings(value["limitations"], "WAVEFORM_QC_LIMITATIONS"),
        "diagnostic_validity": "NOT_INFERRED",
        "clinical_accuracy_claimed": False,
    }


def preview_descriptor(value):
    _walk_safe(value, "$.preview")
    _required(value, {
        "preview_id", "summary_artifact_sha256", "point_count",
        "lead_count", "bounded", "diagnostic_interpretation_included",
    }, "PREVIEW_FIELDS")
    allowed = {
        "preview_id", "summary_artifact_sha256", "point_count",
        "lead_count", "bounded", "diagnostic_interpretation_included", "limitations",
    }
    extra = sorted(set(value) - allowed)
    if extra:
        raise ValueError("PREVIEW_FIELD_FORBIDDEN:" + ",".join(extra))
    if not isinstance(value["preview_id"], str) or not value["preview_id"].strip():
        raise ValueError("PREVIEW_ID")
    _sha(value["summary_artifact_sha256"], "PREVIEW_ARTIFACT_SHA256")
    if type(value["point_count"]) is not int or value["point_count"] < 0 or value["point_count"] > 512:
        raise ValueError("PREVIEW_POINT_COUNT")
    if type(value["lead_count"]) is not int or value["lead_count"] < 1 or value["lead_count"] > 32:
        raise ValueError("PREVIEW_LEAD_COUNT")
    if value["bounded"] is not True or value["diagnostic_interpretation_included"] is not False:
        raise ValueError("PREVIEW_BOUNDARY")
    return {
        "schema": "ekg-engineering-preview-descriptor-v1",
        "preview_id": value["preview_id"],
        "summary_artifact_sha256": value["summary_artifact_sha256"],
        "point_count": value["point_count"], "lead_count": value["lead_count"],
        "bounded": True, "raw_signal_values_included": False,
        "diagnostic_interpretation_included": False,
        "limitations": _safe_strings(value.get("limitations", []), "PREVIEW_LIMITATIONS"),
    }


def transformation_descriptor(value):
    _walk_safe(value, "$.transformation")
    _required(value, {
        "kind", "source_artifact_sha256", "derived_artifact_sha256",
        "authority_state", "limitations",
    }, "TRANSFORMATION_FIELDS")
    allowed = {
        "kind", "source_artifact_sha256", "derived_artifact_sha256",
        "authority_state", "limitations", "resample_rate_hz", "crop_descriptor",
    }
    extra = sorted(set(value) - allowed)
    if extra:
        raise ValueError("TRANSFORMATION_FIELD_FORBIDDEN:" + ",".join(extra))
    if value["kind"] not in TRANSFORM_KINDS:
        raise ValueError("TRANSFORMATION_KIND")
    source_hash = _sha(value["source_artifact_sha256"], "TRANSFORM_SOURCE_SHA256")
    derived_hash = _sha(value["derived_artifact_sha256"], "TRANSFORM_DERIVED_SHA256")
    if value["authority_state"] not in AUTHORITY_STATES:
        raise ValueError("TRANSFORMATION_AUTHORITY_STATE")
    limitations = _safe_strings(value["limitations"], "TRANSFORMATION_LIMITATIONS")
    if value["kind"] != "ORIGINAL" and not limitations:
        raise ValueError("TRANSFORMATION_LIMITATION_REQUIRED")
    if value["kind"] != "ORIGINAL" and source_hash == derived_hash:
        raise ValueError("TRANSFORMATION_DERIVED_HASH_REQUIRED")
    if value.get("resample_rate_hz") is not None:
        if not isinstance(value["resample_rate_hz"], (int, float)) or not math.isfinite(value["resample_rate_hz"]) or value["resample_rate_hz"] <= 0:
            raise ValueError("RESAMPLE_RATE")
    if value.get("crop_descriptor") is not None:
        if not isinstance(value["crop_descriptor"], str) or len(value["crop_descriptor"]) > 120:
            raise ValueError("CROP_DESCRIPTOR")
    return {
        "schema": "ekg-source-transformation-descriptor-v1",
        "kind": value["kind"], "source_artifact_sha256": source_hash,
        "derived_artifact_sha256": derived_hash,
        "authority_state": value["authority_state"], "limitations": limitations,
        "resample_rate_hz": value.get("resample_rate_hz"),
        "crop_descriptor": value.get("crop_descriptor"),
        "authority_restored": False,
    }


def calibration_descriptor(value, refs):
    _walk_safe(value, "$.calibration")
    _required(value, {
        "state", "evidence_ref_id", "artifact_sha256",
        "measurement_eligible", "limitations",
    }, "CALIBRATION_FIELDS")
    allowed = {
        "state", "evidence_ref_id", "artifact_sha256",
        "measurement_eligible", "limitations", "paper_speed_mm_s", "gain_mm_mv",
    }
    extra = sorted(set(value) - allowed)
    if extra:
        raise ValueError("CALIBRATION_FIELD_FORBIDDEN:" + ",".join(extra))
    if value["state"] not in CALIBRATION_STATES:
        raise ValueError("CALIBRATION_STATE")
    if not isinstance(value["measurement_eligible"], bool):
        raise ValueError("MEASUREMENT_ELIGIBLE")
    artifact = _sha(value["artifact_sha256"], "CALIBRATION_ARTIFACT_SHA256")
    bound = _bound_ref(refs, value["evidence_ref_id"], "SOURCE_INSPECTION", artifact)
    if value["measurement_eligible"] and value["state"] != "TRUSTED":
        raise ValueError("MEASUREMENT_REQUIRES_TRUSTED_CALIBRATION")
    for key in ("paper_speed_mm_s", "gain_mm_mv"):
        if value.get(key) is not None and (not isinstance(value[key], (int, float)) or not math.isfinite(value[key]) or value[key] <= 0):
            raise ValueError("CALIBRATION_NUMERIC")
    return {
        "schema": "ekg-calibration-trust-descriptor-v1",
        "state": value["state"], "evidence_ref": bound,
        "artifact_sha256": artifact,
        "measurement_eligible": value["measurement_eligible"],
        "paper_speed_mm_s": value.get("paper_speed_mm_s"),
        "gain_mm_mv": value.get("gain_mm_mv"),
        "limitations": _safe_strings(value["limitations"], "CALIBRATION_LIMITATIONS"),
        "diagnostic_interpretation_included": False,
    }


def untrusted_descriptors(values):
    if not isinstance(values, list) or len(values) > 64:
        raise ValueError("UNTRUSTED_METADATA_ARRAY")
    output = []
    for value in values:
        _walk_safe(value, "$.untrusted_metadata")
        _required(value, {"channel", "artifact_sha256", "present"}, "UNTRUSTED_METADATA_FIELDS")
        allowed = {"channel", "artifact_sha256", "present"}
        extra = sorted(set(value) - allowed)
        if extra:
            if any(key.lower() in CONTENT_KEYS for key in extra):
                raise ValueError("UNTRUSTED_TEXT_CONTENT_FORBIDDEN")
            raise ValueError("UNTRUSTED_METADATA_FIELD_FORBIDDEN:" + ",".join(extra))
        if value["channel"] not in UNTRUSTED_CHANNELS:
            raise ValueError("UNTRUSTED_METADATA_CHANNEL")
        if not isinstance(value["present"], bool):
            raise ValueError("UNTRUSTED_METADATA_PRESENT")
        output.append({
            "channel": value["channel"],
            "artifact_sha256": _sha(value["artifact_sha256"], "UNTRUSTED_METADATA_SHA256"),
            "present": value["present"],
            "authority": "UNTRUSTED_INERT",
            "clinical_authority": False,
        })
    return sorted(output, key=lambda row: (row["channel"], row["artifact_sha256"]))


def _engineering_state(bridge_envelope, inspection, qc):
    if bridge_envelope["state"] == "UNAVAILABLE" or inspection["state"] == "UNAVAILABLE" or qc["state"] == "UNAVAILABLE":
        return "UNAVAILABLE"
    if bridge_envelope["state"] == "UNKNOWN" or inspection["state"] == "UNKNOWN" or qc["state"] == "UNKNOWN":
        return "UNKNOWN"
    if not inspection["verified"] or not qc["verified"]:
        return "UNKNOWN"
    if bridge_envelope["state"] == "DEGRADED" or inspection["state"] == "DEGRADED" or qc["state"] == "DEGRADED" or not qc["engineering_usable"]:
        return "DEGRADED"
    return "USABLE"


def build_exposure(*, bridge_envelope, source_artifact_sha256, inspection,
                   waveform_qc, preview, transformation, calibration,
                   untrusted_metadata=None):
    bridge_envelope = _validate_bridge(deepcopy(bridge_envelope))
    refs = _bridge_refs(bridge_envelope)
    source_hash = _sha(source_artifact_sha256, "SOURCE_ARTIFACT_SHA256")
    source_rows = [
        row for row in refs.values()
        if row["ref"].get("kind") == "SOURCE_VERIFICATION"
        and row["ref"].get("artifact_sha256") == source_hash
    ]
    if not source_rows:
        raise ValueError("SOURCE_ARTIFACT_NOT_BOUND_TO_PACKET2")
    inspection_out = inspection_descriptor(inspection, refs)
    qc_out = qc_descriptor(waveform_qc, refs)
    preview_out = preview_descriptor(preview)
    transform_out = transformation_descriptor(transformation)
    calibration_out = calibration_descriptor(calibration, refs)
    untrusted_out = untrusted_descriptors(untrusted_metadata or [])
    if transform_out["source_artifact_sha256"] != source_hash:
        raise ValueError("TRANSFORMATION_SOURCE_MISMATCH")
    engineering_state = _engineering_state(bridge_envelope, inspection_out, qc_out)
    if engineering_state == "USABLE" and (
        transform_out["kind"] != "ORIGINAL"
        or transform_out["authority_state"] != "PRESERVED"
        or calibration_out["state"] != "TRUSTED"
    ):
        engineering_state = "DEGRADED"
    engineering_usable = (
        engineering_state == "USABLE"
        and calibration_out["measurement_eligible"]
        and transform_out["authority_state"] == "PRESERVED"
    )
    limitations = sorted(set(
        bridge_envelope.get("limitations", [])
        + inspection_out["limitations"] + qc_out["limitations"]
        + preview_out["limitations"] + transform_out["limitations"]
        + calibration_out["limitations"]
    ))
    if not engineering_usable:
        limitations.append("ENGINEERING_USABILITY_LIMITED")
    limitations = sorted(set(limitations))
    body = {
        "schema": SCHEMA, "packet_id": "PKT-EP3-03",
        "binding": {
            "repository": status.REPOSITORY,
            "baseline_commit": BASELINE_COMMIT, "baseline_tree": BASELINE_TREE,
            "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
            "prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
            "packet2_bundle_sha256": bridge_envelope["bundle_sha256"],
        },
        "source_artifact_sha256": source_hash,
        "engineering_state": engineering_state,
        "engineering_usable": engineering_usable,
        "inspection": inspection_out, "waveform_qc": qc_out,
        "preview": preview_out, "transformation": transform_out,
        "calibration": calibration_out, "untrusted_metadata": untrusted_out,
        "limitations": limitations,
        "diagnostic_state": "GOVERNED_INACTIVE",
        "diagnostic_validity_inferred": False,
        "diagnostic_interpretation_included": False,
        "diagnostic_runtime_activation_allowed": False,
        "candidate_active": False,
        "approved_adjudicated_gold_count": 0,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "raw_clinical_waveform_or_image_bytes_included": False,
        "authority_rewritten": False,
        "silent_fallback_allowed": False,
    }
    exposure_sha256 = _digest(body)
    return {**body, "exposure_id": "sqc_" + exposure_sha256[:24], "exposure_sha256": exposure_sha256}


def navigation_descriptor(exposure):
    if not isinstance(exposure, dict) or exposure.get("schema") != SCHEMA:
        raise ValueError("SIGNAL_QC_EXPOSURE_REQUIRED")
    body = deepcopy(exposure)
    declared = body.pop("exposure_sha256", None)
    body.pop("exposure_id", None)
    if _sha(declared, "EXPOSURE_SHA256") != _digest(body):
        raise ValueError("EXPOSURE_HASH_MISMATCH")
    refs = [
        exposure["inspection"]["evidence_ref"],
        exposure["waveform_qc"]["evidence_ref"],
        exposure["calibration"]["evidence_ref"],
    ]
    return {
        "schema": "ekg-signal-qc-navigation-v1",
        "exposure_id": exposure["exposure_id"],
        "exposure_sha256": exposure["exposure_sha256"],
        "source_artifact_sha256": exposure["source_artifact_sha256"],
        "evidence_refs": deepcopy(refs),
        "read_only": True,
        "raw_payload_included": False,
        "diagnostic_interpretation": False,
        "authority_effect": "NONE",
    }
def release_contract():
    return {
        "schema": "ekg-ep3-pkt03-signal-qc-release-contract-v1",
        "packet": "PKT-EP3-03",
        "theme": "Signal inspection and waveform-QC exposure boundary",
        "repository": status.REPOSITORY,
        "baseline_commit": BASELINE_COMMIT,
        "baseline_tree": BASELINE_TREE,
        "stage1_receipt_sha256": STAGE1_RECEIPT_SHA256,
        "accepted_prior_packet_receipt_sha256": PRIOR_PACKET_RECEIPT_SHA256,
        "diagnostic_execution_supported": False,
        "candidate_active": False,
        "approved_adjudicated_gold_count": 0,
        "diagnostic_performance_reporting_allowed": False,
        "clinical_accuracy_claimed": False,
        "native_dataset_annotations_are_project_gold": False,
        "synthetic_fixtures_are_clinical_gold": False,
        "raw_clinical_waveform_or_image_bytes_included": False,
        "authority_rewritten": False,
        "independent_machine_verification_required": True,
        "github_ci_required": True,
    }
