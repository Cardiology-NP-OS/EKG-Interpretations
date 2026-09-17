"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { auditRegistry, currentActionableGaps } = require("../tools/execution_readiness_audit");

const root = path.resolve(__dirname, "..");
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8").replace(/^\uFEFF/, ""));
const checkpoint = read("ECG_EXECUTION_REALIZATION_CHECKPOINT.json");
const registry = read("ECG_CAPABILITY_REGISTRY.json");
const donors = read("ECG_DONOR_REGISTRY.json");
const pkg = read("package.json");
const audit = auditRegistry(root, registry);
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}

test("checkpoint is anchored to accepted multilead main", () => {
  assert.strictEqual(checkpoint.parentMainCommit, "395fe56f6b5f7ae05d0c303fc7948ec8bae416a5");
  assert.strictEqual(checkpoint.parentMainTree, "5e2d23a5b1338465db83061a6b10ce2d26419de1");
});
test("live readiness counts exactly match checkpoint", () => {
  assert.deepStrictEqual(checkpoint.readinessCounts, audit.counts);
  assert.deepStrictEqual(currentActionableGaps(audit), checkpoint.implementationRequiredNow);
  assert.strictEqual(checkpoint.implementationRequiredNow.length, 0);
});
test("waveform rendering is code-backed and tested", () => {
  const cap = registry.capabilities.find(row => row.capability_id === "ECG-CAP-IMAGE-RENDERING");
  assert.ok(cap);
  assert.strictEqual(cap.implementation_status, "TARGET_OWNED_IMPLEMENTATION");
  assert.strictEqual(cap.canonical_target_path, "lib/waveform_rendering.js");
  assert.ok(cap.test_paths.includes("tests/waveform_rendering.test.js"));
});
test("unified operator path is wired into package scripts and CI", () => {
  assert.strictEqual(pkg.scripts["execute:wfdb"], "node tools/run_ecg_pipeline.js");
  for (const name of ["waveform_rendering","ecg_execution_pipeline","ecg_execution_cli","execution_realization_checkpoint"])
    assert.ok(pkg.scripts["test:ci"].includes(`tests/${name}.test.js`), name);
});
test("declared realization files actually exist", () => {
  for (const relative of checkpoint.implementation) assert.ok(fs.existsSync(path.join(root, relative)), relative);
  assert.ok(fs.existsSync(path.join(root, "evaluation/fixtures/SYNTHETIC_EXECUTABLE_PIPELINE_CONFIG.json")));
  assert.ok(fs.existsSync(path.join(root, "evaluation/protocols/WAVEFORM_RENDERING_CONTRACT.json")));
});
test("residual non-executable capabilities remain visibly non-executable", () => {
  for (const row of audit.rows) {
    if (row.readiness !== "EXECUTABLE_TARGET_OWNED")
      assert.ok(!/^ACTIVE(?:_|$)/.test(row.runtimeStatus), row.capabilityId);
  }
});
test("donor resumption is gated on checkpoint acceptance", () => {
  assert.strictEqual(donors.completed_donors, 9);
  assert.strictEqual(donors.next_donor_id, "DONOR-010");
  assert.strictEqual(checkpoint.donorProgram.pausedFrontier, "DONOR-010");
  assert.strictEqual(checkpoint.donorProgram.resumeEligibleAfterAcceptance, true);
});
test("no unsupported superiority or clinical claim is recorded", () => {
  assert.strictEqual(checkpoint.residualNonExecutablePolicy.worldBestClaim, "NOT_CLAIMED_WITHOUT_EXTERNAL_COMPARATIVE_EVIDENCE");
  assert.strictEqual(checkpoint.proof.clinicalPerformanceClaimed, false);
  assert.strictEqual(checkpoint.approvedAdjudicatedGoldCount, 0);
  assert.strictEqual(checkpoint.metrics, "NOT_REPORTABLE");
  assert.strictEqual(checkpoint.clinicalValidity, "NOT_INFERRED");
});
test("checkpoint status is stage safe", () => {
  assert.ok(["IMPLEMENTED_UNVERIFIED","VERIFIED_UNPROMOTED","ACCEPTED_ON_MAIN"].includes(checkpoint.status));
});
if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-execution-realization-checkpoint-tests-v1",pass:true,passed,total:passed,canonicalCapabilities:registry.capability_count,executableCapabilities:audit.counts.EXECUTABLE_TARGET_OWNED,implementationRequiredNow:checkpoint.implementationRequiredNow.length,diagnosticRuntime:"GOVERNED_INACTIVE",clinicalAuthorityAdded:false}));
