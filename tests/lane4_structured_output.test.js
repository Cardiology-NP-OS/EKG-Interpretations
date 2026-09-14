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

console.log(JSON.stringify({
  schema: "ekg-l04-structured-output-tests-v1",
  pass: true,
  passed,
  total: passed,
  candidate_active: false,
}));
