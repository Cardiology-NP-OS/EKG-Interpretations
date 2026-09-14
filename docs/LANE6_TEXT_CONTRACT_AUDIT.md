# Lane 6 Text-Contract Audit

Scope: read-only audit of original-source control text against the machine-readable candidate contract. This file records structural findings only; it does not activate the quarantined candidate or establish clinical validity.

## Source identity

The audited files were read from `C:\Users\sethb\Documents\EKG_INTERPRETATIONS_DATA\v12_1_remaining_controls` and matched the SHA-256 values registered in `clinical_control/v12_1_candidate/IMPORT_MANIFEST.json`:

- `19_RESPONSE_TEMPLATES.md`: `5e4e854adcb601da62ab8cb6482b9196deefdfdb98b226e750ded4c4b4655702`
- `31_MODE_ROUTER.md`: `bb56095c78bb5e324502ce978d7bfddaa0e0bf580fa73717936d8116decf7b72`
- `32_REPORTING_LANGUAGE.md`: `5af12b60931bf5a4bc860a3e406c69ef1c6b787e4bdce6b11510737aa03e6c03`
- `68_STRUCTURED_OUTPUT_GUIDE.md`: `2c4efb9d84e6c5a76df8b646d51572a6e0da681f52749f5a89bc410a12097364`

## Reproducible findings

1. The structured-output guide instructs use of primary `pattern_id` value `unclassified` when no canonical pattern exists. The pattern registry contains no `unclassified` ID. The JSON schema accepts the value syntactically, so this is a shallow-valid/deep-invalid state. `lane6_contract_fuzz.js` now preserves this as a regression.

2. The guide references `40_EVALUATION_ENGINE.py` as the structured-output evaluator. A recursive filename search under `C:\Users\sethb` found no such file. Therefore that documented validation command is not executable from the currently available source material.

3. The mode-router headings are human labels while `analysis_metadata.analysis_mode` uses machine enums. Most routes have an evident semantic counterpart, but `Fast Rhythm Strip` has no dedicated analysis-mode enum and instead overlaps the `input.tracing_type = rhythm_strip` dimension. The source set does not provide an explicit machine mapping table, so the lane does not invent one.

4. The mode router requires comparison to normalize speed/gain and quality before numeric deltas. The current structured `serial_comparison` objects do not encode enough prior/current calibration state to prove that normalization occurred. The lane can enforce serial identity/binding states but cannot deterministically prove this normalization from the output contract alone.

5. The reporting-language source prohibits unsafe certainty and fake diagnostic probabilities, but much of the final narrative remains free text. Exhaustive semantic enforcement cannot be made deterministic without stronger structured identifiers or an authoritative phrase/rule mapping.

6. The Fast Rhythm Strip response template explicitly excludes axis and unsupported 12-lead conclusions. The lane harness now rejects a rhythm-strip output that carries an axis assessment despite passing shallow schema validation.

7. The anesthesia route says perioperative implications are appended rather than replacing base analysis. The lane harness now requires a perioperative-mode output to include the schema's `perioperative_lens` object; omission is a shallow-valid/deep-invalid state.

## Boundary

These findings are contract and reproducibility findings. They do not establish diagnostic accuracy, clinical readiness, acceptance, activation, or deployment authority. `candidate_active` remains false.
