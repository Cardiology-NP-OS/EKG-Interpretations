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

  if (!route.blocked) {
    const required = CONTRACT.mode_specific_context[route.schema_mode] || [];
    for (const key of required) {
      if (!exactTrue(auditContext, key)) add(violations, "mode_context_unresolved", key);
    }
  }

  for (const flag of CONTRACT.mandatory_fail_flags || []) {
    if (payload[flag] === true) add(violations, "mandatory_fail", flag);
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

module.exports = { CONTRACT, resolveMode, auditFinalization };
