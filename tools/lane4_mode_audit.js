const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTRACT_PATH = path.join(
  ROOT,
  "clinical_control",
  "v12_1_candidate",
  "validation_generated",
  "MODE_SELF_AUDIT_CONTRACT.json"
);
const CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
const OUTPUT_SCHEMA = JSON.parse(fs.readFileSync(path.join(
  ROOT,
  "clinical_control",
  "v12_1_candidate",
  "source_core",
  "07_OUTPUT_SCHEMA.json"
), "utf8"));
const QUALITY_GRADES = new Set(
  OUTPUT_SCHEMA.properties.technical_quality.properties.grade.enum
);
const PATTERN_CONFIDENCES = new Set(
  OUTPUT_SCHEMA.properties.interpretation.properties.primary_pattern.properties.confidence.enum
);
const MEASUREMENT_NAMES = new Set([
  ...OUTPUT_SCHEMA.properties.measurements.items.properties.name.enum,
  "st_deviation",
]);
const MEASUREMENT_SOURCES = new Set(
  OUTPUT_SCHEMA.properties.measurements.items.properties.source.enum
);

function normalize(value) {
  return String(value).trim().toLowerCase().replace(/_/g, " ").replace(/\s+/g, " ");
}

function routeMap() {
  const entries = [];
  for (const mode of Object.keys(CONTRACT.declared_modes)) {
    entries.push([normalize(mode), mode]);
  }
  for (const [alias, mode] of Object.entries(CONTRACT.aliases)) {
    entries.push([normalize(alias), mode]);
  }
  return new Map(entries);
}

const ROUTES = routeMap();

function resolveMode(raw) {
  if (Array.isArray(raw)) {
    if (raw.length > 1) return { blocked: true, code: "multiple_modes", raw };
    return { blocked: true, code: "malformed_mode", raw };
  }
  if (typeof raw !== "string") return { blocked: true, code: "malformed_mode", raw };
  const token = normalize(raw);
  if (!token) return { blocked: true, code: "empty_mode", raw };

  const declared = ROUTES.get(token);
  if (!declared) {
    const hits = [...ROUTES.entries()]
      .filter(([alias]) => alias.length >= 6 && token.includes(alias))
      .map(([, mode]) => mode);
    const unique = [...new Set(hits)];
    return {
      blocked: true,
      code: unique.length > 1 ? "ambiguous_mode" : "unknown_mode",
      raw,
    };
  }

  const schemaMode = CONTRACT.declared_modes[declared];
  if (schemaMode === null) {
    return {
      blocked: true,
      code: "unsupported_schema_mode",
      declared_mode: declared,
      schema_mode: null,
    };
  }
  return { blocked: false, declared_mode: declared, schema_mode: schemaMode };
}

function add(list, code, detail) {
  list.push({ code, detail });
}

function exactTrue(object, key) {
  return object && object[key] === true;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function missingRequiredFields(schema, value, at = "$", gaps = []) {
  if (!schema || typeof schema !== "object") return gaps;
  const objectLike = schema.type === "object" ||
    (!schema.type && schema.properties && value && typeof value === "object" && !Array.isArray(value));
  if (objectLike) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      gaps.push(at);
      return gaps;
    }
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) gaps.push(at + "." + key);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        missingRequiredFields(childSchema, value[key], at + "." + key, gaps);
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) {
      gaps.push(at);
      return gaps;
    }
    if (schema.items) {
      value.forEach((item, index) => missingRequiredFields(schema.items, item, at + "[" + index + "]", gaps));
    }
  }
  return gaps;
}

function schemaConditionMatches(schema, value) {
  const gaps = missingRequiredFields(schema, value, "$", []);
  const issues = schemaValueIssues(schema, value, "$", []);
  return gaps.length === 0 && issues.length === 0;
}

function applySubschema(schema, value, at, issues) {
  const gaps = missingRequiredFields(schema, value, at, []);
  for (const gap of gaps) issues.push(gap + ":required");
  schemaValueIssues(schema, value, at, issues);
}

