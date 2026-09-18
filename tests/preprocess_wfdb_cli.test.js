"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawnSync}=require("child_process");
const {createSyntheticFixture}=require("./synthetic_fixture");

let passed=0;
function test(name,fn){try{fn();passed++;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack||e}`);process.exitCode=1;}}

function setup(method="linear-v1"){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-preprocess-cli-"));
  createSyntheticFixture(dir);
  const config={requireCompleteTwelveLead:true,targetSamplingRateHz:250,segmentSamples:2500,resamplingMethod:method,remainderPolicy:"drop"};
  const configPath=path.join(dir,"config.json");
  fs.writeFileSync(configPath,JSON.stringify(config),"utf8");
  return {dir,header:path.join(dir,"00001_hr.hea"),data:path.join(dir,"00001_hr.dat"),configPath,out:path.join(dir,"out.json")};
}

function run(fx){
  const tool=path.resolve(__dirname,"../tools/preprocess_wfdb.js");
  return spawnSync(process.execPath,[tool,"--header",fx.header,"--data",fx.data,"--config",fx.configPath,"--source-id","synthetic-cli-record","--out",fx.out],{encoding:"utf8"});
}
test("CLI writes deterministic executable preprocessing artifact",()=>{
  const fx=setup();
  const runResult=run(fx);
  assert.strictEqual(runResult.status,0,runResult.stderr);
  assert.ok(fs.existsSync(fx.out));
  const artifact=JSON.parse(fs.readFileSync(fx.out,"utf8"));
  assert.strictEqual(artifact.schema,"ekg-signal-preprocessing-pipeline-v1");
  assert.strictEqual(artifact.canonicalLeadOrder.length,12);
  assert.strictEqual(artifact.resampling.required,true);
  assert.strictEqual(artifact.resampling.method,"linear-v1");
  assert.strictEqual(artifact.segments.length,1);
  assert.strictEqual(artifact.segments[0].leads[0].leadName,"I");
  assert.strictEqual(artifact.segments[0].leads[11].leadName,"V6");
  assert.strictEqual(artifact.sourceFiles.pathsEmbedded,false);
  assert.match(artifact.sourceFiles.headerSha256,/^[0-9a-f]{64}$/);
  assert.match(artifact.sourceFiles.dataSha256,/^[0-9a-f]{64}$/);
  assert.strictEqual(artifact.provenance.locator,"synthetic-cli-record");
});

test("CLI executes the foundation DSP profile through the operator path",()=>{
  const fx=setup();
  const config=JSON.parse(fs.readFileSync(fx.configPath,"utf8"));
  config.engineeringTransformProfile="foundation-pretraining-dsp-v1";
  fs.writeFileSync(fx.configPath,JSON.stringify(config),"utf8");
  const runResult=run(fx);
  assert.strictEqual(runResult.status,0,runResult.stderr);
  const artifact=JSON.parse(fs.readFileSync(fx.out,"utf8"));
  assert.strictEqual(artifact.segments[0].engineeringTransform.profileId,"foundation-pretraining-dsp-v1");
  assert.strictEqual(artifact.segments[0].engineeringTransform.lineNotchHz,50);
  assert.deepStrictEqual(artifact.segments[0].engineeringTransform.bandpassHz,[0.67,40]);
  assert.strictEqual(artifact.segments[0].leads[0].unit,"standardized");
  assert.strictEqual(artifact.runtimeAuthority,false);
  assert.strictEqual(artifact.metrics,"NOT_REPORTABLE");
});

test("CLI output omits local source paths and diagnostic authority",()=>{
  const fx=setup();
  const runResult=run(fx);
  assert.strictEqual(runResult.status,0,runResult.stderr);
  const text=fs.readFileSync(fx.out,"utf8");
  const artifact=JSON.parse(text);
  assert.strictEqual(text.includes(fx.dir),false);
  assert.strictEqual(artifact.runtimeAuthority,false);
  assert.strictEqual(artifact.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(artifact.metrics,"NOT_REPORTABLE");
  assert.strictEqual(artifact.activation,"NOT_ELIGIBLE");
});
test("CLI fails closed on unimplemented resampling method",()=>{
  const fx=setup("fft");
  const runResult=run(fx);
  assert.notStrictEqual(runResult.status,0);
  assert.match(runResult.stderr,/PREPROCESS_RESAMPLING_METHOD_UNIMPLEMENTED/);
  assert.strictEqual(fs.existsSync(fx.out),false);
});

test("CLI requires explicit source identity",()=>{
  const fx=setup();
  const tool=path.resolve(__dirname,"../tools/preprocess_wfdb.js");
  const runResult=spawnSync(process.execPath,[tool,"--header",fx.header,"--data",fx.data,"--config",fx.configPath],{encoding:"utf8"});
  assert.notStrictEqual(runResult.status,0);
  assert.match(runResult.stderr,/PREPROCESS_ARG_REQUIRED:source-id/);
});

if(process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-preprocess-wfdb-cli-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
