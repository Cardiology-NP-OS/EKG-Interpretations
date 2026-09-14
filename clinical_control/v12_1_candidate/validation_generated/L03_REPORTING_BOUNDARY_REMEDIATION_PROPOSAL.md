# L03 Reporting-Boundary Remediation Proposal

**Status: PROPOSAL ONLY — INACTIVE**

This generated artifact records deterministic structural findings only. It does not modify source authority, establish clinical validity, or authorize activation.

## Source identity

- `19_RESPONSE_TEMPLATES.md` SHA-256 `5e4e854adcb601da62ab8cb6482b9196deefdfdb98b226e750ded4c4b4655702`; expected match: `true`
- `24_PHENOTYPE_DIAGNOSIS_BOUNDARIES.md` SHA-256 `5ccbbf00a3d0d5db033271407ebd9530c72f2c4c4f5a96007a0a9d7e959e9865`; expected match: `true`
- `32_REPORTING_LANGUAGE.md` SHA-256 `5af12b60931bf5a4bc860a3e406c69ef1c6b787e4bdce6b11510737aa03e6c03`; expected match: `true`
- `68_STRUCTURED_OUTPUT_GUIDE.md` SHA-256 `2c4efb9d84e6c5a76df8b646d51572a6e0da681f52749f5a89bc410a12097364`; expected match: `true`

## Schema findings

- `primary_evidence_for_allows_empty`
- `differential_allows_empty`
- `contradiction_summary_allows_empty`
- `limitations_allows_empty`
- `verification_allows_empty`
- `urgency_uncertainty_allows_empty`
- `lead_observations_allows_empty`
- `primary_pattern_label_free_text`
- `secondary_findings_free_text`
- `pattern_id_not_registry_enforced`

## Evidence-linkage findings

- `primary_evidence_for_is_untyped_free_text`
- `primary_pattern_has_no_explicit_observation_reference_field`
- `lead_observation_id_optional`
- `lead_measurement_evidence_ref_optional`
- `measurement_evidence_ids_not_schema_unique`
- `lead_observation_ids_not_schema_unique`
- `measurement_evidence_refs_not_schema_resolved`

## Template metadata findings

- Template A: missing `project version`, `criteria snapshot`, `source registry version`, `analysis mode`
- Template B: missing `project version`, `criteria snapshot`, `source registry version`, `analysis mode`
- Template C: missing `project version`, `criteria snapshot`, `source registry version`, `analysis mode`
- Template D: missing `project version`, `criteria snapshot`, `source registry version`, `analysis mode`
- Template E: missing `project version`, `criteria snapshot`, `source registry version`, `analysis mode`

## Proposal-only remediation directions

- Require non-empty safety-critical content where the governing contract already requires evidence, uncertainty, differential/context, contradiction handling, limitations, and verification.
- Mechanically bind pattern identifiers to the existing pattern registry rather than permitting arbitrary identifier-shaped strings.
- Add machine-checkable linkage between primary evidence claims and existing lead/measurement evidence identifiers; exact field design remains governed.
- Surface the structured-output metadata required by the guide in response templates or define an explicit governed mapping that preserves those fields.
- Preserve phenotype-versus-diagnosis boundaries, uncertainty, contradiction visibility, and fail-closed behavior.

No medical thresholds, diagnostic criteria, or source facts are introduced here.

candidate_active: false
