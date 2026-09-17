"use strict";
const assert=require("assert");
const {ASSET_GOVERNANCE,sha256,validateAssetLocator,validateModelAssetSpec,verifyModelAssetBytes}=require("../lib/model_asset_safety");
let passed=0;
function test(name,fn){try{fn();passed+=1;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack||e}`);process.exitCode=1;}}
const bytes=Buffer.from("synthetic-checkpoint-bytes","utf8");
function spec(overrides={}){return {
  checkpointId:"synthetic-model-v1",sha256:sha256(bytes),bytes:bytes.length,locator:"models/synthetic-model-v1.bin",
  codeLicense:"MIT",weightLicense:"TEST-ONLY",weightLicenseStatus:"APPROVED_INTERNAL_USE_ONLY",
  preprocessingContract:"synthetic-preprocess-v1",leads:["I","II"],sampleRateHz:500,durationSeconds:10,
  trainingPopulations:["SYNTHETIC_ONLY"],labels:["SYNTHETIC_LABEL"],validationEvidence:"SYNTHETIC_CONTRACT_ONLY",
  calibrationOrThresholdAssumptions:"EXPLICIT_TEST_ASSUMPTIONS",computeBurden:"CPU_TEST_ONLY",
  unsupportedPopulations:["ALL_REAL_CLINICAL_POPULATIONS"],reproducibilityLimits:"NO_EXTERNAL_VALIDATION",
  serializationPolicy:"IDENTITY_ONLY_NO_DESERIALIZATION",...overrides,
};}

test("asset governance remains challenger-only and inactive",()=>{
  assert.strictEqual(ASSET_GOVERNANCE.runtimeAuthority,false);
  assert.strictEqual(ASSET_GOVERNANCE.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(ASSET_GOVERNANCE.metrics,"NOT_REPORTABLE");
});
test("complete model asset metadata validates",()=>{
  const out=validateModelAssetSpec(spec()); assert.strictEqual(out.checkpointId,"synthetic-model-v1");
});test("exact bytes verify without deserialization",()=>{
  const out=verifyModelAssetBytes(spec(),bytes);
  assert.strictEqual(out.pass,true);
  assert.strictEqual(out.deserializationPerformed,false);
  assert.strictEqual(out.executionStatus,"IDENTITY_VERIFIED_CHALLENGER_ONLY");
});
test("hash and byte-count drift fail closed",()=>{
  assert.throws(()=>verifyModelAssetBytes(spec({sha256:"0".repeat(64)}),bytes),/MODEL_ASSET_HASH_MISMATCH/);
  assert.throws(()=>verifyModelAssetBytes(spec({bytes:bytes.length+1}),bytes),/MODEL_ASSET_BYTE_COUNT_MISMATCH/);
});
test("mutable remote acquisition is rejected",()=>{
  assert.throws(()=>validateAssetLocator("https://example.com/model.bin"),/MODEL_ASSET_MUTABLE_REMOTE_REJECTED/);
  assert.throws(()=>validateAssetLocator("s3://bucket/model.bin"),/MODEL_ASSET_MUTABLE_REMOTE_REJECTED/);
});
test("path traversal and absolute paths are rejected",()=>{
  assert.throws(()=>validateAssetLocator("../model.bin"),/MODEL_ASSET_LOCATOR_UNSAFE/);
  assert.throws(()=>validateAssetLocator("C:\\tmp\\model.bin"),/MODEL_ASSET_LOCATOR_UNSAFE/);
});
test("unsafe deserialization policy is rejected",()=>{
  assert.throws(()=>validateModelAssetSpec(spec({serializationPolicy:"torch.load"})),/MODEL_ASSET_UNSAFE_DESERIALIZATION_POLICY/);
});
test("unknown weight license blocks admission",()=>{
  assert.throws(()=>validateModelAssetSpec(spec({weightLicenseStatus:"LICENSE_REVIEW_REQUIRED"})),/MODEL_ASSET_WEIGHT_LICENSE_NOT_ADMITTED/);
});
test("missing model-boundary metadata fails closed",()=>{
  for(const [field,pattern] of [
    ["preprocessingContract",/MODEL_ASSET_PREPROCESSING_CONTRACT/],
    ["trainingPopulations",/MODEL_ASSET_TRAINING_POPULATIONS/],
    ["validationEvidence",/MODEL_ASSET_VALIDATION_EVIDENCE/],
    ["unsupportedPopulations",/MODEL_ASSET_UNSUPPORTED_POPULATIONS/],
    ["reproducibilityLimits",/MODEL_ASSET_REPRODUCIBILITY_LIMITS/],
  ]){
    const candidate=spec(); delete candidate[field]; assert.throws(()=>validateModelAssetSpec(candidate),pattern);
  }
});
test("sample rate and duration must be explicit positive values",()=>{
  assert.throws(()=>validateModelAssetSpec(spec({sampleRateHz:0})),/MODEL_ASSET_SAMPLE_RATE/);
  assert.throws(()=>validateModelAssetSpec(spec({durationSeconds:0})),/MODEL_ASSET_DURATION/);
});
test("verification surface contains no runtime or clinical authority",()=>{
  const out=verifyModelAssetBytes(spec(),bytes);
  assert.strictEqual(out.runtimeAuthority,false);
  assert.strictEqual(out.activation,"NOT_ELIGIBLE");
  assert.strictEqual(out.clinicalValidityInferred,false);
});
if(process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-model-asset-safety-tests-v1",pass:true,passed,total:passed,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
