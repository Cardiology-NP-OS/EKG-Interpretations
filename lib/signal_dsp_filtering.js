"use strict";

const DSP_GOVERNANCE = Object.freeze({
  authorityClass: "NONCLINICAL_ENGINEERING",
  runtimeAuthority: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  evidenceAdmission: "NOT_ADMITTED",
  projectGold: false,
  metrics: "NOT_REPORTABLE",
  activation: "NOT_ELIGIBLE",
  clinicalValidityInferred: false,
});

const FOUNDATION_PROFILE_V1 = Object.freeze({
  profileId: "foundation-pretraining-dsp-v1",
  lineNotchHz: 50,
  lineNotchQ: 30,
  highpassHz: 0.67,
  lowpassHz: 40,
  butterworthOrderPerEdge: 4,
  baselineMedianSeconds: 0.4,
  normalization: "global-zscore-epsilon-v1",
  epsilon: 1e-8,
  transferFunctionParity: "DONOR_ALIGNED_NOT_BYTE_EXACT_SCIPY_FILTFILT",
});

const BUTTERWORTH_Q4 = Object.freeze([
  0.541196100146197,
  1.306562964876377,
]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function finiteSeries(values, code = "DSP_NONFINITE_SAMPLE") {
  requireCondition(Array.isArray(values) && values.length > 0, "DSP_SAMPLES_REQUIRED");
  return values.map(value => {
    requireCondition(typeof value === "number" && Number.isFinite(value), code);
    return value;
  });
}

function finiteMatrix(leads) {
  requireCondition(Array.isArray(leads) && leads.length > 0, "DSP_LEADS_REQUIRED");
  const out = leads.map(lead => finiteSeries(lead));
  const n = out[0].length;
  out.forEach(lead => requireCondition(lead.length === n, "DSP_LEAD_LENGTH_MISMATCH"));
  return out;
}

function normalizeBiquad(b0, b1, b2, a0, a1, a2) {
  requireCondition([b0,b1,b2,a0,a1,a2].every(Number.isFinite), "DSP_COEFFICIENT_NONFINITE");
  requireCondition(a0 !== 0, "DSP_COEFFICIENT_A0_ZERO");
  return Object.freeze({
    b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
    a1: a1 / a0, a2: a2 / a0,
  });
}

function validateFrequency(sampleRateHz, frequencyHz, code) {
  requireCondition(Number.isFinite(sampleRateHz) && sampleRateHz > 0, "DSP_SAMPLE_RATE_INVALID");
  requireCondition(Number.isFinite(frequencyHz) && frequencyHz > 0, code);
  requireCondition(frequencyHz < sampleRateHz / 2, "DSP_FREQUENCY_AT_OR_ABOVE_NYQUIST");
}

function designNotch(sampleRateHz, frequencyHz, q) {
  validateFrequency(sampleRateHz, frequencyHz, "DSP_NOTCH_FREQUENCY_INVALID");
  requireCondition(Number.isFinite(q) && q > 0, "DSP_NOTCH_Q_INVALID");
  const w0 = 2 * Math.PI * frequencyHz / sampleRateHz;
  const alpha = Math.sin(w0) / (2 * q);
  const c = Math.cos(w0);
  return normalizeBiquad(1, -2*c, 1, 1+alpha, -2*c, 1-alpha);
}

function designButterworthSection(type, sampleRateHz, cutoffHz, q) {
  validateFrequency(sampleRateHz, cutoffHz, "DSP_CUTOFF_INVALID");
  requireCondition(["lowpass","highpass"].includes(type), "DSP_FILTER_TYPE_INVALID");
  requireCondition(Number.isFinite(q) && q > 0, "DSP_FILTER_Q_INVALID");
  const w0 = 2 * Math.PI * cutoffHz / sampleRateHz;
  const c = Math.cos(w0), s = Math.sin(w0);
  const alpha = s / (2 * q);
  if (type === "lowpass") {
    return normalizeBiquad((1-c)/2, 1-c, (1-c)/2, 1+alpha, -2*c, 1-alpha);
  }
  return normalizeBiquad((1+c)/2, -(1+c), (1+c)/2, 1+alpha, -2*c, 1-alpha);
}

function applyBiquadCausal(values, coeff) {
  const source = finiteSeries(values);
  requireCondition(coeff && typeof coeff === "object", "DSP_COEFFICIENTS_REQUIRED");
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const out = new Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    const x0 = source[i];
    const y0 = coeff.b0*x0 + coeff.b1*x1 + coeff.b2*x2 - coeff.a1*y1 - coeff.a2*y2;
    requireCondition(Number.isFinite(y0), "DSP_FILTER_NUMERIC_FAILURE");
    out[i] = y0;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
  }
  return out;
}

