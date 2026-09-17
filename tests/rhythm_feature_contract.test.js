"use strict";
const assert = require("assert");
const delineationFixture = require("../evaluation/fixtures/SYNTHETIC_FIDUCIAL_DELINEATION.json");
const config = require("../evaluation/fixtures/SYNTHETIC_SIGNAL_INTELLIGENCE_CONFIG.json");
const { runWaveformMeasurementPipeline } = require("../lib/signal_measurement_pipeline");
const { extractRhythmFeatures, FEATURE_GOVERNANCE } = require("../lib/rhythm_feature_contract");
const { evaluateCandidatePhenotypes, PHENOTYPE_GOVERNANCE, STATES } = require("../lib/candidate_phenotype_engine");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

const provenance = Object.freeze({
  sourceKind: "SYNTHETIC_FIXTURE",
  locator: "ECG-FIXTURE-SYNTHETIC-RHYTHM-FEATURES-V1",
});

function fill(samples, start, end, value) {
  for (let i = start; i <= end; i += 1) samples[i] = value;
}

function syntheticWfdb(options = {}) {
  const fx = delineationFixture;
  const rPeaks = options.rPeaks || fx.rPeaks;
  const samples = Array(fx.sampleCount).fill(fx.baseline);
  const rel = fx.relativeFiducials;
  const amp = fx.amplitudesMv;
  rPeaks.forEach((rPeak, beatIndex) => {
    if (options.omitPBeat !== beatIndex) {
      fill(samples, rPeak + rel.pOnset, rPeak + rel.pOffset, amp.p);
      samples[rPeak + rel.pPeak] = amp.pPeak;
    }
    const qrsOnset = rPeak + (options.qrsOnsetOffset ?? rel.qrsOnset);
    const qrsOffset = rPeak + (options.qrsOffsetOffset ?? rel.qrsOffset);
    fill(samples, qrsOnset, qrsOffset, amp.qrs);
    samples[rPeak] = amp.rPeak;
    fill(samples, rPeak + rel.tOnset, rPeak + rel.tOffset, amp.t);
    samples[rPeak + rel.tPeak] = amp.tPeak;
  });
  const header = `synthetic 1 ${fx.sampleRateHz} ${fx.sampleCount}\n` +
    `synthetic.dat 16 1000.0(0)/mV 16 0 0 0 0 ${fx.lead}\n`;
  const data = Buffer.alloc(fx.sampleCount * 2);
  samples.forEach((value, i) => data.writeInt16LE(Math.round(value * 1000), i * 2));
  return { header, data };
}

function regularMeasurement(options = {}) {
  const wfdb = syntheticWfdb(options);
  return runWaveformMeasurementPipeline({
    headerText: wfdb.header,
    dataBuffer: wfdb.data,
    leadName: delineationFixture.lead,
    config: config.measurement,
    provenance,
  });
}

