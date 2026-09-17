"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = p => JSON.parse(fs.readFileSync(path.join(root,p), "utf8").replace(/^\uFEFF/, ""));
const checkpoint = read("ECG_EXECUTABLE_PREPROCESSING_CHECKPOINT.json");
const registry = read("ECG_CAPABILITY_REGISTRY.json");
const donors = read("ECG_DONOR_REGISTRY.json");
const protocol = read("evaluation/protocols/EXECUTABLE_PREPROCESSING_CONTRACT.json");
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };
check("checkpoint is anchored to accepted delineation main", () => {
  assert.strictEqual(checkpoint.parentMainCommit, "5450bc23bfcab536a77f88ee28d4488a22c29204");
  assert.strictEqual(checkpoint.parentMainTree, "3dfea69a0f824fdfd3f589d42ad6a6e520a706dd");
});
check("preprocessing implementation and operator workflow exist", () => {
  for (const p of checkpoint.implementation) assert.ok(fs.existsSync(path.join(root,p)), p);
  assert.ok(fs.existsSync(path.join(root,"docs/WFDB_PREPROCESSING_WORKFLOW.md")));
});
check("four preprocessing capabilities now point to executable target code", () => {
  const ids = ["ECG-CAP-PREPROCESS-LEAD-ORDER","ECG-CAP-PREPROCESS-RESAMPLING","ECG-CAP-PREPROCESS-WINDOWING-SEGMENTATION","ECG-CAP-PREPROCESS-FAILURE-ACCOUNTING"];
  for (const id of ids) { const c=registry.capabilities.find(x=>x.capability_id===id); assert.ok(c,id); assert.strictEqual(c.canonical_target_path,"lib/signal_preprocessing_pipeline.js"); assert.strictEqual(c.implementation_status,"TARGET_OWNED_IMPLEMENTATION"); }
});
check("operator contract remains non-diagnostic and non-gold", () => {
  assert.strictEqual(protocol.authorityClass,"ENGINEERING_NONDIAGNOSTIC");
  assert.strictEqual(protocol.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(protocol.evidenceAdmission,"NOT_ADMITTED");
  assert.strictEqual(protocol.projectGold,false);
  assert.strictEqual(protocol.metrics,"NOT_REPORTABLE");
  assert.strictEqual(protocol.activation,"NOT_ELIGIBLE");
});
check("implementation candidate evidence is exact and successful", () => {
  assert.strictEqual(checkpoint.verification.implementationCandidateCommit,"c6a201a1e52e30a42dbcb7e374cf76f815acb333");
  assert.strictEqual(checkpoint.verification.implementationCandidateTree,"74e0a451c00d154d92b3c621e1412d9511fdc6c4");
  assert.strictEqual(checkpoint.verification.candidateCiRunId,35270514524);
  assert.strictEqual(checkpoint.verification.candidateCiConclusion,"success");
  assert.strictEqual(checkpoint.verification.independentVerification,"PASS_FULL_CLONE");
  assert.strictEqual(checkpoint.verification.independentFullTargetSuite,"PASS");
});
check("donor frontier remains paused at Donor 010", () => {
  assert.strictEqual(donors.completed_donors,9);
  assert.strictEqual(donors.next_donor_id,"DONOR-010");
  assert.strictEqual(checkpoint.donorProgram.pausedFrontier,"DONOR-010");
});
check("governed state remains inactive", () => {
  assert.strictEqual(checkpoint.clinicalControlChanged,false);
  assert.strictEqual(checkpoint.clinicalAuthorityAdded,false);
  assert.strictEqual(checkpoint.approvedAdjudicatedGoldCount,0);
  assert.strictEqual(checkpoint.clinicalValidity,"NOT_INFERRED");
});
assert.ok(["IMPLEMENTATION_CANDIDATE_UNVERIFIED","VERIFIED_IMPLEMENTATION_EVIDENCE_BOUND","ACCEPTED_ON_MAIN_POST_PROMOTION_CI"].includes(checkpoint.status));
passed += 1;
console.log("PASS checkpoint status is stage-safe");
console.log(JSON.stringify({schema:"ekg-executable-preprocessing-checkpoint-tests-v1",pass:true,passed,total:passed,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