function oddReflectPad(values, padSamples) {
  const source = finiteSeries(values);
  requireCondition(Number.isInteger(padSamples) && padSamples >= 1, "DSP_PAD_INVALID");
  requireCondition(source.length > padSamples + 1, "DSP_SIGNAL_TOO_SHORT_FOR_ZERO_PHASE_FILTER");
  const left = [];
  for (let i = padSamples; i >= 1; i -= 1) left.push(2*source[0] - source[i]);
  const right = [];
  for (let i = source.length - 2; i >= source.length - padSamples - 1; i -= 1) {
    right.push(2*source[source.length-1] - source[i]);
  }
  return left.concat(source, right);
}

function zeroPhaseBiquad(values, coeff, padSamples = 24) {
  const source = finiteSeries(values);
  const pad = Math.min(padSamples, source.length - 2);
  requireCondition(pad >= 1, "DSP_SIGNAL_TOO_SHORT_FOR_ZERO_PHASE_FILTER");
  const padded = oddReflectPad(source, pad);
  const forward = applyBiquadCausal(padded, coeff);
  const backward = applyBiquadCausal(forward.slice().reverse(), coeff).reverse();
  return backward.slice(pad, backward.length - pad);
}

function applySectionsZeroPhase(values, sections) {
  requireCondition(Array.isArray(sections) && sections.length > 0, "DSP_SECTIONS_REQUIRED");
  return sections.reduce((series, coeff) => zeroPhaseBiquad(series, coeff), finiteSeries(values));
}

function lowerBound(sorted, value) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function medianFilterZeroPad(values, windowSamples) {
  const source = finiteSeries(values);
  requireCondition(Number.isInteger(windowSamples) && windowSamples >= 1, "DSP_MEDIAN_WINDOW_INVALID");
  requireCondition(windowSamples % 2 === 1, "DSP_MEDIAN_WINDOW_MUST_BE_ODD");
  const radius = (windowSamples - 1) >> 1;
  const sorted = [];
  for (let j = -radius; j <= radius; j += 1) {
    const value = j < 0 || j >= source.length ? 0 : source[j];
    sorted.splice(lowerBound(sorted, value), 0, value);
  }
  const out = new Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    out[i] = sorted[radius];
    if (i === source.length - 1) break;
    const leavingIndex = i - radius;
    const enteringIndex = i + radius + 1;
    const leaving = leavingIndex < 0 || leavingIndex >= source.length ? 0 : source[leavingIndex];
    const entering = enteringIndex < 0 || enteringIndex >= source.length ? 0 : source[enteringIndex];
    const removeAt = lowerBound(sorted, leaving);
    requireCondition(removeAt < sorted.length && sorted[removeAt] === leaving, "DSP_MEDIAN_WINDOW_STATE");
    sorted.splice(removeAt, 1);
    sorted.splice(lowerBound(sorted, entering), 0, entering);
  }
  return out;
}