function stateMap(result) {
  return new Map(result.candidates.map(x => [x.phenotypeCode, x.state]));
}
test("feature and phenotype governance remains evaluation-only", () => {
  assert.strictEqual(FEATURE_GOVERNANCE.runtimeAuthority, false);
  assert.strictEqual(FEATURE_GOVERNANCE.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(PHENOTYPE_GOVERNANCE.runtimeAuthority, false);
  assert.strictEqual(PHENOTYPE_GOVERNANCE.metrics, "NOT_REPORTABLE");
});

test("regular synthetic waveform produces deterministic rhythm features", () => {
  const features = extractRhythmFeatures(regularMeasurement());
  assert.strictEqual(features.beatCount, 4);
  assert.strictEqual(features.rr.count, 3);
  assert.strictEqual(features.rr.medianMs, 1000);
  assert.strictEqual(features.rr.sdMs, 0);
  assert.strictEqual(features.rr.coefficientOfVariation, 0);
  assert.strictEqual(features.rr.rmssdMs, 0);
  assert.strictEqual(features.intervals.prMedianMs, 160);
  assert.strictEqual(features.intervals.qrsMedianMs, 100);
  assert.strictEqual(features.intervals.qtMedianMs, 400);
  assert.strictEqual(features.delineationCoverage.pWaveCoverageRatio, 1);
});

test("regular synthetic waveform keeps all configured candidate phenotypes quiet", () => {
  const result = evaluateCandidatePhenotypes(extractRhythmFeatures(regularMeasurement()), config.phenotypes);
  for (const row of result.candidates) assert.strictEqual(row.state, STATES.NOT_DETECTED, row.phenotypeCode);
});
test("irregular RR candidate is detected from explicit variability thresholds", () => {
  const features = extractRhythmFeatures(regularMeasurement({rPeaks:[100,300,550,850]}));
  const result = evaluateCandidatePhenotypes(features, config.phenotypes);
  assert.strictEqual(stateMap(result).get("RR_IRREGULARITY"), STATES.DETECTED);
  assert.ok(features.rr.coefficientOfVariation >= config.phenotypes.rrIrregularity.cvAtOrAbove);
});

test("pause candidate requires both absolute and relative configured thresholds", () => {
  const features = extractRhythmFeatures(regularMeasurement({rPeaks:[100,250,400,800]}));
  const result = evaluateCandidatePhenotypes(features, config.phenotypes);
  assert.strictEqual(stateMap(result).get("RR_PAUSE"), STATES.DETECTED);
  const row = result.candidates.find(x => x.phenotypeCode === "RR_PAUSE");
  assert.ok(row.observed.maxRrMs >= config.phenotypes.pause.absoluteRrMsAtOrAbove);
  assert.ok(row.observed.maxToMedianRatio >= config.phenotypes.pause.medianMultipleAtOrAbove);
});

test("wide QRS candidate is descriptive and threshold bound", () => {
  const features = extractRhythmFeatures(regularMeasurement({qrsOnsetOffset:-15,qrsOffsetOffset:20}));
  const result = evaluateCandidatePhenotypes(features, config.phenotypes);
  assert.strictEqual(features.intervals.qrsMedianMs, 140);
  assert.strictEqual(stateMap(result).get("QRS_DURATION_ABOVE_CONFIGURED_THRESHOLD"), STATES.DETECTED);
});

test("low P-wave coverage candidate does not become a rhythm diagnosis", () => {
  const features = extractRhythmFeatures(regularMeasurement({omitPBeat:0}));
  const localConfig = JSON.parse(JSON.stringify(config.phenotypes));
  localConfig.pWaveCoverage.ratioAtOrBelow = 0.8;
  const result = evaluateCandidatePhenotypes(features, localConfig);
  assert.strictEqual(features.delineationCoverage.pWaveCoverageRatio, 0.75);
  assert.strictEqual(stateMap(result).get("P_WAVE_COVERAGE_LOW"), STATES.DETECTED);
  assert.strictEqual(JSON.stringify(result).toLowerCase().includes("atrial fibrillation"), false);
});
test("configured PR duration candidate uses measured value without diagnosis", () => {
  const measurement = regularMeasurement();
  const pr = measurement.intervalMeasurements.measurements.find(x => x.metric === "pr");
  pr.value = 220;
  const result = evaluateCandidatePhenotypes(extractRhythmFeatures(measurement), config.phenotypes);
  assert.strictEqual(stateMap(result).get("PR_DURATION_ABOVE_CONFIGURED_THRESHOLD"), STATES.DETECTED);
});

test("insufficient RR data abstains rather than fabricating regularity", () => {
  const features = extractRhythmFeatures(regularMeasurement({rPeaks:[100,350]}));
  const result = evaluateCandidatePhenotypes(features, config.phenotypes);
  assert.strictEqual(stateMap(result).get("RR_IRREGULARITY"), STATES.INSUFFICIENT);
  assert.strictEqual(stateMap(result).get("RR_PAUSE"), STATES.INSUFFICIENT);
});

test("missing PR measurement returns insufficient data state", () => {
  const measurement = regularMeasurement({omitPBeat:0});
  measurement.intervalMeasurements.measurements = measurement.intervalMeasurements.measurements.filter(x => x.metric !== "pr");
  const result = evaluateCandidatePhenotypes(extractRhythmFeatures(measurement), config.phenotypes);
  assert.strictEqual(stateMap(result).get("PR_DURATION_ABOVE_CONFIGURED_THRESHOLD"), STATES.INSUFFICIENT);
});

test("candidate thresholds must be explicit and bounded", () => {
  const features = extractRhythmFeatures(regularMeasurement());
  const bad = JSON.parse(JSON.stringify(config.phenotypes));
  bad.pWaveCoverage.ratioAtOrBelow = 2;
  assert.throws(() => evaluateCandidatePhenotypes(features, bad), /PHENOTYPE_P_COVERAGE_THRESHOLD/);
  assert.throws(() => evaluateCandidatePhenotypes(features, null), /PHENOTYPE_CONFIG_REQUIRED/);
});

test("duplicate measurement metrics fail closed", () => {
  const measurement=regularMeasurement();
  measurement.intervalMeasurements.measurements.push({...measurement.intervalMeasurements.measurements[0]});
  assert.throws(()=>extractRhythmFeatures(measurement),/FEATURE_DUPLICATE_MEASUREMENT/);
});

test("nonpositive RR intervals fail closed", () => {
  const measurement=regularMeasurement();
  measurement.intervalMeasurements.rrIntervalsMs[0]=0;
  assert.throws(()=>extractRhythmFeatures(measurement),/FEATURE_RR_RANGE/);
});

test("impossible delineation coverage fails closed", () => {
  const measurement=regularMeasurement();
  measurement.coverage.pWaveCandidates=measurement.coverage.beats+1;
  assert.throws(()=>extractRhythmFeatures(measurement),/FEATURE_P_COVERAGE_RANGE/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-rhythm-feature-contract-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  metrics: "NOT_REPORTABLE",
  clinicalAuthorityAdded: false,
}));
