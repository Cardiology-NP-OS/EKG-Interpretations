"""Generated PKT-EP1-08 quarantined pattern-candidate evidence engine.

This module does not perform free-text clinical reasoning, morphology inference,
or diagnosis. A registry pattern is executable only when an explicit deterministic
rule is listed in PKT08_EXECUTABLE_RULES.json. All other patterns return
NOT_EXECUTABLE.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY_PATH = ROOT / "source_core" / "23_PATTERN_REGISTRY.json"
CALC_PATH = ROOT / "source" / "25_CALCULATION_ENGINE.py"
CRITERIA_PATH = ROOT / "source_text" / "12_CLINICAL_CRITERIA_REGISTRY.md"
RULES_PATH = ROOT / "validation_generated" / "PKT08_EXECUTABLE_RULES.json"

REGISTRY_SHA256 = "05764e9437862f6c4f1948c6f0385abb320764c4cb0f2007ce7c426df7d31fdb"
CALC_SHA256 = "872d7df0df0a6d50604583fe6ff8f6fdce0d50e14da4669f408f8a4c9235d82d"
CRITERIA_SHA256 = "7c771f498304ebdaaf3cfd98c0ea7d14e08e8d35c01180c7b91c76f7a35c6f1e"

_spec = importlib.util.spec_from_file_location("pkt08_calc", CALC_PATH)
calc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(calc)

def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def _canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))

def _candidate_id(pattern_id: str, evidence_ids: list[str], context: dict) -> str:
    material = {"pattern_id": pattern_id, "evidence_ids": sorted(evidence_ids), "context": context}
    return "pc_" + hashlib.sha256(_canonical(material).encode()).hexdigest()[:24]

def verify_source_hashes() -> dict:
    actual = {
        "pattern_registry": _sha(REGISTRY_PATH),
        "calculation_engine": _sha(CALC_PATH),
        "criteria_registry": _sha(CRITERIA_PATH),
    }
    expected = {
        "pattern_registry": REGISTRY_SHA256,
        "calculation_engine": CALC_SHA256,
        "criteria_registry": CRITERIA_SHA256,
    }
    if actual != expected:
        raise ValueError("SOURCE_HASH_MISMATCH")
    return actual

def load_registry(path: Path | None = None) -> dict:
    path = Path(path or REGISTRY_PATH)
    if _sha(path) != REGISTRY_SHA256:
        raise ValueError("PATTERN_REGISTRY_SHA256_MISMATCH")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    patterns = data.get("patterns")
    if not isinstance(patterns, list) or len(patterns) != 59:
        raise ValueError("PATTERN_REGISTRY_COUNT")
    ids = [p.get("id") for p in patterns]
    if len(set(ids)) != 59 or any(not isinstance(x, str) or not x for x in ids):
        raise ValueError("PATTERN_REGISTRY_IDENTITY")
    return data

def load_rules() -> dict:
    data = json.loads(RULES_PATH.read_text(encoding="utf-8-sig"))
    if data.get("default_behavior") != "NOT_EXECUTABLE":
        raise ValueError("RULE_REGISTRY_DEFAULT")
    allowed = set(data.get("executable_patterns", {}))
    if not allowed <= {"left_axis", "right_axis", "stemi_threshold"}:
        raise ValueError("RULE_REGISTRY_SCOPE_EXPANSION")
    return data

def _pattern_map() -> dict[str, dict]:
    return {p["id"]: p for p in load_registry()["patterns"]}

def _validate_measurements(envelopes) -> list[dict]:
    out = list(envelopes or [])
    ids = set()
    for env in out:
        if not isinstance(env, dict) or env.get("schema") != "ekg-pkt07-measurement-evidence-v1":
            raise ValueError("INVALID_MEASUREMENT_ENVELOPE")
        if env.get("candidate_active") is not False or env.get("clinical_accuracy_claimed") is not False:
            raise ValueError("MEASUREMENT_AUTHORITY_ESCALATION")
        rec = env.get("measurement_evidence")
        if not isinstance(rec, dict) or not rec.get("measurement_id"):
            raise ValueError("MEASUREMENT_IDENTITY")
        if rec["measurement_id"] in ids:
            raise ValueError("DUPLICATE_MEASUREMENT_ID")
        ids.add(rec["measurement_id"])
    return out

def _available(envelopes, metric: str) -> list[dict]:
    return [
        env for env in envelopes
        if env.get("status") == "AVAILABLE"
        and env.get("measurement_evidence", {}).get("metric") == metric
    ]

def _base(pattern: dict, envelopes: list[dict], context: dict) -> dict:
    ids = [x["measurement_evidence"]["measurement_id"] for x in envelopes]
    return {
        "schema": "ekg-pkt08-pattern-candidate-v1",
        "candidate_id": _candidate_id(pattern["id"], ids, context),
        "pattern_id": pattern["id"],
        "label": pattern["label"],
        "domain": pattern["domain"],
        "status": None,
        "rule_id": None,
        "required_evidence": list(pattern.get("required_or_defining_evidence") or []),
        "supportive_evidence": list(pattern.get("supportive_evidence") or []),
        "satisfied_required_evidence": [],
        "missing_required_evidence": [],
        "supporting_evidence_refs": [],
        "supporting_leads": [],
        "major_confounders_or_mimics": list(pattern.get("major_confounders_or_mimics") or []),
        "active_confounders": list(context.get("confounders") or []),
        "contradictions": list(context.get("contradictions") or []),
        "diagnostic_boundary": pattern.get("diagnostic_boundary"),
        "urgency": pattern.get("default_urgency"),
        "certainty": "none",
        "population": pattern.get("population"),
        "measurement_dependencies": list(pattern.get("measurement_dependencies") or []),
        "clinical_context_required": bool(pattern.get("requires_clinical_context_for_syndrome_or_etiology")),
        "rule_provenance": None,
        "candidate_active": False,
        "clinical_accuracy_claimed": False,
        "diagnosis": None,
        "automatic_selection_allowed": False,
    }

def _finalize(result: dict) -> dict:
    if result["status"] == "PRESENT_CANDIDATE":
        result["certainty"] = "candidate_only"
    elif result["status"] in {"ABSENT_BY_RULE", "NOT_EXECUTABLE", "INDETERMINATE", "INELIGIBLE"}:
        result["certainty"] = "none"
    if result["status"] == "PRESENT_CANDIDATE" and result.get("contradictions"):
        result["status"] = "INDETERMINATE"
        result["certainty"] = "none"
        result["missing_required_evidence"].append("unresolved contradiction requires review")
    if result["status"] == "PRESENT_CANDIDATE" and result.get("active_confounders"):
        result["status"] = "INDETERMINATE"
        result["certainty"] = "none"
        result["missing_required_evidence"].append("active confounder requires review")
    if result["status"] == "PRESENT_CANDIDATE" and result.get("must_name_supporting_leads") and not result["supporting_leads"]:
        result["status"] = "INDETERMINATE"
        result["certainty"] = "none"
        result["missing_required_evidence"].append("supporting lead identity required")
    return result

def _adult_eligible(pattern: dict, context: dict) -> bool:
    pop = str(context.get("population", "adult")).lower()
    required = str(pattern.get("population", "adult_default")).lower()
    if required.startswith("adult") and pop not in {"adult", "adult_default"}:
        return False
    return True

def _axis_rule(pattern: dict, envelopes: list[dict], context: dict, expected: str, rule_id: str) -> dict:
    out = _base(pattern, envelopes, context)
    out["rule_id"] = rule_id
    out["rule_provenance"] = {
        "source": "source/25_CALCULATION_ENGINE.py",
        "source_sha256": CALC_SHA256,
        "function": "axis_category",
    }
    if not _adult_eligible(pattern, context):
        out["status"] = "INELIGIBLE"
        out["missing_required_evidence"] = ["adult population required by registry"]
        return _finalize(out)
    axes = _available(envelopes, "axis")
    if len(axes) != 1:
        out["status"] = "INDETERMINATE"
        out["missing_required_evidence"] = ["one explicit frontal QRS axis measurement"]
        return _finalize(out)
    rec = axes[0]["measurement_evidence"]
    category = calc.axis_category(rec["value"])
    out["supporting_evidence_refs"] = [rec["measurement_id"]]
    out["satisfied_required_evidence"] = [f"explicit frontal QRS axis category={category}"]
    out["status"] = "PRESENT_CANDIDATE" if category == expected else "ABSENT_BY_RULE"
    return _finalize(out)

def _stemi_rule(pattern: dict, envelopes: list[dict], context: dict) -> dict:
    out = _base(pattern, envelopes, context)
    out["must_name_supporting_leads"] = True
    out["rule_id"] = "conventional_st_threshold_v1"
    out["rule_provenance"] = {
        "source": "source/25_CALCULATION_ENGINE.py",
        "source_sha256": CALC_SHA256,
        "function": "conventional_st_elevation_met",
        "criteria_source": "source_text/12_CLINICAL_CRITERIA_REGISTRY.md",
        "criteria_sha256": CRITERIA_SHA256,
    }
    if not _adult_eligible(pattern, context):
        out["status"] = "INELIGIBLE"
        out["missing_required_evidence"] = ["adult population required by registry"]
        return _finalize(out)
    st = _available(envelopes, "st_deviation")
    usable = {}
    refs = []
    for env in st:
        rec = env["measurement_evidence"]
        lead = rec.get("lead")
        if not lead:
            continue
        if rec.get("calibration_id") is None:
            continue
        usable[str(lead).upper()] = float(rec["value"])
        refs.append(rec["measurement_id"])
    if len(usable) < 2:
        out["status"] = "INDETERMINATE"
        out["missing_required_evidence"] = ["at least two calibrated lead-labelled ST measurements"]
        return _finalize(out)
    confounded = bool(context.get("bbb_or_lvh_confounded", False))
    result = calc.conventional_st_elevation_met(
        usable,
        sex=context.get("sex"),
        age_years=context.get("age_years"),
        bbb_or_lvh_confounded=confounded,
    )
    if result is None:
        out["status"] = "INDETERMINATE"
        out["missing_required_evidence"] = ["threshold not safely assessable from supplied demographics/confounder context"]
        return _finalize(out)
    supporting = []
    if result:
        for a, b in calc.CONTIGUOUS_ST_PAIRS:
            if a not in usable or b not in usable:
                continue
            ta = calc.st_elevation_threshold_mm(a, context.get("sex"), context.get("age_years"))
            tb = calc.st_elevation_threshold_mm(b, context.get("sex"), context.get("age_years"))
            if ta is not None and tb is not None and usable[a] >= ta and usable[b] >= tb:
                supporting.extend([a, b])
    out["supporting_leads"] = sorted(set(supporting))
    out["supporting_evidence_refs"] = refs
    out["satisfied_required_evidence"] = (
        ["new/explicit J-point ST measurements meet conventional contiguous-lead thresholds"]
        if result else []
    )
    out["missing_required_evidence"] = [] if result else ["conventional contiguous-lead ST threshold not met"]
    out["status"] = "PRESENT_CANDIDATE" if result else "ABSENT_BY_RULE"
    return _finalize(out)

def evaluate_pattern(pattern_id: str, measurement_envelopes=None, context=None) -> dict:
    verify_source_hashes()
    rules = load_rules()
    patterns = _pattern_map()
    if pattern_id not in patterns:
        raise ValueError("UNKNOWN_PATTERN_ID")
    pattern = patterns[pattern_id]
    envs = _validate_measurements(measurement_envelopes)
    ctx = dict(context or {})
    executable = rules.get("executable_patterns", {})
    if pattern_id not in executable:
        out = _base(pattern, envs, ctx)
        out["status"] = "NOT_EXECUTABLE"
        out["missing_required_evidence"] = ["no explicit deterministic full-pattern rule encoded"]
        return _finalize(out)
    rule = executable[pattern_id]["rule_id"]
    if rule == "axis_left_v1":
        return _axis_rule(pattern, envs, ctx, "left_axis_deviation", rule)
    if rule == "axis_right_v1":
        return _axis_rule(pattern, envs, ctx, "right_axis_deviation", rule)
    if rule == "conventional_st_threshold_v1":
        return _stemi_rule(pattern, envs, ctx)
    raise ValueError("UNREGISTERED_EXECUTABLE_RULE")

def component_helper_evidence(kind: str, **kwargs) -> dict:
    verify_source_hashes()
    if kind == "rate_from_rr_seconds":
        value = calc.rate_from_rr_seconds(kwargs["rr_s"])
        return {"kind": kind, "value": value, "unit": "bpm", "pattern_completed": False,
                "source_sha256": CALC_SHA256}
    if kind == "qrs_duration_category":
        value = calc.qrs_duration_category(kwargs["qrs_ms"])
        return {"kind": kind, "value": value, "unit": None, "pattern_completed": False,
                "source_sha256": CALC_SHA256}
    if kind == "classic_sgarbossa_components":
        value = calc.classic_sgarbossa_components(
            concordant_ste_mm=kwargs.get("concordant_ste_mm"),
            concordant_std_v1_v3_mm=kwargs.get("concordant_std_v1_v3_mm"),
            discordant_ste_mm=kwargs.get("discordant_ste_mm"),
        )
        return {"kind": kind, "value": value, "unit": None, "pattern_completed": False,
                "requires_lbbb_or_paced_context": True, "source_sha256": CALC_SHA256}
    if kind == "conventional_st_elevation_met":
        value = calc.conventional_st_elevation_met(
            kwargs["measurements_mm"], sex=kwargs.get("sex"), age_years=kwargs.get("age_years"),
            bbb_or_lvh_confounded=kwargs.get("bbb_or_lvh_confounded", False),
        )
        return {"kind": kind, "value": value, "unit": None, "pattern_completed": False,
                "source_sha256": CALC_SHA256}
    raise ValueError("UNSUPPORTED_COMPONENT_HELPER")

def aggregate_candidates(candidates) -> dict:
    rows = list(candidates)
    ids = [x.get("candidate_id") for x in rows]
    if any(not x for x in ids) or len(ids) != len(set(ids)):
        raise ValueError("CANDIDATE_IDENTITY_CONFLICT")
    contradiction_index = [
        {"candidate_id": x["candidate_id"], "pattern_id": x["pattern_id"], "contradictions": x["contradictions"]}
        for x in rows if x.get("contradictions")
    ]
    return {
        "schema": "ekg-pkt08-candidate-aggregate-v1",
        "candidates": rows,
        "contradiction_index": contradiction_index,
        "automatic_winner": None,
        "automatic_selection_allowed": False,
        "candidate_active": False,
        "clinical_accuracy_claimed": False,
    }
