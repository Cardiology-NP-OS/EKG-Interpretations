"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {LOADER_GOVERNANCE,loadLocalDatasetRecord,safeRelativeFile,sha256,validateLocalDatasetManifest}=require("../lib/local_dataset_loader");
let passed=0;
function test(name,fn){try{fn();passed+=1;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack||e}`);process.exitCode=1;}}
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-dataset-loader-"));
  const header=Buffer.from("rec 1 100 2\nrec.dat 16 1000(0)/mV 16 0 0 0 0 I\n","utf8");
  const data=Buffer.alloc(4);data.writeInt16LE(1000,0);data.writeInt16LE(2000,2);
  fs.writeFileSync(path.join(root,"rec.hea"),header);fs.writeFileSync(path.join(root,"rec.dat"),data);
  const manifest={datasetId:"ECG-DATASET-SYNTHETIC",projectGold:false,sourceLabelsAreProjectGold:false,records:[{
    recordId:"rec",patientId:"p1",split:"test",headerFile:"rec.hea",dataFile:"rec.dat",
    headerBytes:header.length,dataBytes:data.length,headerSha256:sha256(header),dataSha256:sha256(data),
  }]};
  return {root,header,data,manifest};
}
test("loader governance remains nonclinical",()=>{
  assert.strictEqual(LOADER_GOVERNANCE.runtimeAuthority,false);assert.strictEqual(LOADER_GOVERNANCE.metrics,"NOT_REPORTABLE");
});test("manifest validates exact local record identity",()=>{
  const fx=fixture();const out=validateLocalDatasetManifest(fx.manifest);assert.strictEqual(out.records.length,1);assert.strictEqual(out.datasetId,"ECG-DATASET-SYNTHETIC");
});
test("record loading verifies bytes and hashes before return",()=>{
  const fx=fixture();const out=loadLocalDatasetRecord(fx.root,fx.manifest,"rec");
  assert.strictEqual(out.recordId,"rec");assert.strictEqual(out.dataBuffer.length,4);assert.strictEqual(out.sourceFiles.pathsAreManifestRelative,true);
  assert.strictEqual(out.runtimeAuthority,false);
});
test("absolute and traversal paths fail closed",()=>{
  assert.throws(()=>safeRelativeFile("../rec.dat"),/DATASET_LOADER_PATH_TRAVERSAL/);
  assert.throws(()=>safeRelativeFile("C:\\tmp\\rec.dat"),/DATASET_LOADER_ABSOLUTE_PATH/);
});
test("patient leakage across splits fails manifest validation",()=>{
  const fx=fixture();const r={...fx.manifest.records[0],recordId:"rec2",headerFile:"x.hea",dataFile:"x.dat",split:"train"};
  assert.throws(()=>validateLocalDatasetManifest({...fx.manifest,records:[fx.manifest.records[0],r]}),/EVAL_SPLIT_PATIENT_LEAKAGE/);
});
test("duplicate record identifiers fail closed",()=>{
  const fx=fixture();assert.throws(()=>validateLocalDatasetManifest({...fx.manifest,records:[fx.manifest.records[0],{...fx.manifest.records[0]}]}),/DATASET_LOADER_DUPLICATE_RECORD/);
});test("record byte drift fails exact hash verification",()=>{
  const fx=fixture();fs.writeFileSync(path.join(fx.root,"rec.dat"),Buffer.from([1,2,3,4]));
  assert.throws(()=>loadLocalDatasetRecord(fx.root,fx.manifest,"rec"),/DATASET_LOADER_DATA_HASH_MISMATCH/);
});
test("record byte-count drift fails before hash comparison",()=>{
  const fx=fixture();fs.writeFileSync(path.join(fx.root,"rec.dat"),Buffer.from([1,2]));
  assert.throws(()=>loadLocalDatasetRecord(fx.root,fx.manifest,"rec"),/DATASET_LOADER_DATA_BYTE_COUNT_MISMATCH/);
});
test("unknown record fails closed",()=>{
  const fx=fixture();assert.throws(()=>loadLocalDatasetRecord(fx.root,fx.manifest,"missing"),/DATASET_LOADER_RECORD_NOT_FOUND/);
});
test("manifest cannot claim project gold",()=>{
  const fx=fixture();assert.throws(()=>validateLocalDatasetManifest({...fx.manifest,projectGold:true}),/DATASET_LOADER_PROJECT_GOLD/);
});
if(process.exitCode)process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-local-dataset-loader-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
