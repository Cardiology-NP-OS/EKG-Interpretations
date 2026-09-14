const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { CONTRACT, resolveMode, auditFinalization } = require("../tools/lane4_mode_audit");
const FAILURE_REGISTRY = JSON.parse(fs.readFileSync(path.join(
  __dirname, "..", "clinical_control", "v12_1_candidate", "source_core", "36_FAILURE_MODE_REGISTRY.json"
), "utf8"));
const PATTERN_REGISTRY = JSON.parse(fs.readFileSync(path.join(
  __dirname, "..", "clinical_control", "v12_1_candidate", "source_core", "23_PATTERN_REGISTRY.json"
), "utf8"));

let passed = 0;
let assertions = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS " + name);
  } catch (error) {
    console.error("FAIL " + name + ": " + (error.stack || error));
    process.exitCode = 1;
  }
}
function eq(actual, expected) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected);
}
function ok(value) {
  assertions += 1;
  assert.ok(value);
}
function codes(result) {
  return [...result.blockers, ...result.violations].map((item) => item.code);
}
function base(mode = "analyze") {
  return {
    requested_mode: mode,
    audit_context: {
      self_audit_completed: true,
      source_authority_resolved: true,
      image_quality_prerequisite_resolved: true,
      security_prerequisite_resolved: true,
    },
    output_complete: true,
  };
}
function withModeContext(payload, schemaMode) {
  const needed = CONTRACT.mode_specific_context[schemaMode] || [];
  for (const key of needed) payload.audit_context[key] = true;
  return payload;
}

test("general mode can pass only with resolved audit context", () => {
  eq(auditFinalization(base()).verdict, "PASS");
});

test("every declared mode routes deterministically", () => {
  for (const [mode, schemaMode] of Object.entries(CONTRACT.declared_modes)) {
    const result = auditFinalization(withModeContext(base(mode), schemaMode));
    if (schemaMode === null) {
      eq(result.verdict, "BLOCKED");
      eq(result.route.code, "unsupported_schema_mode");
    } else {
      eq(result.verdict, "PASS");
      eq(result.route.schema_mode, schemaMode);
    }
  }
});

test("unknown empty malformed and multiple modes block", () => {
  eq(resolveMode("not-a-mode").code, "unknown_mode");
  eq(resolveMode("   ").code, "empty_mode");
  eq(resolveMode({ mode: "analyze" }).code, "malformed_mode");
  eq(resolveMode(["analyze"]).code, "malformed_mode");
  eq(resolveMode([]).code, "malformed_mode");
  eq(resolveMode(["analyze", "compare"]).code, "multiple_modes");
});

test("conflicting mode text is ambiguous", () => {
  const result = resolveMode("qt audit compare");
  eq(result.blocked, true);
  eq(result.code, "ambiguous_mode");
});

test("unsupported mode cannot emit normal output", () => {
  const payload = base("fast_rhythm_strip");
  payload.normal_output_emitted = true;
  const result = auditFinalization(payload);
  eq(result.verdict, "BLOCKED");
  ok(codes(result).includes("unsupported_mode_normal_output"));
});

test("learning interpretation remains blocked before learner commitment", () => {
  const result = auditFinalization(base("learn_blind_test"));
  eq(result.verdict, "BLOCKED");
  ok(codes(result).includes("learning_precommit_unrepresentable"));
});

test("missing required audit context cannot pass", () => {
  for (const key of CONTRACT.required_audit_context) {
    const payload = base();
    delete payload.audit_context[key];
    const result = auditFinalization(payload);
    eq(result.verdict, "REVISE");
    ok(codes(result).includes("required_audit_context_unresolved"));
  }
});

test("incomplete output cannot pass", () => {
  const payload = base();
  delete payload.output_complete;
  const result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("incomplete_output"));
});

