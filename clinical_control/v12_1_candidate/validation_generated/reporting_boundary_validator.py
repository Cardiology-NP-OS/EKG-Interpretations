import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "source_core"
TEXT = ROOT / "source_text"

EXPECTED_HASHES = {
    "19_RESPONSE_TEMPLATES.md": "5e4e854adcb601da62ab8cb6482b9196deefdfdb98b226e750ded4c4b4655702",
    "24_PHENOTYPE_DIAGNOSIS_BOUNDARIES.md": "5ccbbf00a3d0d5db033271407ebd9530c72f2c4c4f5a96007a0a9d7e959e9865",
    "32_REPORTING_LANGUAGE.md": "5af12b60931bf5a4bc860a3e406c69ef1c6b787e4bdce6b11510737aa03e6c03",
    "68_STRUCTURED_OUTPUT_GUIDE.md": "2c4efb9d84e6c5a76df8b646d51572a6e0da681f52749f5a89bc410a12097364",
}

WORD_SEP = r"[\s:-]+"
STRONG_ASSERTION_RE = re.compile(
    rf"\b(?:proves|definitive|this{WORD_SEP}patient{WORD_SEP}has|"
    rf"rules{WORD_SEP}out|safe|cleared)\b",
    re.IGNORECASE,
)
NEGATED_STRONG_ASSERTION_RE = re.compile(
    rf"\b(?:not|never|cannot|can't|does{WORD_SEP}not|doesn't){WORD_SEP}"
    rf"(?:prove|proves|definitive|safe|cleared|rule{WORD_SEP}out|rules{WORD_SEP}out)\b",
    re.IGNORECASE,
)

DIAGNOSIS_LABEL_TERMS = (
    "brugada syndrome", "congenital long-qt syndrome", "wpw syndrome",
    "pulmonary embolism", "cardiac tamponade", "acute pericarditis",
    "hyperkalemia", "hypokalemia", "hypocalcemia", "hypercalcemia",
    "previous myocardial infarction", "acute mi", "posterior mi", "wellens syndrome",
)
_DIAGNOSIS_DECLARATION_TERMS = "|".join(re.escape(term) for term in DIAGNOSIS_LABEL_TERMS)
UNSUPPORTED_CLINICAL_DIAGNOSIS_RE = re.compile(
    rf"\b(?:this{WORD_SEP}is|diagnosis{WORD_SEP}is|(?:the{WORD_SEP})?patient{WORD_SEP}has){WORD_SEP}(?:an?{WORD_SEP})?(?:{_DIAGNOSIS_DECLARATION_TERMS})\b",
    re.IGNORECASE,
)
CAUSE_CONNECTOR_RE = re.compile(
    rf"\b(?:due{WORD_SEP}to|caused{WORD_SEP}by|secondary{WORD_SEP}to|"
    rf"drug[- ]induced|medication[- ]induced|from{WORD_SEP}medication)\b",
    re.IGNORECASE,
)

