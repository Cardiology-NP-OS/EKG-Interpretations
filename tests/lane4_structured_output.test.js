const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { auditFinalization } = require("../tools/lane4_mode_audit");

const schema = JSON.parse(fs.readFileSync(path.join(
  __dirname, "..", "clinical_control", "v12_1_candidate", "source_core", "07_OUTPUT_SCHEMA.json"
), "utf8"));

function base() {
  return {
    requested_mode: "analyze",
    audit_context: {
      self_audit_completed: true,
      source_authority_resolved: true,
      image_quality_prerequisite_resolved: true,
      security_prerequisite_resolved: true,
    },
    output_complete: true,
    structured_output_emitted: true,
  };
}

function codes(result) {
  return [...result.blockers, ...result.violations].map((item) => item.code);
}

function skeleton(node) {
  if (!node || typeof node !== "object") return null;
  if (node.type === "object") {
    const value = {};
    for (const key of node.required || []) value[key] = skeleton(node.properties[key]);
    return value;
  }
  if (node.type === "array") return [];
  if (Object.prototype.hasOwnProperty.call(node, "const")) return node.const;
  return null;
}

function validValue(node) {
  if (!node || typeof node !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(node, "const")) return node.const;
  if (Array.isArray(node.enum)) return node.enum[0];
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
  const type = types.includes("null") ? "null" : types[0];
  if (type === "object") {
    const value = {};
    for (const key of node.required || []) value[key] = validValue(node.properties[key]);
    return value;
  }
  if (type === "array") return [];
  if (type === "string") return "";
  if (type === "boolean") return false;
  if (type === "number" || type === "integer") return 0;
  return null;
}

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log("PASS " + name);
}

test("empty emitted structured output cannot claim complete", () => {
  const result = auditFinalization({ ...base(), structured_output: {} });
  assert.equal(result.verdict, "REVISE");
  assert.ok(codes(result).includes("structured_output_required_field_missing"));
});

test("nested required fields are enforced", () => {
  const output = skeleton(schema);
  output.urgency = {};
  const result = auditFinalization({ ...base(), structured_output: output });
  assert.equal(result.verdict, "REVISE");
  assert.ok(result.violations.some((item) => item.detail === "$.urgency.level"));
});

test("required fields inside emitted array items are enforced", () => {
  const output = skeleton(schema);
  output.measurements = [{}];
  const result = auditFinalization({ ...base(), structured_output: output });
  assert.equal(result.verdict, "REVISE");
  assert.ok(result.violations.some((item) => item.detail === "$.measurements[0].name"));
});

test("presence-only structural skeleton still fails semantic schema checks", () => {
  const result = auditFinalization({ ...base(), structured_output: skeleton(schema) });
  assert.equal(result.verdict, "REVISE");
  assert.ok(codes(result).includes("structured_output_schema_violation"));
});

test("schema-valid structural fixture passes bounded structured-output gate", () => {
  const result = auditFinalization({ ...base(), structured_output: validValue(schema) });
  assert.equal(result.verdict, "PASS");
});

test("const enum type and additional-property violations cannot pass", () => {
  let output = validValue(schema);
  output.schema_version = "9.9";
  let result = auditFinalization({ ...base(), structured_output: output });
  assert.equal(result.verdict, "REVISE");
  assert.ok(result.violations.some((item) => item.detail === "$.schema_version:const"));

  output = validValue(schema);
  output.urgency.level = "instant";
  result = auditFinalization({ ...base(), structured_output: output });
  assert.ok(result.violations.some((item) => item.detail === "$.urgency.level:enum"));

  output = validValue(schema);
  output.urgency.reason = 42;
  result = auditFinalization({ ...base(), structured_output: output });
  assert.ok(result.violations.some((item) => item.detail === "$.urgency.reason:type"));

  output = validValue(schema);
  output.unexpected = true;
  result = auditFinalization({ ...base(), structured_output: output });
  assert.ok(result.violations.some((item) => item.detail === "$.unexpected:additional_property"));
});

test("pattern and uniqueItems violations cannot pass", () => {
  let output = validValue(schema);
  output.interpretation.primary_pattern.pattern_id = "BAD PATTERN!";
  let result = auditFinalization({ ...base(), structured_output: output });
  assert.equal(result.verdict, "REVISE");
  assert.ok(result.violations.some((item) => item.detail === "$.interpretation.primary_pattern.pattern_id:pattern"));

  output = validValue(schema);
  output.verification = ["same", "same"];
  result = auditFinalization({ ...base(), structured_output: output });
  assert.equal(result.verdict, "REVISE");
  assert.ok(result.violations.some((item) => item.detail === "$.verification:unique_items"));
});

