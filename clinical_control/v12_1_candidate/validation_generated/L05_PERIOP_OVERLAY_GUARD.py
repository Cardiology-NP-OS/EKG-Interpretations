import re

ALLOWED_FIELDS = {
    "hemodynamic_relevance",
    "anesthesia_relevance",
    "context_needed",
}

FORBIDDEN_CERTAINTY = (
    "safe to proceed",
    "cancel surgery",
    "this patient has",
    "proves",
    "definitive",
    "rules out",
    "torsades is imminent",
)

FORBIDDEN_DEVICE_INFERENCE = (
    "magnet response",
    "programmed mode",
    "battery status",
    "device dependency",
    "perioperative device plan",
)

def _text_items(lens):
    for key in ALLOWED_FIELDS:
        for item in lens.get(key, []):
            yield key, item


def validate_perioperative_lens(lens, *, technical_quality=None, calibration_source=None):
    errors = []
    if lens is None:
        return {"pass": True, "errors": []}
    if not isinstance(lens, dict):
        return {"pass": False, "errors": ["perioperative_lens must be object or null"]}

    extras = sorted(set(lens) - ALLOWED_FIELDS)
    if extras:
        errors.append("undeclared perioperative_lens fields: " + ", ".join(extras))

    for key in ALLOWED_FIELDS:
        value = lens.get(key)
        if value is None:
            continue
        if not isinstance(value, list):
            errors.append(f"{key} must be an array")
            continue
        if not all(isinstance(item, str) and item.strip() for item in value):
            errors.append(f"{key} entries must be non-empty strings")
    joined = " ".join(item for _, item in _text_items(lens)).lower()

    for phrase in FORBIDDEN_CERTAINTY:
        if phrase in joined:
            errors.append(f"unsupported perioperative certainty/action: {phrase}")

    for phrase in FORBIDDEN_DEVICE_INFERENCE:
        if phrase in joined:
            errors.append(f"unsupported device inference from ECG alone: {phrase}")

    override = re.search(
        r"\b(?:ignore[sd]?|override[sd]?|bypass(?:es|ed)?)\b.{0,50}\b(?:uncertainty|limitations?|technical quality|image quality|source integrity|security)\b",
        joined,
    )
    if override:
        errors.append("perioperative context cannot override uncertainty, limitations, quality, or source-security controls")

    if re.search(r"\b(?:give|administer|start|stop|hold)\b.{0,40}\b(?:mg|mcg|g|ml|units?)\b", joined):
        errors.append("patient-specific medication/dose instruction is outside overlay authority")

    if technical_quality == "cannot_interpret":
        asserted = [
            item for key, item in _text_items(lens)
            if key != "context_needed"
            and not any(marker in item.lower() for marker in ("cannot", "uncertain", "verify", "context", "not assessable"))
        ]
        if asserted:
            errors.append("cannot_interpret source cannot support affirmative perioperative ECG assertions")

    if calibration_source in {None, "unknown"}:
        exact_measurement = re.search(r"\b\d+(?:\.\d+)?\s*(?:ms|mm|mv)\b", joined)
        if exact_measurement:
            errors.append("exact ECG measurement requires trustworthy calibration or explicit numeric provenance")

    return {"pass": not errors, "errors": errors}


def validate_analysis_record(record):
    errors = []
    if not isinstance(record, dict):
        return {"pass": False, "errors": ["analysis record must be an object"]}

    lens = record.get("perioperative_lens")
    technical = record.get("technical_quality") or {}
    input_state = record.get("input") or {}
    interpretation = record.get("interpretation") or {}

    lens_result = validate_perioperative_lens(
        lens,
        technical_quality=technical.get("grade"),
        calibration_source=technical.get("calibration_source"),
    )
    errors.extend(lens_result["errors"])

    if not isinstance(lens, dict):
        return {"pass": not errors, "errors": errors}

    relevance = list(lens.get("hemodynamic_relevance") or []) + list(lens.get("anesthesia_relevance") or [])
    context_needed = lens.get("context_needed") or []
    joined = " ".join(relevance).lower()

    if relevance and not context_needed and not input_state.get("clinical_context_provided", False):
        errors.append("perioperative relevance without supplied clinical context must name context_needed")

    contradictions = interpretation.get("contradiction_summary") or []
    if contradictions and relevance and not context_needed:
        errors.append("unresolved interpretation contradictions require perioperative context/verification")

    serial_binding = record.get("serial_binding") or {}
    if isinstance(serial_binding, dict) and "temporal_change_language_allowed" in serial_binding:
        serial_available = bool(serial_binding.get("temporal_change_language_allowed"))
    else:
        serial_available = bool(input_state.get("serial_comparison", False))
    serial_claim = re.search(
        r"\b(?:new|unchanged|worsen(?:ed|ing)?|improv(?:ed|ing)?|compared with prior|baseline change)\b",
        joined,
    )
    if serial_claim and not serial_available:
        errors.append("serial-change perioperative claim requires verified serial comparison")

    history_current = re.search(r"\bhistory of\b.{0,80}\b(?:confirms|proves|establishes)\b.{0,40}\bcurrent\b", joined)
    if history_current:
        errors.append("historical diagnosis cannot establish the current tracing finding")

    unsupported_ecg_proof = re.search(
        r"\becg\b.{0,30}\b(?:proves|confirms|establishes)\b.{0,30}\b(?:diagnosis|disease|etiology|cause)\b",
        joined,
    )
    if unsupported_ecg_proof:
        errors.append("perioperative relevance cannot use ECG as proof of clinical diagnosis or etiology")

    grade = technical.get("grade")
    limitations = record.get("limitations") or []
    if grade in {"limited", "poor", "cannot_interpret"} and not limitations:
        errors.append("degraded technical quality requires explicit top-level limitations")

    acquisition = record.get("acquisition_integrity") or {}
    integrity_status = acquisition.get("status") if isinstance(acquisition, dict) else None
    if integrity_status in {"possible_inconsistency", "insufficient_data"} and relevance:
        if not limitations:
            errors.append("compromised acquisition integrity requires explicit top-level limitations")
        if not context_needed:
            errors.append("compromised acquisition integrity requires perioperative context_needed")

    if relevance and context_needed and not (record.get("verification") or []):
        errors.append("perioperative context_needed must propagate to top-level verification")

    return {"pass": not errors, "errors": errors}
