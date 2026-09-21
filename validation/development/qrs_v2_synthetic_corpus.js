"use strict";

const fixtureManifest = require("../../evaluation/fixtures/QRS_V2_SYNTHETIC_REGRESSIONS.json");

function toSamples(milliseconds, sampleRateHz) {
  return Math.round(milliseconds * sampleRateHz / 1000);
}

function addTriangle(samples, center, halfWidth, amplitude) {
  const width = Math.max(1, halfWidth);
  for (let i = Math.max(0, center - width); i <= Math.min(samples.length - 1, center + width); i += 1) {
    samples[i] += amplitude * (1 - Math.abs(i - center) / width);
  }
}

function deterministicNoise(length, seed, amplitude) {
  let state = seed >>> 0;
  const output = new Array(length);
  for (let i = 0; i < length; i += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    output[i] = (((state / 0x100000000) * 2) - 1) * amplitude;
  }
  return output;
}

function buildSyntheticQrsFixture(spec, generator = fixtureManifest.generator) {
  const sampleRateHz = generator.sample_rate_hz;
  const sampleCount = toSamples(generator.duration_ms, sampleRateHz);
  const samples = Array(sampleCount).fill(0);
  const defaultWidthMs = spec.qrs_width_ms || generator.default_qrs_width_ms;
  const qrsAmplitude = spec.qrs_amplitude === undefined ? 1 : spec.qrs_amplitude;
  const defaultPolarity = spec.qrs_polarity === undefined ? 1 : spec.qrs_polarity;
  const pAmplitude = spec.p_amplitude === undefined ? 0.18 : spec.p_amplitude;
  const tAmplitude = spec.t_amplitude === undefined ? 0.32 : spec.t_amplitude;
  const pWidthMs = spec.p_width_ms || 120;
  const tWidthMs = spec.t_width_ms || 180;

  spec.beats_ms.forEach((beatMs, beatIndex) => {
    const r = toSamples(beatMs, sampleRateHz);
    const widthMs = spec.beat_widths_ms ? spec.beat_widths_ms[beatIndex] : defaultWidthMs;
    const polarity = spec.beat_polarities ? spec.beat_polarities[beatIndex] : defaultPolarity;
    const amplitudeScale = spec.beat_amplitudes ? spec.beat_amplitudes[beatIndex] : 1;
    if (spec.include_p !== false) {
      addTriangle(
        samples,
        r + toSamples(generator.default_p_offset_ms, sampleRateHz),
        toSamples(pWidthMs / 2, sampleRateHz),
        pAmplitude * amplitudeScale
      );
    }
    const qrsHalf = Math.max(2, toSamples(widthMs / 2, sampleRateHz));
    addTriangle(samples, r - Math.round(qrsHalf * 0.55), Math.max(1, Math.round(qrsHalf * 0.35)), -0.22 * qrsAmplitude * amplitudeScale * polarity);
    addTriangle(samples, r, Math.max(2, Math.round(qrsHalf * 0.5)), qrsAmplitude * amplitudeScale * polarity);
    addTriangle(samples, r + Math.round(qrsHalf * 0.55), Math.max(1, Math.round(qrsHalf * 0.35)), -0.28 * qrsAmplitude * amplitudeScale * polarity);
    if (spec.qrs_notch_ms) {
      addTriangle(samples, r + toSamples(spec.qrs_notch_ms, sampleRateHz), Math.max(2, Math.round(qrsHalf * 0.35)), qrsAmplitude * amplitudeScale * polarity * 0.78);
    }
    if (spec.pacer) {
      addTriangle(
        samples,
        r + toSamples(spec.pacer.offset_ms, sampleRateHz),
        Math.max(1, toSamples(spec.pacer.width_ms / 2, sampleRateHz)),
        spec.pacer.amplitude
      );
    }
    if (spec.include_t !== false) {
      addTriangle(
        samples,
        r + toSamples(generator.default_t_offset_ms, sampleRateHz),
        toSamples(tWidthMs / 2, sampleRateHz),
        tAmplitude * amplitudeScale
      );
    }
  });

  if (spec.pause_decoy) {
    addTriangle(
      samples,
      toSamples(spec.pause_decoy.center_ms, sampleRateHz),
      toSamples(spec.pause_decoy.width_ms / 2, sampleRateHz),
      spec.pause_decoy.amplitude
    );
  }
  if (spec.baseline_wander) {
    for (let i = 0; i < samples.length; i += 1) {
      samples[i] += spec.baseline_wander.amplitude * Math.sin(2 * Math.PI * spec.baseline_wander.frequency_hz * i / sampleRateHz);
    }
  }
  if (spec.noise_burst) {
    const start = toSamples(spec.noise_burst.start_ms, sampleRateHz);
    const end = toSamples(spec.noise_burst.end_ms, sampleRateHz);
    for (let i = start; i < end; i += 1) {
      samples[i] += spec.noise_burst.amplitude * (i % 2 === 0 ? 1 : -1);
    }
  }
  if (spec.noise_amplitude) {
    const noise = deterministicNoise(samples.length, generator.deterministic_noise_seed, spec.noise_amplitude);
    for (let i = 0; i < samples.length; i += 1) samples[i] += noise[i];
  }
  return {
    id: spec.id,
    sampleRateHz,
    samples,
    referenceSampleIndices: spec.beats_ms.map(value => toSamples(value, sampleRateHz)),
    expected: spec.expected,
    provenance: {
      sourceKind: fixtureManifest.authority.source_kind,
      locator: `${fixtureManifest.fixture_set_id}:${spec.id}`,
      projectGold: false,
      runtimeAuthority: false,
    },
  };
}

function fixtureById(id) {
  const spec = fixtureManifest.fixtures.find(row => row.id === id);
  if (!spec) throw new Error(`QRS_V2_FIXTURE_NOT_FOUND:${id}`);
  return buildSyntheticQrsFixture(spec);
}

module.exports = {
  addTriangle,
  buildSyntheticQrsFixture,
  deterministicNoise,
  fixtureById,
  fixtureManifest,
  toSamples,
};
