"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const fx = require("../evaluation/fixtures/SYNTHETIC_FIDUCIAL_DELINEATION.json");
const config = require("../evaluation/fixtures/SYNTHETIC_SIGNAL_INTELLIGENCE_CONFIG.json");
const { runMultiLeadSignalIntelligence } = require("../lib/multilead_signal_intelligence");
const { buildMultiLeadAnalysis } = require("../tools/analyze_wfdb_12lead");

const LEADS = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"];
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
function fill(samples, start, end, value) { for (let i=start; i<=end; i+=1) samples[i]=value; }
function baseWave(rPeaks) {
  const samples = Array(fx.sampleCount).fill(fx.baseline);
  const rel = fx.relativeFiducials, amp = fx.amplitudesMv;
  for (const rPeak of rPeaks) {
    fill(samples,rPeak+rel.pOnset,rPeak+rel.pOffset,amp.p); samples[rPeak+rel.pPeak]=amp.pPeak;
    fill(samples,rPeak+rel.qrsOnset,rPeak+rel.qrsOffset,amp.qrs); samples[rPeak]=amp.rPeak;
    fill(samples,rPeak+rel.tOnset,rPeak+rel.tOffset,amp.t); samples[rPeak+rel.tPeak]=amp.tPeak;
  }
  return samples;
}
function syntheticTwelveLead(rPeaks = fx.rPeaks, flatLead = null) {
  const waves = LEADS.map(lead => lead === flatLead ? Array(fx.sampleCount).fill(0) : baseWave(rPeaks));
  const header = [`synthetic12 12 ${fx.sampleRateHz} ${fx.sampleCount}`]
    .concat(LEADS.map(lead => `synthetic12.dat 16 1000.0(0)/mV 16 0 0 0 0 ${lead}`)).join("\n") + "\n";
  const data = Buffer.alloc(fx.sampleCount * LEADS.length * 2);
  for (let sample = 0; sample < fx.sampleCount; sample += 1) {
    for (let lead = 0; lead < LEADS.length; lead += 1) {
      data.writeInt16LE(Math.round(waves[lead][sample] * 1000), (sample * LEADS.length + lead) * 2);
    }
  }
  return { header, data };
}
const provenance = { sourceKind:"SYNTHETIC_FIXTURE", locator:"ECG-FIXTURE-MULTILEAD-V1" };
function run(wfdb, leadNames) {
  return runMultiLeadSignalIntelligence({
    headerText:wfdb.header, dataBuffer:wfdb.data, leadNames,
    measurementConfig:config.measurement, phenotypeConfig:config.phenotypes,
    thresholdAuthority:config.thresholdAuthority, provenance,
  });
}

test("all twelve synthetic leads execute through the accepted single-lead workflow", () => {
  const out = run(syntheticTwelveLead());
  assert.strictEqual(out.processedLeads.length, 12);
  assert.strictEqual(out.failureAccounting.skipped, 0);
  assert.deepStrictEqual(out.requestedLeads, LEADS);
  assert.ok(out.leadAnalyses.every(row => row.analysis.schema === "ekg-signal-intelligence-workflow-v1"));
});

test("irregular timing aggregates descriptive candidate evidence across leads", () => {
  const out = run(syntheticTwelveLead([100,300,550,850]));
  const row = out.candidateEvidence.find(x => x.candidateCode === "RR_IRREGULARITY");
  assert.strictEqual(row.state, "MULTILEAD_CANDIDATE_EVIDENCE_PRESENT");
  assert.strictEqual(row.supportingLeads.length, 12);
  assert.strictEqual(row.evidence.length, 12);
  assert.ok(row.evidence.every(x => x.configuredThreshold));
});

test("one unusable lead is categorized without discarding usable leads", () => {
  const out = run(syntheticTwelveLead(fx.rPeaks, "V6"));
  assert.strictEqual(out.failureAccounting.attempted, 12);
  assert.strictEqual(out.failureAccounting.processed, 11);
  assert.strictEqual(out.failureAccounting.skipped, 1);
  assert.strictEqual(out.failures[0].lead, "V6");
  assert.strictEqual(Object.values(out.failureAccounting.skipReasons).reduce((a,b)=>a+b,0), 1);
});

