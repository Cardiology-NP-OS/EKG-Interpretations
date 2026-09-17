"use strict";

const PHENOTYPE_GOVERNANCE = Object.freeze({
  authorityClass: "EVALUATION_NONRUNTIME",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});

const STATES = Object.freeze({
  DETECTED: "CANDIDATE_DETECTED",
  NOT_DETECTED: "CANDIDATE_NOT_DETECTED",
  INSUFFICIENT: "INSUFFICIENT_DATA",
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function finite(value, code) {
  requireCondition(typeof value === "number" && Number.isFinite(value), code);
  return value;
}

function validateThreshold(value, code, {min = 0, max = Infinity} = {}) {
  finite(value, code);
  requireCondition(value >= min && value <= max, code);
  return value;
}
function validateConfig(config) {
  requireCondition(config && typeof config === "object" && !Array.isArray(config), "PHENOTYPE_CONFIG_REQUIRED");
  requireCondition(Number.isInteger(config.minBeatCount) && config.minBeatCount >= 2, "PHENOTYPE_MIN_BEAT_COUNT");
  const required = ["rrIrregularity","pause","qrsDuration","pWaveCoverage","prDuration"];
  for (const key of required) requireCondition(config[key] && typeof config[key] === "object", `PHENOTYPE_CONFIG_${key}`);
  requireCondition(Number.isInteger(config.rrIrregularity.minIntervals) && config.rrIrregularity.minIntervals >= 2, "PHENOTYPE_RR_MIN_INTERVALS");
  validateThreshold(config.rrIrregularity.cvAtOrAbove, "PHENOTYPE_RR_CV_THRESHOLD", {min:0,max:10});
  validateThreshold(config.rrIrregularity.maxSuccessiveDeltaMsAtOrAbove, "PHENOTYPE_RR_DELTA_THRESHOLD", {min:0});
  requireCondition(Number.isInteger(config.pause.minIntervals) && config.pause.minIntervals >= 1, "PHENOTYPE_PAUSE_MIN_INTERVALS");
  validateThreshold(config.pause.absoluteRrMsAtOrAbove, "PHENOTYPE_PAUSE_ABSOLUTE_THRESHOLD", {min:1});
  validateThreshold(config.pause.medianMultipleAtOrAbove, "PHENOTYPE_PAUSE_MULTIPLE_THRESHOLD", {min:1});
  validateThreshold(config.qrsDuration.medianMsAtOrAbove, "PHENOTYPE_QRS_THRESHOLD", {min:1});
  validateThreshold(config.pWaveCoverage.ratioAtOrBelow, "PHENOTYPE_P_COVERAGE_THRESHOLD", {min:0,max:1});
  validateThreshold(config.prDuration.medianMsAtOrAbove, "PHENOTYPE_PR_THRESHOLD", {min:1});
  return config;
}

function candidate(phenotypeCode, state, observed, configuredThreshold, reason = null) {
  return { phenotypeCode, state, observed, configuredThreshold, reason };
}
function evaluateCandidatePhenotypes(features, config) {
  requireCondition(features && typeof features === "object" && !Array.isArray(features), "PHENOTYPE_FEATURES_REQUIRED");
  requireCondition(features.schema === "ekg-rhythm-feature-set-v1", "PHENOTYPE_FEATURE_SCHEMA");
  requireCondition(features.runtimeAuthority === false, "PHENOTYPE_FEATURE_AUTHORITY");
  validateConfig(config);
  const out = [];

  if (!features.rr || features.rr.count < config.rrIrregularity.minIntervals) {
    out.push(candidate("RR_IRREGULARITY", STATES.INSUFFICIENT, {rrIntervalCount:features.rr ? features.rr.count : 0}, config.rrIrregularity, "MIN_INTERVALS_NOT_MET"));
  } else {
    const detected = features.rr.coefficientOfVariation >= config.rrIrregularity.cvAtOrAbove ||
      features.rr.maxAbsoluteSuccessiveDifferenceMs >= config.rrIrregularity.maxSuccessiveDeltaMsAtOrAbove;
    out.push(candidate("RR_IRREGULARITY", detected ? STATES.DETECTED : STATES.NOT_DETECTED, {
      coefficientOfVariation: features.rr.coefficientOfVariation,
      maxAbsoluteSuccessiveDifferenceMs: features.rr.maxAbsoluteSuccessiveDifferenceMs,
      rrIntervalCount: features.rr.count,
    }, config.rrIrregularity));
  }

  if (!features.rr || features.rr.count < config.pause.minIntervals) {
    out.push(candidate("RR_PAUSE", STATES.INSUFFICIENT, {rrIntervalCount:features.rr ? features.rr.count : 0}, config.pause, "MIN_INTERVALS_NOT_MET"));
  } else {
    const ratio = features.rr.medianMs > 0 ? features.rr.maxMs / features.rr.medianMs : 0;
    const detected = features.rr.maxMs >= config.pause.absoluteRrMsAtOrAbove && ratio >= config.pause.medianMultipleAtOrAbove;
    out.push(candidate("RR_PAUSE", detected ? STATES.DETECTED : STATES.NOT_DETECTED, {
      maxRrMs: features.rr.maxMs,
      medianRrMs: features.rr.medianMs,
      maxToMedianRatio: Number(ratio.toFixed(6)),
    }, config.pause));
  }
  const qrs = features.intervals.qrsMedianMs;
  out.push(qrs === null
    ? candidate("QRS_DURATION_ABOVE_CONFIGURED_THRESHOLD", STATES.INSUFFICIENT, {qrsMedianMs:null}, config.qrsDuration, "QRS_MEASUREMENT_UNAVAILABLE")
    : candidate("QRS_DURATION_ABOVE_CONFIGURED_THRESHOLD", qrs >= config.qrsDuration.medianMsAtOrAbove ? STATES.DETECTED : STATES.NOT_DETECTED, {qrsMedianMs:qrs}, config.qrsDuration));

  const pr = features.intervals.prMedianMs;
  out.push(pr === null
    ? candidate("PR_DURATION_ABOVE_CONFIGURED_THRESHOLD", STATES.INSUFFICIENT, {prMedianMs:null}, config.prDuration, "PR_MEASUREMENT_UNAVAILABLE")
    : candidate("PR_DURATION_ABOVE_CONFIGURED_THRESHOLD", pr >= config.prDuration.medianMsAtOrAbove ? STATES.DETECTED : STATES.NOT_DETECTED, {prMedianMs:pr}, config.prDuration));

  const pCoverage = features.delineationCoverage.pWaveCoverageRatio;
  if (features.beatCount < config.minBeatCount) {
    out.push(candidate("P_WAVE_COVERAGE_LOW", STATES.INSUFFICIENT, {beatCount:features.beatCount,pWaveCoverageRatio:pCoverage}, config.pWaveCoverage, "MIN_BEAT_COUNT_NOT_MET"));
  } else {
    out.push(candidate("P_WAVE_COVERAGE_LOW", pCoverage <= config.pWaveCoverage.ratioAtOrBelow ? STATES.DETECTED : STATES.NOT_DETECTED, {
      beatCount: features.beatCount,
      pWaveCoverageRatio: pCoverage,
    }, config.pWaveCoverage));
  }

  return {
    schema: "ekg-candidate-phenotype-set-v1",
    featureSchema: features.schema,
    record: features.record,
    lead: features.lead,
    candidates: out,
    provenance: { ...features.provenance, projectGold:false, runtimeAuthority:false },
    diagnosticInterpretationIncluded: false,
    ...PHENOTYPE_GOVERNANCE,
  };
}

module.exports = { PHENOTYPE_GOVERNANCE, STATES, evaluateCandidatePhenotypes };
