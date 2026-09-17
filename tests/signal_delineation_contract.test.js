"use strict";
const assert = require("assert");
const fixture = require("../evaluation/fixtures/SYNTHETIC_FIDUCIAL_DELINEATION.json");
const { delineateCandidateBeats, DELINEATION_GOVERNANCE } = require("../lib/signal_delineation_contract");
const {
  detectCandidateRPeaks,
  extractPhysicalLead,
  measureFiducialIntervals,
} = require("../lib/signal_measurement_contract");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

const provenance = Object.freeze({
  sourceKind: "SYNTHETIC_FIXTURE",
  locator: "tests/signal_delineation_contract.test.js#synthetic-wave-fixture",
});

function fill(samples, start, end, value) {
  for (let i = start; i <= end; i += 1) samples[i] = value;
}
function syntheticRecord(options = {}) {
  const polarity = options.polarity === -1 ? -1 : 1;
  const samples = Array(fixture.sampleCount).fill(fixture.baseline);
  const rel = fixture.relativeFiducials;
  const amp = fixture.amplitudesMv;
  fixture.rPeaks.forEach((rPeak, beatIndex) => {
    if (options.omitPBeat !== beatIndex) {
      fill(samples, rPeak + rel.pOnset, rPeak + rel.pOffset, polarity * amp.p);
      samples[rPeak + rel.pPeak] = polarity * amp.pPeak;
    }
    fill(samples, rPeak + rel.qrsOnset, rPeak + rel.qrsOffset, polarity * amp.qrs);
    samples[rPeak] = polarity * amp.rPeak;
    if (options.omitTBeat !== beatIndex) {
      fill(samples, rPeak + rel.tOnset, rPeak + rel.tOffset, polarity * amp.t);
      samples[rPeak + rel.tPeak] = polarity * amp.tPeak;
    }
  });
  const header = `synthetic 1 ${fixture.sampleRateHz} ${fixture.sampleCount}\n` +
    `synthetic.dat 16 1000.0(0)/mV 16 0 0 0 0 ${fixture.lead}\n`;
  const buffer = Buffer.alloc(fixture.sampleCount * 2);
  samples.forEach((value, i) => buffer.writeInt16LE(Math.round(value * 1000), i * 2));
  return { samples, header, buffer };
}

function runPipeline(options = {}) {
  const record = syntheticRecord(options);
  const lead = extractPhysicalLead(record.header, record.buffer, fixture.lead);
  const r = detectCandidateRPeaks(lead.samples, lead.sampleRateHz, {
    minAbsoluteDeviation: 0.9,
    refractoryMs: 200,
    provenance,
  });
  const delineation = delineateCandidateBeats(
    lead.samples,
    lead.sampleRateHz,
    r.events,
    fixture.config,
    provenance,
  );
  return { record, lead, r, delineation };
}

