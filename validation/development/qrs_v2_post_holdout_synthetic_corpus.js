"use strict";

const manifest = require("./QRS_V2_POST_HOLDOUT_SYNTHETIC_CHARACTERIZATION_V1.json");
const { buildSyntheticQrsFixture, toSamples } = require("./qrs_v2_synthetic_corpus");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function fixtureById(id) {
  const spec = manifest.fixtures.find(row => row.id === id);
  requireCondition(spec, `QRS_V2_POST_HOLDOUT_FIXTURE_NOT_FOUND:${id}`);
  const leads = spec.leads.map(lead => {
    const beats = spec.reference_beats_ms.slice();
    if (lead.additional_qrs_like_transient_ms !== undefined) {
      beats.push(lead.additional_qrs_like_transient_ms);
      beats.sort((a, b) => a - b);
    }
    const generated = buildSyntheticQrsFixture({
      id: `${spec.id}:${lead.lead_name}`,
      beats_ms: beats,
      beat_amplitudes: lead.beat_amplitudes,
      qrs_amplitude: lead.qrs_amplitude,
      expected: {},
    });
    return { leadName: lead.lead_name, samples: generated.samples };
  });
  return {
    id: spec.id,
    sampleRateHz: manifest.generator.sample_rate_hz,
    leads,
    referenceSampleIndices: spec.reference_beats_ms.map(value => toSamples(value, manifest.generator.sample_rate_hz)),
    expectedFrozenCandidate: spec.expected_frozen_candidate,
    expectedAlternateLeadIsolation: spec.expected_alternate_lead_isolation,
    provenance: {
      sourceKind: "DETERMINISTIC_SYNTHETIC_ENGINEERING_FIXTURE",
      locator: `${manifest.fixture_set_id}:${spec.id}`,
      projectGold: false,
      runtimeAuthority: false,
    },
  };
}

module.exports = { fixtureById, manifest };
