"use strict";
const assert = require("assert");
const fx = require("../evaluation/fixtures/SYNTHETIC_FIDUCIAL_DELINEATION.json");
const baseConfig = require("../evaluation/fixtures/SYNTHETIC_EXECUTABLE_PIPELINE_CONFIG.json");
const { hashObject, runExecutableEcgPipeline, stableJson } = require("../lib/ecg_execution_pipeline");

const LEADS = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
const PROVENANCE = Object.freeze({sourceKind:"SYNTHETIC_HARDENING_TEST",locator:"ECG-FIXTURE-EXEC-HARDENING-V1"});
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function fill(samples, start, end, value) {
  for (let i = Math.max(0,start); i <= Math.min(samples.length - 1,end); i += 1) samples[i] = value;
}
function metricMap(output) {
  return new Map(output.measurement.intervalMeasurements.measurements.map(row => [row.metric,row.value]));
}
function waveformAtRate(rateHz) {
  const scale = rateHz / fx.sampleRateHz;
  const sampleCount = Math.round(fx.sampleCount * scale);
  const samples = Array(sampleCount).fill(0);
  const r = fx.relativeFiducials, a = fx.amplitudesMv;
  for (const basePeak of fx.rPeaks) {
    const peak = Math.round(basePeak * scale);
    const at = offset => Math.round(offset * scale);
    fill(samples, peak + at(r.pOnset), peak + at(r.pOffset), a.p);
    samples[peak + at(r.pPeak)] = a.pPeak;
    fill(samples, peak + at(r.qrsOnset), peak + at(r.qrsOffset), a.qrs);
    samples[peak] = a.rPeak;
    fill(samples, peak + at(r.tOnset), peak + at(r.tOffset), a.t);
    samples[peak + at(r.tPeak)] = a.tPeak;
  }
  return samples;
}
function syntheticWfdb({rateHz=250, order=LEADS, allLeads=true}={}) {
  const signal = waveformAtRate(rateHz), record = `synthetic${rateHz}`;
  const header = [`${record} 12 ${rateHz} ${signal.length}`]
    .concat(order.map(lead => `${record}.dat 16 1000.0(0)/mV 16 0 0 0 0 ${lead}`)).join("\n") + "\n";
  const data = Buffer.alloc(order.length * signal.length * 2);
  for (let i=0;i<signal.length;i+=1) for (let j=0;j<order.length;j+=1) {
    const value = allLeads || order[j] === "II" ? signal[i] : 0;
    data.writeInt16LE(Math.round(value * 1000),(i*order.length+j)*2);
  }
  return {header,data};
}
function configFor(rateHz) {
  const config = clone(baseConfig);
  config.preprocessing.targetSamplingRateHz = fx.sampleRateHz;
  config.preprocessing.segmentSamples = fx.sampleCount;
  config.preprocessing.resamplingMethod = rateHz === fx.sampleRateHz ? null : "linear-v1";
  return config;
}
function runFor(options={}, config=configFor(options.rateHz || fx.sampleRateHz), provenance=PROVENANCE) {
  const wfdb = syntheticWfdb(options);
  return runExecutableEcgPipeline({
    headerText: wfdb.header,
    dataBuffer: wfdb.data,
    config,
    provenance,
  });
}

test("all canonical leads execute after one preprocessing pass", () => {
  const out = runFor({allLeads:true});
  assert.strictEqual(out.multiLeadAnalysis.failureAccounting.attempted,12);
  assert.strictEqual(out.multiLeadAnalysis.failureAccounting.processed,12);
  assert.strictEqual(out.multiLeadAnalysis.failureAccounting.skipped,0);
  assert.deepStrictEqual(out.multiLeadAnalysis.processedLeads,LEADS);
  assert.strictEqual(out.multiLeadAnalysis.crossLeadConsistency.qrsMedianMs.range,0);
});
test("canonical lead reorder makes signal results invariant to source order", () => {
  const scrambled = ["V3","II","aVF","I","V6","III","aVR","V1","aVL","V5","V2","V4"];
  const a = runFor({order:LEADS,allLeads:true});
  const b = runFor({order:scrambled,allLeads:true});
  assert.deepStrictEqual(metricMap(a),metricMap(b));
  assert.deepStrictEqual(a.preprocessing.canonicalLeadOrder,LEADS);
  assert.deepStrictEqual(b.preprocessing.canonicalLeadOrder,LEADS);
  assert.strictEqual(a.rendering.svgSha256,b.rendering.svgSha256);
  assert.notStrictEqual(a.provenanceChain.sourceHeaderSha256,b.provenanceChain.sourceHeaderSha256);
});

