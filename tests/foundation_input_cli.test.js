"use strict";
const assert=require("assert"),fs=require("fs"),os=require("os"),path=require("path");
const {spawnSync}=require("child_process");
const {createSyntheticFixture}=require("./synthetic_fixture");
let passed=0;function test(n,f){try{f();passed++;console.log("PASS "+n);}catch(e){console.error("FAIL "+n+": "+(e.stack||e));process.exitCode=1;}}
function setup(rate=100){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-foundation-cli-"));createSyntheticFixture(dir);
  const config={requireCompleteTwelveLead:true,targetSamplingRateHz:rate,segmentSamples:500,resamplingMethod:"linear-v1",remainderPolicy:"drop"};
  const spec={profileId:"foundation-representation-12lead-100hz-5s-v1",packing:"lead-major-contiguous-v1",inputSampleRateHz:100,windowSeconds:5,samplesPerLead:500,leadCount:12,leadOrder:["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"],vectorLength:6000,compatibility:"GEOMETRY_COMPATIBLE_NOT_DONOR_BYTE_EXACT"};
  const cp=path.join(dir,"config.json"),sp=path.join(dir,"spec.json"),out=path.join(dir,"out.json");
  fs.writeFileSync(cp,JSON.stringify(config));fs.writeFileSync(sp,JSON.stringify(spec));
  return{dir,header:path.join(dir,"00001_hr.hea"),data:path.join(dir,"00001_hr.dat"),cp,sp,out};
}
function run(fx){const tool=path.resolve(__dirname,"../tools/prepare_foundation_input.js");return spawnSync(process.execPath,[tool,"--header",fx.header,"--data",fx.data,"--config",fx.cp,"--spec",fx.sp,"--source-id","synthetic-foundation-record","--segment-index","0","--out",fx.out],{encoding:"utf8"});}
test("WFDB operator produces deterministic 6000-value foundation vector",()=>{const fx=setup(),r=run(fx);assert.strictEqual(r.status,0,r.stderr);const x=JSON.parse(fs.readFileSync(fx.out));assert.strictEqual(x.vectorLength,6000);assert.strictEqual(x.inputSampleRateHz,100);assert.strictEqual(x.windowSeconds,5);assert.strictEqual(x.profileId,"foundation-representation-12lead-100hz-5s-v1");assert.strictEqual(x.compatibility,"GEOMETRY_COMPATIBLE_NOT_DONOR_BYTE_EXACT");assert.match(x.vectorSha256,/^[0-9a-f]{64}$/);assert.strictEqual(x.runtimeAuthority,false);});
test("operator is deterministic for identical source bytes",()=>{const fx=setup();assert.strictEqual(run(fx).status,0);const a=JSON.parse(fs.readFileSync(fx.out));assert.strictEqual(run(fx).status,0);const b=JSON.parse(fs.readFileSync(fx.out));assert.strictEqual(a.vectorSha256,b.vectorSha256);assert.deepStrictEqual(a.values,b.values);});
test("operator output does not embed local source paths",()=>{const fx=setup();assert.strictEqual(run(fx).status,0);const text=fs.readFileSync(fx.out,"utf8"),x=JSON.parse(text);assert.strictEqual(text.includes(fx.dir),false);assert.strictEqual(x.sourceFiles.pathsEmbedded,false);assert.strictEqual(x.projectGold,false);});
test("sample-rate mismatch fails closed",()=>{const fx=setup(125),r=run(fx);assert.notStrictEqual(r.status,0);assert.match(r.stderr,/FOUNDATION_ADAPTER_PIPELINE_SAMPLE_RATE/);assert.strictEqual(fs.existsSync(fx.out),false);});
test("missing source identity fails closed",()=>{const fx=setup(),tool=path.resolve(__dirname,"../tools/prepare_foundation_input.js"),r=spawnSync(process.execPath,[tool,"--header",fx.header,"--data",fx.data,"--config",fx.cp,"--spec",fx.sp],{encoding:"utf8"});assert.notStrictEqual(r.status,0);assert.match(r.stderr,/FOUNDATION_INPUT_ARG_REQUIRED:source-id/);});
if(process.exitCode)process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-foundation-input-cli-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