function expectedBeat(rPeak) {
  const rel = fixture.relativeFiducials;
  return {
    pOnset: rPeak + rel.pOnset,
    pPeak: rPeak + rel.pPeak,
    pOffset: rPeak + rel.pOffset,
    qrsOnset: rPeak + rel.qrsOnset,
    rPeak,
    qrsOffset: rPeak + rel.qrsOffset,
    jPoint: rPeak + rel.qrsOffset,
    tOnset: rPeak + rel.tOnset,
    tPeak: rPeak + rel.tPeak,
    tOffset: rPeak + rel.tOffset,
  };
}
test("governance remains evaluation-only and clinically inactive", () => {
  assert.strictEqual(DELINEATION_GOVERNANCE.authorityClass, "EVALUATION_NONRUNTIME");
  assert.strictEqual(DELINEATION_GOVERNANCE.runtimeAuthority, false);
  assert.strictEqual(DELINEATION_GOVERNANCE.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(DELINEATION_GOVERNANCE.projectGold, false);
  assert.strictEqual(DELINEATION_GOVERNANCE.metrics, "NOT_REPORTABLE");
  assert.strictEqual(DELINEATION_GOVERNANCE.clinicalValidityInferred, false);
});

test("raw synthetic WFDB reaches exact candidate P QRS and T fiducials", () => {
  const out = runPipeline();
  assert.deepStrictEqual(out.r.events.map(x => x.sampleIndex), fixture.rPeaks);
  assert.strictEqual(out.delineation.beats.length, fixture.rPeaks.length);
  out.delineation.beats.forEach((beat, i) => {
    const expected = expectedBeat(fixture.rPeaks[i]);
    for (const [key, value] of Object.entries(expected)) assert.strictEqual(beat[key], value, `${i}:${key}`);
    assert.strictEqual(beat.sourceKind, "automated_fiducial_unvalidated");
  });
});

test("candidate delineation feeds deterministic interval measurement", () => {
  const out = runPipeline();
  const measured = measureFiducialIntervals({sampleRateHz:fixture.sampleRateHz,sampleCount:fixture.sampleCount,beats:out.delineation.beats,provenance});
  const byMetric = new Map(measured.measurements.map(x => [x.metric, x.value]));
  assert.strictEqual(byMetric.get("pr"), fixture.expectedMeasurements.prMs);
  assert.strictEqual(byMetric.get("qrs"), fixture.expectedMeasurements.qrsMs);
  assert.strictEqual(byMetric.get("qt"), fixture.expectedMeasurements.qtMs);
  assert.strictEqual(byMetric.get("rr"), fixture.expectedMeasurements.rrMs);
  assert.strictEqual(byMetric.get("ventricular_rate"), fixture.expectedMeasurements.ventricularRateBpm);
  assert.strictEqual(byMetric.get("qtc_bazett"), fixture.expectedMeasurements.qtcBazettMs);
  assert.strictEqual(byMetric.get("qtc_fridericia"), fixture.expectedMeasurements.qtcFridericiaMs);
  assert.strictEqual(measured.clinicalValidityInferred, false);
});

test("candidate delineation is polarity agnostic on the synthetic contract", () => {
  const out = runPipeline({polarity:-1});
  out.delineation.beats.forEach((beat, i) => {
    const expected = expectedBeat(fixture.rPeaks[i]);
    for (const [key, value] of Object.entries(expected)) assert.strictEqual(beat[key], value, `${i}:${key}`);
  });
});

test("missing P wave remains absent instead of fabricated", () => {
  const out = runPipeline({omitPBeat:0});
  const beat = out.delineation.beats[0];
  assert.strictEqual(Object.prototype.hasOwnProperty.call(beat,"pOnset"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(beat,"pPeak"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(beat,"pOffset"), false);
  assert.strictEqual(beat.qrsOnset, fixture.rPeaks[0] + fixture.relativeFiducials.qrsOnset);
});
test("missing T wave remains absent instead of fabricated", () => {
  const out = runPipeline({omitTBeat:0});
  const beat = out.delineation.beats[0];
  assert.strictEqual(Object.prototype.hasOwnProperty.call(beat,"tOnset"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(beat,"tPeak"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(beat,"tOffset"), false);
  assert.strictEqual(beat.jPoint, beat.qrsOffset);
});

test("QRS must cross its explicit threshold", () => {
  const out = runPipeline();
  const bad = JSON.parse(JSON.stringify(fixture.config));
  bad.qrs.threshold = 2;
  assert.throws(() => delineateCandidateBeats(out.lead.samples, fixture.sampleRateHz, fixture.rPeaks, bad, provenance), /DELINEATION_QRS_NOT_FOUND/);
});

test("wave search windows must be explicit and ordered", () => {
  const out = runPipeline();
  const bad = JSON.parse(JSON.stringify(fixture.config));
  bad.p.searchStartMsBeforeR = bad.p.searchEndMsBeforeR;
  assert.throws(() => delineateCandidateBeats(out.lead.samples, fixture.sampleRateHz, fixture.rPeaks, bad, provenance), /P_WINDOW_ORDER/);
});

test("R peaks must be unique ordered and in range", () => {
  const out = runPipeline();
  assert.throws(() => delineateCandidateBeats(out.lead.samples, fixture.sampleRateHz, [100,100], fixture.config, provenance), /DELINEATION_RPEAK_ORDER/);
  assert.throws(() => delineateCandidateBeats(out.lead.samples, fixture.sampleRateHz, [100,1000], fixture.config, provenance), /DELINEATION_RPEAK_RANGE/);
});
test("nonfinite waveform samples fail closed", () => {
  const out = runPipeline();
  const samples = out.lead.samples.slice();
  samples[12] = NaN;
  assert.throws(() => delineateCandidateBeats(samples, fixture.sampleRateHz, fixture.rPeaks, fixture.config, provenance), /DELINEATION_NONFINITE_SAMPLE/);
});

test("provenance is mandatory for automated candidates", () => {
  const out = runPipeline();
  assert.throws(() => delineateCandidateBeats(out.lead.samples, fixture.sampleRateHz, fixture.rPeaks, fixture.config, null), /DELINEATION_PROVENANCE_REQUIRED/);
});

test("candidate output surface has no diagnosis or activation fields", () => {
  const out = runPipeline();
  const text = JSON.stringify(out.delineation).toLowerCase();
  for (const forbidden of ["diagnosis","atrial fibrillation","bundle branch","av block","patternactivation"])
    assert.strictEqual(text.includes(forbidden), false, forbidden);
  assert.strictEqual(out.delineation.runtimeAuthority, false);
  assert.strictEqual(out.delineation.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(out.delineation.metrics, "NOT_REPORTABLE");
});

console.log(JSON.stringify({schema:"ekg-signal-delineation-contract-tests-v1",pass:process.exitCode!==1,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",metrics:"NOT_REPORTABLE",clinicalAuthorityAdded:false}));