function schemaValueIssues(schema, value, at = "$", issues = []) {
  if (!schema || typeof schema !== "object") return issues;
  if (Object.prototype.hasOwnProperty.call(schema, "const") && value !== schema.const) {
    issues.push(at + ":const");
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    issues.push(at + ":enum");
  }
  if (typeof schema.pattern === "string" && typeof value === "string") {
    const pattern = new RegExp(schema.pattern);
    if (!pattern.test(value)) issues.push(at + ":pattern");
  }
  if (typeof value === "string" && Number.isInteger(schema.minLength) && value.length < schema.minLength) {
    issues.push(at + ":min_length");
  }
  if (typeof value === "string" && Number.isInteger(schema.maxLength) && value.length > schema.maxLength) {
    issues.push(at + ":max_length");
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) issues.push(at + ":minimum");
    if (typeof schema.maximum === "number" && value > schema.maximum) issues.push(at + ":maximum");
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) issues.push(at + ":exclusive_minimum");
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) issues.push(at + ":exclusive_maximum");
  }
  const allowedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (allowedTypes.length) {
    const actualType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const typeMatch = allowedTypes.some((type) => type === actualType ||
      (type === "number" && actualType === "number" && Number.isFinite(value)) ||
      (type === "integer" && actualType === "number" && Number.isInteger(value)) ||
      (type === "object" && actualType === "object"));
    if (!typeMatch) {
      issues.push(at + ":type");
      return issues;
    }
  }
  if (schema.type === "array" && Array.isArray(value) && schema.uniqueItems === true) {
    const serialized = value.map((item) => JSON.stringify(item));
    if (new Set(serialized).size !== serialized.length) issues.push(at + ":unique_items");
  }
  const objectLike = (schema.type === "object" || (!schema.type && schema.properties)) &&
    value && typeof value === "object" && !Array.isArray(value);
  if (objectLike) {
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties || {}, key)) issues.push(at + "." + key + ":additional_property");
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) schemaValueIssues(childSchema, value[key], at + "." + key, issues);
    }
  } else if (schema.type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((item, index) => schemaValueIssues(schema.items, item, at + "[" + index + "]", issues));
  }
  for (const clause of schema.allOf || []) {
    if (clause.if) {
      const branch = schemaConditionMatches(clause.if, value) ? clause.then : clause.else;
      if (branch) applySubschema(branch, value, at, issues);
    } else {
      applySubschema(clause, value, at, issues);
    }
  }
  return issues;
}

