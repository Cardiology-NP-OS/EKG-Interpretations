"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8").replace(/^\uFEFF/,""));
const checkpoint=read("ECG_PRECLINICAL_VALIDATION_CHECKPOINT.json");
const donors=read("ECG_DONOR_REGISTRY.json");
const image=read("ECG_IMAGE_INTAKE_CHECKPOINT.json");
const receipt=read("donors/heartwise-ai_ecg-tokenizer/DONOR_RECEIPT.json");
let passed=0;
const check=(name,fn)=>{fn();passed++;console.log("PASS "+name)};

check("checkpoint binds exact accepted main SHA tree and CI",()=>{
  assert.strictEqual(checkpoint.frozen_engineering_basis.commit,"32e74373523512c3fcf3921fcb8e2501b8ea2bbb");
  assert.strictEqual(checkpoint.frozen_engineering_basis.tree,"8134669d78b125adbca7d68c3e1f52c7fce63603");
  assert.strictEqual(checkpoint.frozen_engineering_basis.exact_main_ci_run_id,35542758154);
  assert.strictEqual(checkpoint.frozen_engineering_basis.exact_main_ci_conclusion,"success");
});

check("donor frontier is accepted and sequential",()=>{
  const d14=donors.donors.find(d=>d.donor_id==="DONOR-014");
  assert.ok(d14);
  assert.strictEqual(d14.status,"ACCEPTED_ON_MAIN");
  assert.strictEqual(donors.completed_donors,14);
  assert.strictEqual(donors.required_donor_count,21);
  assert.strictEqual(donors.next_donor_id,"DONOR-015");
  assert.strictEqual(receipt.acceptance_state,"ACCEPTED_ON_MAIN_POST_PROMOTION_CI");
});

check("image stack is integrated but real clinical validation remains false",()=>{
  const p=image.proofBoundary;
  for(const key of [
    "jpegFullChainThroughImmutableAnalysisVerified",
    "automaticPerspectiveCornerDetectionImplemented",
    "automaticLeadIdentityVerificationImplemented",
    "traceBaselineEstimationImplemented",
    "simultaneousLeadComparisonPerformed"
  ]) assert.strictEqual(p[key],true,key);
  assert.strictEqual(p.realClinicalImageValidationEstablished,false);
  assert.strictEqual(p.realClinicalVoltageAccuracyEstablished,false);
  assert.strictEqual(p.clinicalPerformanceClaimed,false);
  assert.strictEqual(p.clinicalValidityInferred,false);
});

check("checkpoint cannot silently claim clinical authority",()=>{
  const s=checkpoint.clinical_validation_state;
  assert.strictEqual(s.clinical_accuracy_testing_started,false);
  assert.strictEqual(s.clinical_accuracy_claimed,false);
  assert.strictEqual(s.clinical_validity_inferred,false);
  assert.strictEqual(s.approved_adjudicated_gold_count,0);
  assert.strictEqual(s.diagnostic_runtime,"GOVERNED_INACTIVE");
  assert.strictEqual(s.evidence_admission,"NOT_ADMITTED");
  assert.strictEqual(s.metrics,"NOT_REPORTABLE");
  assert.strictEqual(s.activation,"NOT_ELIGIBLE");
});

check("evaluation controls require leakage discipline and immutable evidence",()=>{
  const req=checkpoint.mandatory_evaluation_controls.join("\n");
  assert.match(req,/frozen target commit\/tree/i);
  assert.match(req,/record hashes/i);
  assert.match(req,/patient leakage/i);
  assert.match(req,/before inspecting final test results/i);
  assert.match(req,/confidence intervals/i);
  assert.match(req,/failures and abstentions/i);
  assert.match(req,/separate governed evidence-admission decision/i);
});

console.log(JSON.stringify({
  schema:"ekg-preclinical-validation-checkpoint-tests-v2",
  pass:true,passed,total:passed,
  clinicalAccuracyClaimed:false,
  metrics:checkpoint.clinical_validation_state.metrics,
  runtime:checkpoint.clinical_validation_state.diagnostic_runtime
}));