FAKE_PROBABILITY_RE = re.compile(
    r"(?<!\d)(?:100|[1-9]?\d)(?:\.\d+)?\s*%\s*(?:likely|probability|chance|confidence)",
    re.IGNORECASE,
)
UNSUPPORTED_MI_DECLARATION_RE = re.compile(
    rf"\b(?:(?:this{WORD_SEP}is|diagnosis{WORD_SEP}is){WORD_SEP}"
    rf"(?:an?{WORD_SEP})?(?:acute{WORD_SEP})?mi|"
    rf"this{WORD_SEP}patient{WORD_SEP}has{WORD_SEP}"
    rf"(?:an?{WORD_SEP})?(?:acute{WORD_SEP})?mi)\b",
    re.IGNORECASE,
)
NEGATIVE_EXCLUSION_RE = re.compile(
    rf"\b(?:rules{WORD_SEP}out|excludes{WORD_SEP}disease)\b",
    re.IGNORECASE,
)
UNSUPPORTED_WCT_MECHANISM_RE = re.compile(
    r"\bwide[- ]complex tachycardia\b.{0,40}\b(?:is|equals|diagnosis is)\s+(?:definitive\s+)?(?:vt|svt(?:\s+with\s+aberrancy)?)\b",
    re.IGNORECASE,
)
UNSUPPORTED_DEVICE_STATE_RE = re.compile(
    r"\b(?:device|pacemaker)\b.{0,40}\b(?:is\s+programmed|battery\s+is|is\s+dependent|dependency\s+is)\b",
    re.IGNORECASE,
)
UNSUPPORTED_CULPRIT_ARTERY_RE = re.compile(
    r"\bculprit artery\s+is\s+(?!not\b)(?:established|identified|proven|definitive)\b",
    re.IGNORECASE,
)
UNSUPPORTED_LOW_VOLTAGE_ETIOLOGY_RE = re.compile(
    r"\blow voltage\b.{0,50}\b(?:means|proves|diagnosis is|is due to)\b.{0,50}\b(?:pericardial effusion|infiltrative disease)\b",
    re.IGNORECASE,
)
UNSUPPORTED_LVH_ANATOMY_RE = re.compile(
    r"\blvh voltage(?:/repolarization)?(?: pattern)?\b.{0,50}\b(?:confirms|proves|establishes|equals)\b.{0,30}\banatomic lv hypertrophy\b",
    re.IGNORECASE,
)
UNSUPPORTED_NUMERIC_POTASSIUM_RE = re.compile(
    r"\bserum potassium\s+(?:is|=|equals)\s*[-+]?\d+(?:\.\d+)?\b.{0,40}\b(?:from|based on)\b.{0,20}\becg\b",
    re.IGNORECASE,
)
UNSUPPORTED_2TO1_MOBITZ_RE = re.compile(
    rf"\b2:1{WORD_SEP}av{WORD_SEP}block\b.{{0,40}}\b"
    rf"(?:is|equals|diagnosis{WORD_SEP}is){WORD_SEP}mobitz{WORD_SEP}(?:i|ii)\b",
    re.IGNORECASE,
)
UNSUPPORTED_BBB_DURATION_ONLY_RE = re.compile(
    rf"\bqrs{WORD_SEP}duration{WORD_SEP}alone\b.{{0,50}}\b"
    rf"(?:establishes|proves|confirms|means|diagnosis{WORD_SEP}is){WORD_SEP}"
    rf"(?:complete{WORD_SEP})?(?:rbbb|lbbb)\b",
    re.IGNORECASE,
)
UNSUPPORTED_AF_FROM_IRREGULAR_RHYTHM_RE = re.compile(
    r"\birregularly irregular rhythm\b.{0,40}\b(?:is|equals|diagnosis is)\s+atrial fibrillation\b",
    re.IGNORECASE,
)
UNSUPPORTED_SINGLE_RR_AVERAGE_RATE_RE = re.compile(
    r"\baverage rate\s+(?:is|=|equals)\s*\d+(?:\.\d+)?\s*bpm\b"
    r".{0,50}\bfrom\s+(?:a\s+)?single rr interval\b"
    r".{0,50}\birregular rhythm\b",
    re.IGNORECASE,
)

def _load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))

def source_hash_status():
    result = {}
    for name, expected in EXPECTED_HASHES.items():
        got = hashlib.sha256((TEXT / name).read_bytes()).hexdigest()
        result[name] = {"expected": expected, "got": got, "match": got == expected}
    return result

def schema_gap_findings():
    schema = _load_json(CORE / "07_OUTPUT_SCHEMA.json")
    props = schema["properties"]
    interp = props["interpretation"]
    iprops = interp["properties"]
    primary = iprops["primary_pattern"]["properties"]
    gaps = []
    if "minItems" not in primary["evidence_for"]:
        gaps.append("primary_evidence_for_allows_empty")
    if "minItems" not in iprops["differential"]:
        gaps.append("differential_allows_empty")
    if "minItems" not in iprops["contradiction_summary"]:
        gaps.append("contradiction_summary_allows_empty")
    if "minItems" not in props["limitations"]:
        gaps.append("limitations_allows_empty")
    if "minItems" not in props["verification"]:
        gaps.append("verification_allows_empty")
    if "minLength" not in props["urgency"]["properties"]["uncertainty"]:
        gaps.append("urgency_uncertainty_allows_empty")
    if "minItems" not in props["lead_observations"]:
        gaps.append("lead_observations_allows_empty")
    if set(primary["label"]) == {"type"}:
        gaps.append("primary_pattern_label_free_text")
    secondary_items = iprops["secondary_findings"]["items"]
    if set(secondary_items) == {"type"}:
        gaps.append("secondary_findings_free_text")
    pattern_id = primary["pattern_id"]
    if "enum" not in pattern_id:
        gaps.append("pattern_id_not_registry_enforced")
    return gaps