function auditFinalization(payload = {}) {
  const violations = [];
  const blockers = [];
  const route = resolveMode(payload.requested_mode);
  if (route.blocked) add(blockers, route.code, route.raw || route.declared_mode || null);

  if (route.declared_mode === "learn_blind_test" &&
      !exactTrue(payload.audit_context, "learner_committed")) {
    add(blockers, "learning_precommit_unrepresentable", "interpretation must remain withheld");
  }

  const auditContext = payload.audit_context || {};
  for (const key of CONTRACT.required_audit_context) {
    if (!exactTrue(auditContext, key)) add(violations, "required_audit_context_unresolved", key);
  }
  if (payload.output_complete !== true) {
    add(violations, "incomplete_output", "output_complete must be boolean true");
  }
  if (payload.structured_output_emitted === true) {
    const gaps = missingRequiredFields(OUTPUT_SCHEMA, payload.structured_output);
    for (const gap of gaps) add(violations, "structured_output_required_field_missing", gap);
    const schemaIssues = schemaValueIssues(OUTPUT_SCHEMA, payload.structured_output);
    for (const issue of schemaIssues) add(violations, "structured_output_schema_violation", issue);

    const emittedQuality = payload.structured_output?.technical_quality || {};
    const emittedPrimary = payload.structured_output?.interpretation?.primary_pattern || {};
    const emittedRhythm = payload.structured_output?.rhythm || {};
    const emittedMeasurements = Array.isArray(payload.structured_output?.measurements) ?
      payload.structured_output.measurements : [];
    if (["limited", "poor", "cannot_interpret"].includes(emittedQuality.grade) &&
        !nonEmptyArray(emittedQuality.limitations)) {
      add(violations, "structured_output_quality_limitations_missing", emittedQuality.grade);
    }
    if (emittedQuality.crop_or_occlusion === true && !nonEmptyArray(emittedQuality.limitations)) {
      add(violations, "structured_output_quality_limitation_missing_for_crop", "crop_or_occlusion");
    }
    if (emittedQuality.perspective_distortion === true && !nonEmptyArray(emittedQuality.limitations)) {
      add(violations, "structured_output_quality_limitation_missing_for_perspective", "perspective_distortion");
    }
    if (emittedRhythm.finding && !nonEmptyArray(emittedRhythm.evidence)) {
      add(violations, "structured_output_rhythm_evidence_missing", emittedRhythm.finding);
    }
    if (emittedPrimary.label && !nonEmptyArray(emittedPrimary.evidence_for)) {
      add(violations, "structured_output_primary_pattern_evidence_missing", emittedPrimary.label);
    }
    for (const measurement of emittedMeasurements) {
      if (!measurement || typeof measurement !== "object") continue;
      const numeric = typeof measurement.value === "number" && Number.isFinite(measurement.value);
      if (numeric && !["user", "machine", "estimated", "calculated"].includes(measurement.source)) {
        add(violations, "structured_output_numeric_measurement_missing_source", measurement.name || null);
      }
      if (numeric && measurement.name === "qtc" &&
          !(typeof measurement.formula === "string" && measurement.formula.trim())) {
        add(violations, "structured_output_qtc_formula_missing", measurement.name);
      }
      if (numeric && ["rr", "pr", "qrs", "qt"].includes(measurement.name) &&
          measurement.source === "estimated" &&
          !(typeof emittedQuality.paper_speed_mm_s === "number" && Number.isFinite(emittedQuality.paper_speed_mm_s) && emittedQuality.paper_speed_mm_s > 0)) {
        add(violations, "structured_output_estimated_time_without_verified_speed", measurement.name);
      }
    }
    if (emittedQuality.grade === "cannot_interpret" && emittedPrimary.confidence === "high") {
      add(violations, "structured_output_high_confidence_forbidden_by_quality", emittedQuality.grade);
    }
    if (payload.technical_quality?.grade !== undefined &&
        emittedQuality.grade !== undefined &&
        payload.technical_quality.grade !== emittedQuality.grade) {
      add(violations, "structured_output_audit_mismatch", "technical_quality.grade");
    }
    if (payload.primary_pattern_confidence !== undefined &&
        emittedPrimary.confidence !== undefined &&
        payload.primary_pattern_confidence !== emittedPrimary.confidence) {
      add(violations, "structured_output_audit_mismatch", "interpretation.primary_pattern.confidence");
    }
    if (payload.technical_quality?.crop_or_occlusion !== undefined &&
        emittedQuality.crop_or_occlusion !== undefined &&
        payload.technical_quality.crop_or_occlusion !== emittedQuality.crop_or_occlusion) {
      add(violations, "structured_output_audit_mismatch", "technical_quality.crop_or_occlusion");
    }
    if (payload.technical_quality?.perspective_distortion !== undefined &&
        emittedQuality.perspective_distortion !== undefined &&
        payload.technical_quality.perspective_distortion !== emittedQuality.perspective_distortion) {
      add(violations, "structured_output_audit_mismatch", "technical_quality.perspective_distortion");
    }
    if (payload.rhythm_finding !== undefined &&
        emittedRhythm.finding !== undefined &&
        payload.rhythm_finding !== emittedRhythm.finding) {
      add(violations, "structured_output_audit_mismatch", "rhythm.finding");
    }
    if (payload.primary_pattern_label !== undefined &&
        emittedPrimary.label !== undefined &&
        payload.primary_pattern_label !== emittedPrimary.label) {
      add(violations, "structured_output_audit_mismatch", "interpretation.primary_pattern.label");
    }
  }

  if (!route.blocked) {
    const required = CONTRACT.mode_specific_context[route.schema_mode] || [];
    for (const key of required) {
      if (!exactTrue(auditContext, key)) add(violations, "mode_context_unresolved", key);
    }
  }

  for (const flag of CONTRACT.mandatory_fail_flags || []) {
    if (payload[flag] === true) add(violations, "mandatory_fail", flag);
  }
  for (const [flag, failureId] of Object.entries(CONTRACT.failure_control_flags || {})) {
    if (payload[flag] === true) add(violations, "failure_control", failureId + ":" + flag);
  }

  if (route.blocked && payload.normal_output_emitted === true) {
    add(blockers, "unsupported_mode_normal_output", route.code);
  }

  const quality = payload.technical_quality || {};
  if (quality.grade !== undefined && !QUALITY_GRADES.has(quality.grade)) {
    add(violations, "invalid_quality_grade", quality.grade);
  }
  if (payload.primary_pattern_confidence !== undefined &&
      !PATTERN_CONFIDENCES.has(payload.primary_pattern_confidence)) {
    add(violations, "unsupported_certainty", payload.primary_pattern_confidence);
  }
  if (["limited", "poor", "cannot_interpret"].includes(quality.grade) &&
      !nonEmptyArray(quality.limitations)) {
    add(violations, "quality_limitations_missing", quality.grade);
  }
  if (quality.crop_or_occlusion === true && !nonEmptyArray(quality.limitations)) {
    add(violations, "quality_limitation_missing_for_crop", "crop_or_occlusion");
  }
  if (quality.perspective_distortion === true && !nonEmptyArray(quality.limitations)) {
    add(violations, "quality_limitation_missing_for_perspective", "perspective_distortion");
  }
  if (quality.grade === "cannot_interpret" && payload.primary_pattern_confidence === "high") {
    add(violations, "high_confidence_forbidden_by_quality", quality.grade);
  }
  if (quality.grade === "cannot_interpret" && payload.model_exact_measurements === true) {
    add(violations, "exact_measurement_forbidden_by_quality", quality.grade);
  }

  const measurements = payload.measurements === undefined ? [] : payload.measurements;
  if (!Array.isArray(measurements)) {
    add(violations, "invalid_measurements_shape", typeof measurements);
  } else {
    for (const measurement of measurements) {
      if (!measurement || typeof measurement !== "object") {
        add(violations, "malformed_measurement", measurement);
        continue;
      }
      if (measurement.name !== undefined && !MEASUREMENT_NAMES.has(measurement.name)) {
        add(violations, "invalid_measurement_name", measurement.name);
      }
      if (measurement.source !== undefined && !MEASUREMENT_SOURCES.has(measurement.source)) {
        add(violations, "invalid_measurement_source", measurement.source);
      }
      const numeric = typeof measurement.value === "number";
      const finiteNumeric = numeric && Number.isFinite(measurement.value);
      if (numeric && !finiteNumeric) {
        add(violations, "nonfinite_measurement", measurement.name || null);
      }
      if (finiteNumeric && !["user", "machine", "estimated", "calculated"].includes(measurement.source)) {
        add(violations, "numeric_measurement_missing_source", measurement.name || null);
      }
      if (finiteNumeric && measurement.name === "qtc" &&
          !(typeof measurement.formula === "string" && measurement.formula.trim())) {
        add(violations, "qtc_formula_missing", measurement.name);
      }
      if (finiteNumeric && ["rr", "pr", "qrs", "qt"].includes(measurement.name) &&
          measurement.source === "estimated" && payload.paper_speed_verified !== true) {
        add(violations, "estimated_time_without_verified_speed", measurement.name);
      }
      if (finiteNumeric && measurement.name === "st_deviation" &&
          (payload.gain_verified !== true || payload.geometry_undistorted !== true)) {
        add(violations, "st_deviation_without_verified_geometry", measurement.name);
      }
    }
  }

  if (payload.rhythm_finding && !nonEmptyArray(payload.rhythm_evidence)) {
    add(violations, "rhythm_evidence_missing", payload.rhythm_finding);
  }
  if (payload.primary_pattern_label && !nonEmptyArray(payload.primary_pattern_evidence_for)) {
    add(violations, "primary_pattern_evidence_missing", payload.primary_pattern_label);
  }
  if (payload.pattern_id && payload.pattern_id_resolved !== true) {
    add(violations, "pattern_id_unresolved", payload.pattern_id);
  }
  if (payload.unresolved_contradiction === true && payload.primary_pattern_confidence === "high") {
    add(violations, "high_confidence_with_unresolved_contradiction", payload.primary_pattern_label || null);
  }

  if (payload.previous_mode !== undefined) {
    const previous = resolveMode(payload.previous_mode);
    if (previous.blocked) {
      add(violations, "invalid_previous_mode", previous.code);
    } else if (!route.blocked && previous.declared_mode !== route.declared_mode) {
      if (!exactTrue(payload.transition_context, "reaudit_completed")) {
        add(violations, "mode_transition_requires_reaudit", previous.declared_mode + "->" + route.declared_mode);
      }
      if (payload.inherited_prior_pass === true) {
        add(violations, "stale_pass_inheritance", previous.declared_mode + "->" + route.declared_mode);
      }
    }
  }

  const verdict = blockers.length ? "BLOCKED" : violations.length ? "REVISE" : "PASS";
  return {
    schema: "ekg-l04-mode-self-audit-evaluation-v1",
    verdict,
    route,
    blockers,
    violations,
    candidate_active: false,
  };
}

if (require.main === module) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    try {
      const payload = JSON.parse(input || "{}");
      const result = auditFinalization(payload);
      console.log(JSON.stringify(result, null, 2));
      if (result.verdict !== "PASS") process.exitCode = 1;
    } catch (error) {
      console.error(JSON.stringify({
        schema: "ekg-l04-mode-self-audit-evaluation-v1",
        verdict: "BLOCKED",
        blockers: [{ code: "invalid_json", detail: String(error.message || error) }],
        violations: [],
        candidate_active: false,
      }, null, 2));
      process.exitCode = 1;
    }
  });
}

module.exports = { CONTRACT, resolveMode, auditFinalization, missingRequiredFields, schemaValueIssues };
