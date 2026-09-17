"use strict";

const {
  parseHeaderDetailed,
  decodeInt16Interleaved,
  toPhysical,
} = require("./wfdb_signal");

const MEASUREMENT_GOVERNANCE = Object.freeze({
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
function median(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "MEASURE_VALUES_REQUIRED");
  const sorted = values.map(v => finite(v, "MEASURE_NONFINITE")).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function normalizeProvenance(provenance) {
  requireCondition(provenance && typeof provenance === "object" && !Array.isArray(provenance), "MEASURE_PROVENANCE_REQUIRED");
  requireCondition(typeof provenance.sourceKind === "string" && provenance.sourceKind.length > 0, "MEASURE_SOURCE_KIND_REQUIRED");
  requireCondition(typeof provenance.locator === "string" && provenance.locator.length > 0, "MEASURE_SOURCE_LOCATOR_REQUIRED");
  return {
    sourceKind: provenance.sourceKind,
    locator: provenance.locator,
    assetSha256: provenance.assetSha256 || null,
    upstreamCommit: provenance.upstreamCommit || null,
    upstreamTree: provenance.upstreamTree || null,
    projectGold: false,
    runtimeAuthority: false,
  };
}

function extractPhysicalLead(headerText, dataBuffer, leadName) {
  const header = parseHeaderDetailed(headerText);
  const index = header.signals.findIndex(s => s.leadName.toUpperCase() === String(leadName).toUpperCase());
  requireCondition(index >= 0, "MEASURE_LEAD_NOT_FOUND");
  const raw = decodeInt16Interleaved(dataBuffer, header.leadCount, header.sampleCount)[index];
  const signal = header.signals[index];
  return {
    schema: "ekg-calibrated-lead-v1",
    record: header.record,
    leadName: signal.leadName,
    sampleRateHz: header.sampleRate,
    unit: signal.unit,
    gain: signal.gain,
    baseline: signal.baseline,
    samples: raw.map(value => toPhysical(value, signal.gain, signal.baseline)),
    diagnosticInterpretationIncluded: false,
    ...MEASUREMENT_GOVERNANCE,
  };
}

function detectCandidateRPeaks(samples, sampleRateHz, options = {}) {
  requireCondition(Array.isArray(samples) && samples.length >= 3, "RPEAK_SAMPLES_REQUIRED");
  finite(sampleRateHz, "RPEAK_SAMPLE_RATE");
  requireCondition(sampleRateHz > 0, "RPEAK_SAMPLE_RATE");
  const threshold = finite(options.minAbsoluteDeviation, "RPEAK_THRESHOLD_REQUIRED");
  const refractoryMs = finite(options.refractoryMs, "RPEAK_REFRACTORY_REQUIRED");
  requireCondition(threshold > 0 && refractoryMs > 0, "RPEAK_CONFIG_RANGE");
  const validatedSamples = samples.map(v => finite(v, "RPEAK_NONFINITE_SAMPLE"));
  requireCondition(options.provenance && typeof options.provenance === "object", "MEASURE_PROVENANCE_REQUIRED");
  const baseline = options.baseline === undefined ? median(validatedSamples) : finite(options.baseline, "RPEAK_BASELINE");
  const refractorySamples = Math.max(1, Math.round(refractoryMs * sampleRateHz / 1000));
  const deviations = validatedSamples.map(v => Math.abs(v - baseline));
  const candidates = [];
  for (let i = 1; i < deviations.length - 1; i += 1) {
    if (deviations[i] < threshold) continue;
    if (deviations[i] >= deviations[i - 1] && deviations[i] > deviations[i + 1]) {
      candidates.push({ sampleIndex: i, strength: deviations[i] });
    }
  }
  candidates.sort((a, b) => b.strength - a.strength || a.sampleIndex - b.sampleIndex);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.every(x => Math.abs(x.sampleIndex - candidate.sampleIndex) >= refractorySamples)) {
      selected.push(candidate);
    }
  }
  selected.sort((a, b) => a.sampleIndex - b.sampleIndex);
  const provenance = normalizeProvenance(options.provenance);
  return {
    schema: "ekg-rpeak-candidate-events-v1",
    algorithm: "target-owned-local-extrema-absolute-deviation-v1",
    events: selected.map(x => ({
      fiducial: "R_PEAK",
      sampleIndex: x.sampleIndex,
      timeMs: round(x.sampleIndex * 1000 / sampleRateHz),
      strength: round(x.strength),
      sourceKind: "automated_fiducial_unvalidated",
    })),
    configuration: { minAbsoluteDeviation: threshold, refractoryMs, baseline: round(baseline) },
    provenance,
    diagnosticInterpretationIncluded: false,
    ...MEASUREMENT_GOVERNANCE,
  };
}
function msBetween(start, end, sampleRateHz, code) {
  requireCondition(Number.isInteger(start) && Number.isInteger(end) && end >= start, code);
  return round((end - start) * 1000 / sampleRateHz);
}

function validateBeatFiducials(beat, sampleCount) {
  requireCondition(beat && typeof beat === "object" && !Array.isArray(beat), "FIDUCIAL_BEAT_REQUIRED");
  const fields = ["pOnset", "pOffset", "qrsOnset", "rPeak", "qrsOffset", "jPoint", "tPeak", "tOffset"];
  for (const field of fields) {
    if (beat[field] === undefined || beat[field] === null) continue;
    requireCondition(Number.isInteger(beat[field]) && beat[field] >= 0 && beat[field] < sampleCount, `FIDUCIAL_${field.toUpperCase()}_RANGE`);
  }
  requireCondition(Number.isInteger(beat.rPeak), "FIDUCIAL_RPEAK_REQUIRED");
  const ordered = fields.filter(f => beat[f] !== undefined && beat[f] !== null).map(f => beat[f]);
  for (let i = 1; i < ordered.length; i += 1) requireCondition(ordered[i] >= ordered[i - 1], "FIDUCIAL_ORDER");
  return beat;
}