def evidence_linkage_findings():
    schema = _load_json(CORE / "07_OUTPUT_SCHEMA.json")
    props = schema["properties"]
    primary = props["interpretation"]["properties"]["primary_pattern"]
    lead_item = props["lead_observations"]["items"]
    findings = []

    evidence_items = primary["properties"]["evidence_for"]["items"]
    if evidence_items == {"type": "string"}:
        findings.append("primary_evidence_for_is_untyped_free_text")

    primary_props = primary["properties"]
    if not any(
        key in primary_props
        for key in ("observation_refs", "evidence_refs", "supporting_lead_refs")
    ):
        findings.append("primary_pattern_has_no_explicit_observation_reference_field")

    lead_required = set(lead_item.get("required", []))
    if "observation_id" not in lead_required:
        findings.append("lead_observation_id_optional")
    if "measurement_evidence_ref" not in lead_required:
        findings.append("lead_measurement_evidence_ref_optional")
    if "uniqueItems" not in props["measurement_evidence"]:
        findings.append("measurement_evidence_ids_not_schema_unique")
    if "uniqueItems" not in props["lead_observations"]:
        findings.append("lead_observation_ids_not_schema_unique")
    findings.append("measurement_evidence_refs_not_schema_resolved")

    return findings

def template_schema_findings():
    text = (TEXT / "19_RESPONSE_TEMPLATES.md").read_text(encoding="utf-8").lower()
    guide = (TEXT / "68_STRUCTURED_OUTPUT_GUIDE.md").read_text(encoding="utf-8").lower()
    required_metadata = [
        "project version", "criteria snapshot", "source registry version", "analysis mode"
    ]
    guide_declares = all(item in guide for item in required_metadata)

    markers = [
        ("A", "# template a", "# template b"),
        ("B", "# template b", "# template c"),
        ("C", "# template c", "# template d"),
        ("D", "# template d", "# template e"),
        ("E", "# template e", None),
    ]
    missing_by_template = {}
    for name, start, end in markers:
        section = text.split(start, 1)[1]
        if end is not None:
            section = section.split(end, 1)[0]
        missing_by_template[name] = [
            item for item in required_metadata if item not in section
        ]

    return {
        "guide_declares_required_metadata": guide_declares,
        "template_a_missing_required_metadata": missing_by_template["A"],
        "missing_required_metadata_by_template": missing_by_template,
    }

def render_remediation_proposal():
    hashes = source_hash_status()
    schema_gaps = schema_gap_findings()
    linkage = evidence_linkage_findings()
    template = template_schema_findings()

    lines = [
        "# L03 Reporting-Boundary Remediation Proposal",
        "",
        "**Status: PROPOSAL ONLY — INACTIVE**",
        "",
        "This generated artifact records deterministic structural findings only. "
        "It does not modify source authority, establish clinical validity, or authorize activation.",
        "",
        "## Source identity",
        "",
    ]
    for name in sorted(hashes):
        item = hashes[name]
        lines.append(
            f"- `{name}` SHA-256 `{item['got']}`; expected match: "
            f"`{str(item['match']).lower()}`"
        )

    lines.extend([
        "",
        "## Schema findings",
        "",
    ])
    lines.extend(f"- `{item}`" for item in schema_gaps)

    lines.extend([
        "",
        "## Evidence-linkage findings",
        "",
    ])
    lines.extend(f"- `{item}`" for item in linkage)

    lines.extend([
        "",
        "## Template metadata findings",
        "",
    ])
    for name, missing in sorted(
        template["missing_required_metadata_by_template"].items()
    ):
        joined = ", ".join(f"`{item}`" for item in missing) or "none"
        lines.append(f"- Template {name}: missing {joined}")

    lines.extend([
        "",
        "## Proposal-only remediation directions",
        "",
        "- Require non-empty safety-critical content where the governing contract "
        "already requires evidence, uncertainty, differential/context, contradiction "
        "handling, limitations, and verification.",
        "- Mechanically bind pattern identifiers to the existing pattern registry "
        "rather than permitting arbitrary identifier-shaped strings.",
        "- Add machine-checkable linkage between primary evidence claims and existing "
        "lead/measurement evidence identifiers; exact field design remains governed.",
        "- Surface the structured-output metadata required by the guide in response "
        "templates or define an explicit governed mapping that preserves those fields.",
        "- Preserve phenotype-versus-diagnosis boundaries, uncertainty, contradiction "
        "visibility, and fail-closed behavior.",
        "",
        "No medical thresholds, diagnostic criteria, or source facts are introduced here.",
        "",
        "candidate_active: false",
        "",
    ])
    return "\n".join(lines)

