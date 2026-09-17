"use strict";

const DELINEATION_GOVERNANCE = Object.freeze({
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

function toSamples(ms, sampleRateHz, code) {
  finite(ms, code);
  requireCondition(ms >= 0, code);
  return Math.round(ms * sampleRateHz / 1000);
}
function normalizeProvenance(provenance) {
  requireCondition(provenance && typeof provenance === "object" && !Array.isArray(provenance), "DELINEATION_PROVENANCE_REQUIRED");
  const sourceKind = String(provenance.sourceKind || "").trim();
  const locator = String(provenance.locator || "").trim();
  requireCondition(sourceKind.length > 0 && locator.length > 0, "DELINEATION_PROVENANCE_REQUIRED");
  return { sourceKind, locator };
}

function validateSamples(samples) {
  requireCondition(Array.isArray(samples) && samples.length > 0, "DELINEATION_SAMPLES_REQUIRED");
  for (const value of samples) finite(value, "DELINEATION_NONFINITE_SAMPLE");
}

function validateWaveConfig(wave, prefix) {
  requireCondition(wave && typeof wave === "object" && !Array.isArray(wave), `${prefix}_CONFIG_REQUIRED`);
  finite(wave.threshold, `${prefix}_THRESHOLD_REQUIRED`);
  requireCondition(wave.threshold > 0, `${prefix}_THRESHOLD_REQUIRED`);
}

function validateConfig(config, sampleRateHz) {
  requireCondition(config && typeof config === "object" && !Array.isArray(config), "DELINEATION_CONFIG_REQUIRED");
  const baseline = finite(config.baseline, "DELINEATION_BASELINE_REQUIRED");
  validateWaveConfig(config.qrs, "QRS");
  validateWaveConfig(config.p, "P");
  validateWaveConfig(config.t, "T");
  const qrsBefore = toSamples(config.qrs.beforeMs, sampleRateHz, "QRS_BEFORE_MS");
  const qrsAfter = toSamples(config.qrs.afterMs, sampleRateHz, "QRS_AFTER_MS");
  const pStart = toSamples(config.p.searchStartMsBeforeR, sampleRateHz, "P_SEARCH_START_MS");
  const pEnd = toSamples(config.p.searchEndMsBeforeR, sampleRateHz, "P_SEARCH_END_MS");
  const tStart = toSamples(config.t.searchStartMsAfterR, sampleRateHz, "T_SEARCH_START_MS");
  const tEnd = toSamples(config.t.searchEndMsAfterR, sampleRateHz, "T_SEARCH_END_MS");
  requireCondition(qrsBefore > 0 && qrsAfter > 0, "QRS_WINDOW_REQUIRED");
  requireCondition(pStart > pEnd && pEnd >= qrsBefore, "P_WINDOW_ORDER");
  requireCondition(tEnd > tStart && tStart >= qrsAfter, "T_WINDOW_ORDER");
  return { baseline, qrsBefore, qrsAfter, pStart, pEnd, tStart, tEnd };
}

function absoluteDeviation(samples, index, baseline) {
  return Math.abs(samples[index] - baseline);
}

function strongestIndex(samples, start, end, baseline) {
  let best = start;
  let strength = -Infinity;
  for (let i = start; i <= end; i += 1) {
    const d = absoluteDeviation(samples, i, baseline);
    if (d > strength) { best = i; strength = d; }
  }
  return { index: best, strength };
}

function contiguousRegion(samples, anchor, start, end, baseline, threshold) {
  requireCondition(anchor >= start && anchor <= end, "DELINEATION_ANCHOR_WINDOW");
  if (absoluteDeviation(samples, anchor, baseline) < threshold) return null;
  let left = anchor;
  while (left > start && absoluteDeviation(samples, left - 1, baseline) >= threshold) left -= 1;
  let right = anchor;
  while (right < end && absoluteDeviation(samples, right + 1, baseline) >= threshold) right += 1;
  return { start: left, end: right };
}

function optionalWaveRegion(samples, start, end, baseline, threshold) {
  if (start > end) return null;
  const strongest = strongestIndex(samples, start, end, baseline);
  if (strongest.strength < threshold) return null;
  const region = contiguousRegion(samples, strongest.index, start, end, baseline, threshold);
  return { onset: region.start, peak: strongest.index, offset: region.end, strength: strongest.strength };
}

function normalizeRPeaks(rPeaks, sampleCount) {
  requireCondition(Array.isArray(rPeaks) && rPeaks.length > 0, "DELINEATION_RPEAKS_REQUIRED");
  let prior = -1;
  return rPeaks.map(item => {
    const value = Number.isInteger(item) ? item : item && Number.isInteger(item.sampleIndex) ? item.sampleIndex : NaN;
    requireCondition(Number.isInteger(value) && value >= 0 && value < sampleCount, "DELINEATION_RPEAK_RANGE");
    requireCondition(value > prior, "DELINEATION_RPEAK_ORDER");
    prior = value;
    return value;
  });
}

function delineateCandidateBeats(samples, sampleRateHz, rPeaks, config, provenance) {
  validateSamples(samples);
  finite(sampleRateHz, "DELINEATION_SAMPLE_RATE");
  requireCondition(sampleRateHz > 0, "DELINEATION_SAMPLE_RATE");
  const prov = normalizeProvenance(provenance);
  const windows = validateConfig(config, sampleRateHz);
  const peaks = normalizeRPeaks(rPeaks, samples.length);
  const beats = peaks.map(rPeak => {
    const qrsStart = Math.max(0, rPeak - windows.qrsBefore);
    const qrsEnd = Math.min(samples.length - 1, rPeak + windows.qrsAfter);
    const qrs = contiguousRegion(samples, rPeak, qrsStart, qrsEnd, windows.baseline, config.qrs.threshold);
    requireCondition(qrs !== null, "DELINEATION_QRS_NOT_FOUND");

    const pStart = Math.max(0, rPeak - windows.pStart);
    const pEnd = Math.max(0, rPeak - windows.pEnd);
    const p = optionalWaveRegion(samples, pStart, Math.min(pEnd, qrs.start - 1), windows.baseline, config.p.threshold);

    const tStart = Math.min(samples.length - 1, rPeak + windows.tStart);
    const tEnd = Math.min(samples.length - 1, rPeak + windows.tEnd);
    const t = optionalWaveRegion(samples, Math.max(tStart, qrs.end + 1), tEnd, windows.baseline, config.t.threshold);

    return {
      ...(p ? { pOnset: p.onset, pPeak: p.peak, pOffset: p.offset } : {}),
      qrsOnset: qrs.start,
      rPeak,
      qrsOffset: qrs.end,
      jPoint: qrs.end,
      ...(t ? { tOnset: t.onset, tPeak: t.peak, tOffset: t.offset } : {}),
      sourceKind: "automated_fiducial_unvalidated",
    };
  });
  return {
    schema: "ekg-candidate-fiducial-delineation-v1",
    sampleRateHz,
    baseline: windows.baseline,
    provenance: prov,
    configuration: {
      qrs: { ...config.qrs },
      p: { ...config.p },
      t: { ...config.t },
    },
    beats,
    ...DELINEATION_GOVERNANCE,
    diagnosticInterpretationIncluded: false,
  };
}

module.exports = {
  DELINEATION_GOVERNANCE,
  delineateCandidateBeats,
};
