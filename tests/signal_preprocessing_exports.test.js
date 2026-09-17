"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createSyntheticFixture } = require("./synthetic_fixture");
const {
  executeWaveformPreprocessing,
  executeWaveformPreprocessingBatch,
  linearResample,
  sliceSegment,
} = require("../lib/signal_preprocessing_pipeline");

let passed=0;
function test(name,fn){try{fn();passed++;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack||e}`);process.exitCode=1;}}

const implementationProvenance={
  source:"Cardiology-NP-OS/EKG-Interpretations",
  locator:"lib/signal_preprocessing_pipeline.js",
  commit:"a".repeat(40),
  tree:"b".repeat(40),
};

function fixture(kind="hr"){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ekg-preprocess-export-"));
  createSyntheticFixture(dir);
  const stem=kind==="hr"?"00001_hr":"00001_lr";
  return {headerText:fs.readFileSync(path.join(dir,`${stem}.hea`),"utf8"),dataBuffer:fs.readFileSync(path.join(dir,`${stem}.dat`))};
}
test("single-window export executes calibrated reorder resample and segment",()=>{
  const out=executeWaveformPreprocessing({
    ...fixture("hr"),
    targetSamplingRateHz:250,
    segmentSamples:2500,
    segmentStartSample:0,
    resamplingMethod:"linear-v1",
    implementationProvenance,
  });
  assert.strictEqual(out.leads.length,12);
  assert.ok(out.leads.every(x=>x.samples.length===2500));
  assert.strictEqual(out.leads[0].leadName,"I");
  assert.strictEqual(out.leads[11].leadName,"V6");
  assert.strictEqual(out.contract.requiresResampling,true);
  assert.strictEqual(out.runtimeAuthority,false);
});

test("single-window export requires exact implementation provenance",()=>{
  const bad={...implementationProvenance}; delete bad.tree;
  assert.throws(()=>executeWaveformPreprocessing({
    ...fixture("lr"),targetSamplingRateHz:100,segmentSamples:1000,
    implementationProvenance:bad,
  }),/PREPROCESS_IMPLEMENTATION_PROVENANCE/);
});

test("batch export categorizes unsupported resampling without silent loss",()=>{
  const common={...fixture("hr"),targetSamplingRateHz:250,segmentSamples:2500,implementationProvenance};
  const batch=executeWaveformPreprocessingBatch([
    {...common,resamplingMethod:"linear-v1"},
    {...common,resamplingMethod:"not-implemented"},
  ]);
  assert.strictEqual(batch.failureAccounting.attempted,2);
  assert.strictEqual(batch.failureAccounting.processed,1);
  assert.strictEqual(batch.failureAccounting.skipped,1);
  assert.strictEqual(batch.failures[0].reason,"PREPROCESS_RESAMPLING_METHOD_UNIMPLEMENTED");
});
test("linear resample alias and slice helper are deterministic",()=>{
  assert.deepStrictEqual(linearResample([0,1,2,3],2,4),[0,0.5,1,1.5,2,2.5,3,3]);
  assert.deepStrictEqual(sliceSegment([0,1,2,3,4],1,3),[1,2,3]);
});

test("single-window segment bounds fail closed",()=>{
  assert.throws(()=>executeWaveformPreprocessing({
    ...fixture("lr"),targetSamplingRateHz:100,segmentSamples:1000,segmentStartSample:1,
    implementationProvenance,
  }),/PREPROCESS_SEGMENT_BOUNDS/);
});

test("export surfaces remain non-diagnostic and non-reportable",()=>{
  const out=executeWaveformPreprocessing({
    ...fixture("lr"),targetSamplingRateHz:100,segmentSamples:1000,
    implementationProvenance,
  });
  assert.strictEqual(out.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(out.evidenceAdmission,"NOT_ADMITTED");
  assert.strictEqual(out.projectGold,false);
  assert.strictEqual(out.metrics,"NOT_REPORTABLE");
  assert.strictEqual(out.activation,"NOT_ELIGIBLE");
  assert.strictEqual(out.clinicalValidityInferred,false);
});

if(process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-preprocessing-export-tests-v1",pass:true,passed,total:passed,syntheticOnly:true,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
