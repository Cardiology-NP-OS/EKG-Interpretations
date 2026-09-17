"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = p => JSON.parse(fs.readFileSync(path.join(root,p), "utf8").replace(/^\uFEFF/, ""));
const checkpoint = read("ECG_FIDUCIAL_DELINEATION_CHECKPOINT.json");
const capabilities = read("ECG_CAPABILITY_REGISTRY.json");
const donorRegistry = read("ECG_DONOR_REGISTRY.json");
const workflow = read("evaluation/protocols/WFDB_MEASUREMENT_WORKFLOW_CONTRACT.json");
let passed = 0;
const check = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

check("checkpoint remains anchored to accepted measurement main", () => {
  assert.strictEqual(checkpoint.parentMainCommit, "a926e53e1c2104ff423f7a6ffcf7e98810d22a4c");
  assert.strictEqual(checkpoint.parentMainTree, "a083fabf5be0035a669df396513bb860578c57c7");
});

check("delineation and measurement workflow implementations exist", () => {
  for (const p of checkpoint.implementation) assert.ok(fs.existsSync(path.join(root,p)), p);
  assert.ok(fs.existsSync(path.join(root,"lib/signal_measurement_pipeline.js")));
  assert.ok(fs.existsSync(path.join(root,"tools/measure_wfdb.js")));
});
check("canonical fiducial capability points to target-owned implementation", () => {
  const c = capabilities.capabilities.find(x => x.capability_id === "ECG-CAP-EVENT-FIDUCIAL-DELINEATION");
  assert.ok(c);
  assert.strictEqual(c.canonical_target_path, "lib/signal_delineation_contract.js");
  assert.strictEqual(c.implementation_status, "TARGET_OWNED_EVALUATION_IMPLEMENTATION");
  assert.strictEqual(c.runtime_status, "INACTIVE_EVALUATION_ONLY");
});

check("real workflow remains nonruntime and non-gold", () => {
  assert.strictEqual(workflow.authorityClass, "EVALUATION_NONRUNTIME");
  assert.strictEqual(workflow.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(workflow.evidenceAdmission, "NOT_ADMITTED");
  assert.strictEqual(workflow.projectGold, false);
  assert.strictEqual(workflow.metrics, "NOT_REPORTABLE");
  assert.strictEqual(workflow.activation, "NOT_ELIGIBLE");
});

check("donor harvesting remains paused at Donor 010", () => {
  assert.strictEqual(donorRegistry.completed_donors, 9);
  assert.strictEqual(donorRegistry.next_donor_id, "DONOR-010");
  assert.strictEqual(checkpoint.donorProgram.pausedFrontier, "DONOR-010");
});
check("governed clinical state remains unchanged", () => {
  assert.strictEqual(checkpoint.clinicalControlChanged, false);
  assert.strictEqual(checkpoint.clinicalAuthorityAdded, false);
  assert.strictEqual(checkpoint.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(checkpoint.evidenceAdmission, "NOT_ADMITTED");
  assert.strictEqual(checkpoint.approvedAdjudicatedGoldCount, 0);
  assert.strictEqual(checkpoint.metrics, "NOT_REPORTABLE");
  assert.strictEqual(checkpoint.activation, "NOT_ELIGIBLE");
  assert.strictEqual(checkpoint.clinicalValidity, "NOT_INFERRED");
});

check("implementation verification is exact and successful", () => {
  const v = checkpoint.verification;
  assert.strictEqual(v.implementationCandidateCommit, "54427eacf5d41b1376d0f86cf0f1d064eb89d534");
  assert.strictEqual(v.implementationCandidateTree, "0afe4fceb1f7091d52c25d6b2183333c28ce20d8");
  assert.strictEqual(v.candidateCiRunId, 35267257412);
  assert.strictEqual(v.candidateCiConclusion, "success");
  assert.strictEqual(v.independentVerification, "PASS");
  assert.strictEqual(v.independentDelineation, "12/12 PASS");
  assert.strictEqual(v.independentWorkflow, "7/7 PASS");
  assert.strictEqual(v.independentCheckpoint, "6/6 PASS");
  assert.strictEqual(v.independentFullTargetSuite, "PASS");
});
check("checkpoint status is stage-safe", () => {
  assert.ok(new Set(["VERIFIED_IMPLEMENTATION_EVIDENCE_BOUND","ACCEPTED_ON_MAIN"]).has(checkpoint.status));
});
console.log(JSON.stringify({
  schema: "ekg-fiducial-delineation-checkpoint-tests-v1",
  pass: true,
  passed,
  total: passed,
  diagnosticRuntime: "GOVERNED_INACTIVE",
  clinicalAuthorityAdded: false,
}));
