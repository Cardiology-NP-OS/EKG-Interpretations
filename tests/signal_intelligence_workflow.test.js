"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const fx = require("../evaluation/fixtures/SYNTHETIC_FIDUCIAL_DELINEATION.json");
const config = require("../evaluation/fixtures/SYNTHETIC_SIGNAL_INTELLIGENCE_CONFIG.json");
const { runSignalIntelligenceWorkflow, WORKFLOW_GOVERNANCE } = require("../lib/signal_intelligence_workflow");
const { buildAnalysis, parseArgs, sha256 } = require("../tools/analyze_wfdb");

let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
const provenance = Object.freeze({sourceKind:"SYNTHETIC_FIXTURE",locator:"ECG-FIXTURE-SIGNAL-INTELLIGENCE-V1"});
function fill(samples, start, end, value) { for (let i=start; i<=end; i+=1) samples[i]=value; }
function syntheticWfdb(rPeaks = fx.rPeaks) {
  const samples = Array(fx.sampleCount).fill(fx.baseline);
  const rel = fx.relativeFiducials;
  const amp = fx.amplitudesMv;
  for (const rPeak of rPeaks) {
    fill(samples, rPeak+rel.pOnset, rPeak+rel.pOffset, amp.p);
    samples[rPeak+rel.pPeak] = amp.pPeak;
    fill(samples, rPeak+rel.qrsOnset, rPeak+rel.qrsOffset, amp.qrs);
    samples[rPeak] = amp.rPeak;
    fill(samples, rPeak+rel.tOnset, rPeak+rel.tOffset, amp.t);
    samples[rPeak+rel.tPeak] = amp.tPeak;
  }
  const header = `synthetic 1 ${fx.sampleRateHz} ${fx.sampleCount}\n`+
    `synthetic.dat 16 1000.0(0)/mV 16 0 0 0 0 ${fx.lead}\n`;
  const data = Buffer.alloc(fx.sampleCount*2);
  samples.forEach((v,i)=>data.writeInt16LE(Math.round(v*1000),i*2));
  return {header,data};
}
function run(rPeaks = fx.rPeaks) {
  const wfdb = syntheticWfdb(rPeaks);
  return runSignalIntelligenceWorkflow({headerText:wfdb.header,dataBuffer:wfdb.data,leadName:fx.lead,
    measurementConfig:config.measurement,phenotypeConfig:config.phenotypes,provenance});
}
test("workflow composes measurement features and candidate phenotypes", () => {
  const out = run();
  assert.strictEqual(out.schema,"ekg-signal-intelligence-workflow-v1");
  assert.strictEqual(out.measurement.schema,"ekg-waveform-measurement-pipeline-v1");
  assert.strictEqual(out.features.schema,"ekg-rhythm-feature-set-v1");
  assert.strictEqual(out.candidatePhenotypes.schema,"ekg-candidate-phenotype-set-v1");
  assert.ok(out.candidatePhenotypes.candidates.every(x=>x.state==="CANDIDATE_NOT_DETECTED"));
  assert.strictEqual(out.runtimeAuthority,false);
  assert.strictEqual(out.diagnosticInterpretationIncluded,false);
});

test("irregular synthetic timing produces descriptive candidate only", () => {
  const out = run([100,300,550,850]);
  const row = out.candidatePhenotypes.candidates.find(x=>x.phenotypeCode==="RR_IRREGULARITY");
  assert.strictEqual(row.state,"CANDIDATE_DETECTED");
  const text = JSON.stringify(out).toLowerCase();
  assert.strictEqual(text.includes("atrial fibrillation"),false);
  assert.strictEqual(text.includes('"diagnosis"'),false);
});

