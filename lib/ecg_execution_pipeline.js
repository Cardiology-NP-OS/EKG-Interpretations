"use strict";

const crypto = require("crypto");
const { runSignalPreprocessingPipeline } = require("./signal_preprocessing_pipeline");
const { runPhysicalLeadMeasurementPipeline } = require("./signal_measurement_pipeline");
const { extractRhythmFeatures } = require("./rhythm_feature_contract");
const { evaluateCandidatePhenotypes } = require("./candidate_phenotype_engine");
const { renderWaveformSvg } = require("./waveform_rendering");

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
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function hashObject(value) {
  return sha256(Buffer.from(stableJson(value), "utf8"));
}
function validateInput(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "EXECUTION_INPUT_REQUIRED");
  requireCondition(typeof input.headerText === "string" && input.headerText.length > 0, "EXECUTION_HEADER_REQUIRED");
  requireCondition(Buffer.isBuffer(input.dataBuffer), "EXECUTION_DATA_REQUIRED");
  requireCondition(input.config && typeof input.config === "object" && !Array.isArray(input.config), "EXECUTION_CONFIG_REQUIRED");
  requireCondition(input.provenance && typeof input.provenance === "object" && !Array.isArray(input.provenance), "EXECUTION_PROVENANCE_REQUIRED");
  const config = input.config;
  requireCondition(config.preprocessing && typeof config.preprocessing === "object", "EXECUTION_PREPROCESSING_CONFIG_REQUIRED");
  requireCondition(config.measurement && typeof config.measurement === "object", "EXECUTION_MEASUREMENT_CONFIG_REQUIRED");
  requireCondition(config.phenotypes && typeof config.phenotypes === "object", "EXECUTION_PHENOTYPE_CONFIG_REQUIRED");
  requireCondition(typeof config.leadName === "string" && config.leadName.length > 0, "EXECUTION_LEAD_REQUIRED");
  requireCondition(typeof config.thresholdAuthority === "string" && config.thresholdAuthority.trim().length > 0, "EXECUTION_THRESHOLD_AUTHORITY_REQUIRED");
  return config;
}

function preprocessingSummary(preprocessing, segment) {
  return {
    schema: preprocessing.schema,
    record: preprocessing.record,
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
function runExecutableEcgPipeline(input) {
  const config = validateInput(input);
  const preprocessing = runSignalPreprocessingPipeline({
    headerText: input.headerText,
    dataBuffer: input.dataBuffer,
    config: config.preprocessing,
    provenance: input.provenance,
  });
  const segmentIndex = config.segmentIndex === undefined ? 0 : config.segmentIndex;
  requireCondition(Number.isInteger(segmentIndex) && segmentIndex >= 0, "EXECUTION_SEGMENT_INDEX_INVALID");
  const segment = preprocessing.segments[segmentIndex];
  requireCondition(segment, "EXECUTION_SEGMENT_NOT_FOUND");
  requireCondition(segment.paddedSamples === 0, "EXECUTION_PADDED_SEGMENT_REJECTED");
  const selectedLead = segment.leads.find(lead => lead.leadName === config.leadName);
  requireCondition(selectedLead, "EXECUTION_LEAD_NOT_FOUND");
  const stageProvenance = {
    ...input.provenance,
    sourceHeaderSha256: sha256(Buffer.from(input.headerText, "utf8")),
    sourceDataSha256: sha256(input.dataBuffer),
    preprocessingConfigSha256: hashObject(config.preprocessing),
    measurementConfigSha256: hashObject(config.measurement),
    phenotypeConfigSha256: hashObject(config.phenotypes),
    thresholdAuthority: config.thresholdAuthority.trim(),
    segmentIndex,
    projectGold: false,
    runtimeAuthority: false,
  };
  const measurement = runPhysicalLeadMeasurementPipeline({
    physicalLead: {
      record: preprocessing.record,
      leadName: selectedLead.leadName,
      sampleRateHz: preprocessing.targetSamplingRateHz,
      samples: selectedLead.samples,
      unit: selectedLead.unit,
      calibration: { unit: selectedLead.unit, preprocessingApplied: true },
    },
    config: config.measurement,
    provenance: stageProvenance,
  });
  const features = extractRhythmFeatures(measurement);
  const candidatePhenotypes = evaluateCandidatePhenotypes(features, config.phenotypes);
  const rendering = renderWaveformSvg({
    leads: segment.leads,
    ...(config.rendering || {}),
  });
  return {
    schema: "ekg-executable-signal-pipeline-v1",
    preprocessing: preprocessingSummary(preprocessing, segment),
    measurement,
    features,
    candidatePhenotypes,
    rendering,
    provenanceChain: stageProvenance,
    diagnosticInterpretationIncluded: false,
    ...EXECUTION_GOVERNANCE,
  };
}

module.exports = {
  EXECUTION_GOVERNANCE,
  hashObject,
  runExecutableEcgPipeline,
  sha256,
  stableJson,
};