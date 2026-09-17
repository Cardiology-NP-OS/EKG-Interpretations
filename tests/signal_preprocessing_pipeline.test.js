"use strict";
const assert = require("assert");
const {
  PIPELINE_GOVERNANCE,
  preprocessBatch,
  resampleLinear,
  runSignalPreprocessingPipeline,
  segmentLeads,
} = require("../lib/signal_preprocessing_pipeline");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

const canonical = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
const scrambled = ["V6","II","I","V1","III","aVF","V2","aVR","V3","aVL","V5","V4"];
function syntheticWfdb({ leads = scrambled, sampleRateHz = 100, sampleCount = 8 } = {}) {
  const header = [`prep ${leads.length} ${sampleRateHz} ${sampleCount}`]
    .concat(leads.map(lead => `prep.dat 16 1000.0(0)/mV 16 0 0 0 0 ${lead}`)).join("\n") + "\n";
  const buffer = Buffer.alloc(leads.length * sampleCount * 2);
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (let leadIndex = 0; leadIndex < leads.length; leadIndex += 1) {
      const canonicalIndex = canonical.indexOf(leads[leadIndex]);
      const valueMv = (canonicalIndex + 1) + sample / 10;
      buffer.writeInt16LE(Math.round(valueMv * 1000), (sample * leads.length + leadIndex) * 2);
    }
  }
  return { header, buffer };
}
const provenance = { sourceKind:"SYNTHETIC_FIXTURE", locator:"preprocess-pipeline-test" };
function config(overrides = {}) {
  return {
    requireCompleteTwelveLead: true,
    targetSamplingRateHz: 200,
    segmentSamples: 8,
    resamplingMethod: "linear-v1",
    remainderPolicy: "drop",
    ...overrides,
  };
}

test("governance remains nonclinical engineering only", () => {
  assert.strictEqual(PIPELINE_GOVERNANCE.runtimeAuthority, false);
  assert.strictEqual(PIPELINE_GOVERNANCE.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(PIPELINE_GOVERNANCE.evidenceAdmission, "NOT_ADMITTED");
  assert.strictEqual(PIPELINE_GOVERNANCE.metrics, "NOT_REPORTABLE");
});

test("scrambled twelve-lead WFDB is reordered canonically", () => {
  const fx = syntheticWfdb();
  const out = runSignalPreprocessingPipeline({headerText:fx.header,dataBuffer:fx.buffer,config:config(),provenance});
  assert.deepStrictEqual(out.canonicalLeadOrder, canonical);
  assert.strictEqual(out.segments.length, 2);
  const first = out.segments[0].leads;
  assert.strictEqual(first[0].leadName, "I");
  assert.strictEqual(first[0].samples[0], 1);
  assert.strictEqual(first[1].leadName, "II");
  assert.strictEqual(first[1].samples[0], 2);
  assert.strictEqual(first[11].leadName, "V6");
  assert.strictEqual(first[11].samples[0], 12);
});

test("linear resampling is deterministic and executable", () => {
  assert.deepStrictEqual(resampleLinear([0,1,2,3], 2, 4), [0,0.5,1,1.5,2,2.5,3,3]);
});
test("identity-rate preprocessing preserves sample count", () => {
  const fx = syntheticWfdb({sampleRateHz:100,sampleCount:8});
  const out = runSignalPreprocessingPipeline({headerText:fx.header,dataBuffer:fx.buffer,config:config({targetSamplingRateHz:100,resamplingMethod:null,segmentSamples:4}),provenance});
  assert.strictEqual(out.resampling.required, false);
  assert.strictEqual(out.resampling.method, "identity");
  assert.strictEqual(out.resampling.targetSamples, 8);
  assert.strictEqual(out.segments.length, 2);
});

test("zero-pad remainder is explicit and deterministic", () => {
  const segmented = segmentLeads([[1,2,3,4,5],[6,7,8,9,10]], 4, "zero-pad");
  assert.strictEqual(segmented.segments.length, 2);
  assert.deepStrictEqual(segmented.segments[1].leads[0], [5,0,0,0]);
  assert.strictEqual(segmented.paddedSamples, 3);
  assert.strictEqual(segmented.droppedSamples, 0);
});

test("partial lead processing is allowed only when explicitly requested", () => {
  const fx = syntheticWfdb({leads:["II","V1"],sampleRateHz:100,sampleCount:8});
  const out = runSignalPreprocessingPipeline({headerText:fx.header,dataBuffer:fx.buffer,config:config({requireCompleteTwelveLead:false,targetSamplingRateHz:100,resamplingMethod:null,segmentSamples:4}),provenance});
  assert.deepStrictEqual(out.canonicalLeadOrder, ["II","V1"]);
});

test("missing required leads fail closed", () => {
  const fx = syntheticWfdb({leads:["II","V1"]});
  assert.throws(() => runSignalPreprocessingPipeline({headerText:fx.header,dataBuffer:fx.buffer,config:config(),provenance}), /MISSING_REQUIRED_12_LEAD/);
});

test("unsupported resampling implementation fails closed", () => {
  const fx = syntheticWfdb();
  assert.throws(() => runSignalPreprocessingPipeline({headerText:fx.header,dataBuffer:fx.buffer,config:config({resamplingMethod:"fft"}),provenance}), /PREPROCESS_RESAMPLING_METHOD_UNIMPLEMENTED/);
});
test("batch failure accounting reconciles processed and categorized skipped records", () => {
  const fx = syntheticWfdb({sampleRateHz:100,sampleCount:8});
  const good = {headerText:fx.header,dataBuffer:fx.buffer,config:config({targetSamplingRateHz:100,resamplingMethod:null,segmentSamples:4}),provenance};
  const bad = {...good, dataBuffer:Buffer.alloc(2)};
  const batch = preprocessBatch([good,bad]);
  assert.strictEqual(batch.failureAccounting.attempted, 2);
  assert.strictEqual(batch.failureAccounting.processed, 1);
  assert.strictEqual(batch.failureAccounting.skipped, 1);
  assert.strictEqual(Object.values(batch.failureAccounting.skipReasons).reduce((a,b)=>a+b,0), 1);
  assert.strictEqual(batch.failures.length, 1);
});

test("pipeline output contains no diagnostic activation surface", () => {
  const fx = syntheticWfdb();
  const out = runSignalPreprocessingPipeline({headerText:fx.header,dataBuffer:fx.buffer,config:config(),provenance});
  const text = JSON.stringify(out).toLowerCase();
  assert.strictEqual(text.includes('"diagnosis"'), false);
  assert.strictEqual(out.runtimeAuthority, false);
  assert.strictEqual(out.activation, "NOT_ELIGIBLE");
  assert.strictEqual(out.metrics, "NOT_REPORTABLE");
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema:"ekg-signal-preprocessing-pipeline-tests-v1",
  pass:true, passed, total:passed,
  syntheticOnly:true,
  diagnosticRuntime:"GOVERNED_INACTIVE",
  clinicalAuthorityAdded:false,
}));
