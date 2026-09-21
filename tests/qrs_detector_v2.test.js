"use strict";

const assert = require("assert");
const { detectCandidateRPeaksV2, QRS_V2_ALGORITHM } = require("../lib/qrs_detector_v2");
const { detectCandidateRPeaksMultiLeadV2 } = require("../lib/qrs_multilead_v2");
const { matchEventsV2 } = require("../lib/event_matcher_v2");
const { runPhysicalLeadMeasurementPipeline } = require("../lib/signal_measurement_pipeline");
const {
  deterministicNoise,
  fixtureById,
  fixtureManifest,
} = require("../validation/development/qrs_v2_synthetic_corpus");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function detectFixture(id) {
  const fixture = fixtureById(id);
  const detection = detectCandidateRPeaksV2(fixture.samples, fixture.sampleRateHz, {
    provenance: fixture.provenance,
  });
  const match = matchEventsV2(fixture.referenceSampleIndices, detection.events, {
    toleranceSamples: Math.round(fixture.expected.max_timing_error_ms * fixture.sampleRateHz / 1000),
  });
  return { fixture, detection, match };
}

for (const spec of fixtureManifest.fixtures) {
  test(`${spec.id} satisfies exact synthetic regression accounting`, () => {
    const { fixture, detection, match } = detectFixture(spec.id);
    assert.strictEqual(match.matchedCount, fixture.expected.matched, `${spec.id}:matched`);
    assert.strictEqual(match.falseNegativeCount, fixture.expected.false_negative, `${spec.id}:fn`);
    if (fixture.expected.false_positive !== undefined) {
      assert.strictEqual(match.falsePositiveCount, fixture.expected.false_positive, `${spec.id}:fp`);
    } else {
      assert.ok(match.falsePositiveCount <= fixture.expected.false_positive_maximum, `${spec.id}:fp-max`);
    }
    assert.ok(match.matches.every(row => row.absoluteErrorSamples <= match.toleranceSamples), `${spec.id}:timing`);
    if (fixture.expected.paced_complexes !== undefined) {
      assert.strictEqual(detection.events.filter(row => row.pacedComplexCandidate).length, fixture.expected.paced_complexes, `${spec.id}:paced`);
    }
    const searchback = detection.events.filter(row => row.detectionConfidenceClass === "SEARCHBACK").length;
    if (fixture.expected.searchback_minimum !== undefined) assert.ok(searchback >= fixture.expected.searchback_minimum, `${spec.id}:searchback-min`);
    if (fixture.expected.searchback_maximum !== undefined) assert.ok(searchback <= fixture.expected.searchback_maximum, `${spec.id}:searchback-max`);
    assert.strictEqual(detection.algorithm, QRS_V2_ALGORITHM);
    assert.strictEqual(detection.runtimeAuthority, false);
    assert.strictEqual(detection.diagnosticRuntime, "GOVERNED_INACTIVE");
    assert.strictEqual(detection.metrics, "NOT_REPORTABLE");
  });
}

test("FIRST_LEAD_NOT_BEST_LEAD selects the cleaner second channel", () => {
  const clean = fixtureById("CLEAN_NORMAL_QRS");
  const noisy = deterministicNoise(clean.samples.length, 91, 0.8);
  const out = detectCandidateRPeaksMultiLeadV2([
    { leadName: "I", samples: noisy },
    { leadName: "II", samples: clean.samples },
  ], clean.sampleRateHz, { provenance: clean.provenance });
  assert.strictEqual(out.selectedLeadName, "II");
  assert.strictEqual(out.detection.events.length, clean.referenceSampleIndices.length);
});

test("MISSING_DEGRADED_LEAD rejects a flat channel and preserves usable detection", () => {
  const clean = fixtureById("CLEAN_NORMAL_QRS");
  const out = detectCandidateRPeaksMultiLeadV2([
    { leadName: "II", samples: Array(clean.samples.length).fill(0) },
    { leadName: "V5", samples: clean.samples },
  ], clean.sampleRateHz, { provenance: clean.provenance });
  assert.strictEqual(out.selectedLeadName, "V5");
  assert.strictEqual(out.leadQuality.find(row => row.leadName === "II").usable, false);
});

