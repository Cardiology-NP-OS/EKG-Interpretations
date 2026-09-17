"use strict";

const CANONICAL_12_LEAD_ORDER = Object.freeze([
  "I", "II", "III", "aVR", "aVL", "aVF",
  "V1", "V2", "V3", "V4", "V5", "V6",
]);

const MAX_SAMPLING_RATE_HZ = 100000;
const MAX_SEGMENT_SAMPLES = 10000000;

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
};
