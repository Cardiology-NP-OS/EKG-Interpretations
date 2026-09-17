"use strict";

const {
  detectCandidateRPeaks,
  extractPhysicalLead,
  measureFiducialAmplitude,
  measureFiducialIntervals,
} = require("./signal_measurement_contract");
const { delineateCandidateBeats } = require("./signal_delineation_contract");

const PIPELINE_GOVERNANCE = Object.freeze({
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
function validateConfig(config) {
  requireCondition(config && typeof config === "object" && !Array.isArray(config), "PIPELINE_CONFIG_REQUIRED");
  requireCondition(config.detector && typeof config.detector === "object", "PIPELINE_DETECTOR_CONFIG_REQUIRED");
  requireCondition(config.delineation && typeof config.delineation === "object", "PIPELINE_DELINEATION_CONFIG_REQUIRED");
  return config;
}
function buildAmplitudeRows(samples, beats, baseline, leadName, unit, provenance) {
  const rows = [];
  for (let beatIndex = 0; beatIndex < beats.length; beatIndex += 1) {
    const beat = beats[beatIndex];
    for (const [fiducial, field] of [
      ["P_PEAK", "pPeak"],
      ["R_PEAK", "rPeak"],
      ["J_POINT", "jPoint"],
      ["T_PEAK", "tPeak"],
    ]) {
      if (!Number.isInteger(beat[field])) continue;
      rows.push({
        beatIndex,
        ...measureFiducialAmplitude(samples, beat[field], baseline, {
          lead: leadName,
          fiducial,
          unit,
          provenance,
        }),
      });
    }
  }
  return rows;
}

function normalizePhysicalLead(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "PIPELINE_PHYSICAL_LEAD_REQUIRED");
  requireCondition(typeof input.record === "string" && input.record.length > 0, "PIPELINE_RECORD_REQUIRED");
  requireCondition(typeof input.leadName === "string" && input.leadName.length > 0, "PIPELINE_LEAD_REQUIRED");
  requireCondition(Number.isFinite(input.sampleRateHz) && input.sampleRateHz > 0, "PIPELINE_SAMPLE_RATE_REQUIRED");
  requireCondition(Array.isArray(input.samples) && input.samples.length > 0, "PIPELINE_SAMPLES_REQUIRED");
  const samples = input.samples.map(value => {
    requireCondition(typeof value === "number" && Number.isFinite(value), "PIPELINE_NONFINITE_SAMPLE");
    return value;
  });
  requireCondition(typeof input.unit === "string" && input.unit.length > 0, "PIPELINE_UNIT_REQUIRED");
  return {
    record: input.record,
    leadName: input.leadName,
    sampleRateHz: input.sampleRateHz,
    samples,
    unit: input.unit,
    calibration: input.calibration || null,
  };
}

function runPhysicalLeadMeasurementPipeline(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "PIPELINE_INPUT_REQUIRED");
  requireCondition(input.provenance && typeof input.provenance === "object", "PIPELINE_PROVENANCE_REQUIRED");
  const config = validateConfig(input.config);
  const lead = normalizePhysicalLead(input.physicalLead);
  const rPeaks = detectCandidateRPeaks(lead.samples, lead.sampleRateHz, {
    ...config.detector,
    provenance: input.provenance,
  });
  requireCondition(rPeaks.events.length > 0, "PIPELINE_NO_RPEAK_CANDIDATES");
  const delineation = delineateCandidateBeats(
    lead.samples,
    lead.sampleRateHz,
    rPeaks.events,
    config.delineation,
    input.provenance,
  );
  const intervals = measureFiducialIntervals({
    sampleRateHz: lead.sampleRateHz,
    sampleCount: lead.samples.length,
    beats: delineation.beats,
    provenance: input.provenance,
  });
  const amplitudes = buildAmplitudeRows(
    lead.samples,
    delineation.beats,
    config.delineation.baseline,
    lead.leadName,
    lead.unit,
    input.provenance,
  );
  const pCount = delineation.beats.filter(x => Number.isInteger(x.pOnset) && Number.isInteger(x.pOffset)).length;
  const tCount = delineation.beats.filter(x => Number.isInteger(x.tOnset) && Number.isInteger(x.tOffset)).length;
  return {
    schema: "ekg-waveform-measurement-pipeline-v1",
    record: lead.record,
    lead: lead.leadName,
    sampleRateHz: lead.sampleRateHz,
    sampleCount: lead.samples.length,
    calibration: lead.calibration || { unit: lead.unit },
    candidateRPeaks: rPeaks,
    candidateFiducials: delineation,
    intervalMeasurements: intervals,
    amplitudeMeasurements: amplitudes,
    coverage: {
      beats: delineation.beats.length,
      pWaveCandidates: pCount,
      qrsCandidates: delineation.beats.length,
      tWaveCandidates: tCount,
    },
    provenance: { ...input.provenance, projectGold: false, runtimeAuthority: false },
    diagnosticInterpretationIncluded: false,
    ...PIPELINE_GOVERNANCE,
  };
}
function runWaveformMeasurementPipeline(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "PIPELINE_INPUT_REQUIRED");
  requireCondition(typeof input.headerText === "string" && input.headerText.length > 0, "PIPELINE_HEADER_REQUIRED");
  requireCondition(Buffer.isBuffer(input.dataBuffer), "PIPELINE_DATA_BUFFER_REQUIRED");
  requireCondition(typeof input.leadName === "string" && input.leadName.trim().length > 0, "PIPELINE_LEAD_REQUIRED");
  const lead = extractPhysicalLead(input.headerText, input.dataBuffer, input.leadName);
  return runPhysicalLeadMeasurementPipeline({
    physicalLead: {
      record: lead.record,
      leadName: lead.leadName,
      sampleRateHz: lead.sampleRateHz,
      samples: lead.samples,
      unit: lead.unit,
      calibration: { unit: lead.unit, gain: lead.gain, baseline: lead.baseline },
    },
    config: input.config,
    provenance: input.provenance,
  });
}

module.exports = {
  PIPELINE_GOVERNANCE,
  runPhysicalLeadMeasurementPipeline,
  runWaveformMeasurementPipeline,
};