function globalZScore(leads, epsilon = 1e-8) {
  const matrix = finiteMatrix(leads);
  requireCondition(Number.isFinite(epsilon) && epsilon > 0, "DSP_ZSCORE_EPSILON_INVALID");
  let count = 0, sum = 0;
  for (const lead of matrix) for (const value of lead) { count += 1; sum += value; }
  const center = sum / count;
  let sq = 0;
  for (const lead of matrix) for (const value of lead) sq += (value-center) ** 2;
  const scale = Math.sqrt(sq / count);
  const denominator = scale + epsilon;
  return {
    leads: matrix.map(lead => lead.map(value => (value-center)/denominator)),
    center, scale, epsilon, outputUnit: "standardized",
  };
}

function buildFoundationFilterSections(sampleRateHz, profile = FOUNDATION_PROFILE_V1) {
  requireCondition(sampleRateHz > 2 * profile.lineNotchHz, "DSP_SAMPLE_RATE_TOO_LOW_FOR_PROFILE");
  const notch = designNotch(sampleRateHz, profile.lineNotchHz, profile.lineNotchQ);
  const highpass = BUTTERWORTH_Q4.map(q => designButterworthSection("highpass", sampleRateHz, profile.highpassHz, q));
  const lowpass = BUTTERWORTH_Q4.map(q => designButterworthSection("lowpass", sampleRateHz, profile.lowpassHz, q));
  return { notch, highpass, lowpass };
}

function applyFoundationPretrainingProfile(leads, sampleRateHz, profile = FOUNDATION_PROFILE_V1) {
  const matrix = finiteMatrix(leads);
  requireCondition(Number.isFinite(sampleRateHz) && sampleRateHz > 0, "DSP_SAMPLE_RATE_INVALID");
  const sections = buildFoundationFilterSections(sampleRateHz, profile);
  const baselineWindowSamples = Math.floor(profile.baselineMedianSeconds * sampleRateHz) + 1;
  const oddWindow = baselineWindowSamples % 2 === 1 ? baselineWindowSamples : baselineWindowSamples + 1;
  requireCondition(matrix[0].length > 48, "DSP_SIGNAL_TOO_SHORT_FOR_PROFILE");
  const filtered = matrix.map(lead => {
    let out = zeroPhaseBiquad(lead, sections.notch);
    out = applySectionsZeroPhase(out, sections.highpass);
    out = applySectionsZeroPhase(out, sections.lowpass);
    const baseline = medianFilterZeroPad(out, oddWindow);
    return out.map((value, i) => value - baseline[i]);
  });
  const normalized = globalZScore(filtered, profile.epsilon);
  return {
    schema: "ekg-foundation-pretraining-dsp-v1",
    leads: normalized.leads,
    metadata: {
      profileId: profile.profileId,
      sampleRateHz,
      lineNotchHz: profile.lineNotchHz,
      lineNotchQ: profile.lineNotchQ,
      bandpassHz: [profile.highpassHz, profile.lowpassHz],
      butterworthOrderPerEdge: profile.butterworthOrderPerEdge,
      baselineMedianSeconds: profile.baselineMedianSeconds,
      baselineMedianSamples: oddWindow,
      normalization: profile.normalization,
      normalizationCenter: normalized.center,
      normalizationScale: normalized.scale,
      transferFunctionParity: profile.transferFunctionParity,
      sourceCompatibility: "DONOR_ALIGNED_CLEAN_REIMPLEMENTATION",
    },
    ...DSP_GOVERNANCE,
  };
}

module.exports = {
  BUTTERWORTH_Q4,
  DSP_GOVERNANCE,
  FOUNDATION_PROFILE_V1,
  applyBiquadCausal,
  applyFoundationPretrainingProfile,
  applySectionsZeroPhase,
  buildFoundationFilterSections,
  designButterworthSection,
  designNotch,
  finiteMatrix,
  finiteSeries,
  globalZScore,
  medianFilterZeroPad,
  oddReflectPad,
  zeroPhaseBiquad,
};