function measurement(metric, value, unit, method, dependencies = []) {
  return {
    metric,
    value: round(value),
    unit,
    method,
    dependencies: [...dependencies],
    sourceKind: "automated_fiducial_unvalidated",
    runtimeAuthority: false,
    clinicalValidityInferred: false,
  };
}

function qtcFromQtRr(qtMs, rrMs) {
  finite(qtMs, "QTC_QT"); finite(rrMs, "QTC_RR");
  requireCondition(qtMs > 0 && rrMs > 0, "QTC_RANGE");
  const rrSeconds = rrMs / 1000;
  return {
    bazettMs: round(qtMs / Math.sqrt(rrSeconds)),
    fridericiaMs: round(qtMs / Math.cbrt(rrSeconds)),
  };
}
function measureFiducialIntervals(input) {
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "MEASURE_INPUT_REQUIRED");
  const sampleRateHz = finite(input.sampleRateHz, "MEASURE_SAMPLE_RATE");
  requireCondition(sampleRateHz > 0, "MEASURE_SAMPLE_RATE");
  requireCondition(Number.isInteger(input.sampleCount) && input.sampleCount > 0, "MEASURE_SAMPLE_COUNT");
  requireCondition(Array.isArray(input.beats) && input.beats.length > 0, "MEASURE_BEATS_REQUIRED");
  const provenance = normalizeProvenance(input.provenance || {});
  const beats = input.beats.map(b => validateBeatFiducials(b, input.sampleCount));
  const perBeat = beats.map((beat, index) => {
    const values = { beatIndex: index, rPeakSample: beat.rPeak };
    if (beat.pOnset !== undefined && beat.qrsOnset !== undefined) values.prMs = msBetween(beat.pOnset, beat.qrsOnset, sampleRateHz, "PR_ORDER");
    if (beat.qrsOnset !== undefined && beat.qrsOffset !== undefined) values.qrsMs = msBetween(beat.qrsOnset, beat.qrsOffset, sampleRateHz, "QRS_ORDER");
    if (beat.qrsOnset !== undefined && beat.tOffset !== undefined) values.qtMs = msBetween(beat.qrsOnset, beat.tOffset, sampleRateHz, "QT_ORDER");
    return values;
  });
  const rrValues = [];
  for (let i = 1; i < beats.length; i += 1) rrValues.push(msBetween(beats[i - 1].rPeak, beats[i].rPeak, sampleRateHz, "RR_ORDER"));
  const measurements = [];
  const addMedian = (metric, key) => {
    const values = perBeat.map(x => x[key]).filter(v => v !== undefined);
    if (values.length) measurements.push(measurement(metric, median(values), "ms", `median_${key}`));
  };
  addMedian("pr", "prMs");
  addMedian("qrs", "qrsMs");
  addMedian("qt", "qtMs");
  if (rrValues.length) {
    const rrMs = median(rrValues);
    measurements.push(measurement("rr", rrMs, "ms", "median_rr"));
    measurements.push(measurement("ventricular_rate", 60000 / rrMs, "bpm", "rate_from_median_rr", ["rr"]));
    const qt = measurements.find(x => x.metric === "qt");
    if (qt) {
      const qtc = qtcFromQtRr(qt.value, rrMs);
      measurements.push(measurement("qtc_bazett", qtc.bazettMs, "ms", "bazett", ["qt", "rr"]));
      measurements.push(measurement("qtc_fridericia", qtc.fridericiaMs, "ms", "fridericia", ["qt", "rr"]));
    }
  }
  return {
    schema: "ekg-fiducial-measurement-set-v1",
    sampleRateHz,
    sampleCount: input.sampleCount,
    beatCount: beats.length,
    perBeat,
    rrIntervalsMs: rrValues,
    measurements,
    provenance,
    diagnosticInterpretationIncluded: false,
    ...MEASUREMENT_GOVERNANCE,
  };
}

function measureFiducialAmplitude(samples, sampleIndex, baselineValue, metadata = {}) {
  requireCondition(Array.isArray(samples) && samples.length > 0, "AMPLITUDE_SAMPLES_REQUIRED");
  requireCondition(Number.isInteger(sampleIndex) && sampleIndex >= 0 && sampleIndex < samples.length, "AMPLITUDE_INDEX_RANGE");
  const value = finite(samples[sampleIndex], "AMPLITUDE_NONFINITE_SAMPLE") - finite(baselineValue, "AMPLITUDE_BASELINE");
  return {
    schema: "ekg-fiducial-amplitude-v1",
    lead: metadata.lead || null,
    fiducial: metadata.fiducial || "UNSPECIFIED",
    sampleIndex,
    value: round(value),
    unit: metadata.unit || null,
    baselineValue: round(baselineValue),
    provenance: normalizeProvenance(metadata.provenance || {}),
    diagnosticInterpretationIncluded: false,
    ...MEASUREMENT_GOVERNANCE,
  };
}
module.exports = {
  MEASUREMENT_GOVERNANCE,
  detectCandidateRPeaks,
  extractPhysicalLead,
  measureFiducialAmplitude,
  measureFiducialIntervals,
  qtcFromQtRr,
};
