"use strict";

const crypto = require("crypto");
const { runSignalPreprocessingPipeline } = require("./signal_preprocessing_pipeline");
const { runPhysicalLeadMeasurementPipeline } = require("./signal_measurement_pipeline");
const { extractRhythmFeatures } = require("./rhythm_feature_contract");
const { evaluateCandidatePhenotypes } = require("./candidate_phenotype_engine");
const { renderWaveformSvg } = require("./waveform_rendering");
const { aggregateCandidateEvidence, summarizeMetric } = require("./multilead_signal_intelligence");

const EXECUTION_GOVERNANCE = Object.freeze({
  authorityClass: "EVALUATION_NONRUNTIME",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  sourceLabelsAreProjectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}
function stableJson(value, seen = new Set(), depth = 0) {
  requireCondition(depth <= 64, "EXECUTION_CONFIG_DEPTH_LIMIT");
  if (value === null) return "null";
  if (["string", "boolean"].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === "number") {
    requireCondition(Number.isFinite(value), "EXECUTION_CONFIG_NONFINITE");
    return JSON.stringify(value);
  }
  requireCondition(typeof value === "object", "EXECUTION_CONFIG_JSON_TYPE");
  requireCondition(!seen.has(value), "EXECUTION_CONFIG_CYCLE");
  seen.add(value);
  let out;
  if (Array.isArray(value)) {
    out = `[${value.map(item => stableJson(item, seen, depth + 1)).join(",")}]`;
  } else {
    requireCondition(Object.getPrototypeOf(value) === Object.prototype,
      "EXECUTION_CONFIG_PLAIN_OBJECT_REQUIRED");
    out = `{${Object.keys(value).sort().map(key => {
      requireCondition(value[key] !== undefined, "EXECUTION_CONFIG_UNDEFINED");
      return `${JSON.stringify(key)}:${stableJson(value[key], seen, depth + 1)}`;
    }).join(",")}}`;
  }
  seen.delete(value);
  return out;
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function hashObject(value) {
  return sha256(Buffer.from(stableJson(value), "utf8"));
}
function validateProvenance(provenance) {
  requireCondition(provenance && typeof provenance === "object" && !Array.isArray(provenance),
    "EXECUTION_PROVENANCE_REQUIRED");
  requireCondition(typeof provenance.sourceKind === "string" && provenance.sourceKind.trim().length > 0,
    "EXECUTION_SOURCE_KIND_REQUIRED");
  requireCondition(typeof provenance.locator === "string" && provenance.locator.trim().length > 0,
    "EXECUTION_SOURCE_LOCATOR_REQUIRED");
  requireCondition(provenance.projectGold !== true, "EXECUTION_PROJECT_GOLD_FORBIDDEN");
  requireCondition(provenance.runtimeAuthority !== true, "EXECUTION_RUNTIME_AUTHORITY_FORBIDDEN");
}
function validateInput(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "EXECUTION_INPUT_REQUIRED");
  requireCondition(typeof input.headerText === "string" && input.headerText.length > 0, "EXECUTION_HEADER_REQUIRED");
  requireCondition(Buffer.isBuffer(input.dataBuffer), "EXECUTION_DATA_REQUIRED");
  requireCondition(input.config && typeof input.config === "object" && !Array.isArray(input.config), "EXECUTION_CONFIG_REQUIRED");
  validateProvenance(input.provenance);
  return input.config;
}
function validateConfig(config) {
  requireCondition(config.preprocessing && typeof config.preprocessing === "object",
    "EXECUTION_PREPROCESSING_CONFIG_REQUIRED");
  requireCondition(config.measurement && typeof config.measurement === "object",
    "EXECUTION_MEASUREMENT_CONFIG_REQUIRED");
  requireCondition(config.phenotypes && typeof config.phenotypes === "object",
    "EXECUTION_PHENOTYPE_CONFIG_REQUIRED");
  requireCondition(typeof config.leadName === "string" && config.leadName.trim().length > 0,
    "EXECUTION_LEAD_REQUIRED");
  requireCondition(typeof config.thresholdAuthority === "string" && config.thresholdAuthority.trim().length > 0,
    "EXECUTION_THRESHOLD_AUTHORITY_REQUIRED");
  if (config.rendering !== undefined)
    requireCondition(config.rendering && typeof config.rendering === "object" && !Array.isArray(config.rendering),
      "EXECUTION_RENDERING_CONFIG_INVALID");
  return config;
}
function reasonCode(error) {
  return String(error && error.message ? error.message : error).split(":")[0] || "EXECUTION_UNKNOWN_FAILURE";
}
function preprocessingSummary(preprocessing, segment) {
  return {
    schema: preprocessing.schema, record: preprocessing.record,
    sourceLeadOrder: preprocessing.sourceLeadOrder,
    canonicalLeadOrder: preprocessing.canonicalLeadOrder,
    sourceSamplingRateHz: preprocessing.sourceSamplingRateHz,
    targetSamplingRateHz: preprocessing.targetSamplingRateHz,
    resampling: preprocessing.resampling,
    segmentation: preprocessing.segmentation,
    selectedSegment: {
      segmentIndex: segment.segmentIndex,
      startSample: segment.startSample,
      endSampleExclusive: segment.endSampleExclusive,
      paddedSamples: segment.paddedSamples,
    },
    provenance: preprocessing.provenance,
  };
}
function analyzePhysicalLead(preprocessing, lead, config, provenance) {
  const measurement = runPhysicalLeadMeasurementPipeline({
    physicalLead: {
      record: preprocessing.record,
      leadName: lead.leadName,
      sampleRateHz: preprocessing.targetSamplingRateHz,
      samples: lead.samples,
      unit: lead.unit,
      calibration: { unit: lead.unit, preprocessingApplied: true },
    },
    config: config.measurement,
    provenance,
  });
  const features = extractRhythmFeatures(measurement);
  const candidatePhenotypes = evaluateCandidatePhenotypes(features, config.phenotypes);
  return { measurement, features, candidatePhenotypes };
}
function runPreprocessedMultiLead(preprocessing, segment, config, provenance) {
  const successes = [], failures = [], skipReasons = {};
  for (const lead of segment.leads) {
    try {
      successes.push({ lead: lead.leadName, analysis: analyzePhysicalLead(preprocessing, lead, config, provenance) });
    } catch (error) {
      const reason = reasonCode(error);
      failures.push({ lead: lead.leadName, reason });
      skipReasons[reason] = (skipReasons[reason] || 0) + 1;
    }
  }
  requireCondition(successes.length > 0, "EXECUTION_NO_USABLE_LEADS");
  const rows = successes.map(row => ({
    lead: row.lead,
    features: {
      beatCount: row.analysis.features.beatCount,
      ventricularRateBpm: row.analysis.features.intervals.ventricularRateFromMedianRrBpm,
      prMedianMs: row.analysis.features.intervals.prMedianMs,
      qrsMedianMs: row.analysis.features.intervals.qrsMedianMs,
      qtMedianMs: row.analysis.features.intervals.qtMedianMs,
      qtcFridericiaMedianMs: row.analysis.features.intervals.qtcFridericiaMedianMs,
    },
  }));
  return {
    schema: "ekg-preprocessed-multilead-signal-intelligence-v1",
    attemptedLeadOrder: segment.leads.map(lead => lead.leadName),
    processedLeads: successes.map(row => row.lead),
    leadAnalyses: successes,
    failures,
    failureAccounting: {
      attempted: segment.leads.length,
      processed: successes.length,
      skipped: failures.length,
      exceptionPolicy: "fail-lead-and-categorize",
      skipReasons,
    },
    crossLeadConsistency: {
      beatCount: summarizeMetric(rows, "beatCount"),
      ventricularRateBpm: summarizeMetric(rows, "ventricularRateBpm"),
      prMedianMs: summarizeMetric(rows, "prMedianMs"),
      qrsMedianMs: summarizeMetric(rows, "qrsMedianMs"),
      qtMedianMs: summarizeMetric(rows, "qtMedianMs"),
      qtcFridericiaMedianMs: summarizeMetric(rows, "qtcFridericiaMedianMs"),
    },
    candidateEvidence: aggregateCandidateEvidence(successes),
    provenance: { ...provenance, projectGold: false, runtimeAuthority: false },
    diagnosticInterpretationIncluded: false,
    ...EXECUTION_GOVERNANCE,
  };
}

function runExecutableEcgPipeline(input) {
  const config = validateConfig(validateInput(input));
  const preprocessing = runSignalPreprocessingPipeline({
    headerText: input.headerText,
    dataBuffer: input.dataBuffer,
    config: config.preprocessing,
    provenance: input.provenance,
  });
  const segmentIndex = config.segmentIndex === undefined ? 0 : config.segmentIndex;
  requireCondition(Number.isInteger(segmentIndex) && segmentIndex >= 0,
    "EXECUTION_SEGMENT_INDEX_INVALID");
  const segment = preprocessing.segments[segmentIndex];
  requireCondition(segment, "EXECUTION_SEGMENT_NOT_FOUND");
  requireCondition(segment.paddedSamples === 0, "EXECUTION_PADDED_SEGMENT_REJECTED");
  requireCondition(segment.leads.some(lead => lead.leadName === config.leadName), "EXECUTION_LEAD_NOT_FOUND");
  const stageProvenance = {
    sourceKind: input.provenance.sourceKind.trim(),
    locator: input.provenance.locator.trim(),
    assetSha256: input.provenance.assetSha256 || null,
    upstreamCommit: input.provenance.upstreamCommit || null,
    upstreamTree: input.provenance.upstreamTree || null,
    sourceHeaderSha256: sha256(Buffer.from(input.headerText, "utf8")),
    sourceDataSha256: sha256(input.dataBuffer),
    executionConfigSha256: hashObject(config),
    preprocessingConfigSha256: hashObject(config.preprocessing),
    measurementConfigSha256: hashObject(config.measurement),
    phenotypeConfigSha256: hashObject(config.phenotypes),
    thresholdAuthority: config.thresholdAuthority.trim(),
    segmentIndex,
    projectGold: false,
    runtimeAuthority: false,
  };
  const multiLeadAnalysis = runPreprocessedMultiLead(
    preprocessing, segment, config, stageProvenance
  );
  const primary = multiLeadAnalysis.leadAnalyses.find(row => row.lead === config.leadName);
  requireCondition(primary, "EXECUTION_PRIMARY_LEAD_UNUSABLE");
  const rendering = renderWaveformSvg({
    leads: segment.leads,
    ...(config.rendering || {}),
  });
  return {
    schema: "ekg-executable-signal-pipeline-v2",
    preprocessing: preprocessingSummary(preprocessing, segment),
    measurement: primary.analysis.measurement,
    features: primary.analysis.features,
    candidatePhenotypes: primary.analysis.candidatePhenotypes,
    multiLeadAnalysis,
    rendering,
    provenanceChain: stageProvenance,
    diagnosticInterpretationIncluded: false,
    ...EXECUTION_GOVERNANCE,
  };
}

module.exports = {
  EXECUTION_GOVERNANCE,
  analyzePhysicalLead,
  hashObject,
  runExecutableEcgPipeline,
  runPreprocessedMultiLead,
  sha256,
  stableJson,
};
