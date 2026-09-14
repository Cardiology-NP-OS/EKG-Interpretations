const STANDARD_LEADS = [
  "I", "II", "III", "aVR", "aVL", "aVF",
  "V1", "V2", "V3", "V4", "V5", "V6",
];

const SOURCE_REFERENCES = Object.freeze({
  imageQuality: Object.freeze({
    file: "29_IMAGE_QUALITY_PROTOCOL.md",
    sha256: "4720e1b2b22dd3c5100c24cebba0ebfec262a1f4f5956f298a63b9505568d459",
  }),
  inputSecurity: Object.freeze({
    file: "35_INPUT_SECURITY.md",
    sha256: "e9f2e59bfcafc109b41b8d76b52f8ac82b35d19543bf05656e41c5e750dc552e",
  }),
});

const SOURCE_KINDS = new Set([
  "original_digital_ecg_pdf",
  "scanned_paper_ecg",
  "phone_photo",
  "screenshot",
  "monitor_capture",
  "cropped_lead_strip",
  "structured_input",
]);

const SUPPORTED_FORMATS = new Set(["pdf", "png", "jpeg", "jpg", "structured_json"]);
const QUALITY_FLAGS = new Set([
  "low_resolution",
  "severe_compression",
  "cropped",
  "rotation_or_skew",
  "perspective_distortion",
  "distorted_aspect_ratio",
  "resampled",
  "insufficient_signal_or_image_quality",
]);

const STRUCTURE_LIMITS = Object.freeze({
  maxDepth: 64,
  maxContainerEntries: 2048,
  maxNodes: 10000,
});

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior|system|developer)\b/i,
  /ignore\s+(?:the\s+)?waveform\b/i,
  /override\s+(?:project|system|developer|safety|instructions?)\b/i,
  /follow\s+(?:these|the following)\s+instructions?\b/i,
  /system\s+(?:message|prompt|instruction)\b/i,
  /developer\s+(?:message|instruction)\b/i,
  /do\s+not\s+follow\s+(?:project|system|developer)\b/i,
  /you\s+must\s+(?:ignore|override)\b/i,
];

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  try {
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch (error) {
    return false;
  }
}

function pushUnique(array, value) {
  if (!array.includes(value)) array.push(value);
}

function walkFiniteNumbers(
  value,
  path,
  errors,
  active = new WeakSet(),
  state = { nodes: 0, limited: false },
  depth = 0
) {
  if (state.limited) return;
  state.nodes += 1;
  if (state.nodes > STRUCTURE_LIMITS.maxNodes) {
    errors.push(`STRUCTURE_NODE_LIMIT:${path}`);
    state.limited = true;
    return;
  }
  if (depth > STRUCTURE_LIMITS.maxDepth) {
    errors.push(`STRUCTURE_DEPTH_LIMIT:${path}`);
    state.limited = true;
    return;
  }

  const type = typeof value;
  if (type === "number" && !Number.isFinite(value)) {
    errors.push(`NONFINITE_NUMERIC_VALUE:${path}`);
    return;
  }
  if (["undefined", "bigint", "symbol", "function"].includes(type)) {
    errors.push(`UNSUPPORTED_VALUE_TYPE:${path}:${type}`);
    return;
  }
  if (value === null || ["string", "boolean", "number"].includes(type)) return;

  const arrayValue = Array.isArray(value);
  const plainObjectValue = isPlainObject(value);
  if (!arrayValue && !plainObjectValue) {
    errors.push(`UNSUPPORTED_OBJECT_TYPE:${path}`);
    return;
  }
  if (active.has(value)) {
    errors.push(`CYCLIC_STRUCTURE:${path}`);
    return;
  }

  active.add(value);
  const keys = Reflect.ownKeys(value);
  const entryCount = arrayValue ? value.length : keys.length;
  if (entryCount > STRUCTURE_LIMITS.maxContainerEntries) {
    errors.push(`STRUCTURE_WIDTH_LIMIT:${path}`);
    state.limited = true;
    active.delete(value);
    return;
  }

  if (arrayValue) {
    for (let index = 0; index < value.length && !state.limited; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        errors.push(`SPARSE_ARRAY:${path}[${index}]`);
        continue;
      }
      walkFiniteNumbers(
        value[index], `${path}[${index}]`, errors, active, state, depth + 1
      );
    }
    for (const key of keys) {
      if (key === "length" || (typeof key === "string" && /^(0|[1-9]\d*)$/.test(key))) continue;
      errors.push(`UNSUPPORTED_ARRAY_PROPERTY:${path}`);
    }
  } else {
    for (const key of keys) {
      if (state.limited) break;
      if (typeof key !== "string") {
        errors.push(`UNSUPPORTED_PROPERTY_KEY:${path}`);
        continue;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      const childPath = path ? `${path}.${key}` : key;
      if (!descriptor || !descriptor.enumerable) {
        errors.push(`UNSUPPORTED_PROPERTY_DESCRIPTOR:${childPath}`);
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) {
        errors.push(`UNSUPPORTED_ACCESSOR_PROPERTY:${childPath}`);
        continue;
      }
      walkFiniteNumbers(
        descriptor.value, childPath, errors, active, state, depth + 1
      );
    }
  }
  active.delete(value);
}

