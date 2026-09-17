"use strict";
const assert = require("assert");
const annotations = require("../evaluation/protocols/ANNOTATION_EVALUATION_CONTRACTS.json");
const catalog = require("../evaluation/datasets/ECG_DATASET_CATALOG.json");
const failures = require("../evaluation/failure_modes/FAILURE_MODE_CATALOG.json");
const benchmarks = require("../evaluation/benchmarks/BENCHMARK_CONTRACTS.json");
const {
  EVALUATION_GOVERNANCE, buildReproducibilityFingerprint, compareFeatureRows, computeBinaryMetrics,
  failureModeById, findDataset, harmonizeLabels, ingestAnnotations, perturbSignal,
  validateAnnotationContracts, validateBenchmarkPlan, validateDatasetBundle, validateDatasetCatalog,
} = require("../lib/evaluation_runtime");

let passed=0;
function test(name,fn){try{fn();passed+=1;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack||e}`);process.exitCode=1;}}

test("evaluation runtime governance is inactive and nonreportable",()=>{
  assert.strictEqual(EVALUATION_GOVERNANCE.runtimeAuthority,false);
  assert.strictEqual(EVALUATION_GOVERNANCE.metrics,"NOT_REPORTABLE");
  assert.strictEqual(EVALUATION_GOVERNANCE.projectGold,false);
});
test("annotation contract is executable and unique",()=>{
  const types=validateAnnotationContracts(annotations);
  assert.strictEqual(types.size,5);
  assert.ok(types.has("R_PEAK_EVENT"));
});
test("annotation ingestion preserves source provenance without gold promotion",()=>{
  const out=ingestAnnotations({
    type:"R_PEAK_EVENT",
    provenance:{source:"synthetic",locator:"fixture:rpeak"},
    annotations:[{recordId:"r1",sampleIndex:10},{recordId:"r1",sampleIndex:20,value:"beat"}],
  },annotations);
  assert.strictEqual(out.rows.length,2);
  assert.strictEqual(out.rows[0].annotationId,"r1:R_PEAK_EVENT:0");
  assert.strictEqual(out.projectGold,false);
  assert.strictEqual(out.runtimeAuthority,false);
});
test("annotation ingestion rejects unsupported types and invalid indices",()=>{
  assert.throws(()=>ingestAnnotations({type:"MAGIC",provenance:{source:"x",locator:"y"},annotations:[]},annotations),/EVAL_ANNOTATION_TYPE_UNSUPPORTED/);
  assert.throws(()=>ingestAnnotations({type:"R_PEAK_EVENT",provenance:{source:"x",locator:"y"},annotations:[{recordId:"r",sampleIndex:-1}]},annotations),/EVAL_ANNOTATION_SAMPLE_INDEX/);
});
test("canonical dataset catalog executes through exact validation",()=>{
  const out=validateDatasetCatalog(catalog);
  assert.strictEqual(out.datasetCount,74);
  assert.strictEqual(out.pass,true);
});
test("dataset lookup is exact and fail closed",()=>{
  const row=findDataset(catalog,"ECG-DATASET-AFDB");
  assert.strictEqual(row.datasetId,"ECG-DATASET-AFDB");
  assert.throws(()=>findDataset(catalog,"ECG-DATASET-NOT-REAL"),/EVAL_CATALOG_DATASET_NOT_FOUND/);
});
test("explicit label harmonization never invents unmapped semantics",()=>{
  assert.deepStrictEqual(harmonizeLabels(["A","B","A"],{A:"X",B:"Y"}),["X","Y","X"]);
  assert.throws(()=>harmonizeLabels(["A","C"],{A:"X"}),/EVAL_LABEL_UNMAPPED:C/);
});
test("binary evaluation metrics compute exactly but remain nonreportable",()=>{
  const out=computeBinaryMetrics({truth:[true,true,false,false],predictions:[true,false,true,false],projectGold:false,sourceLabelsAreProjectGold:false});
  assert.deepStrictEqual(out.counts,{tp:1,tn:1,fp:1,fn:1,total:4});
  assert.strictEqual(out.precision,0.5);
  assert.strictEqual(out.sensitivity,0.5);
  assert.strictEqual(out.f1,0.5);
  assert.strictEqual(out.accuracy,0.5);
  assert.strictEqual(out.reportable,false);
  assert.strictEqual(out.metrics,"NOT_REPORTABLE");
});
test("metric runtime rejects any project-gold elevation",()=>{
  assert.throws(()=>computeBinaryMetrics({truth:[true],predictions:[true],projectGold:true,sourceLabelsAreProjectGold:false}),/EVAL_METRIC_PROJECT_GOLD/);
  assert.throws(()=>computeBinaryMetrics({truth:[true],predictions:[true],projectGold:false,sourceLabelsAreProjectGold:true}),/EVAL_METRIC_SOURCE_LABEL_GOLD/);
});
test("failure mode lookup is executable and exact",()=>{
  const row=failureModeById(failures,"ECG-FAIL-PATIENT-LEAKAGE");
  assert.strictEqual(row.action,"FAIL_EVALUATION");
  assert.throws(()=>failureModeById(failures,"NOPE"),/EVAL_FAILURE_NOT_FOUND/);
});
test("benchmark plans require every declared contract requirement",()=>{
  const contract=benchmarks.contracts.find(x=>x.id==="ECG-EVAL-FEATURE-FAMILY");
  const out=validateBenchmarkPlan({contractId:contract.id,requirementsSatisfied:[...contract.requirements]},benchmarks);
  assert.strictEqual(out.pass,true);
  assert.strictEqual(out.reportable,false);
  assert.throws(()=>validateBenchmarkPlan({contractId:contract.id,requirementsSatisfied:contract.requirements.slice(1)},benchmarks),/EVAL_BENCHMARK_REQUIREMENT_MISSING/);
});
test("reproducibility fingerprint is deterministic and sensitive to config drift",()=>{
  const base={
    sourceCommit:"a".repeat(40),sourceTree:"b".repeat(40),seed:7,
    config:{mode:"synthetic",window:100},artifacts:{fixture:"c".repeat(64)},
    preprocessingContract:"linear-v1",
  };
  const one=buildReproducibilityFingerprint(base);
  const two=buildReproducibilityFingerprint(base);
  const changed=buildReproducibilityFingerprint({...base,config:{mode:"synthetic",window:101}});
  assert.strictEqual(one.fingerprintSha256,two.fingerprintSha256);
  assert.notStrictEqual(one.fingerprintSha256,changed.fingerprintSha256);
  assert.strictEqual(one.mutableRemoteResolution,false);
});
test("reproducibility fingerprint rejects malformed artifact hashes",()=>{
  assert.throws(()=>buildReproducibilityFingerprint({sourceCommit:"a".repeat(40),sourceTree:"b".repeat(40),seed:1,config:{},artifacts:{x:"bad"}}),/EVAL_REPRO_ARTIFACT_HASH/);
});
test("synthetic robustness transforms execute deterministically",()=>{
  assert.deepStrictEqual(perturbSignal([1,2,3],{method:"add-offset-v1",value:2}),[3,4,5]);
  assert.deepStrictEqual(perturbSignal([1,2,3],{method:"scale-v1",factor:2}),[2,4,6]);
  assert.deepStrictEqual(perturbSignal([1,2,3,4],{method:"mask-range-v1",start:1,end:3,fill:0}),[1,0,0,4]);
  assert.deepStrictEqual(perturbSignal([1,2,3,4],{method:"crop-v1",start:1,end:3}),[2,3]);
  assert.deepStrictEqual(perturbSignal([1,2,3],{method:"deterministic-additive-noise-v1",noise:[0.1,-0.1,0.2]}),[1.1,1.9,3.2]);
});
test("robustness transforms reject unknown methods and malformed noise",()=>{
  assert.throws(()=>perturbSignal([1,2,3],{method:"magic"}),/EVAL_ROBUST_METHOD_UNIMPLEMENTED/);
  assert.throws(()=>perturbSignal([1,2,3],{method:"deterministic-additive-noise-v1",noise:[1]}),/EVAL_ROBUST_NOISE_LENGTH/);
});

test("dataset bundle validation executes split leakage controls",()=>{
  const descriptor=catalog.entries.find(x=>x.datasetId==="ECG-DATASET-AFDB");
  const split={records:[{recordId:"r1",patientId:"p1",split:"train"},{recordId:"r2",patientId:"p2",split:"test"}],sourceLabelsAreProjectGold:false,projectGold:false};
  const out=validateDatasetBundle(descriptor,split);
  assert.strictEqual(out.pass,true);
  assert.strictEqual(out.split.patientLeakageDetected,false);
});
test("feature benchmark runs on exact cohort intersection and stays nonreportable",()=>{
  const out=compareFeatureRows({reference:[{recordId:"a",features:{x:1,y:2}},{recordId:"b",features:{x:2,y:4}}],candidate:[{recordId:"a",features:{x:2,y:2}},{recordId:"b",features:{x:4,y:null}},{recordId:"c",features:{x:9,y:9}}],featureNames:["x","y"]});
  assert.strictEqual(out.sameRecordCohortCount,2);
  assert.deepStrictEqual(out.missingReferenceRecords,["c"]);
  assert.strictEqual(out.features.x.mae,1.5);
  assert.strictEqual(out.features.y.count,1);
  assert.strictEqual(out.features.y.missing,1);
  assert.strictEqual(out.reportable,false);
});
test("feature benchmark rejects duplicate and disjoint cohorts",()=>{
  assert.throws(()=>compareFeatureRows({reference:[{recordId:"a",features:{x:1}},{recordId:"a",features:{x:2}}],candidate:[{recordId:"a",features:{x:1}}],featureNames:["x"]}),/EVAL_FEATURE_DUPLICATE_REFERENCE/);
  assert.throws(()=>compareFeatureRows({reference:[{recordId:"a",features:{x:1}}],candidate:[{recordId:"b",features:{x:1}}],featureNames:["x"]}),/EVAL_FEATURE_NO_COHORT_INTERSECTION/);
});

if(process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema:"ekg-evaluation-runtime-tests-v1",pass:true,passed,total:passed,
  syntheticOnly:true,metrics:"NOT_REPORTABLE",diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false,
}));
