"use strict";

const FEATURE_GOVERNANCE = Object.freeze({
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

function finite(value, code) {
  requireCondition(typeof value === "number" && Number.isFinite(value), code);
  return value;
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function mean(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "FEATURE_VALUES_REQUIRED");
  return values.reduce((sum, value) => sum + finite(value, "FEATURE_NONFINITE"), 0) / values.length;
}
function median(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "FEATURE_VALUES_REQUIRED");
  const sorted = values.map(v => finite(v, "FEATURE_NONFINITE")).sort((a,b) => a-b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length);
}

function successiveDifferences(values) {
  const out = [];
  for (let i = 1; i < values.length; i += 1) out.push(values[i] - values[i-1]);
  return out;
}

function rms(values) {
  requireCondition(values.length > 0, "FEATURE_VALUES_REQUIRED");
  return Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length);
}

function measurementMap(measurementArtifact) {
  const measurements = measurementArtifact.intervalMeasurements && measurementArtifact.intervalMeasurements.measurements;
  requireCondition(Array.isArray(measurements), "FEATURE_INTERVAL_MEASUREMENTS_REQUIRED");
  const out = new Map();
  for (const row of measurements) {
    requireCondition(row && typeof row === "object" && typeof row.metric === "string" && row.metric.length > 0, "FEATURE_MEASUREMENT_ROW");
    requireCondition(!out.has(row.metric), "FEATURE_DUPLICATE_MEASUREMENT");
    out.set(row.metric, finite(row.value, "FEATURE_MEASUREMENT_NONFINITE"));
  }
  return out;
}
function amplitudeSummary(measurementArtifact, fiducial) {
  const rows = Array.isArray(measurementArtifact.amplitudeMeasurements) ? measurementArtifact.amplitudeMeasurements : [];
  const values = rows.filter(row => row.fiducial === fiducial).map(row => finite(row.value, "FEATURE_AMPLITUDE_NONFINITE"));
  if (!values.length) return null;
  return {
    count: values.length,
    median: round(median(values)),
    min: round(Math.min(...values)),
    max: round(Math.max(...values)),
  };
}

function normalizeProvenance(measurementArtifact) {
  const provenance = measurementArtifact.provenance;
  requireCondition(provenance && typeof provenance === "object" && !Array.isArray(provenance), "FEATURE_PROVENANCE_REQUIRED");
  requireCondition(typeof provenance.sourceKind === "string" && provenance.sourceKind.length > 0, "FEATURE_SOURCE_KIND_REQUIRED");
  requireCondition(typeof provenance.locator === "string" && provenance.locator.length > 0, "FEATURE_SOURCE_LOCATOR_REQUIRED");
  return {
    sourceKind: provenance.sourceKind,
    locator: provenance.locator,
    assetSha256: provenance.assetSha256 || null,
    projectGold: false,
    runtimeAuthority: false,
  };
}

function extractRhythmFeatures(measurementArtifact) {
  requireCondition(measurementArtifact && typeof measurementArtifact === "object" && !Array.isArray(measurementArtifact), "FEATURE_ARTIFACT_REQUIRED");
  requireCondition(measurementArtifact.schema === "ekg-waveform-measurement-pipeline-v1", "FEATURE_ARTIFACT_SCHEMA");
  requireCondition(measurementArtifact.runtimeAuthority === false, "FEATURE_RUNTIME_AUTHORITY");
  const rr = measurementArtifact.intervalMeasurements.rrIntervalsMs;
  requireCondition(Array.isArray(rr), "FEATURE_RR_REQUIRED");
  const rrValues = rr.map(v => {
    const value = finite(v, "FEATURE_RR_NONFINITE");
    requireCondition(value > 0, "FEATURE_RR_RANGE");
    return value;
  });
  const diffs = rrValues.length >= 2 ? successiveDifferences(rrValues) : [];
  const absDiffs = diffs.map(Math.abs);
  const m = measurementMap(measurementArtifact);
  const beatCount = measurementArtifact.candidateFiducials && Array.isArray(measurementArtifact.candidateFiducials.beats)
    ? measurementArtifact.candidateFiducials.beats.length
    : measurementArtifact.intervalMeasurements.beatCount;
  requireCondition(Number.isInteger(beatCount) && beatCount > 0, "FEATURE_BEAT_COUNT");
  const coverage = measurementArtifact.coverage || {};
  const pCount = Number.isInteger(coverage.pWaveCandidates) ? coverage.pWaveCandidates : 0;
  const qrsCount = Number.isInteger(coverage.qrsCandidates) ? coverage.qrsCandidates : beatCount;
  const tCount = Number.isInteger(coverage.tWaveCandidates) ? coverage.tWaveCandidates : 0;
  for (const [name, count] of [["P",pCount],["QRS",qrsCount],["T",tCount]]) {
    requireCondition(count >= 0 && count <= beatCount, `FEATURE_${name}_COVERAGE_RANGE`);
  }

  const rrSummary = rrValues.length ? {
    count: rrValues.length,
    meanMs: round(mean(rrValues)),
    medianMs: round(median(rrValues)),
    minMs: round(Math.min(...rrValues)),
    maxMs: round(Math.max(...rrValues)),
    sdMs: round(standardDeviation(rrValues)),
    coefficientOfVariation: round(mean(rrValues) === 0 ? 0 : standardDeviation(rrValues) / mean(rrValues)),
    rmssdMs: diffs.length ? round(rms(diffs)) : null,
    medianAbsoluteSuccessiveDifferenceMs: absDiffs.length ? round(median(absDiffs)) : null,
    maxAbsoluteSuccessiveDifferenceMs: absDiffs.length ? round(Math.max(...absDiffs)) : null,
  } : null;

  const get = key => m.has(key) ? round(m.get(key)) : null;
  return {
    schema: "ekg-rhythm-feature-set-v1",
    record: measurementArtifact.record,
    lead: measurementArtifact.lead,
    sampleRateHz: measurementArtifact.sampleRateHz,
    sampleCount: measurementArtifact.sampleCount,
    beatCount,
    rr: rrSummary,
    intervals: {
      prMedianMs: get("pr"),
      qrsMedianMs: get("qrs"),
      qtMedianMs: get("qt"),
      qtcBazettMedianMs: get("qtc_bazett"),
      qtcFridericiaMedianMs: get("qtc_fridericia"),
      ventricularRateFromMedianRrBpm: get("ventricular_rate"),
    },
    delineationCoverage: {
      pWaveCandidateCount: pCount,
      qrsCandidateCount: qrsCount,
      tWaveCandidateCount: tCount,
      pWaveCoverageRatio: round(pCount / beatCount),
      qrsCoverageRatio: round(qrsCount / beatCount),
      tWaveCoverageRatio: round(tCount / beatCount),
    },
    amplitudes: {
      pPeak: amplitudeSummary(measurementArtifact, "P_PEAK"),
      rPeak: amplitudeSummary(measurementArtifact, "R_PEAK"),
      jPoint: amplitudeSummary(measurementArtifact, "J_POINT"),
      tPeak: amplitudeSummary(measurementArtifact, "T_PEAK"),
    },
    provenance: normalizeProvenance(measurementArtifact),
    diagnosticInterpretationIncluded: false,
    ...FEATURE_GOVERNANCE,
  };
}

module.exports = {
  FEATURE_GOVERNANCE,
  extractRhythmFeatures,
  median,
  standardDeviation,
};
