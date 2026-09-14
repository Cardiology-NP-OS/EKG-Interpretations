"""Generated PKT-EP1-07 non-diagnostic measurement-evidence adapter.

This module wraps the quarantined V12.1 calculation engine without modifying it.
It never performs morphology inference, rhythm diagnosis, or waveform fiducial
detection. Unsupported extraction fails closed.
"""
from __future__ import annotations
import hashlib
import importlib.util
import math
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[1]
ENGINE_PATH = ROOT / "source" / "25_CALCULATION_ENGINE.py"
_spec = importlib.util.spec_from_file_location("pkt07_candidate_calc", ENGINE_PATH)
calc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(calc)
ENGINE_SHA256 = hashlib.sha256(ENGINE_PATH.read_bytes()).hexdigest()

CANONICAL_UNITS = {
    "atrial_rate": "bpm", "ventricular_rate": "bpm", "rr": "ms",
    "pr": "ms", "qrs": "ms", "qt": "ms", "qtc": "ms",
    "axis": "deg", "st_deviation": "mm", "other": None,
}
ERRORS = {
    "MISSING_REQUIRED_INPUT", "MALFORMED_INPUT", "NONFINITE_INPUT",
    "UNIT_MISMATCH", "MISSING_LEAD_IDENTITY", "MISSING_CALIBRATION",
    "CONFLICTING_EVIDENCE", "UNSUPPORTED_MEASUREMENT",
    "AUTOMATIC_FIDUCIAL_EXTRACTION_NOT_IMPLEMENTED",
}
def _finite(value, name="value"):
    try:
        x = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"MALFORMED_INPUT:{name}") from exc
    if not math.isfinite(x):
        raise ValueError(f"NONFINITE_INPUT:{name}")
    return x

def _uncertainty(unit=None):
    return {"lower": None, "upper": None, "unit": unit, "method": "not_available"}

def _source(asset_id=None, asset_sha256=None, record_id=None):
    if (asset_id is None) != (asset_sha256 is None):
        raise ValueError("MALFORMED_INPUT:evidence_source_identity")
    if asset_sha256 is not None:
        h = str(asset_sha256).lower()
        if len(h) != 64 or any(c not in "0123456789abcdef" for c in h):
            raise ValueError("MALFORMED_INPUT:asset_sha256")
        asset_sha256 = h
    return {"asset_id": asset_id, "asset_sha256": asset_sha256, "record_id": record_id}

def _record(measurement_id, metric, value, unit, source_kind, method, *,
            lead=None, calibration_id=None, dependencies=None, formula=None,
            exact=True, asset_id=None, asset_sha256=None, record_id=None, notes=None):
    if metric not in CANONICAL_UNITS:
        raise ValueError("UNSUPPORTED_MEASUREMENT")
    expected = CANONICAL_UNITS[metric]
    if expected is not None and unit != expected:
        raise ValueError(f"UNIT_MISMATCH:{metric}:{unit}")
    if value is not None and not isinstance(value, str):
        value = _finite(value)
    return {
        "version": "1.0", "measurement_id": measurement_id, "metric": metric,
        "lead": lead, "value": value, "unit": unit, "source_kind": source_kind,
        "method": method, "calibration_id": calibration_id, "fiducials": [],
        "uncertainty": _uncertainty(unit), "exact_numeric_claim_allowed": bool(exact),
        "evidence_source": _source(asset_id, asset_sha256, record_id),
        "dependencies": list(dependencies or []),
        "notes": notes if formula is None else f"formula={formula}" + (f"; {notes}" if notes else ""),
    }
def _envelope(status, record, reason=None, derived=None):
    quality = {"AVAILABLE": "resolved", "INDETERMINATE": "indeterminate", "NOT_IMPLEMENTED": "unsupported"}[status]
    confidence = "high" if status == "AVAILABLE" else "low"
    return {
        "schema": "ekg-pkt07-measurement-evidence-v1",
        "status": status,
        "quality_state": quality,
        "confidence": confidence,
        "reason": reason,
        "measurement_evidence": record,
        "derived": dict(derived or {}),
        "candidate_active": False,
        "clinical_accuracy_claimed": False,
    }