def _normal(value):
    return re.sub(r"\s+", " ", str(value or "").strip().lower())

def _reporting_fragments(record):
    interp = record.get("interpretation", {})
    primary = interp.get("primary_pattern", {})
    fragments = [primary.get("label", "")]
    fragments.extend(primary.get("evidence_for", []))
    fragments.extend(primary.get("evidence_against", []))
    fragments.extend(interp.get("secondary_findings", []))

    for item in interp.get("differential", []):
        if not isinstance(item, dict):
            continue
        fragments.append(item.get("label", ""))
        fragments.extend(item.get("why_it_fits", []))
        fragments.extend(item.get("why_it_may_not_fit", []))
        fragments.append(item.get("discriminator", ""))

    fragments.extend(interp.get("contradiction_summary", []))
    urgency = record.get("urgency", {})
    fragments.append(urgency.get("reason", ""))
    fragments.append(urgency.get("uncertainty", ""))
    fragments.extend(urgency.get("recommended_verification", []))
    fragments.extend(record.get("limitations", []))
    fragments.extend(record.get("verification", []))

    for item in record.get("lead_observations", []):
        if isinstance(item, dict):
            fragments.extend(item.get("observations", []))

    return [_normal(item) for item in fragments if _normal(item)]

def _assertion_surface(record):
    return " ".join(_reporting_fragments(record))

def _contains_strong_assertion(surface):
    scrubbed = NEGATED_STRONG_ASSERTION_RE.sub("", surface)
    return bool(STRONG_ASSERTION_RE.search(scrubbed))

def _pattern_registry_item(pattern_id):
    if not pattern_id:
        return None
    patterns = _load_json(CORE / "23_PATTERN_REGISTRY.json")["patterns"]
    by_id = {item["id"]: item for item in patterns}
    return by_id.get(pattern_id)

def _regional_pattern_requires_leads(pattern_id):
    item = _pattern_registry_item(pattern_id)
    return bool(item and item.get("must_name_supporting_leads_when_regional"))

def _pattern_requires_clinical_context(pattern_id):
    item = _pattern_registry_item(pattern_id)
    return bool(item and item.get("requires_clinical_context_for_syndrome_or_etiology"))

def registry_boundary_findings():
    patterns = _load_json(CORE / "23_PATTERN_REGISTRY.json")["patterns"]
    return {
        "total_patterns": len(patterns),
        "context_required_ids": [
            item["id"] for item in patterns
            if item.get("requires_clinical_context_for_syndrome_or_etiology")
        ],
        "regional_supporting_lead_ids": [
            item["id"] for item in patterns
            if item.get("must_name_supporting_leads_when_regional")
        ],
    }

def evidence_reference_violations(record):
    violations = set()

    observation_ids = [
        item.get("observation_id")
        for item in record.get("lead_observations", [])
        if isinstance(item, dict) and item.get("observation_id")
    ]
    if len(observation_ids) != len(set(observation_ids)):
        violations.add("duplicate_observation_id")

    measurement_ids = [
        item.get("measurement_id")
        for item in record.get("measurement_evidence", [])
        if isinstance(item, dict) and item.get("measurement_id")
    ]
    if len(measurement_ids) != len(set(measurement_ids)):
        violations.add("duplicate_measurement_evidence_id")

    available_measurement_ids = set(measurement_ids)
    refs = []
    for item in record.get("lead_observations", []):
        if isinstance(item, dict) and item.get("measurement_evidence_ref"):
            refs.append(item["measurement_evidence_ref"])
    for item in record.get("measurements", []):
        if isinstance(item, dict) and item.get("measurement_evidence_ref"):
            refs.append(item["measurement_evidence_ref"])

    if any(ref not in available_measurement_ids for ref in refs):
        violations.add("dangling_measurement_evidence_ref")

    return sorted(violations)