test("every mandatory fail flag prevents PASS", () => {
  for (const flag of CONTRACT.mandatory_fail_flags) {
    const payload = base();
    payload[flag] = true;
    const result = auditFinalization(payload);
    eq(result.verdict, "REVISE");
    ok(codes(result).includes("mandatory_fail"));
  }
});
test("measurement provenance and prerequisites fail closed", () => {
  let payload = base();
  payload.measurements = [{ name: "qrs", value: 120 }];
  let result = auditFinalization(payload);
  ok(codes(result).includes("numeric_measurement_missing_source"));

  payload = base();
  payload.measurements = [{ name: "qtc", value: 480, source: "calculated" }];
  result = auditFinalization(payload);
  ok(codes(result).includes("qtc_formula_missing"));

  payload = base();
  payload.measurements = [{ name: "qt", value: 420, source: "estimated" }];
  result = auditFinalization(payload);
  ok(codes(result).includes("estimated_time_without_verified_speed"));

  payload = base();
  payload.measurements = [{ name: "st_deviation", value: 2, source: "estimated" }];
  result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("st_deviation_without_verified_geometry"));
});

test("ST deviation requires gain geometry and identified landmarks", () => {
  const payload = base();
  payload.gain_verified = true;
  payload.geometry_undistorted = true;
  payload.audit_context.st_j_point_and_baseline_identified = true;
  payload.measurements = [{ name: "st_deviation", value: 2, source: "estimated" }];
  eq(auditFinalization(payload).verdict, "PASS");
});

test("measurement-specific image-quality prerequisites fail closed", () => {
  let payload = base();
  payload.measurements = [{ name: "qtc", value: 450, source: "calculated", formula: "named formula" }];
  let result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("qtc_inputs_unreliable"));
  payload.audit_context.qt_rr_inputs_reliable = true;
  eq(auditFinalization(payload).verdict, "PASS");

  payload = base();
  payload.paper_speed_verified = true;
  payload.measurements = [{ name: "pr", value: 160, source: "estimated" }];
  result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("interval_boundaries_unresolved"));
  payload.audit_context.waveform_boundaries_discernible = true;
  eq(auditFinalization(payload).verdict, "PASS");

  payload = base();
  payload.gain_verified = true;
  payload.geometry_undistorted = true;
  payload.measurements = [{ name: "st_deviation", value: 1, source: "estimated" }];
  result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("st_landmarks_unresolved"));
  payload.audit_context.st_j_point_and_baseline_identified = true;
  eq(auditFinalization(payload).verdict, "PASS");

  payload = base();
  payload.measurements = [{ name: "axis", value: 30, source: "estimated" }];
  result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("axis_prerequisite_unresolved"));
  payload.audit_context.axis_limb_leads_and_fidelity_adequate = true;
  eq(auditFinalization(payload).verdict, "PASS");
});

test("measurement prerequisite combinations fail closed unless all are resolved", () => {
  const flags = [
    "qt_rr_inputs_reliable",
    "waveform_boundaries_discernible",
    "st_j_point_and_baseline_identified",
    "axis_limb_leads_and_fidelity_adequate",
  ];
  for (let mask = 0; mask < 16; mask += 1) {
    const payload = base();
    payload.paper_speed_verified = true;
    payload.gain_verified = true;
    payload.geometry_undistorted = true;
    payload.measurements = [
      { name: "qtc", value: 450, source: "calculated", formula: "named formula" },
      { name: "pr", value: 160, source: "estimated" },
      { name: "st_deviation", value: 1, source: "estimated" },
      { name: "axis", value: 30, source: "estimated" },
    ];
    flags.forEach((flag, index) => {
      if ((mask & (1 << index)) !== 0) payload.audit_context[flag] = true;
    });
    const result = auditFinalization(payload);
    eq(result.verdict, mask === 15 ? "PASS" : "REVISE");
  }
});

test("calibrated reporting boundaries are mandatory fail controls", () => {
  for (const flag of [
    "definitive_brugada_syndrome_from_ecg_alone",
    "definitive_hyperkalemia_from_ecg_alone",
    "fake_numeric_diagnostic_probability",
  ]) {
    ok(CONTRACT.mandatory_fail_flags.includes(flag));
    const result = auditFinalization({ ...base(), [flag]: true });
    eq(result.verdict, "REVISE");
    ok(codes(result).includes("mandatory_fail"));
  }
});