function normalizeLead(label) {
  if (typeof label !== "string") return null;
  const token = label.trim().toUpperCase();
  const map = {
    I: "I", II: "II", III: "III",
    AVR: "aVR", AVL: "aVL", AVF: "aVF",
    V1: "V1", V2: "V2", V3: "V3",
    V4: "V4", V5: "V5", V6: "V6",
  };
  return map[token] || null;
}

function normalizeUntrustedText(text) {
  if (typeof text !== "string") return "";
  return text
    .normalize("NFKC")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function instructionLikeText(text) {
  const normalized = normalizeUntrustedText(text);
  return INJECTION_PATTERNS.some(pattern => pattern.test(normalized));
}

function filenameHasPathTrick(filename) {
  return (
    filename.includes("\0") ||
    /(^|[\\/])\.\.([\\/]|$)/.test(filename) ||
    /^[a-zA-Z]:[\\/]/.test(filename) ||
    /^\\\\/.test(filename) ||
    /^[\\/]/.test(filename)
  );
}

function stableValue(value) {
  if (value === null) return "null";
  if (typeof value === "object") return JSON.stringify(value);
  return `${typeof value}:${String(value)}`;
}

function malformedResult(reasons) {
  return {
    schema: "ekg-input-quality-preflight-v1",
    pass: false,
    technicalQualityGrade: "cannot_interpret",
    warningStates: ["MALFORMED_STRUCTURED_INPUT"],
    fatalCodes: ["MALFORMED_STRUCTURED_INPUT"],
    malformedReasons: reasons,
    blockedConclusions: ["all_source_dependent_conclusions"],
    safePartialAnalysisAllowed: false,
    exactTimeMeasurementAllowed: false,
    exactVoltageMeasurementAllowed: false,
    specificLeadClaimsAllowed: false,
    twelveLeadClaimsAllowed: false,
    serialComparisonAllowed: false,
    measurementsReliable: false,
    sourceTextAuthoritative: false,
    machineInterpretationAuthoritative: false,
    sourceInstructionsIgnored: true,
    externalLinksAndQrCodesInert: true,
    clinicalAccuracyClaimed: false,
    diagnosticInterpretationIncluded: false,
    candidateActive: false,
    sourceReferences: SOURCE_REFERENCES,
  };
}

function preflightInput(input) {
  const malformed = [];
  if (!isPlainObject(input)) return malformedResult(["INPUT_OBJECT_REQUIRED"]);
  try {
    walkFiniteNumbers(input, "", malformed);
  } catch (error) {
    return malformedResult(["STRUCTURE_ACCESS_ERROR"]);
  }
  if (malformed.length) return malformedResult(malformed);

  if (!SOURCE_KINDS.has(input.source_kind)) malformed.push("SOURCE_KIND");
  if (typeof input.format !== "string") malformed.push("FORMAT");
  if (typeof input.readable !== "boolean") malformed.push("READABLE");
  if (!Array.isArray(input.quality_flags)) malformed.push("QUALITY_FLAGS");
  if (!Array.isArray(input.lead_labels)) malformed.push("LEAD_LABELS");
  if (typeof input.lead_labels_verified !== "boolean") malformed.push("LEAD_LABELS_VERIFIED");
  if (typeof input.presented_as_12_lead !== "boolean") malformed.push("PRESENTED_AS_12_LEAD");
  if (typeof input.lead_mislabel_suspected !== "boolean") malformed.push("LEAD_MISLABEL_SUSPECTED");
  if (typeof input.evidence_complete !== "boolean") malformed.push("EVIDENCE_COMPLETE");
  if (typeof input.signal_quality_sufficient !== "boolean") malformed.push("SIGNAL_QUALITY_SUFFICIENT");
  if (typeof input.source_identity_established !== "boolean") malformed.push("SOURCE_IDENTITY_ESTABLISHED");
  if (typeof input.serial_comparison_requested !== "boolean") malformed.push("SERIAL_COMPARISON_REQUESTED");
  if (typeof input.serial_pair_verified !== "boolean") malformed.push("SERIAL_PAIR_VERIFIED");
  if (typeof input.machine_text_conflict !== "boolean") malformed.push("MACHINE_TEXT_CONFLICT");
  if (!isPlainObject(input.calibration)) malformed.push("CALIBRATION");
  if (!isPlainObject(input.geometry)) malformed.push("GEOMETRY");
  if (!isPlainObject(input.image)) malformed.push("IMAGE");
  if (!Array.isArray(input.metadata_claims)) malformed.push("METADATA_CLAIMS");
  if (!Array.isArray(input.measurements)) malformed.push("MEASUREMENTS");
  if (!Array.isArray(input.embedded_text)) malformed.push("EMBEDDED_TEXT");
  if (input.filename !== undefined && typeof input.filename !== "string") {
    malformed.push("FILENAME");
  }
  for (const field of ["ocr_text", "qr_text", "metadata_text", "machine_interpretation_text"]) {
    if (input[field] !== undefined && !Array.isArray(input[field])) {
      malformed.push(field.toUpperCase());
    }
  }
  for (const field of [
    "multiple_tracings_present",
    "tracing_identity_match_established",
    "hidden_text_detected",
  ]) {
    if (input[field] !== undefined && typeof input[field] !== "boolean") {
      malformed.push(field.toUpperCase());
    }
  }
  if (malformed.length) return malformedResult(malformed);

  for (const flag of input.quality_flags) {
    if (typeof flag !== "string" || !QUALITY_FLAGS.has(flag)) malformed.push("QUALITY_FLAG");
  }
  for (const key of ["rotation_or_skew", "perspective_distortion", "distorted_aspect_ratio"]) {
    if (typeof input.geometry[key] !== "boolean") malformed.push(`GEOMETRY_${key}`);
  }
  if (typeof input.calibration.local_scale_trustworthy !== "boolean") {
    malformed.push("LOCAL_SCALE_TRUSTWORTHY");
  }
  if (!["visible", "user", "machine", "unknown"].includes(input.calibration.calibration_source)) {
    malformed.push("CALIBRATION_SOURCE");
  }
  for (const key of ["paper_speed_mm_s", "gain_mm_mV"]) {
    const value = input.calibration[key];
    if (value !== null && typeof value !== "number") malformed.push(`CALIBRATION_${key}`);
  }
  for (const key of ["width_px", "height_px"]) {
    const value = input.image[key];
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      malformed.push(`IMPOSSIBLE_METADATA:${key}`);
    }
  }
  for (const field of ["embedded_text", "ocr_text", "qr_text", "metadata_text", "machine_interpretation_text"]) {
    const values = input[field] || [];
    if (values.some(value => typeof value !== "string")) {
      malformed.push(`${field.toUpperCase()}_ITEM`);
    }
  }
  if (malformed.length) return malformedResult(malformed);

  const warnings = [];
  const fatalCodes = [];
  const blocked = [];
  const format = input.format.toLowerCase();
  if (!SUPPORTED_FORMATS.has(format)) {
    fatalCodes.push("UNSUPPORTED_FORMAT");
    blocked.push("all_source_dependent_conclusions");
  }

  let grade = "adequate";
  if (!input.readable) {
    pushUnique(warnings, "UNREADABLE_SOURCE");
    grade = "cannot_interpret";
    pushUnique(blocked, "all_source_dependent_conclusions");
  }
  for (const flag of input.quality_flags) {
    if (flag === "low_resolution") pushUnique(warnings, "LOW_RESOLUTION");
    if (flag === "severe_compression") pushUnique(warnings, "SEVERE_COMPRESSION");
    if (flag === "cropped") pushUnique(warnings, "CROPPED_SOURCE");
    if (["rotation_or_skew", "perspective_distortion", "distorted_aspect_ratio"].includes(flag)) {
      pushUnique(warnings, "GEOMETRY_DISTORTED");
    }
    if (flag === "insufficient_signal_or_image_quality") {
      pushUnique(warnings, "INSUFFICIENT_SIGNAL_OR_IMAGE_QUALITY");
      grade = "cannot_interpret";
      pushUnique(blocked, "all_source_dependent_conclusions");
    } else if (grade === "adequate") {
      grade = "limited";
    }
  }

  const geometryDistorted =
    input.geometry.rotation_or_skew ||
    input.geometry.perspective_distortion ||
    input.geometry.distorted_aspect_ratio ||
    warnings.includes("GEOMETRY_DISTORTED");
  if (geometryDistorted) {
    pushUnique(warnings, "GEOMETRY_DISTORTED");
    if (grade === "adequate") grade = "limited";
  }

  const speed = input.calibration.paper_speed_mm_s;
  const gain = input.calibration.gain_mm_mV;
  if (speed !== null && speed <= 0) malformed.push("IMPOSSIBLE_METADATA:paper_speed_mm_s");
  if (gain !== null && gain <= 0) malformed.push("IMPOSSIBLE_METADATA:gain_mm_mV");
  if (malformed.length) return malformedResult(malformed);

  const calibrationKnown = input.calibration.calibration_source !== "unknown";
  const transformedScale = geometryDistorted || input.quality_flags.includes("resampled");
  const scaleTrustworthy = !transformedScale || input.calibration.local_scale_trustworthy;
  let exactTimeAllowed = calibrationKnown && speed !== null && scaleTrustworthy;
  let exactVoltageAllowed = calibrationKnown && gain !== null && scaleTrustworthy;
  if (!exactTimeAllowed || !exactVoltageAllowed) {
    pushUnique(warnings, "SCALE_UNKNOWN");
    if (!exactTimeAllowed) pushUnique(blocked, "exact_time_measurements");
    if (!exactVoltageAllowed) pushUnique(blocked, "exact_voltage_measurements");
    if (grade === "adequate") grade = "limited";
  }

  const normalizedLeads = [];
  const unknownLeadLabels = [];
  for (const label of input.lead_labels) {
    const normalized = normalizeLead(label);
    if (normalized) normalizedLeads.push(normalized);
    else unknownLeadLabels.push(label);
  }
  const counts = new Map();
  for (const lead of normalizedLeads) counts.set(lead, (counts.get(lead) || 0) + 1);
  const duplicateLeadLabels = [...counts.entries()]
    .filter(([, count]) => count > 1).map(([lead]) => lead);
  const unique = new Set(normalizedLeads);
  const missingStandardLeads = STANDARD_LEADS.filter(lead => !unique.has(lead));

  if (duplicateLeadLabels.length) {
    pushUnique(warnings, "DUPLICATE_LEADS");
    if (grade === "adequate") grade = "limited";
  }
  if (unknownLeadLabels.length || !input.lead_labels_verified || input.lead_mislabel_suspected) {
    pushUnique(warnings, "LEAD_IDENTITY_UNKNOWN");
    pushUnique(blocked, "specific_lead_or_regional_claims");
    if (grade === "adequate") grade = "limited";
  }
  if (input.presented_as_12_lead && missingStandardLeads.length) {
    pushUnique(warnings, "MISSING_LEADS");
    pushUnique(warnings, "PARTIAL_TRACING_AS_12_LEAD");
    pushUnique(blocked, "twelve_lead_claims");
    if (grade === "adequate") grade = "limited";
  }
  if (input.source_kind === "cropped_lead_strip" && input.presented_as_12_lead) {
    pushUnique(warnings, "PARTIAL_TRACING_AS_12_LEAD");
    pushUnique(blocked, "twelve_lead_claims");
    if (grade === "adequate") grade = "limited";
  }
  const metadataByField = new Map();
  for (const claim of input.metadata_claims) {
    if (!isPlainObject(claim) || typeof claim.field !== "string" || !claim.field.trim() ||
        typeof claim.source !== "string" || !claim.source.trim() ||
        !Object.prototype.hasOwnProperty.call(claim, "value")) {
      malformed.push("METADATA_CLAIM");
      continue;
    }
    const key = claim.field.trim().toLowerCase();
    const values = metadataByField.get(key) || new Set();
    values.add(stableValue(claim.value));
    metadataByField.set(key, values);
  }
  if (malformed.length) return malformedResult(malformed);
  const metadataConflicts = [...metadataByField.entries()]
    .filter(([, values]) => values.size > 1).map(([field]) => field);
  const declaredCalibration = {
    paper_speed_mm_s: speed,
    gain_mm_mv: gain,
    calibration_source: input.calibration.calibration_source,
  };
  for (const [field, declaredValue] of Object.entries(declaredCalibration)) {
    const values = metadataByField.get(field);
    if (
      values &&
      declaredValue !== null &&
      !values.has(stableValue(declaredValue)) &&
      !metadataConflicts.includes(field)
    ) {
      metadataConflicts.push(field);
    }
  }
  if (metadataConflicts.length) {
    pushUnique(warnings, "CONFLICTING_METADATA");
    pushUnique(warnings, "SOURCE_IDENTITY_UNCERTAIN");
    pushUnique(blocked, "serial_change_claims");
    if (grade === "adequate") grade = "limited";
  }
  const calibrationSourceConflict = metadataConflicts.includes("calibration_source");
  if (metadataConflicts.includes("paper_speed_mm_s") || calibrationSourceConflict) {
    exactTimeAllowed = false;
    pushUnique(warnings, "SCALE_UNKNOWN");
    pushUnique(blocked, "exact_time_measurements");
  }
  if (metadataConflicts.includes("gain_mm_mv") || calibrationSourceConflict) {
    exactVoltageAllowed = false;
    pushUnique(warnings, "SCALE_UNKNOWN");
    pushUnique(blocked, "exact_voltage_measurements");
  }
  if (!input.source_identity_established) {
    pushUnique(warnings, "SOURCE_IDENTITY_UNCERTAIN");
    pushUnique(blocked, "serial_change_claims");
    if (grade === "adequate") grade = "limited";
  }
  const multipleTracingsUnmatched =
    input.multiple_tracings_present === true &&
    input.tracing_identity_match_established !== true;
  if (multipleTracingsUnmatched) {
    pushUnique(warnings, "MULTIPLE_TRACINGS_UNMATCHED");
    pushUnique(warnings, "SOURCE_IDENTITY_UNCERTAIN");
    pushUnique(blocked, "serial_change_claims");
    if (grade === "adequate") grade = "limited";
  }
  if (input.serial_comparison_requested && !input.serial_pair_verified) {
    pushUnique(warnings, "SERIAL_PAIR_UNVERIFIED");
    pushUnique(blocked, "serial_change_claims");
    if (grade === "adequate") grade = "limited";
  }
  if (input.machine_text_conflict) {
    pushUnique(warnings, "MACHINE_TEXT_CONFLICT");
    if (grade === "adequate") grade = "limited";
  }

  let measurementsReliable = true;
  const measurementsByKey = new Map();
  for (const measurement of input.measurements) {
    if (!isPlainObject(measurement) || typeof measurement.name !== "string" ||
        !measurement.name.trim() || typeof measurement.value !== "number" ||
        typeof measurement.unit !== "string" || !measurement.unit.trim()) {
      malformed.push("MEASUREMENT");
      continue;
    }
    const key = `${measurement.name.trim().toLowerCase()}|${measurement.unit.trim().toLowerCase()}`;
    const values = measurementsByKey.get(key) || new Set();
    values.add(measurement.value);
    measurementsByKey.set(key, values);
  }
  if (malformed.length) return malformedResult(malformed);
  const contradictoryMeasurements = [...measurementsByKey.entries()]
    .filter(([, values]) => values.size > 1).map(([key]) => key);
  if (contradictoryMeasurements.length) {
    measurementsReliable = false;
    pushUnique(warnings, "CONTRADICTORY_MEASUREMENTS");
    pushUnique(blocked, "measurement_dependent_conclusions");
    if (grade === "adequate") grade = "limited";
  }

  if (!input.evidence_complete) {
    pushUnique(warnings, "INCOMPLETE_EVIDENCE");
    pushUnique(blocked, "evidence_dependent_conclusions");
    if (grade === "adequate") grade = "limited";
  }
  if (!input.signal_quality_sufficient) {
    pushUnique(warnings, "INSUFFICIENT_SIGNAL_OR_IMAGE_QUALITY");
    pushUnique(blocked, "all_source_dependent_conclusions");
    grade = "cannot_interpret";
  }
  const untrustedText = [
    ...input.embedded_text,
    ...(input.ocr_text || []),
    ...(input.qr_text || []),
    ...(input.metadata_text || []),
    ...(input.machine_interpretation_text || []),
  ];
  if (typeof input.filename === "string") untrustedText.push(input.filename);
  if (input.hidden_text_detected === true) {
    pushUnique(warnings, "HIDDEN_TEXT_PRESENT");
  }
  if (untrustedText.some(instructionLikeText)) {
    pushUnique(warnings, "POSSIBLE_PROMPT_INJECTION");
  }
  if (typeof input.filename === "string" && filenameHasPathTrick(input.filename)) {
    pushUnique(warnings, "FILENAME_PATH_TRICK");
  }

  const globallyBlocked =
    fatalCodes.length > 0 ||
    !input.readable ||
    !input.signal_quality_sufficient ||
    grade === "cannot_interpret";

  const specificLeadClaimsAllowed =
    !globallyBlocked &&
    input.lead_labels_verified &&
    !input.lead_mislabel_suspected &&
    unknownLeadLabels.length === 0 &&
    duplicateLeadLabels.length === 0;

  const twelveLeadClaimsAllowed =
    !globallyBlocked &&
    input.presented_as_12_lead &&
    missingStandardLeads.length === 0 &&
    specificLeadClaimsAllowed &&
    input.source_kind !== "cropped_lead_strip";

  return {
    schema: "ekg-input-quality-preflight-v1",
    pass: !globallyBlocked,
    technicalQualityGrade: grade,
    warningStates: warnings.sort(),
    fatalCodes: fatalCodes.sort(),
    malformedReasons: [],
    blockedConclusions: [...new Set(blocked)].sort(),
    safePartialAnalysisAllowed: !globallyBlocked,
    exactTimeMeasurementAllowed: !globallyBlocked && exactTimeAllowed,
    exactVoltageMeasurementAllowed: !globallyBlocked && exactVoltageAllowed,
    specificLeadClaimsAllowed,
    twelveLeadClaimsAllowed,
    serialComparisonAllowed:
      !globallyBlocked &&
      metadataConflicts.length === 0 &&
      input.source_identity_established &&
      !multipleTracingsUnmatched &&
      (!input.serial_comparison_requested || input.serial_pair_verified),
    measurementsReliable,
    sourceTextAuthoritative: false,
    machineInterpretationAuthoritative: false,
    sourceInstructionsIgnored: true,
    externalLinksAndQrCodesInert: true,
    missingStandardLeads,
    duplicateLeadLabels,
    unknownLeadLabels,
    metadataConflicts,
    contradictoryMeasurements,
    clinicalAccuracyClaimed: false,
    diagnosticInterpretationIncluded: false,
    candidateActive: false,
    sourceReferences: SOURCE_REFERENCES,
  };
}

module.exports = {
  SOURCE_REFERENCES,
  STANDARD_LEADS,
  STRUCTURE_LIMITS,
  instructionLikeText,
  preflightInput,
};
