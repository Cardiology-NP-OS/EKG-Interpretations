"use strict";

const TRANSFORM_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
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
function finiteSeries(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "TRANSFORM_SAMPLES_REQUIRED");
  return values.map(value => {
    requireCondition(typeof value === "number" && Number.isFinite(value), "TRANSFORM_NONFINITE_SAMPLE");
    return value;
  });
}
function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function median(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function movingAverage(values, windowSamples) {
  const source = finiteSeries(values);
  requireCondition(Number.isInteger(windowSamples) && windowSamples >= 1, "TRANSFORM_WINDOW_INVALID");
  requireCondition(windowSamples <= source.length, "TRANSFORM_WINDOW_TOO_LARGE");
  requireCondition(windowSamples % 2 === 1, "TRANSFORM_WINDOW_MUST_BE_ODD");
  const radius = Math.floor(windowSamples / 2);
  const out = new Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(source.length - 1, i + radius); j += 1) {
      sum += source[j]; count += 1;
    }
    out[i] = sum / count;
  }
  return out;
}
function removeBaseline(values, config = { method: "none" }) {
  const source = finiteSeries(values);
  const method = config && config.method ? config.method : "none";
  if (method === "none") return { samples: source.slice(), method, baseline: 0 };
  if (method === "subtract-mean-v1") {
    const baseline = mean(source);
    return { samples: source.map(value => value - baseline), method, baseline };
  }
  if (method === "subtract-median-v1") {
    const baseline = median(source);
    return { samples: source.map(value => value - baseline), method, baseline };
  }
  if (method === "moving-average-subtraction-v1") {
    const baseline = movingAverage(source, config.windowSamples);
    return { samples: source.map((value, index) => value - baseline[index]), method, windowSamples: config.windowSamples };
  }
  throw new Error("TRANSFORM_BASELINE_METHOD_UNIMPLEMENTED");
}
function applyFilter(values, config = { method: "none" }) {
  const source = finiteSeries(values);
  const method = config && config.method ? config.method : "none";
  if (method === "none") return { samples: source.slice(), method };
  if (method === "moving-average-v1") {
    return { samples: movingAverage(source, config.windowSamples), method, windowSamples: config.windowSamples };
  }
  throw new Error("TRANSFORM_FILTER_METHOD_UNIMPLEMENTED");
}
function normalizeAmplitude(values, config = { method: "none" }) {
  const source = finiteSeries(values);
  const method = config && config.method ? config.method : "none";
  if (method === "none") return { samples: source.slice(), method, outputUnit: config.inputUnit || null };
  if (method === "zscore-v1") {
    const center = mean(source);
    const variance = source.reduce((sum, value) => sum + ((value - center) ** 2), 0) / source.length;
    const scale = Math.sqrt(variance);
    requireCondition(scale > 0, "TRANSFORM_NORMALIZATION_ZERO_SCALE");
    return { samples: source.map(value => (value - center) / scale), method, center, scale, outputUnit: "standardized" };
  }
  if (method === "median-mad-v1") {
    const center = median(source);
    const scale = median(source.map(value => Math.abs(value - center)));
    requireCondition(scale > 0, "TRANSFORM_NORMALIZATION_ZERO_SCALE");
    return { samples: source.map(value => (value - center) / scale), method, center, scale, outputUnit: "mad-normalized" };
  }
  throw new Error("TRANSFORM_NORMALIZATION_METHOD_UNIMPLEMENTED");
}
function assessArtifacts(values, config = {}) {
  const source = finiteSeries(values);
  const maxStep = config.maxStep === undefined ? null : config.maxStep;
  const clipMin = config.clipMin === undefined ? null : config.clipMin;
  const clipMax = config.clipMax === undefined ? null : config.clipMax;
  if (maxStep !== null) requireCondition(Number.isFinite(maxStep) && maxStep >= 0, "TRANSFORM_MAX_STEP_INVALID");
  if (clipMin !== null) requireCondition(Number.isFinite(clipMin), "TRANSFORM_CLIP_MIN_INVALID");
  if (clipMax !== null) requireCondition(Number.isFinite(clipMax), "TRANSFORM_CLIP_MAX_INVALID");
  if (clipMin !== null && clipMax !== null) requireCondition(clipMin <= clipMax, "TRANSFORM_CLIP_RANGE_INVALID");
  let stepViolations = 0, belowClip = 0, aboveClip = 0;
  for (let i = 0; i < source.length; i += 1) {
    if (clipMin !== null && source[i] <= clipMin) belowClip += 1;
    if (clipMax !== null && source[i] >= clipMax) aboveClip += 1;
    if (maxStep !== null && i > 0 && Math.abs(source[i] - source[i - 1]) > maxStep) stepViolations += 1;
  }
  return {
    sampleCount: source.length,
    stepViolations,
    belowClip,
    aboveClip,
    artifactObserved: stepViolations + belowClip + aboveClip > 0,
    repairApplied: false,
    policy: "detect-and-report-no-silent-repair-v1",
  };
}
function transformLeadForEngineering(values, config = {}) {
  const source = finiteSeries(values);
  const artifacts = assessArtifacts(source, config.artifacts || {});
  const baseline = removeBaseline(source, config.baseline || { method: "none" });
  const filtered = applyFilter(baseline.samples, config.filter || { method: "none" });
  const normalized = normalizeAmplitude(filtered.samples, { ...(config.normalization || { method: "none" }), inputUnit: config.inputUnit || null });
  return {
    schema: "ekg-signal-transform-v1",
    samples: normalized.samples,
    outputUnit: normalized.outputUnit,
    stages: { artifacts, baseline, filter: { ...filtered, samples: undefined }, normalization: { ...normalized, samples: undefined } },
    originalSamplesPreservedExternally: true,
    ...TRANSFORM_GOVERNANCE,
  };
}
module.exports = {
  TRANSFORM_GOVERNANCE,
  applyFilter,
  assessArtifacts,
  finiteSeries,
  mean,
  median,
  movingAverage,
  normalizeAmplitude,
  removeBaseline,
  transformLeadForEngineering,
};