def unavailable(measurement_id, metric, unit, reason, *, lead=None):
    if reason not in ERRORS:
        raise ValueError("UNREGISTERED_INDETERMINATE_REASON")
    rec = _record(
        measurement_id, metric, None, unit, "unavailable", "unavailable",
        lead=lead, exact=False, notes=f"indeterminate_reason={reason}"
    )
    status = "NOT_IMPLEMENTED" if reason == "AUTOMATIC_FIDUCIAL_EXTRACTION_NOT_IMPLEMENTED" else "INDETERMINATE"
    return _envelope(status, rec, reason)

def manual_measurement(measurement_id, metric, value, unit, *, lead=None, record_id=None):
    if metric == "st_deviation" and not lead:
        return unavailable(measurement_id, metric, unit, "MISSING_LEAD_IDENTITY")
    rec = _record(
        measurement_id, metric, _finite(value), unit, "user_provided", "user_input",
        lead=lead, record_id=record_id, exact=True, notes="explicit numeric input; not waveform-derived"
    )
    return _envelope("AVAILABLE", rec)

def digital_measurement(measurement_id, metric, value, unit, *, asset_id, asset_sha256,
                        lead=None, calibration_id=None, record_id=None):
    if metric == "st_deviation" and not lead:
        return unavailable(measurement_id, metric, unit, "MISSING_LEAD_IDENTITY")
    if metric in {"rr", "pr", "qrs", "qt", "st_deviation"} and calibration_id is None:
        return unavailable(measurement_id, metric, unit, "MISSING_CALIBRATION", lead=lead)
    rec = _record(
        measurement_id, metric, _finite(value), unit, "digital_signal", "digital_sample",
        lead=lead, calibration_id=calibration_id, asset_id=asset_id,
        asset_sha256=asset_sha256, record_id=record_id, exact=True,
        notes="explicit validated digital measurement; no morphology inference"
    )
    return _envelope("AVAILABLE", rec)

def waveform_measurement_request(measurement_id, metric, unit, *, lead=None):
    return unavailable(
        measurement_id, metric, unit,
        "AUTOMATIC_FIDUCIAL_EXTRACTION_NOT_IMPLEMENTED", lead=lead
    )
def duration_ms_from_samples(sample_delta, sample_rate_hz):
    samples = _finite(sample_delta, "sample_delta")
    hz = _finite(sample_rate_hz, "sample_rate_hz")
    if samples < 0 or hz <= 0:
        raise ValueError("MALFORMED_INPUT:sample_context")
    return samples * 1000.0 / hz

def rate_from_rr(measurement_id, rr_seconds, *, dependency_id):
    rr = _finite(rr_seconds, "rr_seconds")
    value = calc.rate_from_rr_seconds(rr)
    rec = _record(
        measurement_id, "ventricular_rate", value, "bpm", "calculated", "formula",
        dependencies=[dependency_id], formula="rate_from_rr_seconds",
        notes="non-diagnostic deterministic calculation"
    )
    return _envelope("AVAILABLE", rec)

def rate_from_box_count(measurement_id, boxes, paper_speed_mm_s, *, small_boxes, dependency_id):
    b = _finite(boxes, "boxes")
    speed = _finite(paper_speed_mm_s, "paper_speed_mm_s")
    fn = calc.rate_from_small_boxes if small_boxes else calc.rate_from_large_boxes
    value = fn(b, speed)
    formula = "rate_from_small_boxes" if small_boxes else "rate_from_large_boxes"
    rec = _record(
        measurement_id, "ventricular_rate", value, "bpm", "calculated", "formula",
        dependencies=[dependency_id], formula=formula,
        notes=f"paper_speed_mm_s={speed}"
    )
    return _envelope("AVAILABLE", rec)

def qtc_records(prefix, qt_ms, rr_seconds, *, qt_dependency, rr_dependency):
    qt = _finite(qt_ms, "qt_ms")
    rr = _finite(rr_seconds, "rr_seconds")
    values = calc.qtc_all(qt, rr)
    out = []
    for name, value in sorted(values.items()):
        formula = name.removesuffix("_ms")
        rec = _record(
            f"{prefix}.{formula}", "qtc", value, "ms", "calculated", "formula",
            dependencies=[qt_dependency, rr_dependency], formula=formula,
            notes="formula identity preserved"
        )
        out.append(_envelope("AVAILABLE", rec, derived={"formula": formula}))
    return out
