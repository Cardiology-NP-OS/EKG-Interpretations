"use strict";

const { designButterworthSection, zeroPhaseBiquad } = require("./signal_dsp_filtering");
const { MEASUREMENT_GOVERNANCE } = require("./signal_measurement_contract");

const PAN_TOMPKINS_ALGORITHM = "target-owned-pan-tompkins-classical-baseline-v1";
const DEFAULT_PAN_TOMPKINS_CONFIG = Object.freeze({
  bandpassLowHz: 5,
  bandpassHighHz: 15,
  integrationWindowMs: 150,
  refractoryMs: 200,
  refinementWindowMs: 150,
  thresholdWeight: 0.25,
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function finiteSeries(values) {
  requireCondition(Array.isArray(values) && values.length >= 32, "PAN_TOMPKINS_SAMPLES_REQUIRED");
  return values.map(value => {
    requireCondition(typeof value === "number" && Number.isFinite(value), "PAN_TOMPKINS_NONFINITE_SAMPLE");
    return value;
  });
}

function movingAverage(values, width) {
  const output = new Array(values.length).fill(0);
  const prefix = new Array(values.length + 1).fill(0);
  for (let index = 0; index < values.length; index += 1) prefix[index + 1] = prefix[index] + values[index];
  for (let index = 0; index < values.length; index += 1) {
    const start = Math.max(0, index - width + 1);
    output[index] = (prefix[index + 1] - prefix[start]) / (index - start + 1);
  }
  return output;
}

function localMaxima(values) {
  const output = [];
  for (let index = 1; index < values.length - 1; index += 1) {
    if (values[index] >= values[index - 1] && values[index] > values[index + 1]) output.push({ sampleIndex: index, strength: values[index] });
  }
  return output;
}

function strongestAbsoluteSample(samples, center, radius) {
  const start = Math.max(0, center - radius);
  const end = Math.min(samples.length - 1, center + radius);
  let selected = start;
  for (let index = start + 1; index <= end; index += 1) {
    if (Math.abs(samples[index]) > Math.abs(samples[selected])) selected = index;
  }
  return selected;
}

function detectPanTompkinsRPeaks(samples, sampleRateHz, options = {}) {
  const signal = finiteSeries(samples);
  requireCondition(typeof sampleRateHz === "number" && Number.isFinite(sampleRateHz) && sampleRateHz > 40, "PAN_TOMPKINS_SAMPLE_RATE");
  const config = { ...DEFAULT_PAN_TOMPKINS_CONFIG, ...(options.configuration || {}) };
  for (const [name, value] of Object.entries(config)) requireCondition(typeof value === "number" && Number.isFinite(value), `PAN_TOMPKINS_CONFIG_${name}`);
  requireCondition(config.bandpassLowHz > 0 && config.bandpassHighHz > config.bandpassLowHz && config.bandpassHighHz < sampleRateHz / 2, "PAN_TOMPKINS_BANDPASS");
  requireCondition(config.integrationWindowMs > 0 && config.refractoryMs > 0 && config.refinementWindowMs > 0, "PAN_TOMPKINS_WINDOWS");
  requireCondition(config.thresholdWeight > 0 && config.thresholdWeight < 1, "PAN_TOMPKINS_THRESHOLD_WEIGHT");
  requireCondition(options.provenance && typeof options.provenance === "object", "PAN_TOMPKINS_PROVENANCE_REQUIRED");
  const q = Math.SQRT1_2;
  const highpass = designButterworthSection("highpass", sampleRateHz, config.bandpassLowHz, q);
  const lowpass = designButterworthSection("lowpass", sampleRateHz, config.bandpassHighHz, q);
  const filtered = zeroPhaseBiquad(zeroPhaseBiquad(signal, highpass), lowpass);
  const derivative = filtered.map((value, index) => index === 0 ? 0 : value - filtered[index - 1]);
  const integrated = movingAverage(derivative.map(value => value * value), Math.max(1, Math.round(config.integrationWindowMs * sampleRateHz / 1000)));
  const candidates = localMaxima(integrated);
  requireCondition(candidates.length > 0, "PAN_TOMPKINS_NO_CANDIDATES");
  const strengths = candidates.map(row => row.strength).sort((a, b) => a - b);
  const lower = strengths[Math.floor((strengths.length - 1) * 0.25)];
  const upper = strengths[Math.floor((strengths.length - 1) * 0.9)];
  let noiseLevel = lower;
  let signalLevel = Math.max(upper, lower + Number.EPSILON);
  const refractorySamples = Math.max(1, Math.round(config.refractoryMs * sampleRateHz / 1000));
  const refineRadius = Math.max(1, Math.round(config.refinementWindowMs * sampleRateHz / 2000));
  const accepted = [];
  for (const candidate of candidates) {
    const threshold = noiseLevel + config.thresholdWeight * (signalLevel - noiseLevel);
    if (candidate.strength >= threshold) {
      const sampleIndex = strongestAbsoluteSample(filtered, candidate.sampleIndex, refineRadius);
      const prior = accepted[accepted.length - 1];
      if (!prior || sampleIndex - prior.sampleIndex >= refractorySamples) {
        accepted.push({ sampleIndex, strength: candidate.strength });
      } else if (candidate.strength > prior.strength) {
        accepted[accepted.length - 1] = { sampleIndex, strength: candidate.strength };
      }
      signalLevel = 0.875 * signalLevel + 0.125 * candidate.strength;
    } else {
      noiseLevel = 0.875 * noiseLevel + 0.125 * candidate.strength;
    }
  }
  return {
    schema: "ekg-rpeak-candidate-events-pan-tompkins-v1",
    algorithm: PAN_TOMPKINS_ALGORITHM,
    events: accepted.map(row => ({
      fiducial: "R_PEAK",
      sampleIndex: row.sampleIndex,
      timeMs: Number((row.sampleIndex * 1000 / sampleRateHz).toFixed(6)),
      strength: Number(row.strength.toFixed(12)),
      sourceKind: "automated_fiducial_unvalidated",
    })),
    configuration: config,
    provenance: {
      sourceKind: options.provenance.sourceKind,
      locator: options.provenance.locator,
      projectGold: false,
      runtimeAuthority: false,
    },
    diagnosticInterpretationIncluded: false,
    ...MEASUREMENT_GOVERNANCE,
  };
}

module.exports = { DEFAULT_PAN_TOMPKINS_CONFIG, PAN_TOMPKINS_ALGORITHM, detectPanTompkinsRPeaks, localMaxima, movingAverage };
