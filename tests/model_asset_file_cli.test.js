"use strict";
const assert=require("assert");
const crypto=require("crypto");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {spawnSync}=require("child_process");

let passed=0;
function test(name,fn){try{fn();passed++;console.log("PASS "+name);}catch(e){console.error("FAIL "+name+": "+(e.stack||e));process.exitCode=1;}}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-model-asset-cli-"));
  const asset=path.join(dir,"checkpoint.bin");
  const bytes=Buffer.alloc(3*1024*1024+17);
  for(let i=0;i<bytes.length;i++) bytes[i]=(i*31+7)&255;
  fs.writeFileSync(asset,bytes);
  const sha256=crypto.createHash("sha256").update(bytes).digest("hex");
  const spec={
    checkpointId:"synthetic-large-model-v1",sha256,bytes:bytes.length,locator:"models/synthetic-large-model-v1.bin",
    codeLicense:"MIT",weightLicense:"TEST-ONLY",weightLicenseStatus:"APPROVED_INTERNAL_USE_ONLY",
    preprocessingContract:"synthetic-preprocess-v1",leads:["I"],sampleRateHz:500,durationSeconds:10,
    trainingPopulations:["SYNTHETIC_ONLY"],labels:["SYNTHETIC_LABEL"],validationEvidence:"SYNTHETIC_CONTRACT_ONLY",
    calibrationOrThresholdAssumptions:"NONE",computeBurden:"CPU_TEST_ONLY",
    unsupportedPopulations:["ALL_REAL_CLINICAL_POPULATIONS"],reproducibilityLimits:"NO_EXTERNAL_VALIDATION",
    serializationPolicy:"IDENTITY_ONLY_NO_DESERIALIZATION"
  };
  const specPath=path.join(dir,"spec.json"),out=path.join(dir,"verification.json");
  fs.writeFileSync(specPath,JSON.stringify(spec),"utf8");
  return {dir,asset,specPath,out,bytes,spec};
}
function run(fx){
  return spawnSync(process.execPath,[path.resolve(__dirname,"../tools/verify_model_asset.js"),"--spec",fx.specPath,"--asset",fx.asset,"--out",fx.out],{encoding:"utf8"});
}
test("streaming CLI verifies exact checkpoint identity without deserialization",()=>{
  const fx=fixture(),r=run(fx);
  assert.strictEqual(r.status,0,r.stderr);
  const out=JSON.parse(fs.readFileSync(fx.out,"utf8"));
  assert.strictEqual(out.pass,true);
  assert.strictEqual(out.streamedVerification,true);
  assert.strictEqual(out.deserializationPerformed,false);
  assert.strictEqual(out.sha256,fx.spec.sha256);
  assert.strictEqual(out.bytes,fx.bytes.length);
});
test("verification artifact never embeds the local checkpoint path",()=>{
  const fx=fixture(); assert.strictEqual(run(fx).status,0);
  const text=fs.readFileSync(fx.out,"utf8");
  assert.strictEqual(text.includes(fx.dir),false);
  assert.strictEqual(JSON.parse(text).localPathEmbedded,false);
});
test("byte tamper fails closed before any deserialization",()=>{
  const fx=fixture();
  const fd=fs.openSync(fx.asset,"r+");fs.writeSync(fd,Buffer.from([255]),0,1,100);fs.closeSync(fd);
  const r=run(fx);assert.notStrictEqual(r.status,0);assert.match(r.stderr,/MODEL_ASSET_HASH_MISMATCH/);assert.strictEqual(fs.existsSync(fx.out),false);
});
test("byte-count drift fails closed",()=>{
  const fx=fixture();fs.appendFileSync(fx.asset,Buffer.from([0]));
  const r=run(fx);assert.notStrictEqual(r.status,0);assert.match(r.stderr,/MODEL_ASSET_BYTE_COUNT_MISMATCH/);
});
test("CLI requires explicit spec and asset paths",()=>{
  const tool=path.resolve(__dirname,"../tools/verify_model_asset.js");
  const r=spawnSync(process.execPath,[tool,"--spec","x.json"],{encoding:"utf8"});
  assert.notStrictEqual(r.status,0);assert.match(r.stderr,/MODEL_ASSET_ARG_FORMAT|MODEL_ASSET_ARG_REQUIRED/);
});
if(process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-model-asset-file-cli-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
