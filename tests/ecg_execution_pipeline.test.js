"use strict";
const assert = require("assert");
const fx = require("../evaluation/fixtures/SYNTHETIC_FIDUCIAL_DELINEATION.json");
const config = require("../evaluation/fixtures/SYNTHETIC_EXECUTABLE_PIPELINE_CONFIG.json");
const { runExecutableEcgPipeline, EXECUTION_GOVERNANCE } = require("../lib/ecg_execution_pipeline");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
const leads = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
function fill(values, start, end, value) { for (let i = start; i <= end; i += 1) values[i] = value; }
function synthetic12(rPeaks = fx.rPeaks) {
  const leadII = Array(fx.sampleCount).fill(fx.baseline);
  const rel = fx.relativeFiducials, amp = fx.amplitudesMv;
  for (const rPeak of rPeaks) {
    fill(leadII, rPeak + rel.pOnset, rPeak + rel.pOffset, amp.p);
    leadII[rPeak + rel.pPeak] = amp.pPeak;
    fill(leadII, rPeak + rel.qrsOnset, rPeak + rel.qrsOffset, amp.qrs);
    leadII[rPeak] = amp.rPeak;
    fill(leadII, rPeak + rel.tOnset, rPeak + rel.tOffset, amp.t);
    leadII[rPeak + rel.tPeak] = amp.tPeak;
  }
  const record = "synthetic12";
  const header = [`${record} 12 ${fx.sampleRateHz} ${fx.sampleCount}`]
    .concat(leads.map(lead => `${record}.dat 16 1000.0(0)/mV 16 0 0 0 0 ${lead}`)).join("\n") + "\n";
  const data = Buffer.alloc(leads.length * fx.sampleCount * 2);
  for (let sample = 0; sample < fx.sampleCount; sample += 1) {
    for (let leadIndex = 0; leadIndex < leads.length; leadIndex += 1) {
      const value = leads[leadIndex] === "II" ? leadII[sample] : 0;
      data.writeInt16LE(Math.round(value * 1000), (sample * leads.length + leadIndex) * 2);
    }
  }
  return { header, data };
}
const provenance = Object.freeze({
  sourceKind: "SYNTHETIC_EXECUTABLE_PIPELINE_TEST",
  locator: "ECG-FIXTURE-SYNTHETIC-EXECUTABLE-PIPELINE-V1",
});
function run(effectiveConfig = config, rPeaks = fx.rPeaks) {
  const wfdb = synthetic12(rPeaks);
  return runExecutableEcgPipeline({
    headerText: wfdb.header,
    dataBuffer: wfdb.data,
    config: effectiveConfig,
    provenance,
  });
}
test("twelve-lead executable stack composes every accepted stage", () => {
  const out = run();
  assert.strictEqual(out.schema, "ekg-executable-signal-pipeline-v1");
  assert.deepStrictEqual(out.preprocessing.canonicalLeadOrder, leads);
  assert.strictEqual(out.measurement.schema, "ekg-waveform-measurement-pipeline-v1");
  assert.strictEqual(out.features.schema, "ekg-rhythm-feature-set-v1");
  assert.strictEqual(out.candidatePhenotypes.schema, "ekg-candidate-phenotype-set-v1");
  assert.strictEqual(out.rendering.schema, "ekg-waveform-render-v1");
  assert.strictEqual(out.rendering.leadCount, 12);
  assert.strictEqual(out.runtimeAuthority, false);
});
test("accepted synthetic waveform preserves exact interval measurements", () => {
  const rows = new Map(run().measurement.intervalMeasurements.measurements.map(row => [row.metric, row.value]));
  assert.strictEqual(rows.get("pr"), fx.expectedMeasurements.prMs);
  assert.strictEqual(rows.get("qrs"), fx.expectedMeasurements.qrsMs);
  assert.strictEqual(rows.get("qt"), fx.expectedMeasurements.qtMs);
  assert.strictEqual(rows.get("rr"), fx.expectedMeasurements.rrMs);
  assert.strictEqual(rows.get("ventricular_rate"), fx.expectedMeasurements.ventricularRateBpm);
  assert.strictEqual(rows.get("qtc_bazett"), fx.expectedMeasurements.qtcBazettMs);
  assert.strictEqual(rows.get("qtc_fridericia"), fx.expectedMeasurements.qtcFridericiaMs);
});
test("regular synthetic timing keeps candidate outputs quiet", () => {
  const out = run();
  assert.ok(out.candidatePhenotypes.candidates.every(row => row.state === "CANDIDATE_NOT_DETECTED"));
  assert.strictEqual(JSON.stringify(out).toLowerCase().includes('"diagnosis"'), false);
});
test("irregular synthetic timing yields descriptive candidate evidence only", () => {
  const out = run(config, [100,300,550,850]);
  const row = out.candidatePhenotypes.candidates.find(item => item.phenotypeCode === "RR_IRREGULARITY");
  assert.strictEqual(row.state, "CANDIDATE_DETECTED");
  const text = JSON.stringify(out).toLowerCase();
  assert.strictEqual(text.includes("atrial fibrillation"), false);
  assert.strictEqual(text.includes('"diagnosis"'), false);
});
test("provenance chain binds source bytes and all executable configurations", () => {
  const out = run();
  for (const key of ["sourceHeaderSha256","sourceDataSha256","preprocessingConfigSha256","measurementConfigSha256","phenotypeConfigSha256"])
    assert.match(out.provenanceChain[key], /^[0-9a-f]{64}$/);
  assert.strictEqual(out.provenanceChain.thresholdAuthority, config.thresholdAuthority);
  assert.strictEqual(out.provenanceChain.projectGold, false);
  assert.strictEqual(out.provenanceChain.runtimeAuthority, false);
});
test("padded segments are rejected before measurement", () => {
  const changed = JSON.parse(JSON.stringify(config));
  changed.preprocessing.segmentSamples = 1200;
  changed.preprocessing.remainderPolicy = "zero-pad";
  assert.throws(() => run(changed), /EXECUTION_PADDED_SEGMENT_REJECTED/);
});
test("segment and lead selection fail closed", () => {
  const missingSegment = JSON.parse(JSON.stringify(config)); missingSegment.segmentIndex = 7;
  assert.throws(() => run(missingSegment), /EXECUTION_SEGMENT_NOT_FOUND/);
  const missingLead = JSON.parse(JSON.stringify(config)); missingLead.leadName = "V9";
  assert.throws(() => run(missingLead), /EXECUTION_LEAD_NOT_FOUND/);
});
test("threshold authority is mandatory", () => {
  const invalid = JSON.parse(JSON.stringify(config)); delete invalid.thresholdAuthority;
  assert.throws(() => run(invalid), /EXECUTION_THRESHOLD_AUTHORITY_REQUIRED/);
});
test("execution governance stays inactive and non-reportable", () => {
  assert.strictEqual(EXECUTION_GOVERNANCE.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(EXECUTION_GOVERNANCE.evidenceAdmission, "NOT_ADMITTED");
  assert.strictEqual(EXECUTION_GOVERNANCE.metrics, "NOT_REPORTABLE");
  assert.strictEqual(EXECUTION_GOVERNANCE.activation, "NOT_ELIGIBLE");
});
if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema:"ekg-executable-pipeline-tests-v1",pass:true,passed,total:passed,
  syntheticOnly:true,twelveLeadPathTested:true,diagnosticRuntime:"GOVERNED_INACTIVE",
  metrics:"NOT_REPORTABLE",clinicalAuthorityAdded:false
}));