def interval_measurement(measurement_id, metric, value_ms, *, source="user", record_id=None):
    if metric not in {"pr", "qrs", "qt", "rr"}:
        raise ValueError("UNSUPPORTED_MEASUREMENT")
    if source != "user":
        raise ValueError("UNSUPPORTED_MEASUREMENT:use_digital_measurement")
    env = manual_measurement(measurement_id, metric, value_ms, "ms", record_id=record_id)
    if metric == "qrs" and env["status"] == "AVAILABLE":
        env["derived"]["duration_category"] = calc.qrs_duration_category(env["measurement_evidence"]["value"])
        env["derived"]["diagnostic_interpretation"] = False
    return env

def axis_measurement(measurement_id, degrees, *, record_id=None):
    env = manual_measurement(measurement_id, "axis", degrees, "deg", record_id=record_id)
    if env["status"] == "AVAILABLE":
        env["derived"]["axis_category"] = calc.axis_category(env["measurement_evidence"]["value"])
        env["derived"]["etiology_inferred"] = False
    return env

def st_from_display_mm(measurement_id, measured_mm, *, lead, gain_mm_per_mv=None,
                       calibration_id=None, sex=None, age_years=None, record_id=None):
    if not lead:
        return unavailable(measurement_id, "st_deviation", "mm", "MISSING_LEAD_IDENTITY")
    if gain_mm_per_mv is None or calibration_id is None:
        return unavailable(measurement_id, "st_deviation", "mm", "MISSING_CALIBRATION", lead=lead)
    standardized = calc.standardize_vertical_mm(_finite(measured_mm), _finite(gain_mm_per_mv))
    threshold = calc.st_elevation_threshold_mm(lead, sex=sex, age_years=age_years)
    rec = _record(
        measurement_id, "st_deviation", standardized, "mm", "calculated", "formula",
        lead=lead, calibration_id=calibration_id, dependencies=[],
        formula="standardize_vertical_mm", record_id=record_id,
        notes="value standardized to 10 mm/mV; threshold helper is not a diagnosis"
    )
    derived = {
        "threshold_mm": threshold,
        "conventional_threshold_met": None if threshold is None else standardized >= threshold,
        "diagnosis": None,
    }
    return _envelope("AVAILABLE", rec, derived=derived)
def validate_no_conflicts(envelopes: Iterable[dict]):
    seen = {}
    for env in envelopes:
        rec = env["measurement_evidence"]
        key = (rec["metric"], rec.get("lead"))
        if env["status"] != "AVAILABLE":
            continue
        signature = (rec["value"], rec["unit"])
        if key in seen and seen[key] != signature:
            raise ValueError(f"CONFLICTING_EVIDENCE:{key[0]}:{key[1]}")
        seen[key] = signature
    return True

def map_to_structured_output(envelopes: Iterable[dict]):
    envs = list(envelopes)
    validate_no_conflicts(envs)
    measurements = []
    evidence = []
    for env in envs:
        rec = dict(env["measurement_evidence"])
        evidence.append(rec)
        source_map = {
            "user_provided": "user", "machine_reported": "machine",
            "digital_signal": "machine", "calculated": "calculated",
            "visual_fiducial": "estimated", "unavailable": "unavailable",
        }
        measurements.append({
            "name": rec["metric"] if rec["metric"] in {"atrial_rate","ventricular_rate","rr","pr","qrs","qt","qtc","axis"} else "other",
            "value": rec["value"], "unit": rec["unit"],
            "source": source_map[rec["source_kind"]],
            "confidence": "high" if env["status"] == "AVAILABLE" else "low",
            "lead": rec.get("lead"), "formula": (
                rec["notes"].split(";")[0].split("=",1)[1]
                if rec.get("notes","").startswith("formula=") else None
            ),
            "inputs": list(rec.get("dependencies") or []),
            "notes": rec.get("notes"),
            "measurement_evidence_ref": rec["measurement_id"],
        })
    return {
        "measurements": measurements,
        "measurement_evidence": evidence,
        "candidate_active": False,
        "clinical_accuracy_claimed": False,
    }
