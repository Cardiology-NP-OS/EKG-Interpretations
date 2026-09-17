"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"../..");
const {GOVERNANCE,validateDatasetDescriptor,validateEvaluationFixture,validateSplitManifest}=require(path.join(root,"lib/evaluation_contract"));
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8").replace(/^\uFEFF/,""));
let passed=0; const check=(name,fn)=>{fn(); passed++; console.log(`PASS ${name}`);};
check("governance constants remain non-authoritative",()=>{
  assert.deepStrictEqual(GOVERNANCE,{projectGold:false,sourceLabelsAreProjectGold:false,runtimeAuthority:false,clinicalValidityInferred:false});
});
check("canonical dataset descriptor validates with exact provenance",()=>{
  const catalog=readJson("evaluation/datasets/ECG_DATASET_CATALOG.json");
  const d=catalog.entries.find(x=>x.datasetId==="ECG-DATASET-PTBXL")||catalog.entries[0];
  assert.strictEqual(validateDatasetDescriptor(d),true);
});
check("clean patient split passes with zero leakage",()=>{
  const f=readJson("evaluation/fixtures/patient_split_clean.json");
  assert.strictEqual(validateEvaluationFixture(f),true);
  const out=validateSplitManifest(f);
  assert.strictEqual(out.pass,true);
  assert.strictEqual(out.patientLeakageDetected,false);
  assert.strictEqual(out.projectGold,false);
});
check("patient identity crossing splits fails closed",()=>{
  const f=readJson("evaluation/fixtures/patient_split_leakage.json");
  assert.throws(()=>validateSplitManifest(f),/EVAL_SPLIT_PATIENT_LEAKAGE/);
});
check("duplicate records fail closed",()=>{
  const f=readJson("evaluation/fixtures/patient_split_clean.json");
  f.records.push({...f.records[0]});
  assert.throws(()=>validateSplitManifest(f),/EVAL_SPLIT_DUPLICATE_RECORD/);
});
check("source labels cannot be promoted to project gold",()=>{
  const f=readJson("evaluation/fixtures/patient_split_clean.json");
  f.sourceLabelsAreProjectGold=true;
  assert.throws(()=>validateSplitManifest(f),/EVAL_SPLIT_SOURCE_LABEL_GOLD/);
});
check("evaluation fixtures carry provenance",()=>{
  for(const name of fs.readdirSync(path.join(root,"evaluation/fixtures")).filter(x=>x.endsWith(".json"))){
    const f=readJson(`evaluation/fixtures/${name}`);
    assert.strictEqual(validateEvaluationFixture(f),true);
    assert.strictEqual(f.projectGold,false);
    assert.strictEqual(f.runtimeAuthority,false);
  }
});
console.log(JSON.stringify({schema:"ekg-evaluation-contract-tests-v1",pass:true,passed,total:passed,diagnostic_runtime:"GOVERNED_INACTIVE",approved_adjudicated_gold_count:0,metrics:"NOT_REPORTABLE",clinical_authority_added:false}));
