"use strict";

const CANONICAL_12_LEAD_ORDER = Object.freeze([
  "I", "II", "III", "aVR", "aVL", "aVF",
  "V1", "V2", "V3", "V4", "V5", "V6",
]);

const MAX_SAMPLING_RATE_HZ = 100000;
const MAX_SEGMENT_SAMPLES = 10000000;

const PREPROCESS_GROUP_KEYS = new Set(["patient", "record", "encounter", "dataset-defined"]);
const PREPROCESS_GOVERNANCE = Object.freeze({ projectGold: false, sourceLabelsAreProjectGold: false, runtimeAuthority: false, clinicalValidityInferred: false });

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function nonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validSha40(value) {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}

function validateExactPreprocessingProvenance(provenance) {
  const errors = [];
  if (!isPlainObject(provenance)) return { pass: false, errors: ["PREPROCESS_PROVENANCE_OBJECT_REQUIRED"] };
  if (!nonEmptyText(provenance.source)) errors.push("PREPROCESS_PROVENANCE_SOURCE_REQUIRED");
  if (!nonEmptyText(provenance.locator)) errors.push("PREPROCESS_PROVENANCE_LOCATOR_REQUIRED");
  if (!validSha40(provenance.commit)) errors.push("PREPROCESS_PROVENANCE_COMMIT_REQUIRED");
  if (!validSha40(provenance.tree)) errors.push("PREPROCESS_PROVENANCE_TREE_REQUIRED");
  return { pass: errors.length === 0, errors };
}

function validateFailureAccounting(accounting) {
  const errors = [];
  if (!isPlainObject(accounting)) return { pass: false, errors: ["PREPROCESS_ACCOUNTING_OBJECT_REQUIRED"] };
  for (const key of ["attempted", "processed", "skipped"]) {
    if (!Number.isInteger(accounting[key]) || accounting[key] < 0) errors.push("PREPROCESS_ACCOUNTING_COUNT_INVALID");
  }
  if (Number.isInteger(accounting.attempted) && Number.isInteger(accounting.processed) && Number.isInteger(accounting.skipped) && accounting.processed + accounting.skipped !== accounting.attempted) errors.push("PREPROCESS_ACCOUNTING_RECONCILE");
  if (!nonEmptyText(accounting.exceptionPolicy) || ["silent", "aggregate-only"].includes(String(accounting.exceptionPolicy).toLowerCase())) errors.push("PREPROCESS_ACCOUNTING_EXCEPTION_POLICY");
  if (!isPlainObject(accounting.skipReasons)) errors.push("PREPROCESS_ACCOUNTING_REASONS_REQUIRED");
  else {
    let total = 0;
    for (const [reason, count] of Object.entries(accounting.skipReasons)) {
      if (!nonEmptyText(reason) || !Number.isInteger(count) || count < 0) errors.push("PREPROCESS_ACCOUNTING_REASON_INVALID");
      else total += count;
    }
    if (Number.isInteger(accounting.skipped) && total !== accounting.skipped) errors.push("PREPROCESS_ACCOUNTING_REASON_RECONCILE");
  }
  return { pass: errors.length === 0, errors: [...new Set(errors)] };
}

function validatePreprocessingExecutionProvenance(input) {
  const errors = [];
  if (!isPlainObject(input)) return { pass: false, errors: ["PREPROCESS_EXECUTION_OBJECT_REQUIRED"], governance: PREPROCESS_GOVERNANCE };
  const provenance = validateExactPreprocessingProvenance(input.implementationProvenance);
  errors.push(...provenance.errors);
  const accounting = validateFailureAccounting(input.failureAccounting);
  errors.push(...accounting.errors);
  if (!PREPROCESS_GROUP_KEYS.has(input.groupKeySemantics)) errors.push("PREPROCESS_GROUP_KEY_INVALID");
  if (input.projectGold !== false) errors.push("PREPROCESS_PROJECT_GOLD_FORBIDDEN");
  if (input.sourceLabelsAreProjectGold !== false) errors.push("PREPROCESS_SOURCE_LABEL_GOLD_FORBIDDEN");
  if (input.runtimeAuthority !== false) errors.push("PREPROCESS_RUNTIME_AUTHORITY_FORBIDDEN");
  if (input.clinicalValidityInferred !== false) errors.push("PREPROCESS_CLINICAL_VALIDITY_FORBIDDEN");
  return { pass: errors.length === 0, errors: [...new Set(errors)], governance: PREPROCESS_GOVERNANCE };
}

function normalizeLeadLabel(label) {
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

function validPositiveFinite(value, max) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max;
}