test("workflow governance is nonruntime and non-gold", () => {
  assert.strictEqual(WORKFLOW_GOVERNANCE.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(WORKFLOW_GOVERNANCE.evidenceAdmission,"NOT_ADMITTED");
  assert.strictEqual(WORKFLOW_GOVERNANCE.metrics,"NOT_REPORTABLE");
  assert.strictEqual(WORKFLOW_GOVERNANCE.activation,"NOT_ELIGIBLE");
});
test("CLI argument contract rejects unsafe source identifiers", () => {
  assert.strictEqual(parseArgs(["--header","a.hea","--data","a.dat","--lead","II","--config","c.json","--source-id","fixture:001"])["source-id"],"fixture:001");
  assert.throws(()=>parseArgs(["--header","a.hea","--data","a.dat","--lead","II","--config","c.json","--source-id","../patient/path"]),/ANALYZE_SOURCE_ID_UNSAFE/);
});

test("buildAnalysis binds source and configuration hashes without paths", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),"ekg-intel-build-"));
  const wfdb = syntheticWfdb();
  const hp=path.join(dir,"record.hea"), dp=path.join(dir,"record.dat"), cp=path.join(dir,"config.json");
  fs.writeFileSync(hp,wfdb.header); fs.writeFileSync(dp,wfdb.data); fs.writeFileSync(cp,JSON.stringify(config));
  const artifact=buildAnalysis({header:hp,data:dp,lead:fx.lead,config:cp,"source-id":"fixture:build"});
  assert.strictEqual(artifact.sourceFiles.headerSha256,sha256(fs.readFileSync(hp)));
  assert.strictEqual(artifact.sourceFiles.dataSha256,sha256(fs.readFileSync(dp)));
  assert.strictEqual(artifact.sourceFiles.configSha256,sha256(fs.readFileSync(cp)));
  assert.strictEqual(artifact.configuration.thresholdAuthority,config.thresholdAuthority);
  assert.strictEqual(artifact.sourceFiles.pathsEmbedded,false);
  const text=JSON.stringify(artifact); assert.strictEqual(text.includes(dir),false);
});

test("analysis config requires an explicit threshold authority", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-intel-config-")); const wfdb=syntheticWfdb();
  const hp=path.join(dir,"r.hea"),dp=path.join(dir,"r.dat"),cp=path.join(dir,"c.json");
  fs.writeFileSync(hp,wfdb.header);fs.writeFileSync(dp,wfdb.data);fs.writeFileSync(cp,JSON.stringify({measurement:config.measurement,phenotypes:config.phenotypes}));
  assert.throws(()=>buildAnalysis({header:hp,data:dp,lead:fx.lead,config:cp,"source-id":"fixture:noauth"}),/ANALYZE_CONFIG_AUTHORITY_REQUIRED/);
});
test("CLI writes a structured path-minimized analysis artifact", () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-intel-cli-")); const wfdb=syntheticWfdb();
  const hp=path.join(dir,"record.hea"),dp=path.join(dir,"record.dat"),cp=path.join(dir,"config.json"),op=path.join(dir,"analysis.json");
  fs.writeFileSync(hp,wfdb.header);fs.writeFileSync(dp,wfdb.data);fs.writeFileSync(cp,JSON.stringify(config));
  const result=cpSpawn([path.join(__dirname,"..","tools","analyze_wfdb.js"),"--header",hp,"--data",dp,"--lead",fx.lead,"--config",cp,"--source-id","fixture:cli","--out",op]);
  assert.strictEqual(result.status,0,result.stderr);
  const artifact=JSON.parse(fs.readFileSync(op,"utf8"));
  assert.strictEqual(artifact.schema,"ekg-signal-intelligence-workflow-v1");
  assert.strictEqual(artifact.provenance.locator,"fixture:cli");
  assert.strictEqual(artifact.sourceFiles.pathsEmbedded,false);
  assert.strictEqual(JSON.stringify(artifact).includes(dir),false);
});

function cpSpawn(args) { return cp.spawnSync(process.execPath,args,{encoding:"utf8"}); }

test("unknown lead fails closed through the executable workflow", () => {
  const wfdb=syntheticWfdb();
  assert.throws(()=>runSignalIntelligenceWorkflow({headerText:wfdb.header,dataBuffer:wfdb.data,leadName:"V99",measurementConfig:config.measurement,phenotypeConfig:config.phenotypes,provenance}),/MEASURE_LEAD_NOT_FOUND/);
});

test("workflow requires explicit measurement and phenotype configurations", () => {
  const wfdb=syntheticWfdb();
  assert.throws(()=>runSignalIntelligenceWorkflow({headerText:wfdb.header,dataBuffer:wfdb.data,leadName:fx.lead,phenotypeConfig:config.phenotypes,provenance}),/INTELLIGENCE_MEASUREMENT_CONFIG_REQUIRED/);
  assert.throws(()=>runSignalIntelligenceWorkflow({headerText:wfdb.header,dataBuffer:wfdb.data,leadName:fx.lead,measurementConfig:config.measurement,provenance}),/INTELLIGENCE_PHENOTYPE_CONFIG_REQUIRED/);
});
if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema:"ekg-signal-intelligence-workflow-tests-v1",
  pass:true,
  passed,
  total:passed,
  syntheticOnly:true,
  realCliSurfaceTested:true,
  diagnosticRuntime:"GOVERNED_INACTIVE",
  metrics:"NOT_REPORTABLE",
  clinicalAuthorityAdded:false,
}));
