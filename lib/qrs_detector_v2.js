"use strict";

const {
  designButterworthSection,
  zeroPhaseBiquad,
} = require("./signal_dsp_filtering");
const { MEASUREMENT_GOVERNANCE } = require("./signal_measurement_contract");
const engineeringConfiguration = require("../evaluation/protocols/QRS_DETECTOR_V2_ENGINEERING_CONFIG.json");

const QRS_V2_ALGORITHM = "target-owned-adaptive-qrs-energy-v2";

const DEFAULT_QRS_V2_CONFIG = Object.freeze({ ...engineeringConfiguration.detector });

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

function median(values) {
  requireCondition(Array.isArray(values) && values.length > 0, "QRS_V2_VALUES_REQUIRED");
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function quantile(values, probability) {
  requireCondition(Array.isArray(values) && values.length > 0, "QRS_V2_VALUES_REQUIRED");
  requireCondition(Number.isFinite(probability) && probability >= 0 && probability <= 1, "QRS_V2_QUANTILE");
  const sorted = values.slice().sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const left = Math.floor(position);
  const fraction = position - left;
  return sorted[left] + ((sorted[left + 1] === undefined ? sorted[left] : sorted[left + 1]) - sorted[left]) * fraction;
}

function toSamples(milliseconds, sampleRateHz, minimum = 1) {
  return Math.max(minimum, Math.round(milliseconds * sampleRateHz / 1000));
}

function validateConfiguration(sampleRateHz, overrides) {
  const config = { ...DEFAULT_QRS_V2_CONFIG, ...(overrides || {}) };
  for (const [key, value] of Object.entries(config)) finite(value, `QRS_V2_CONFIG_${key}`);
  requireCondition(config.bandpassLowHz > 0 && config.bandpassHighHz > config.bandpassLowHz, "QRS_V2_BANDPASS_RANGE");
  requireCondition(config.bandpassHighHz < sampleRateHz / 2, "QRS_V2_BANDPASS_NYQUIST");
  requireCondition(config.refractoryMs > 0 && config.integrationWindowMs > 0 && config.bootstrapWindowMs > 0, "QRS_V2_TIME_RANGE");
  requireCondition(config.primaryThresholdWeight > config.secondaryThresholdWeight, "QRS_V2_THRESHOLD_ORDER");
  requireCondition(config.secondaryThresholdWeight >= 0 && config.primaryThresholdWeight <= 1, "QRS_V2_THRESHOLD_RANGE");
  requireCondition(config.signalAdaptationRate > 0 && config.signalAdaptationRate <= 1, "QRS_V2_SIGNAL_ADAPTATION_RANGE");
  requireCondition(config.noiseAdaptationRate > 0 && config.noiseAdaptationRate <= 1, "QRS_V2_NOISE_ADAPTATION_RANGE");
  requireCondition(config.searchbackRrFactor > 1, "QRS_V2_SEARCHBACK_FACTOR");
  requireCondition(Number.isInteger(config.searchbackMinHistory) && config.searchbackMinHistory >= 1, "QRS_V2_SEARCHBACK_HISTORY");
  requireCondition(Number.isInteger(config.searchbackHistoryBeats) && config.searchbackHistoryBeats >= 2, "QRS_V2_SEARCHBACK_WINDOW");
  requireCondition(config.minQrsWidthMs > 0 && config.maxQrsWidthMs > config.minQrsWidthMs, "QRS_V2_WIDTH_RANGE");
  return config;
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

function qrsBandpass(samples, sampleRateHz, config) {
  const q = Math.SQRT1_2;
  const highpass = designButterworthSection("highpass", sampleRateHz, config.bandpassLowHz, q);
  const lowpass = designButterworthSection("lowpass", sampleRateHz, config.bandpassHighHz, q);
  return zeroPhaseBiquad(zeroPhaseBiquad(samples, highpass), lowpass);
}

function fivePointDerivative(samples) {
  const out = Array(samples.length).fill(0);
  for (let i = 2; i < samples.length - 2; i += 1) {
    out[i] = (samples[i + 2] + 2 * samples[i + 1] - 2 * samples[i - 1] - samples[i - 2]) / 8;
  }
  return out;
}

function centeredMovingAverage(values, windowSamples) {
  requireCondition(Number.isInteger(windowSamples) && windowSamples >= 1, "QRS_V2_INTEGRATION_WINDOW");
  const leftRadius = Math.floor((windowSamples - 1) / 2);
  const rightRadius = windowSamples - leftRadius - 1;
  const prefix = new Array(values.length + 1).fill(0);
  for (let i = 0; i < values.length; i += 1) prefix[i + 1] = prefix[i] + values[i];
  return values.map((unused, index) => {
    const start = Math.max(0, index - leftRadius);
    const end = Math.min(values.length, index + rightRadius + 1);
    return (prefix[end] - prefix[start]) / (end - start);
  });
}

function extractLocalMaxima(values, minimumSpacingSamples) {
  const peaks = [];
  let index = 1;
  while (index < values.length - 1) {
    if (values[index] < values[index - 1]) { index += 1; continue; }
    let plateauEnd = index;
    while (plateauEnd + 1 < values.length && values[plateauEnd + 1] === values[index]) plateauEnd += 1;
    if (plateauEnd + 1 < values.length && values[index] > values[plateauEnd + 1]) {
      const sampleIndex = Math.floor((index + plateauEnd) / 2);
      peaks.push({ sampleIndex, strength: values[sampleIndex] });
    }
    index = plateauEnd + 1;
  }
  const selected = [];
  for (const peak of peaks) {
    const prior = selected[selected.length - 1];
    if (!prior || peak.sampleIndex - prior.sampleIndex >= minimumSpacingSamples) {
      selected.push(peak);
    } else if (peak.strength > prior.strength) {
      selected[selected.length - 1] = peak;
    }
  }
  return selected;
}

function localMedian(samples, center, radius) {
  const start = Math.max(0, center - radius);
  const end = Math.min(samples.length, center + radius + 1);
  return median(samples.slice(start, end));
}

function halfHeightWidth(values, index, baseline, maximumRadius) {
  const amplitude = Math.abs(values[index] - baseline);
  if (!(amplitude > 0)) return 0;
  const threshold = amplitude * 0.5;
  let left = index;
  let right = index;
  while (left > Math.max(0, index - maximumRadius) && Math.abs(values[left - 1] - baseline) >= threshold) left -= 1;
  while (right < Math.min(values.length - 1, index + maximumRadius) && Math.abs(values[right + 1] - baseline) >= threshold) right += 1;
  return right - left + 1;
}

function rawExtrema(samples, start, end, baseline) {
  const out = [];
  for (let i = Math.max(1, start); i <= Math.min(samples.length - 2, end); i += 1) {
    const deviation = Math.abs(samples[i] - baseline);
    if (deviation >= Math.abs(samples[i - 1] - baseline) && deviation > Math.abs(samples[i + 1] - baseline)) {
      out.push({ sampleIndex: i, amplitude: deviation });
    }
  }
  return out;
}

function refineFiducial(samples, filtered, candidateIndex, sampleRateHz, config) {
  const before = toSamples(config.refinementWindowBeforeMs, sampleRateHz);
  const after = toSamples(config.refinementWindowAfterMs, sampleRateHz);
  const start = Math.max(1, candidateIndex - before);
  const end = Math.min(samples.length - 2, candidateIndex + after);
  const baseline = localMedian(samples, candidateIndex, toSamples(250, sampleRateHz));
  const widthRadius = toSamples(config.maxQrsWidthMs, sampleRateHz);
  let rawCandidates = rawExtrema(samples, start, end, baseline);
  if (!rawCandidates.length) {
    let fallback = { sampleIndex: start, amplitude: Math.abs(samples[start] - baseline) };
    for (let i = start + 1; i <= end; i += 1) {
      const amplitude = Math.abs(samples[i] - baseline);
      if (amplitude > fallback.amplitude) fallback = { sampleIndex: i, amplitude };
    }
    rawCandidates = [fallback];
  }
  const extrema = rawCandidates.map(row => {
    const widthSamples = halfHeightWidth(samples, row.sampleIndex, baseline, widthRadius);
    const widthMs = widthSamples * 1000 / sampleRateHz;
    const spikePenalty = widthMs <= config.pacerMaxWidthMs ? Math.max(0.05, widthMs / config.pacerMaxWidthMs * 0.2) : 1;
    return {
      ...row,
      widthSamples,
      widthMs,
      score: Math.abs(filtered[row.sampleIndex]) * spikePenalty,
    };
  });
  extrema.sort((a, b) => b.score - a.score || b.amplitude - a.amplitude || a.sampleIndex - b.sampleIndex);
  const chosen = extrema[0];
  const pacerWindow = toSamples(config.pacerAssociationMs, sampleRateHz);
  const associatedPacer = extrema
    .filter(row => row.sampleIndex < chosen.sampleIndex && chosen.sampleIndex - row.sampleIndex <= pacerWindow)
    .filter(row => row.widthMs <= config.pacerMaxWidthMs && row.amplitude > chosen.amplitude * 1.15)
    .sort((a, b) => b.amplitude - a.amplitude || a.sampleIndex - b.sampleIndex)[0] || null;
  return { ...chosen, baseline, associatedPacer };
}

function candidateFeatures(samples, filtered, derivative, candidate, sampleRateHz, config) {
  const fiducial = refineFiducial(samples, filtered, candidate.sampleIndex, sampleRateHz, config);
  const radius = toSamples(config.maxQrsWidthMs, sampleRateHz);
  const filteredBaseline = localMedian(filtered, fiducial.sampleIndex, toSamples(250, sampleRateHz));
  const filteredWidthSamples = halfHeightWidth(filtered, fiducial.sampleIndex, filteredBaseline, radius);
  const filteredWidthMs = filteredWidthSamples * 1000 / sampleRateHz;
  const slopeRadius = toSamples(60, sampleRateHz);
  let maximumSlope = 0;
  for (let i = Math.max(0, fiducial.sampleIndex - slopeRadius); i <= Math.min(derivative.length - 1, fiducial.sampleIndex + slopeRadius); i += 1) {
    maximumSlope = Math.max(maximumSlope, Math.abs(derivative[i]));
  }
  const filteredAmplitude = Math.abs(filtered[fiducial.sampleIndex] - filteredBaseline);
  const normalizedSlopePerMs = filteredAmplitude > 1e-12
    ? maximumSlope / filteredAmplitude * sampleRateHz / 1000
    : 0;
  const spikeLike = fiducial.widthMs <= config.pacerMaxWidthMs && filteredWidthMs <= config.pacerMaxWidthMs * 1.5;
  const morphologyAccepted = !spikeLike
    && filteredWidthMs >= config.minQrsWidthMs
    && filteredWidthMs <= config.maxQrsWidthMs
    && normalizedSlopePerMs >= config.minNormalizedSlopePerMs;
  return {
    ...candidate,
    fiducialIndex: fiducial.sampleIndex,
    amplitude: fiducial.amplitude,
    rawWidthMs: fiducial.widthMs,
    filteredWidthMs,
    maximumSlope,
    normalizedSlopePerMs,
    spikeLike,
    morphologyAccepted,
    associatedPacer: fiducial.associatedPacer,
  };
}

function threshold(noiseLevel, signalLevel, weight) {
  return noiseLevel + weight * Math.max(0, signalLevel - noiseLevel);
}

function clampedAdaptiveUpdate(level, observation, rate, clampFactor) {
  const cap = level > 0 ? level * clampFactor : observation;
  const bounded = Math.min(observation, cap);
  return (1 - rate) * level + rate * bounded;
}

function tWaveLike(candidate, previous, sampleRateHz, config) {
  if (!previous) return false;
  const deltaMs = (candidate.fiducialIndex - previous.fiducialIndex) * 1000 / sampleRateHz;
  if (deltaMs < config.tWaveWindowStartMs || deltaMs > config.tWaveWindowEndMs) return false;
  return candidate.maximumSlope < previous.maximumSlope * config.tWaveSlopeRatio;
}

function medianRecentRrSamples(events, historyBeats) {
  if (events.length < 3) return null;
  const start = Math.max(1, events.length - historyBeats + 1);
  const intervals = [];
  for (let i = start; i < events.length; i += 1) intervals.push(events[i].fiducialIndex - events[i - 1].fiducialIndex);
  return intervals.length ? median(intervals) : null;
}

function insertSearchbackCandidates(accepted, rejected, sampleRateHz, config) {
  if (accepted.length < config.searchbackMinHistory + 1) return accepted;
  const refractory = toSamples(config.refractoryMs, sampleRateHz);
  const output = accepted.slice().sort((a, b) => a.fiducialIndex - b.fiducialIndex);
  let changed = true;
  while (changed) {
    changed = false;
    for (let rightIndex = config.searchbackMinHistory; rightIndex < output.length; rightIndex += 1) {
      const history = output.slice(0, rightIndex);
      const expectedRr = medianRecentRrSamples(history, config.searchbackHistoryBeats);
      if (expectedRr === null) continue;
      const left = output[rightIndex - 1];
      const right = output[rightIndex];
      if (right.fiducialIndex - left.fiducialIndex <= config.searchbackRrFactor * expectedRr) continue;
      const eligible = rejected.filter(candidate =>
        candidate.morphologyAccepted
        && !candidate.spikeLike
        && candidate.strength >= candidate.secondaryThreshold
        && candidate.fiducialIndex - left.fiducialIndex >= refractory
        && right.fiducialIndex - candidate.fiducialIndex >= refractory
        && !tWaveLike(candidate, left, sampleRateHz, config)
      );
      eligible.sort((a, b) => b.strength - a.strength || a.fiducialIndex - b.fiducialIndex);
      if (eligible.length) {
        const recovered = { ...eligible[0], acceptedBy: "SEARCHBACK" };
        output.splice(rightIndex, 0, recovered);
        rejected.splice(rejected.indexOf(eligible[0]), 1);
        changed = true;
        break;
      }
    }
  }
  return output;
}

function detectCandidateRPeaksV2(samples, sampleRateHz, options = {}) {
  requireCondition(Array.isArray(samples) && samples.length >= 32, "QRS_V2_SAMPLES_REQUIRED");
  finite(sampleRateHz, "QRS_V2_SAMPLE_RATE");
  requireCondition(sampleRateHz > 0, "QRS_V2_SAMPLE_RATE");
  const validated = samples.map(value => finite(value, "QRS_V2_NONFINITE_SAMPLE"));
  const provenance = normalizeProvenance(options.provenance);
  const config = validateConfiguration(sampleRateHz, options.configuration || options.config);
  const filtered = qrsBandpass(validated, sampleRateHz, config);
  const derivative = fivePointDerivative(filtered);
  const energy = derivative.map(value => value * value);
  const integrated = centeredMovingAverage(energy, toSamples(config.integrationWindowMs, sampleRateHz));
  const localPeaks = extractLocalMaxima(integrated, toSamples(config.candidateSpacingMs, sampleRateHz));
  requireCondition(localPeaks.length > 0, "QRS_V2_NO_TRANSFORM_CANDIDATES");
  const candidates = localPeaks.map(candidate => candidateFeatures(
    validated, filtered, derivative, candidate, sampleRateHz, config
  ));

  const bootstrapEnd = toSamples(config.bootstrapWindowMs, sampleRateHz);
  const bootstrapCandidates = candidates.filter(candidate => candidate.sampleIndex <= bootstrapEnd);
  const strengths = (bootstrapCandidates.length >= 4 ? bootstrapCandidates : candidates).map(candidate => candidate.strength);
  let noiseLevel = quantile(strengths, 0.25);
  let signalLevel = Math.max(quantile(strengths, 0.9), noiseLevel + Number.EPSILON);
  const refractory = toSamples(config.refractoryMs, sampleRateHz);
  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    candidate.primaryThreshold = threshold(noiseLevel, signalLevel, config.primaryThresholdWeight);
    candidate.secondaryThreshold = threshold(noiseLevel, signalLevel, config.secondaryThresholdWeight);
    const previous = accepted[accepted.length - 1] || null;
    const aboveThreshold = candidate.strength >= candidate.primaryThreshold;
    const isTWave = tWaveLike(candidate, previous, sampleRateHz, config);
    const withinRefractory = previous && candidate.fiducialIndex - previous.fiducialIndex < refractory;
    const replacesRefractoryEvent = aboveThreshold && candidate.morphologyAccepted && !isTWave && withinRefractory
      && (candidate.strength > previous.strength * 1.15 || candidate.maximumSlope > previous.maximumSlope * 1.25);
    if (replacesRefractoryEvent) {
      const replaced = accepted.pop();
      rejected.push({ ...replaced, rejectionReason: "REPLACED_BY_STRONGER_REFRACTORY_CANDIDATE" });
      accepted.push({ ...candidate, acceptedBy: "ADAPTIVE_PRIMARY_REFRACTORY_REPLACEMENT" });
      signalLevel = clampedAdaptiveUpdate(signalLevel, candidate.strength, config.signalAdaptationRate, config.adaptationClampFactor);
    } else if (aboveThreshold && candidate.morphologyAccepted && !isTWave && !withinRefractory) {
      accepted.push({ ...candidate, acceptedBy: "ADAPTIVE_PRIMARY" });
      signalLevel = clampedAdaptiveUpdate(signalLevel, candidate.strength, config.signalAdaptationRate, config.adaptationClampFactor);
    } else {
      const rejectionReason = !aboveThreshold ? "BELOW_ADAPTIVE_THRESHOLD"
        : candidate.spikeLike ? "PACER_SPIKE_CANDIDATE"
          : !candidate.morphologyAccepted ? "NON_QRS_MORPHOLOGY"
            : isTWave ? "T_WAVE_DISCRIMINATION"
              : "REFRACTORY_DUPLICATE";
      rejected.push({ ...candidate, rejectionReason });
      noiseLevel = clampedAdaptiveUpdate(noiseLevel, candidate.strength, config.noiseAdaptationRate, config.adaptationClampFactor);
    }
  }

  const finalEvents = insertSearchbackCandidates(accepted, rejected, sampleRateHz, config)
    .sort((a, b) => a.fiducialIndex - b.fiducialIndex);
  return {
    schema: "ekg-rpeak-candidate-events-v2",
    algorithm: QRS_V2_ALGORITHM,
    events: finalEvents.map(candidate => ({
      fiducial: "R_PEAK",
      sampleIndex: candidate.fiducialIndex,
      timeMs: round(candidate.fiducialIndex * 1000 / sampleRateHz),
      strength: round(candidate.strength),
      detectionConfidenceClass: candidate.acceptedBy,
      qrsWidthMs: round(candidate.filteredWidthMs),
      rawHalfHeightWidthMs: round(candidate.rawWidthMs),
      normalizedSlopePerMs: round(candidate.normalizedSlopePerMs),
      pacedComplexCandidate: Boolean(candidate.associatedPacer),
      associatedPacerSampleIndex: candidate.associatedPacer ? candidate.associatedPacer.sampleIndex : null,
      sourceKind: "automated_fiducial_unvalidated",
    })),
    configuration: { ...config },
    processing: {
      qrsTransform: "zero-phase-butterworth-bandpass-five-point-derivative-square-centered-mwi",
      adaptiveThresholding: "signal-noise-ewma-primary-secondary-v2",
      searchback: "rr-history-lower-threshold-morphology-gated-v2",
      ptDiscrimination: "bandlimited-width-slope-and-relative-timing-v2",
      pacingHandling: "narrow-spike-rejection-and-post-spike-fiducial-refinement-v2",
      timingRefinement: "calibrated-waveform-local-extremum-with-spike-penalty-v2",
      candidateCount: candidates.length,
      rejectedCandidateCount: rejected.length,
    },
    provenance,
    diagnosticInterpretationIncluded: false,
    ...MEASUREMENT_GOVERNANCE,
  };
}

module.exports = {
  DEFAULT_QRS_V2_CONFIG,
  QRS_V2_ALGORITHM,
  centeredMovingAverage,
  detectCandidateRPeaksV2,
  extractLocalMaxima,
  fivePointDerivative,
  qrsBandpass,
};
