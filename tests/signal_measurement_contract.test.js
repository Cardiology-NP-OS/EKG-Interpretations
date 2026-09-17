"use strict";
const assert = require("assert");
const {
  MEASUREMENT_GOVERNANCE,
  detectCandidateRPeaks,
  extractPhysicalLead,
  measureFiducialAmplitude,
  measureFiducialIntervals,
  qtcFromQtRr,
} = require("../lib/signal_measurement_contract");
const fixture = require("../evaluation/fixtures/SYNTHETIC_RPEAK_MEASUREMENT.json");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

const provenance = Object.freeze({
  sourceKind: "SYNTHETIC_FIXTURE",
  locator: "tests/signal_measurement_contract.test.js#pulse-fixture",
});

function pulseRecord(sampleRateHz = fixture.sampleRateHz, sampleCount = fixture.sampleCount) {
  const leads = ["II", "V1"];
  const header = [`pulse 2 ${sampleRateHz} ${sampleCount}`]
    .concat(leads.map(lead => `pulse.dat 16 1000.0(0)/mV 16 0 0 0 0 ${lead}`))
    .join("\n") + "\n";
  const buffer = Buffer.alloc(sampleCount * leads.length * 2);
  const peaks = fixture.expectedCandidateRPeaks;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const ii = peaks.includes(sample) ? 1200 : 0;
    const v1 = peaks.includes(sample) ? -800 : 0;
    buffer.writeInt16LE(ii, (sample * 2) * 2);
    buffer.writeInt16LE(v1, (sample * 2 + 1) * 2);
  }
  return { header, buffer, peaks };
}

function fiducialBeats() {
  return [
    {pOnset:50,pOffset:70,qrsOnset:90,rPeak:100,qrsOffset:115,jPoint:115,tPeak:160,tOffset:190},
    {pOnset:300,pOffset:320,qrsOnset:340,rPeak:350,qrsOffset:365,jPoint:365,tPeak:410,tOffset:440},
    {pOnset:550,pOffset:570,qrsOnset:590,rPeak:600,qrsOffset:615,jPoint:615,tPeak:660,tOffset:690},
    {pOnset:800,pOffset:820,qrsOnset:840,rPeak:850,qrsOffset:865,jPoint:865,tPeak:910,tOffset:940},
  ];
}

test("governance remains explicitly nonruntime and non-gold", () => {
  assert.strictEqual(MEASUREMENT_GOVERNANCE.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(MEASUREMENT_GOVERNANCE.evidenceAdmission, "NOT_ADMITTED");
  assert.strictEqual(MEASUREMENT_GOVERNANCE.projectGold, false);
  assert.strictEqual(MEASUREMENT_GOVERNANCE.metrics, "NOT_REPORTABLE");
  assert.strictEqual(MEASUREMENT_GOVERNANCE.activation, "NOT_ELIGIBLE");
  assert.strictEqual(MEASUREMENT_GOVERNANCE.clinicalValidityInferred, false);
});
test("WFDB bytes become calibrated physical lead samples", () => {
  const fx = pulseRecord();
  const lead = extractPhysicalLead(fx.header, fx.buffer, "II");
  assert.strictEqual(lead.sampleRateHz, 250);
  assert.strictEqual(lead.unit, "mV");
  assert.strictEqual(lead.samples[100], 1.2);
  assert.strictEqual(lead.samples[99], 0);
  assert.strictEqual(lead.diagnosticInterpretationIncluded, false);
});

test("candidate R peaks are detected at synthetic pulse locations", () => {
  const fx = pulseRecord();
  const lead = extractPhysicalLead(fx.header, fx.buffer, "II");
  const out = detectCandidateRPeaks(lead.samples, lead.sampleRateHz, {
    minAbsoluteDeviation: 0.5,
    refractoryMs: 200,
    provenance,
  });
  assert.deepStrictEqual(out.events.map(x => x.sampleIndex), fx.peaks);
  assert.deepStrictEqual(out.events.map(x => x.timeMs), [400,1400,2400,3400]);
  assert.ok(out.events.every(x => x.sourceKind === "automated_fiducial_unvalidated"));
  assert.strictEqual(out.runtimeAuthority, false);
  assert.strictEqual(out.diagnosticRuntime, "GOVERNED_INACTIVE");
});

test("candidate detector is polarity agnostic", () => {
  const fx = pulseRecord();
  const lead = extractPhysicalLead(fx.header, fx.buffer, "V1");
  const out = detectCandidateRPeaks(lead.samples, 250, {minAbsoluteDeviation:0.5,refractoryMs:200,provenance});
  assert.deepStrictEqual(out.events.map(x => x.sampleIndex), fx.peaks);
});
test("refractory suppression keeps the strongest nearby event", () => {
  const samples = Array(200).fill(0);
  samples[50] = 1.0;
  samples[55] = 2.0;
  const out = detectCandidateRPeaks(samples, 100, {minAbsoluteDeviation:0.5,refractoryMs:100,provenance});
  assert.deepStrictEqual(out.events.map(x => x.sampleIndex), [55]);
});

test("subthreshold variation is ignored", () => {
  const samples = Array.from({length:100}, (_, i) => i % 2 ? 0.1 : -0.1);
  const out = detectCandidateRPeaks(samples, 100, {minAbsoluteDeviation:0.5,refractoryMs:100,provenance});
  assert.strictEqual(out.events.length, 0);
});

test("fiducials produce deterministic PR QRS QT RR rate and QTc measurements", () => {
  const out = measureFiducialIntervals({sampleRateHz:250,sampleCount:1000,beats:fiducialBeats(),provenance});
  const byMetric = new Map(out.measurements.map(x => [x.metric, x]));
  assert.strictEqual(byMetric.get("pr").value, fixture.expectedMeasurements.prMs);
  assert.strictEqual(byMetric.get("qrs").value, fixture.expectedMeasurements.qrsMs);
  assert.strictEqual(byMetric.get("qt").value, fixture.expectedMeasurements.qtMs);
  assert.strictEqual(byMetric.get("rr").value, fixture.expectedMeasurements.rrMs);
  assert.strictEqual(byMetric.get("ventricular_rate").value, fixture.expectedMeasurements.ventricularRateBpm);
  assert.strictEqual(byMetric.get("qtc_bazett").value, fixture.expectedMeasurements.qtcBazettMs);
  assert.strictEqual(byMetric.get("qtc_fridericia").value, fixture.expectedMeasurements.qtcFridericiaMs);
  assert.strictEqual(out.clinicalValidityInferred, false);
});
test("QTc formulas preserve formula identity without classification", () => {
  const qtc = qtcFromQtRr(360, 810);
  assert.ok(Math.abs(qtc.bazettMs - 400) < 1e-6);
  assert.ok(Math.abs(qtc.fridericiaMs - 386.195754) < 0.01);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(qtc, "prolonged"), false);
});