test("500 Hz source resampling preserves synthetic interval arithmetic", () => {
  const a = runFor({rateHz:250,allLeads:true},configFor(250));
  const b = runFor({rateHz:500,allLeads:true},configFor(500));
  const ma = metricMap(a), mb = metricMap(b);
  for (const key of ["pr","qrs","qt","rr","ventricular_rate"])
    assert.strictEqual(mb.get(key),ma.get(key),key);
  assert.strictEqual(b.preprocessing.sourceSamplingRateHz,500);
  assert.strictEqual(b.preprocessing.targetSamplingRateHz,250);
  assert.strictEqual(b.preprocessing.resampling.method,"linear-v1");
});
test("flat non-primary leads are categorized rather than silently discarded", () => {
  const out = runFor({allLeads:false});
  assert.strictEqual(out.multiLeadAnalysis.failureAccounting.attempted,12);
  assert.strictEqual(out.multiLeadAnalysis.failureAccounting.processed,1);
  assert.strictEqual(out.multiLeadAnalysis.failureAccounting.skipped,11);
  assert.deepStrictEqual(out.multiLeadAnalysis.processedLeads,["II"]);
  assert.strictEqual(Object.values(out.multiLeadAnalysis.failureAccounting.skipReasons).reduce((a,b)=>a+b,0),11);
});

test("pipeline output is byte-deterministic for identical inputs", () => {
  const a = runFor({allLeads:true}), b = runFor({allLeads:true});
  assert.strictEqual(JSON.stringify(a),JSON.stringify(b));
  assert.strictEqual(a.provenanceChain.executionConfigSha256,b.provenanceChain.executionConfigSha256);
});

test("source byte mutation changes source hash without rebinding configuration", () => {
  const wfdb = syntheticWfdb({allLeads:true});
  const config = configFor(250);
  const a = runExecutableEcgPipeline({headerText:wfdb.header,dataBuffer:wfdb.data,config,provenance:PROVENANCE});
  const changed = Buffer.from(wfdb.data); changed[0] = changed[0] ^ 1;
  const b = runExecutableEcgPipeline({headerText:wfdb.header,dataBuffer:changed,config,provenance:PROVENANCE});
  assert.notStrictEqual(a.provenanceChain.sourceDataSha256,b.provenanceChain.sourceDataSha256);
  assert.strictEqual(a.provenanceChain.executionConfigSha256,b.provenanceChain.executionConfigSha256);
});
test("canonical configuration hashing ignores object key order", () => {
  assert.strictEqual(hashObject({b:2,a:{y:true,x:1}}),hashObject({a:{x:1,y:true},b:2}));
  const cyclic = {}; cyclic.self = cyclic;
  assert.throws(()=>stableJson(cyclic),/EXECUTION_CONFIG_CYCLE/);
  assert.throws(()=>stableJson({x:Infinity}),/EXECUTION_CONFIG_NONFINITE/);
});

test("execution provenance is mandatory and cannot claim authority", () => {
  const wfdb = syntheticWfdb({allLeads:true}), config = configFor(250);
  assert.throws(()=>runExecutableEcgPipeline({headerText:wfdb.header,dataBuffer:wfdb.data,config,provenance:{locator:"x"}}),/EXECUTION_SOURCE_KIND_REQUIRED/);
  assert.throws(()=>runExecutableEcgPipeline({headerText:wfdb.header,dataBuffer:wfdb.data,config,provenance:{sourceKind:"x"}}),/EXECUTION_SOURCE_LOCATOR_REQUIRED/);
  assert.throws(()=>runExecutableEcgPipeline({headerText:wfdb.header,dataBuffer:wfdb.data,config,provenance:{...PROVENANCE,runtimeAuthority:true}}),/EXECUTION_RUNTIME_AUTHORITY_FORBIDDEN/);
  assert.throws(()=>runExecutableEcgPipeline({headerText:wfdb.header,dataBuffer:wfdb.data,config,provenance:{...PROVENANCE,projectGold:true}}),/EXECUTION_PROJECT_GOLD_FORBIDDEN/);
});

test("known but unusable primary lead fails distinctly from unknown lead", () => {
  assert.throws(()=>runFor({allLeads:false},{...configFor(250),leadName:"V1"}),/EXECUTION_PRIMARY_LEAD_UNUSABLE/);
  assert.throws(()=>runFor({allLeads:false},{...configFor(250),leadName:"V99"}),/EXECUTION_LEAD_NOT_FOUND/);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-executable-signal-pipeline-hardening-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",metrics:"NOT_REPORTABLE",clinicalAuthorityAdded:false}));
