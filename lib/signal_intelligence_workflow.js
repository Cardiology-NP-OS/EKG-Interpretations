"use strict";

const { runWaveformMeasurementPipeline } = require("./signal_measurement_pipeline");
const { extractRhythmFeatures } = require("./rhythm_feature_contract");
const { evaluateCandidatePhenotypes } = require("./candidate_phenotype_engine");

const WORKFLOW_GOVERNANCE = Object.freeze({
  authorityClass: "EVALUATION_NONRUNTIME",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function runSignalIntelligenceWorkflow(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "INTELLIGENCE_INPUT_REQUIRED");
  requireCondition(input.measurementConfig && typeof input.measurementConfig === "object", "INTELLIGENCE_MEASUREMENT_CONFIG_REQUIRED");
  requireCondition(input.phenotypeConfig && typeof input.phenotypeConfig === "object", "INTELLIGENCE_PHENOTYPE_CONFIG_REQUIRED");
  const measurement = runWaveformMeasurementPipeline({
    headerText: input.headerText,
    dataBuffer: input.dataBuffer,
    leadName: input.leadName,
    config: input.measurementConfig,
    provenance: input.provenance,
  });
  const features = extractRhythmFeatures(measurement);
  const phenotypes = evaluateCandidatePhenotypes(features, input.phenotypeConfig);
  return {
    schema: "ekg-signal-intelligence-workflow-v1",
    measurement,
    features,
    candidatePhenotypes: phenotypes,
    provenance: { ...measurement.provenance, projectGold:false, runtimeAuthority:false },
    diagnosticInterpretationIncluded: false,
    ...WORKFLOW_GOVERNANCE,
  };
}

module.exports = {
  WORKFLOW_GOVERNANCE,
  runSignalIntelligenceWorkflow,
};