test("explicit lead subset is preserved and cross-lead consistency is quantified", () => {
  const out = run(syntheticTwelveLead(), ["II","V1","V5"]);
  assert.deepStrictEqual(out.processedLeads, ["II","V1","V5"]);
  assert.strictEqual(out.crossLeadConsistency.beatCount.count, 3);
  assert.strictEqual(out.crossLeadConsistency.beatCount.range, 0);
  assert.strictEqual(out.crossLeadConsistency.ventricularRateBpm.count, 3);
});

test("duplicate or unknown requested leads fail closed", () => {
  const wfdb = syntheticTwelveLead();
  assert.throws(() => run(wfdb,["II","II"]), /MULTILEAD_DUPLICATE_LEAD/);
  assert.throws(() => run(wfdb,["II","V99"]), /MULTILEAD_LEAD_NOT_FOUND/);
});

test("multilead output remains candidate evidence rather than diagnosis", () => {
  const out = run(syntheticTwelveLead());
  const text = JSON.stringify(out).toLowerCase();
  assert.strictEqual(out.runtimeAuthority, false);
  assert.strictEqual(out.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(out.metrics, "NOT_REPORTABLE");
  assert.strictEqual(out.diagnosticInterpretationIncluded, false);
  assert.strictEqual(text.includes('"diagnosis"'), false);
  assert.strictEqual(out.thresholdAuthority, config.thresholdAuthority);
});

test("CLI build binds source and config hashes without embedding local paths", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-multilead-build-"));
  const wfdb=syntheticTwelveLead();
  const hp=path.join(dir,"r.hea"),dp=path.join(dir,"r.dat"),cpth=path.join(dir,"c.json");
  fs.writeFileSync(hp,wfdb.header);fs.writeFileSync(dp,wfdb.data);fs.writeFileSync(cpth,JSON.stringify(config));
  const artifact=buildMultiLeadAnalysis({header:hp,data:dp,config:cpth,"source-id":"fixture:multi",leads:"II,V1,V5"});
  assert.deepStrictEqual(artifact.processedLeads,["II","V1","V5"]);
  assert.strictEqual(artifact.sourceFiles.pathsEmbedded,false);
  assert.strictEqual(JSON.stringify(artifact).includes(dir),false);
});

test("12-lead CLI writes a path-minimized structured artifact", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-multilead-cli-"));
  const wfdb=syntheticTwelveLead();
  const hp=path.join(dir,"r.hea"),dp=path.join(dir,"r.dat"),cpth=path.join(dir,"c.json"),op=path.join(dir,"out.json");
  fs.writeFileSync(hp,wfdb.header);fs.writeFileSync(dp,wfdb.data);fs.writeFileSync(cpth,JSON.stringify(config));
  const result=cp.spawnSync(process.execPath,[path.join(__dirname,"..","tools","analyze_wfdb_12lead.js"),
    "--header",hp,"--data",dp,"--config",cpth,"--source-id","fixture:cli12","--out",op],{encoding:"utf8"});
  assert.strictEqual(result.status,0,result.stderr);
  const artifact=JSON.parse(fs.readFileSync(op,"utf8"));
  assert.strictEqual(artifact.schema,"ekg-multilead-signal-intelligence-v1");
  assert.strictEqual(artifact.processedLeads.length,12);
  assert.strictEqual(artifact.sourceFiles.pathsEmbedded,false);
  assert.strictEqual(JSON.stringify(artifact).includes(dir),false);
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema:"ekg-multilead-signal-intelligence-tests-v1",
  pass:true,passed,total:passed,syntheticOnly:true,realCliSurfaceTested:true,
  diagnosticRuntime:"GOVERNED_INACTIVE",metrics:"NOT_REPORTABLE",clinicalAuthorityAdded:false,
}));
