import importlib.util
import re
from pathlib import Path

BASE_PATH = Path(__file__).with_name("L05_PERIOP_OVERLAY_GUARD.py")
spec = importlib.util.spec_from_file_location("l05_periop_base_guard", BASE_PATH)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

AUTHORITY_PATTERNS = (
    r"\bcleared for (?:surgery|anesthesia|procedure)\b",
    r"\b(?:proceed|go ahead) with (?:surgery|anesthesia|procedure)\b",
    r"\b(?:surgery|procedure|anesthesia)\s+(?:is\s+)?cleared\b",
    r"\b(?:surgery|procedure|anesthesia)\s+(?:may|can)\s+proceed\b",
    r"\bpatient\s+(?:is\s+)?cleared(?:[- ]for|.{0,50}\bfor)[- ]+(?:surgery|anesthesia|procedure)\b",
    r"\bpatient\s+(?:is\s+)?(?:may undergo|can undergo)\s+(?:for\s+)?(?:surgery|anesthesia|procedure)\b",
    r"\bpatient\b.{0,20}\b(?:fit|acceptable|appropriate|okay|suitable)\b.{0,20}\b(?:for\s+)?(?:surgery|anesthesia|procedure)\b",
    r"\b(?:ecg|tracing)\b.{0,30}\b(?:sufficient|adequate)\b.{0,30}\b(?:clearance|proceed)\b",
    r"\b(?:ecg|tracing)\b.{0,20}\bpermits?\b.{0,20}\b(?:surgery|anesthesia|procedure)\b.{0,20}\bproceed\b",
    r"\b(?:ecg|tracing)\b.{0,20}\bsupports?\b.{0,20}\bproceed(?:ing)?\b.{0,20}\b(?:surgery|anesthesia|procedure)\b",
    r"\becg findings\b.{0,30}\bcompatible with proceeding\b.{0,20}\b(?:to\s+)?(?:surgery|anesthesia|procedure)\b",
)

NO_CONTRAINDICATION_PATTERNS = (
    r"\bno contraindication to (?:surgery|anesthesia|procedure)\b",
    r"\bno\s+(?:(?:apparent|evident)\s+)?(?:ecg(?:[- ](?:based|related))?\s+)?contraindication\s+to\s+(?:surgery|anesthesia|procedure)\b",
)

SAFE_AUTHORITY_LIMITATION_PATTERN = re.compile(
    r"\b(?:cannot|can\s+not|does\s+not)\b.{0,30}\b(?:establish|determine|confirm|prove|show)\b"
    r".{0,60}\b(?:there\s+is\s+)?no\s+(?:(?:apparent|evident)\s+)?"
    r"(?:ecg(?:[- ](?:based|related))?\s+)?contraindication\b"
)

CLINICAL_PROOF_PATTERN = re.compile(
    r"\b(?:ecg|tracing)\b.{0,40}\b(?:proves|confirms|establishes|demonstrates)\b"
    r".{0,40}\b(?:diagnosis|disease|etiology|cause|syndrome|infarction|mi)\b"
)
SHOWS_CLINICAL_CONCLUSION_PATTERN = re.compile(
    r"\b(?:ecg|tracing)\b.{0,20}\bshows\b\s+(?:the\s+|a\s+)?"
    r"(?:diagnosis|disease|etiology|cause|syndrome|infarction|mi)\b"
)
PASSIVE_CLINICAL_PROOF_PATTERN = re.compile(
    r"\b(?:diagnosis|disease|etiology|cause|syndrome|infarction|mi)\b\s*[:,-]?\s*"
    r"(?:(?:is|was)\s+)?(?:(?:clinically|firmly|definitively)\s+)?"
    r"(?:proven|confirmed|established|demonstrated)\b\s+"
    r"(?:by|on|from)\s+(?:the\s+)?(?:ecg|tracing)\b"
)
FALSE_EXCLUSION_PATTERN = re.compile(
    r"\b(?:ecg|tracing)\b.{0,30}\b(?:exclude(?:s|d|ing)?|eliminate(?:s|d|ing)?)\b.{0,40}"
    r"\b(?:acute coronary syndrome|acs|disease|diagnosis|etiology|cause|syndrome|infarction|mi)\b"
)
NEGATED_EXCLUSION_PATTERN = re.compile(
    r"\b(?:ecg|tracing)\b.{0,20}\b(?:does\s+not|cannot|can\s+not|may\s+not)\s+"
    r"(?:exclude|eliminate)\b"
)


def _joined_relevance(lens):
    if not isinstance(lens, dict):
        return ""
    values = []
    for key in ("hemodynamic_relevance", "anesthesia_relevance"):
        field = lens.get(key)
        if isinstance(field, list):
            values.extend(item for item in field if isinstance(item, str))
    return " ".join(" ".join(values).lower().split())


def validate_perioperative_lens(lens, *, technical_quality=None, calibration_source=None):
    result = base.validate_perioperative_lens(
        lens,
        technical_quality=technical_quality,
        calibration_source=calibration_source,
    )
    errors = list(result["errors"])
    joined = _joined_relevance(lens)

    if any(re.search(pattern, joined) for pattern in AUTHORITY_PATTERNS):
        errors.append("ECG overlay cannot issue perioperative clearance/proceed authority")

    no_contraindication = any(re.search(pattern, joined) for pattern in NO_CONTRAINDICATION_PATTERNS)
    if no_contraindication and not SAFE_AUTHORITY_LIMITATION_PATTERN.search(joined):
        errors.append("ECG overlay cannot issue perioperative clearance/proceed authority")

    if (
        CLINICAL_PROOF_PATTERN.search(joined)
        or SHOWS_CLINICAL_CONCLUSION_PATTERN.search(joined)
        or PASSIVE_CLINICAL_PROOF_PATTERN.search(joined)
    ):
        errors.append("perioperative relevance cannot use ECG/tracing as proof of clinical diagnosis or etiology")

    if FALSE_EXCLUSION_PATTERN.search(joined) and not NEGATED_EXCLUSION_PATTERN.search(joined):
        errors.append("perioperative relevance cannot use ECG/tracing to exclude clinical disease")

    return {"pass": not errors, "errors": errors}


def validate_analysis_record(record):
    result = base.validate_analysis_record(record)
    errors = list(result["errors"])

    if isinstance(record, dict):
        lens = record.get("perioperative_lens")
        technical = record.get("technical_quality") or {}
        authority = validate_perioperative_lens(
            lens,
            technical_quality=technical.get("grade"),
            calibration_source=technical.get("calibration_source"),
        )
        for error in authority["errors"]:
            if error not in errors:
                errors.append(error)

    return {"pass": not errors, "errors": errors}