function buildSignalPreprocessingContract(input) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return failure(["INPUT_OBJECT_REQUIRED"]);
  }

  const sourceLeadLabels = input.sourceLeadLabels;
  if (!Array.isArray(sourceLeadLabels) || sourceLeadLabels.length === 0) {
    errors.push("SOURCE_LEAD_LABELS_REQUIRED");
  }

  const normalizedSourceLeads = [];
  const unknownSourceLeadLabels = [];
  if (Array.isArray(sourceLeadLabels)) {
    for (const label of sourceLeadLabels) {
      const normalized = normalizeLeadLabel(label);
      if (normalized) normalizedSourceLeads.push(normalized);
      else unknownSourceLeadLabels.push(label);
    }
  }
  if (unknownSourceLeadLabels.length) errors.push("UNKNOWN_SOURCE_LEAD_LABEL");

  const counts = new Map();
  for (const lead of normalizedSourceLeads) counts.set(lead, (counts.get(lead) || 0) + 1);
  const duplicateSourceLeads = [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([lead]) => lead);
  if (duplicateSourceLeads.length) errors.push("DUPLICATE_SOURCE_LEAD");

  const requireCompleteTwelveLead = input.requireCompleteTwelveLead !== false;
  const sourceLeadSet = new Set(normalizedSourceLeads);
  const missingCanonicalLeads = CANONICAL_12_LEAD_ORDER.filter(lead => !sourceLeadSet.has(lead));
  if (requireCompleteTwelveLead && missingCanonicalLeads.length) {
    errors.push("MISSING_REQUIRED_12_LEAD");
  }

  if (!validPositiveFinite(input.sourceSamplingRateHz, MAX_SAMPLING_RATE_HZ)) {
    errors.push("INVALID_SOURCE_SAMPLING_RATE_HZ");
  }
  if (!validPositiveFinite(input.targetSamplingRateHz, MAX_SAMPLING_RATE_HZ)) {
    errors.push("INVALID_TARGET_SAMPLING_RATE_HZ");
  }
  if (!Number.isInteger(input.segmentSamples) || input.segmentSamples <= 0 || input.segmentSamples > MAX_SEGMENT_SAMPLES) {
    errors.push("INVALID_SEGMENT_SAMPLES");
  }

  const ratesValid =
    validPositiveFinite(input.sourceSamplingRateHz, MAX_SAMPLING_RATE_HZ) &&
    validPositiveFinite(input.targetSamplingRateHz, MAX_SAMPLING_RATE_HZ);
  const requiresResampling = ratesValid && input.sourceSamplingRateHz !== input.targetSamplingRateHz;
  if (requiresResampling && (typeof input.resamplingMethod !== "string" || !input.resamplingMethod.trim())) {
    errors.push("RESAMPLING_METHOD_REQUIRED");
  }
  if (!requiresResampling && input.resamplingMethod !== undefined && input.resamplingMethod !== null && typeof input.resamplingMethod !== "string") {
    errors.push("INVALID_RESAMPLING_METHOD");
  }

  if (errors.length) {
    return failure(errors, {
      normalizedSourceLeads,
      unknownSourceLeadLabels,
      duplicateSourceLeads,
      missingCanonicalLeads,
      requiresResampling,
    });
  }

  const indexByLead = new Map(normalizedSourceLeads.map((lead, index) => [lead, index]));
  const reorderIndices = requireCompleteTwelveLead
    ? CANONICAL_12_LEAD_ORDER.map(lead => indexByLead.get(lead))
    : CANONICAL_12_LEAD_ORDER.filter(lead => indexByLead.has(lead)).map(lead => indexByLead.get(lead));
  const canonicalLeadOrder = requireCompleteTwelveLead
    ? [...CANONICAL_12_LEAD_ORDER]
    : CANONICAL_12_LEAD_ORDER.filter(lead => indexByLead.has(lead));

  const segmentDurationSeconds = input.segmentSamples / input.targetSamplingRateHz;

  return {
    schema: "ekg-signal-preprocessing-contract-v1",
    pass: true,
    sourceLeadOrder: normalizedSourceLeads,
    canonicalLeadOrder,
    reorderIndices,
    sourceSamplingRateHz: input.sourceSamplingRateHz,
    targetSamplingRateHz: input.targetSamplingRateHz,
    requiresResampling,
    resamplingMethod: requiresResampling ? input.resamplingMethod.trim() : null,
    segmentSamples: input.segmentSamples,
    segmentDurationSeconds,
    provenance: {
      sourceDatasetId: typeof input.sourceDatasetId === "string" ? input.sourceDatasetId : null,
      sourceAdapterId: typeof input.sourceAdapterId === "string" ? input.sourceAdapterId : null,
      upstreamCommit: typeof input.upstreamCommit === "string" ? input.upstreamCommit : null,
    },
    sourceLabelsPromotedToProjectGold: false,
    projectGoldCreated: false,
    diagnosticRuntime: "GOVERNED_INACTIVE",
    metrics: "NOT_REPORTABLE",
    activation: "NOT_ELIGIBLE",
    clinicalValidityInferred: false,
  };
}

function failure(errors, details = {}) {
  return {
    schema: "ekg-signal-preprocessing-contract-v1",
    pass: false,
    errors: [...new Set(errors)],
    ...details,
    sourceLabelsPromotedToProjectGold: false,
    projectGoldCreated: false,
    diagnosticRuntime: "GOVERNED_INACTIVE",
    metrics: "NOT_REPORTABLE",
    activation: "NOT_ELIGIBLE",
    clinicalValidityInferred: false,
  };
}

module.exports = {
  CANONICAL_12_LEAD_ORDER,
  normalizeLeadLabel,
  buildSignalPreprocessingContract,
  PREPROCESS_GOVERNANCE,
  validateExactPreprocessingProvenance,
  validateFailureAccounting,
  validatePreprocessingExecutionProvenance,
};
