"use strict";
const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checkpoint = require("../ECG_MULTILEAD_SIGNAL_INTELLIGENCE_CHECKPOINT.json");
const protocol = require("../evaluation/protocols/MULTILEAD_SIGNAL_INTELLIGENCE_CONTRACT.json");
const donorRegistry = require("../ECG_DONOR_REGISTRY.json");
const pkg = require("../package.json");
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

function ensureCommit(commit) {
  const probe=cp.spawnSync("git",["-C",root,"cat-file","-e",`${commit}^{commit}`],{encoding:"utf8"});
  if (probe.status===0) return;
  cp.execFileSync("git",["-C",root,"fetch","--no-tags","--depth=1","origin",commit],{stdio:"ignore"});
}

test("checkpoint is pinned to accepted executable preprocessing main", () => {
  assert.strictEqual(checkpoint.parentMainCommit,"13819fc70c8458d7f1c56a04367c7dee1308ca5a");
  assert.strictEqual(checkpoint.parentMainTree,"6a55696977baf8a98dc7049e6fbb193a2d8ea2ec");
});

test("implementation files and protocol exist", () => {
  for (const relative of checkpoint.implementation) assert.ok(fs.existsSync(path.join(root,relative)), relative);
});

test("CI and operator scripts include the multilead workflow", () => {
  assert.ok(pkg.scripts["test:ci"].includes("tests/multilead_signal_intelligence.test.js"));
  assert.strictEqual(pkg.scripts["analyze:wfdb12"],"node tools/analyze_wfdb_12lead.js");
});

test("protocol preserves fail-closed lead accounting", () => {
  assert.strictEqual(protocol.failurePolicy.leadFailure,"FAIL_LEAD_AND_CATEGORIZE");
  assert.strictEqual(protocol.failurePolicy.recordFailure,"FAIL_IF_NO_USABLE_LEADS");
  assert.strictEqual(protocol.failurePolicy.silentDropPermitted,false);
});

test("protocol and checkpoint preserve nonclinical governance", () => {
  assert.strictEqual(protocol.diagnosticRuntime,"GOVERNED_INACTIVE");
  assert.strictEqual(protocol.metrics,"NOT_REPORTABLE");
  assert.strictEqual(protocol.interpretationBoundary.candidateEvidenceIsDiagnosis,false);
  assert.strictEqual(checkpoint.clinicalAuthorityAdded,false);
  assert.strictEqual(checkpoint.approvedAdjudicatedGoldCount,0);
  assert.strictEqual(checkpoint.clinicalValidity,"NOT_INFERRED");
});

test("donor program remains paused without changing donor completion", () => {
  assert.strictEqual(donorRegistry.completed_donors,9);
  assert.strictEqual(donorRegistry.next_donor_id,"DONOR-010");
  assert.strictEqual(checkpoint.donorProgram.pausedFrontier,"DONOR-010");
});

test("clinical control boundary is unchanged from the parent main", () => {
  ensureCommit(checkpoint.parentMainCommit);
  const changed = cp.execFileSync("git",["-C",root,"diff","--name-only",checkpoint.parentMainCommit,"--","clinical_control"],{encoding:"utf8"}).trim();
  assert.strictEqual(changed,"");
});

test("checkpoint status is stage safe", () => {
  assert.ok(["IMPLEMENTED_UNPROMOTED","VERIFIED_UNPROMOTED","ACCEPTED_ON_MAIN"].includes(checkpoint.status));
  if (checkpoint.status === "IMPLEMENTED_UNPROMOTED") {
    assert.strictEqual(checkpoint.promotion.mergeCommit,null);
    assert.strictEqual(checkpoint.verification.independentVerification,"PENDING");
  }
});

if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({
  schema:"ekg-multilead-signal-intelligence-checkpoint-tests-v1",
  pass:true,passed,total:passed,
  completedDonors:donorRegistry.completed_donors,
  nextDonor:donorRegistry.next_donor_id,
  diagnosticRuntime:checkpoint.diagnosticRuntime,
  metrics:checkpoint.metrics,
  clinicalAuthorityAdded:false,
}));