test("fiducial amplitude is a calibrated difference only", () => {
  const samples = [0.1,0.2,0.5,0.2];
  const out = measureFiducialAmplitude(samples, 2, 0.1, {lead:"V2",fiducial:"J_POINT",unit:"mV",provenance});
  assert.strictEqual(out.value, 0.4);
  assert.strictEqual(out.lead, "V2");
  assert.strictEqual(out.fiducial, "J_POINT");
  assert.strictEqual(out.diagnosticInterpretationIncluded, false);
});

test("invalid fiducial ordering fails closed", () => {
  const beats = [{pOnset:100,qrsOnset:90,rPeak:110,qrsOffset:120,tOffset:180}];
  assert.throws(() => measureFiducialIntervals({sampleRateHz:250,sampleCount:500,beats,provenance}), /FIDUCIAL_ORDER/);
});

test("missing detector provenance fails closed", () => {
  const samples = Array(20).fill(0); samples[10]=1;
  assert.throws(() => detectCandidateRPeaks(samples,100,{minAbsoluteDeviation:0.5,refractoryMs:100}), /MEASURE_PROVENANCE_REQUIRED/);
});

test("nonfinite waveform values fail closed", () => {
  const samples = [0,0,NaN,1,0];
  assert.throws(() => detectCandidateRPeaks(samples,100,{minAbsoluteDeviation:0.5,refractoryMs:100,provenance}), /RPEAK_NONFINITE_SAMPLE/);
});
test("detector requires explicit threshold and refractory configuration", () => {
  const samples = [0,0,1,0,0];
  assert.throws(() => detectCandidateRPeaks(samples,100,{refractoryMs:100,provenance}), /RPEAK_THRESHOLD_REQUIRED/);
  assert.throws(() => detectCandidateRPeaks(samples,100,{minAbsoluteDeviation:0.5,provenance}), /RPEAK_REFRACTORY_REQUIRED/);
});

test("measurement surface contains no diagnosis or pattern activation fields", () => {
  const out = measureFiducialIntervals({sampleRateHz:250,sampleCount:1000,beats:fiducialBeats(),provenance});
  const text = JSON.stringify(out).toLowerCase();
  assert.strictEqual(text.includes('"diagnosis"'), false);
  assert.strictEqual(text.includes('"pattern_id"'), false);
  assert.strictEqual(out.activation, "NOT_ELIGIBLE");
  assert.strictEqual(out.evidenceAdmission, "NOT_ADMITTED");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema: "ekg-signal-measurement-contract-tests-v1",
  pass: true,
  passed,
  total: passed,
  syntheticOnly: true,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  metrics: "NOT_REPORTABLE",
  clinicalAuthorityAdded: false,
}));