test("evidence and contradiction safeguards prevent superficial PASS", () => {
  let payload = base();
  payload.rhythm_finding = "named rhythm";
  let result = auditFinalization(payload);
  ok(codes(result).includes("rhythm_evidence_missing"));

  payload = base();
  payload.primary_pattern_label = "pattern";
  result = auditFinalization(payload);
  ok(codes(result).includes("primary_pattern_evidence_missing"));

  payload = base();
  payload.pattern_id = "P999";
  result = auditFinalization(payload);
  ok(codes(result).includes("pattern_id_unresolved"));

  payload = base();
  payload.primary_pattern_label = "pattern";
  payload.primary_pattern_evidence_for = ["finding"];
  payload.unresolved_contradiction = true;
  payload.primary_pattern_confidence = "high";
  result = auditFinalization(payload);
  ok(codes(result).includes("high_confidence_with_unresolved_contradiction"));
});
test("cannot-interpret quality blocks unsafe certainty", () => {
  const payload = base();
  payload.technical_quality = { grade: "cannot_interpret", limitations: [] };
  payload.primary_pattern_confidence = "high";
  payload.model_exact_measurements = true;
  const result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("quality_limitations_missing"));
  ok(codes(result).includes("high_confidence_forbidden_by_quality"));
  ok(codes(result).includes("exact_measurement_forbidden_by_quality"));
});

test("mode transitions require re-audit and reject stale PASS inheritance", () => {
  const payload = withModeContext(base("compare"), "comparison");
  payload.previous_mode = "analyze";
  payload.inherited_prior_pass = true;
  const result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("mode_transition_requires_reaudit"));
  ok(codes(result).includes("stale_pass_inheritance"));
});

test("valid re-audited transition may pass", () => {
  const payload = withModeContext(base("compare"), "comparison");
  payload.previous_mode = "analyze";
  payload.transition_context = { reaudit_completed: true };
  eq(auditFinalization(payload).verdict, "PASS");
});

test("invalid previous mode cannot be ignored", () => {
  const payload = base();
  payload.previous_mode = "garbage";
  const result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("invalid_previous_mode"));
});

test("all pairwise multi-mode arrays block", () => {
  const modes = Object.keys(CONTRACT.declared_modes);
  for (let i = 0; i < modes.length; i += 1) {
    for (let j = i + 1; j < modes.length; j += 1) {
      const result = auditFinalization(base([modes[i], modes[j]]));
      eq(result.verdict, "BLOCKED");
      eq(result.route.code, "multiple_modes");
    }
  }
});

test("all supported pairwise transitions require fresh re-audit", () => {
  const modes = Object.entries(CONTRACT.declared_modes)
    .filter(([, schemaMode]) => schemaMode !== null);
  for (const [from] of modes) {
    for (const [to, schemaMode] of modes) {
      if (from === to) continue;
      const payload = withModeContext(base(to), schemaMode);
      payload.previous_mode = from;
      const result = auditFinalization(payload);
      eq(result.verdict, "REVISE");
      ok(codes(result).includes("mode_transition_requires_reaudit"));
    }
  }
});

test("missing-value semantics never treat truthy substitutes as resolved", () => {
  const substitutes = [false, null, 0, 1, "true", {}, []];
  for (const key of CONTRACT.required_audit_context) {
    for (const value of substitutes) {
      const payload = base();
      payload.audit_context[key] = value;
      const result = auditFinalization(payload);
      eq(result.verdict, "REVISE");
      ok(codes(result).includes("required_audit_context_unresolved"));
    }
  }
});

test("aliases tolerate case whitespace and underscore normalization only", () => {
  const samples = [
    ["  QT_AUDIT  ", "qt_audit"],
    ["Machine Vs Human", "machine_vs_human"],
    ["ANESTHESIA_LENS", "perioperative"],
    ["comparison", "comparison"],
  ];
  for (const [raw, expectedSchemaMode] of samples) {
    const result = resolveMode(raw);
    eq(result.blocked, false);
    eq(result.schema_mode, expectedSchemaMode);
  }
});

test("non-finite numeric measurements cannot produce PASS", () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const payload = base();
    payload.measurements = [{ name: "qrs", value, source: "machine" }];
    const result = auditFinalization(payload);
    eq(result.verdict, "REVISE");
    ok(codes(result).includes("nonfinite_measurement"));
  }
});