test("declared string-length and numeric-bound violations cannot pass", () => {
  function outputWithGeometry() {
    const output = validValue(schema);
    const geometry = validValue(schema.properties.geometry_calibrations.items);
    geometry.calibration_id = "cal_1";
    output.geometry_calibrations = [geometry];
    return { output, geometry };
  }

  let fixture = outputWithGeometry();
  fixture.geometry.supporting_evidence = [""];
  let result = auditFinalization({ ...base(), structured_output: fixture.output });
  assert.equal(result.verdict, "REVISE");
  assert.ok(result.violations.some((item) => item.detail === "$.geometry_calibrations[0].supporting_evidence[0]:min_length"));

  fixture = outputWithGeometry();
  fixture.geometry.x_pixels_per_mm = 0;
  result = auditFinalization({ ...base(), structured_output: fixture.output });
  assert.ok(result.violations.some((item) => item.detail === "$.geometry_calibrations[0].x_pixels_per_mm:exclusive_minimum"));

  fixture = outputWithGeometry();
  fixture.geometry.x_scale_uncertainty_fraction = -0.1;
  result = auditFinalization({ ...base(), structured_output: fixture.output });
  assert.ok(result.violations.some((item) => item.detail === "$.geometry_calibrations[0].x_scale_uncertainty_fraction:minimum"));

  fixture = outputWithGeometry();
  fixture.geometry.x_scale_uncertainty_fraction = 1;
  result = auditFinalization({ ...base(), structured_output: fixture.output });
  assert.ok(result.violations.some((item) => item.detail === "$.geometry_calibrations[0].x_scale_uncertainty_fraction:exclusive_maximum"));
});

test("conditional exact-measurement evidence binding is enforced", () => {
  function outputWithEvidence(sourceKind, exactAllowed, assetId, assetSha256) {
    const output = validValue(schema);
    const evidence = validValue(schema.properties.measurement_evidence.items);
    evidence.measurement_id = "m1";
    evidence.source_kind = sourceKind;
    evidence.exact_numeric_claim_allowed = exactAllowed;
    evidence.evidence_source = { asset_id: assetId, asset_sha256: assetSha256, record_id: null };
    output.measurement_evidence = [evidence];
    return output;
  }

  let output = outputWithEvidence("visual_fiducial", true, null, null);
  let result = auditFinalization({ ...base(), structured_output: output });
  assert.equal(result.verdict, "REVISE");
  assert.ok(result.violations.some((item) => item.detail === "$.measurement_evidence[0].evidence_source.asset_id:type"));
  assert.ok(result.violations.some((item) => item.detail === "$.measurement_evidence[0].evidence_source.asset_sha256:type"));

  output = outputWithEvidence("digital_signal", true, "asset_1", "a".repeat(64));
  result = auditFinalization({ ...base(), structured_output: output });
  assert.equal(result.verdict, "PASS");

  output = outputWithEvidence("machine_reported", true, null, null);
  result = auditFinalization({ ...base(), structured_output: output });
  assert.equal(result.verdict, "PASS");
});

test("emitted structured semantics cannot bypass or contradict audit state", () => {
  let output = validValue(schema);
  output.technical_quality.grade = "cannot_interpret";
  output.technical_quality.limitations = ["uninterpretable"];
  output.interpretation.primary_pattern.confidence = "high";
  let result = auditFinalization({ ...base(), structured_output: output });
  assert.equal(result.verdict, "REVISE");
  assert.ok(codes(result).includes("structured_output_high_confidence_forbidden_by_quality"));

  output = validValue(schema);
  result = auditFinalization({
    ...base(),
    technical_quality: { grade: "limited", limitations: ["artifact"] },
    structured_output: output,
  });
  assert.equal(result.verdict, "REVISE");
  assert.ok(codes(result).includes("structured_output_audit_mismatch"));

  output = validValue(schema);
  result = auditFinalization({
    ...base(),
    primary_pattern_confidence: "low",
    structured_output: output,
  });
  assert.equal(result.verdict, "REVISE");
  assert.ok(codes(result).includes("structured_output_audit_mismatch"));

  output = validValue(schema);
  result = auditFinalization({
    ...base(),
    technical_quality: { grade: output.technical_quality.grade, limitations: [] },
    primary_pattern_confidence: output.interpretation.primary_pattern.confidence,
    structured_output: output,
  });
  assert.equal(result.verdict, "PASS");
});

console.log(JSON.stringify({
  schema: "ekg-l04-structured-output-tests-v1",
  pass: true,
  passed,
  total: passed,
  candidate_active: false,
}));