test("COMPETING_LEAD_QUALITY uses deterministic engineering-quality ranking", () => {
  const clean = fixtureById("CLEAN_NORMAL_QRS");
  const out = detectCandidateRPeaksMultiLeadV2([
    { leadName: "I", samples: clean.samples.map(value => value * 0.35) },
    { leadName: "V2", samples: clean.samples },
  ], clean.sampleRateHz, { provenance: clean.provenance });
  assert.strictEqual(out.selectedLeadName, "V2");
  const scores = Object.fromEntries(out.leadQuality.map(row => [row.leadName, row.qualityScore]));
  assert.ok(scores.V2 > scores.I);
});

test("LEAD_INVERSION remains detectable when it is the only usable lead", () => {
  const inverted = fixtureById("INVERTED_QRS");
  const out = detectCandidateRPeaksMultiLeadV2([
    { leadName: "I", samples: Array(inverted.samples.length).fill(0) },
    { leadName: "aVR", samples: inverted.samples },
  ], inverted.sampleRateHz, { provenance: inverted.provenance });
  assert.strictEqual(out.selectedLeadName, "aVR");
  assert.strictEqual(out.detection.events.length, inverted.referenceSampleIndices.length);
});

test("single-lead multilead API falls back without weakening governance", () => {
  const fixture = fixtureById("CLEAN_NORMAL_QRS");
  const out = detectCandidateRPeaksMultiLeadV2([
    { leadName: "II", samples: fixture.samples },
  ], fixture.sampleRateHz, { provenance: fixture.provenance });
  assert.strictEqual(out.selectedLeadName, "II");
  assert.strictEqual(out.singleLeadFallbackSupported, true);
  assert.strictEqual(out.runtimeAuthority, false);
});

test("measurement pipeline selects V2 only through the explicit algorithm identifier", () => {
  const fixture = fixtureById("CLEAN_NORMAL_QRS");
  const out = runPhysicalLeadMeasurementPipeline({
    physicalLead: {
      record: "qrs-v2-synthetic-pipeline",
      leadName: "II",
      sampleRateHz: fixture.sampleRateHz,
      samples: fixture.samples,
      unit: "mV",
    },
    config: {
      detector: { algorithm: QRS_V2_ALGORITHM },
      delineation: {
        baseline: 0,
        qrs: { threshold: 0.1, beforeMs: 100, afterMs: 100 },
        p: { threshold: 0.1, searchStartMsBeforeR: 250, searchEndMsBeforeR: 100 },
        t: { threshold: 0.15, searchStartMsAfterR: 100, searchEndMsAfterR: 400 },
      },
    },
    provenance: fixture.provenance,
  });
  assert.strictEqual(out.candidateRPeaks.algorithm, QRS_V2_ALGORITHM);
  assert.strictEqual(out.coverage.beats, fixture.referenceSampleIndices.length);
  assert.strictEqual(out.runtimeAuthority, false);
});

test("invalid samples and incompatible sample rates fail closed", () => {
  const fixture = fixtureById("CLEAN_NORMAL_QRS");
  const bad = fixture.samples.slice(); bad[50] = NaN;
  assert.throws(() => detectCandidateRPeaksV2(bad, fixture.sampleRateHz, { provenance: fixture.provenance }), /QRS_V2_NONFINITE_SAMPLE/);
  assert.throws(() => detectCandidateRPeaksV2(fixture.samples, 30, { provenance: fixture.provenance }), /QRS_V2_BANDPASS_NYQUIST/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-qrs-detector-v2-tests-v1",
  pass: true,
  passed,
  total: passed,
  fixtureSet: fixtureManifest.fixture_set_id,
  syntheticOnly: true,
  clinicalAuthorityAdded: false,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  metrics: "NOT_REPORTABLE"
}));