test("schema-invalid quality certainty and measurement enums cannot pass", () => {
  let result = auditFinalization({ ...base(), primary_pattern_confidence: "certain" });
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("unsupported_certainty"));

  result = auditFinalization({ ...base(), technical_quality: { grade: "excellent", limitations: [] } });
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("invalid_quality_grade"));

  result = auditFinalization({ ...base(), measurements: [{ name: "not_a_metric", value: 1, source: "machine" }] });
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("invalid_measurement_name"));

  result = auditFinalization({ ...base(), measurements: [{ name: "qrs", value: 1, source: "invented" }] });
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("invalid_measurement_source"));
});

test("punctuation unicode and fallback routing stay deterministic", () => {
  for (const raw of ["qt-audit", "qt/audit", "machine.vs.human", "analyze!!!", "xx analyze yy", "fast rhythm strip now", "qt\u200baudit"]) {
    eq(resolveMode(raw).code, "unknown_mode");
  }
  for (const raw of ["qt\u00a0audit", "qt\u2003audit", "learn\u00a0/\u00a0blind\u00a0test"]) {
    eq(resolveMode(raw).blocked, false);
  }
});

test("unsupported and learning transitions cannot bypass route semantics", () => {
  let payload = base("fast_rhythm_strip");
  payload.previous_mode = "analyze";
  payload.transition_context = { reaudit_completed: true };
  let result = auditFinalization(payload);
  eq(result.verdict, "BLOCKED");
  ok(codes(result).includes("unsupported_schema_mode"));

  payload = base("analyze");
  payload.previous_mode = "fast_rhythm_strip";
  payload.transition_context = { reaudit_completed: true };
  result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("invalid_previous_mode"));

  payload = base("learn_blind_test");
  payload.previous_mode = "analyze";
  payload.transition_context = { reaudit_completed: true };
  result = auditFinalization(payload);
  eq(result.verdict, "BLOCKED");
  ok(codes(result).includes("learning_precommit_unrepresentable"));

  payload.audit_context.learner_committed = true;
  result = auditFinalization(payload);
  eq(result.verdict, "PASS");
});

test("crop and perspective quality contradictions require explicit limitations", () => {
  let payload = base();
  payload.technical_quality = { grade: "adequate", limitations: [], crop_or_occlusion: true };
  let result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("quality_limitation_missing_for_crop"));

  payload = base();
  payload.technical_quality = { grade: "adequate", limitations: [], perspective_distortion: true };
  result = auditFinalization(payload);
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("quality_limitation_missing_for_perspective"));

  payload.technical_quality.limitations = ["perspective distortion present"];
  eq(auditFinalization(payload).verdict, "PASS");
});

test("failure-registry controls cannot be acknowledged and still PASS", () => {
  for (const [flag, failureId] of Object.entries(CONTRACT.failure_control_flags)) {
    const payload = base();
    payload[flag] = true;
    const result = auditFinalization(payload);
    eq(result.verdict, "REVISE");
    ok(codes(result).includes("failure_control"));
    ok(result.violations.some((item) => item.detail === failureId + ":" + flag));
  }
});

test("every registered detected failure id prevents PASS", () => {
  for (const failure of FAILURE_REGISTRY.failure_modes) {
    const result = auditFinalization({ ...base(), detected_failure_ids: [failure.id] });
    eq(result.verdict, "REVISE");
    ok(codes(result).includes("failure_control"));
    ok(result.violations.some((item) => item.detail === failure.id + ":detected_failure_ids"));
  }
});

test("detected failure id input fails closed on malformed or unknown values", () => {
  let result = auditFinalization({ ...base(), detected_failure_ids: "F01" });
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("invalid_detected_failure_ids_shape"));

  result = auditFinalization({ ...base(), detected_failure_ids: ["F99"] });
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("invalid_failure_id"));
});

test("parallel pattern ids require actual registry resolution", () => {
  const knownId = PATTERN_REGISTRY.patterns[0].id;
  let result = auditFinalization({ ...base(), pattern_id: knownId, pattern_id_resolved: true });
  eq(result.verdict, "PASS");

  result = auditFinalization({ ...base(), pattern_id: "totally_fake", pattern_id_resolved: true });
  eq(result.verdict, "REVISE");
  ok(codes(result).includes("pattern_id_unresolved"));
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-l04-mode-audit-tests-v1",
  pass: true,
  passed,
  assertions,
  candidate_active: false,
}));