def validate_record(record):
    violations = set(evidence_reference_violations(record))
    interp = record.get("interpretation", {})
    primary = interp.get("primary_pattern", {})
    label = _normal(primary.get("label", ""))
    surface = _assertion_surface(record)

    if not _normal(record.get("urgency", {}).get("uncertainty", "")):
        violations.add("missing_uncertainty")
    if not primary.get("evidence_for"):
        violations.add("missing_evidence")
    if not interp.get("differential"):
        violations.add("missing_differential")
    if not interp.get("contradiction_summary"):
        violations.add("missing_contradiction_summary")
    if not record.get("limitations"):
        violations.add("missing_limitations")
    if not record.get("verification"):
        violations.add("missing_verification")

    if _contains_strong_assertion(surface):
        violations.add("reporting_language_too_strong")
    if FAKE_PROBABILITY_RE.search(surface):
        violations.add("unsupported_numeric_diagnostic_probability")
    if UNSUPPORTED_MI_DECLARATION_RE.search(surface):
        violations.add("unsupported_mi_declaration")
    if UNSUPPORTED_CLINICAL_DIAGNOSIS_RE.search(surface):
        violations.add("unsupported_clinical_diagnosis_declaration")
    if UNSUPPORTED_WCT_MECHANISM_RE.search(surface):
        violations.add("unsupported_wct_mechanism_declaration")
    if UNSUPPORTED_DEVICE_STATE_RE.search(surface):
        violations.add("unsupported_device_state_inference")
    if UNSUPPORTED_CULPRIT_ARTERY_RE.search(surface):
        violations.add("unsupported_culprit_artery_declaration")
    if UNSUPPORTED_LOW_VOLTAGE_ETIOLOGY_RE.search(surface):
        violations.add("unsupported_low_voltage_etiology")
    if UNSUPPORTED_LVH_ANATOMY_RE.search(surface):
        violations.add("unsupported_lvh_anatomic_declaration")
    if UNSUPPORTED_NUMERIC_POTASSIUM_RE.search(surface):
        violations.add("unsupported_numeric_potassium_inference")
    if UNSUPPORTED_2TO1_MOBITZ_RE.search(surface):
        violations.add("unsupported_2to1_mobitz_subtype_declaration")
    if UNSUPPORTED_BBB_DURATION_ONLY_RE.search(surface):
        violations.add("unsupported_bbb_duration_only_declaration")
    if UNSUPPORTED_AF_FROM_IRREGULAR_RHYTHM_RE.search(surface):
        violations.add("unsupported_arrhythmia_from_artifact_ambiguous_rhythm")
    if UNSUPPORTED_SINGLE_RR_AVERAGE_RATE_RE.search(surface):
        violations.add("unsupported_average_rate_from_single_rr")
    if any(term in label for term in DIAGNOSIS_LABEL_TERMS):
        violations.add("phenotype_promoted_to_diagnosis")
    secondary_text = [_normal(item) for item in interp.get("secondary_findings", [])]
    if any(
        any(term == item or item.startswith(term + " ") for term in DIAGNOSIS_LABEL_TERMS)
        for item in secondary_text
    ):
        violations.add("secondary_finding_promoted_to_diagnosis")
    if CAUSE_CONNECTOR_RE.search(surface):
        violations.add("unsupported_cause_attribution")
    if NEGATIVE_EXCLUSION_RE.search(surface):
        violations.add("negative_ecg_exclusion")

    st = record.get("st_t_assessment", {})
    indeterminate = any(
        st.get(key) in {"indeterminate", "not_assessable"}
        for key in (
            "ischemia_concern",
            "occlusion_pattern_concern",
            "conventional_st_elevation_threshold",
        )
    )
    if indeterminate and primary.get("confidence") == "high":
        violations.add("indeterminate_evidence_with_high_certainty")

    if primary.get("confidence") == "high" and primary.get("evidence_against"):
        violations.add("hidden_contradiction_high_confidence")

    pattern_id = primary.get("pattern_id")
    if _regional_pattern_requires_leads(pattern_id):
        supporting_leads = [
            item for item in record.get("lead_observations", [])
            if isinstance(item, dict) and item.get("lead") and item.get("observations")
        ]
        if not supporting_leads:
            violations.add("missing_supporting_leads")

    if _pattern_requires_clinical_context(pattern_id) and CAUSE_CONNECTOR_RE.search(surface):
        violations.add("context_required_for_etiology")

    secondary = [_normal(item) for item in interp.get("secondary_findings", [])]
    if label:
        negative_forms = {f"no {label}", f"not {label}"}
        if any(item in negative_forms for item in secondary):
            violations.add("secondary_primary_contradiction")

    return sorted(violations)
