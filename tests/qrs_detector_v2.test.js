"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { detectCandidateRPeaks } = require("../lib/signal_measurement_contract");
const { AUTHORITY, dispatch } = require("../tools/specialist_provider");
const executionConfig = require("../evaluation/fixtures/SYNTHETIC_EXECUTABLE_PIPELINE_CONFIG.json");
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

test("provider preserves V1 before and after explicit V2 opt-in through dispatch and CLI", () => {
  const fixture = fixtureById("CLEAN_NORMAL_QRS");
  const leads = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
  const samples = fixture.samples.map(value => Math.round(value * 1000) / 1000);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "qrs-v2-provider-"));
  try {
    const header = path.join(tempRoot, "synthetic.hea");
    const data = path.join(tempRoot, "synthetic.dat");
    fs.writeFileSync(header, [
      `synthetic 12 ${fixture.sampleRateHz} ${samples.length}`,
      ...leads.map(lead => `synthetic.dat 16 1000.0(0)/mV 16 0 0 0 0 ${lead}`),
    ].join("\n") + "\n");
    const buffer = Buffer.alloc(samples.length * leads.length * 2);
    samples.forEach((value, index) => {
      leads.forEach((lead, leadIndex) => buffer.writeInt16LE(Math.round(value * 1000), (index * leads.length + leadIndex) * 2));
    });
    fs.writeFileSync(data, buffer);
    const defaultConfig = JSON.parse(JSON.stringify(executionConfig));
    defaultConfig.preprocessing.segmentSamples = samples.length;
    const v2Config = JSON.parse(JSON.stringify(defaultConfig));
    v2Config.measurement.detector = { algorithm: QRS_V2_ALGORITHM };
    const defaultConfigBefore = JSON.stringify(defaultConfig);
    const artifacts = [];
    for (const [index, config] of [defaultConfig, v2Config, defaultConfig].entries()) {
      const configPath = path.join(tempRoot, `config-${index}.json`);
      const outDir = path.join(tempRoot, `out-${index}`);
      fs.writeFileSync(configPath, JSON.stringify(config));
      const request = {
        operation: "waveform_execute",
        args: { header, data, config: configPath, "source-id": "fixture:qrs-v2-provider", "out-dir": outDir },
      };
      const out = dispatch(request);
      const cli = spawnSync(process.execPath, [path.join(__dirname, "../tools/specialist_provider.js")], {
        input: JSON.stringify({ ...request, args: { ...request.args, "out-dir": `${outDir}-cli` } }),
        encoding: "utf8",
        timeout: 30000,
      });
      assert.strictEqual(cli.status, 0, cli.stderr);
      assert.deepStrictEqual(JSON.parse(cli.stdout), out);
      assert.strictEqual(out.pass, true);
      assert.strictEqual(out.analysisFile, "analysis.json");
      assert.strictEqual(out.waveformFile, "waveform.svg");
      const artifact = JSON.parse(fs.readFileSync(path.join(outDir, out.analysisFile), "utf8"));
      assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(`${outDir}-cli`, out.analysisFile), "utf8")), artifact);
      assert.strictEqual(artifact.rendering.svgSha256, out.renderingSha256);
      assert.strictEqual(artifact.localPathsEmbedded, false);
      assert.strictEqual(artifact.diagnosticInterpretationIncluded, false);
      assert.strictEqual(artifact.measurement.diagnosticInterpretationIncluded, false);
      for (const [key, value] of Object.entries(AUTHORITY)) {
        assert.strictEqual(out[key], value, key);
        if (key !== "clinicalAuthorityAdded") {
          assert.strictEqual(artifact[key], value, key);
          assert.strictEqual(artifact.measurement[key], value, key);
        }
      }
      const direct = index === 1
        ? detectCandidateRPeaksV2(samples, fixture.sampleRateHz, { provenance: fixture.provenance })
        : detectCandidateRPeaks(samples, fixture.sampleRateHz, { ...defaultConfig.measurement.detector, provenance: fixture.provenance });
      assert.strictEqual(artifact.measurement.candidateRPeaks.algorithm, direct.algorithm);
      assert.deepStrictEqual(artifact.measurement.candidateRPeaks.events, direct.events);
      assert.deepStrictEqual(artifact.measurement.candidateRPeaks.events.map(event => event.sampleIndex), fixture.referenceSampleIndices);
      assert.deepStrictEqual(artifact.multiLeadAnalysis.processedLeads, leads);
      artifacts.push(artifact);
    }
    assert.strictEqual(artifacts[1].measurement.candidateRPeaks.algorithm, QRS_V2_ALGORITHM);
    assert.notStrictEqual(artifacts[0].measurement.candidateRPeaks.algorithm, QRS_V2_ALGORITHM);
    assert.deepStrictEqual(artifacts[2], artifacts[0]);
    assert.strictEqual(JSON.stringify(defaultConfig), defaultConfigBefore);
    assert.strictEqual(executionConfig.measurement.detector.algorithm, undefined);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
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
