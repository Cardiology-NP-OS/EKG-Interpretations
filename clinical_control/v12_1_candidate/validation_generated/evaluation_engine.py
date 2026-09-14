"""PKT-EP1-09 adjudicated-gold and evaluation infrastructure.

Engineering/evaluation mechanics only. This module does not create clinical
labels, does not treat native dataset annotations as adjudicated gold, and
blocks diagnostic-performance claims when approved adjudicated gold is absent.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "source_core" / "23_PATTERN_REGISTRY.json"
REGISTRY_SHA256 = "05764e9437862f6c4f1948c6f0385abb320764c4cb0f2007ce7c426df7d31fdb"

GOLD_SCHEMA = "ekg-pkt09-gold-case-v1"
PRED_SCHEMA = "ekg-pkt09-prediction-v1"
SYNTHETIC_SCHEMA = "ekg-pkt09-synthetic-evaluator-case-v1"

def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def _canonical(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()

def _id(prefix: str, value) -> str:
    return prefix + hashlib.sha256(_canonical(value)).hexdigest()[:24]

def registry():
    if _sha(REGISTRY_PATH) != REGISTRY_SHA256:
        raise ValueError("PATTERN_REGISTRY_SHA256_MISMATCH")
    data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8-sig"))
    ids = [p["id"] for p in data["patterns"]]
    if len(ids) != 59 or len(set(ids)) != 59:
        raise ValueError("PATTERN_REGISTRY_IDENTITY")
    return data
def validate_gold_case(case: dict) -> dict:
    if case.get("schema") != GOLD_SCHEMA:
        raise ValueError("GOLD_SCHEMA")
    required = {
        "case_id", "case_version", "source_provenance", "tracing_identity",
        "usage_status", "privacy_review_status", "registry_binding",
        "independent_annotations", "adjudication_status", "final_adjudication",
        "pattern_labels", "measurement_ground_truth", "partition",
    }
    missing = sorted(required - set(case))
    if missing:
        raise ValueError("GOLD_MISSING:" + ",".join(missing))
    if case["usage_status"] != "APPROVED":
        raise ValueError("GOLD_USAGE_NOT_APPROVED")
    if case["privacy_review_status"] != "CLEARED_NON_SENSITIVE":
        raise ValueError("GOLD_PRIVACY_REVIEW_NOT_CLEAR")
