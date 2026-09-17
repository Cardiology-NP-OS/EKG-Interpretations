"use strict";
const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const checkpoint = require("../ECG_CAPABILITY_REALIZATION_CHECKPOINT.json");
const registry = require("../ECG_CAPABILITY_REGISTRY.json");
const donors = require("../ECG_DONOR_REGISTRY.json");
const pkg = require("../package.json");
const { auditRegistry } = require("../tools/execution_readiness_audit");
const root = path.resolve(__dirname, "..");
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
function ensureCommit(commit) {
  const probe = cp.spawnSync("git", ["-C", root, "cat-file", "-e", `${commit}^{commit}`], { encoding:"utf8" });
  if (probe.status === 0) return;
  cp.execFileSync("git", ["-C", root, "fetch", "--no-tags", "--depth=1", "origin", commit], { stdio:"ignore" });
}
test("checkpoint is anchored to accepted hardening main", () => {
  assert.strictEqual(checkpoint.parentMainCommit, "c6bf317fe3805a2e08fde40daa14049105071933");
  assert.strictEqual(checkpoint.parentMainTree, "7d837905b219b19cf63a051a75eb16b085427b97");
});
test("live readiness exactly matches realized checkpoint", () => {
  const audit = auditRegistry(root, registry);
  assert.deepStrictEqual(audit.counts, checkpoint.readinessAfter);
  assert.strictEqual(audit.counts.EXECUTABLE_TARGET_OWNED, 42);
  assert.strictEqual(audit.counts.CONTRACT_ONLY_NONRUNTIME, 0);
  assert.strictEqual(audit.counts.GOVERNANCE_ONLY, 0);
  assert.strictEqual(audit.counts.IMPLEMENTATION_REQUIRED_NOW, 0);
});
test("all 24 claimed realizations are executable code with direct tests", () => {
  assert.strictEqual(checkpoint.realizedCapabilities.length, 24);
  const byId = new Map(registry.capabilities.map(row => [row.capability_id, row]));
  for (const row of checkpoint.realizedCapabilities) {
    const capability = byId.get(row.capabilityId);
    assert.ok(capability, row.capabilityId);
    assert.ok(["TARGET_OWNED_IMPLEMENTATION","TARGET_OWNED_EVALUATION_IMPLEMENTATION"].includes(capability.implementation_status));
    assert.strictEqual(capability.canonical_target_path, row.implementation);
    assert.ok(row.implementation.startsWith("lib/") && fs.existsSync(path.join(root, row.implementation)));
    assert.ok(capability.test_paths.includes(row.test));
    assert.ok(fs.existsSync(path.join(root, row.test)));
  }
});
test("residual references are explicit and do not masquerade as implementations", () => {
  assert.strictEqual(checkpoint.residualNonExecutable.length, 15);
  const byId = new Map(registry.capabilities.map(row => [row.capability_id, row]));
  for (const row of checkpoint.residualNonExecutable) {
    const capability = byId.get(row.capabilityId);
    assert.ok(capability, row.capabilityId);
    assert.ok(typeof row.reason === "string" && row.reason.length > 10);
    assert.ok(["TARGET_OWNED_RESEARCH_REPRESENTATION","CHALLENGER_METADATA_ONLY"].includes(capability.implementation_status));
    assert.ok(!capability.canonical_target_path.startsWith("lib/"));
  }
});
test("every new runtime suite is wired into CI", () => {
  const required = ["signal_adapter","signal_transformations","local_dataset_loader","image_robustness","model_asset_safety","evaluation_runtime","governance_runtime","capability_realization_checkpoint"];
  for (const name of required) assert.ok(pkg.scripts["test:ci"].includes(`tests/${name}.test.js`), name);
});
test("donor frontier remains paused until realization acceptance", () => {
  assert.strictEqual(donors.completed_donors, 9);
  assert.strictEqual(donors.next_donor_id, "DONOR-010");
  assert.strictEqual(checkpoint.donorProgram.pausedFrontier, "DONOR-010");
  assert.strictEqual(checkpoint.donorProgram.resumeEligibleAfterAcceptance, true);
});
test("clinical control remains unchanged from the accepted hardening parent", () => {
  ensureCommit(checkpoint.parentMainCommit);
  const changed = cp.execFileSync("git", ["-C",root,"diff","--name-only",checkpoint.parentMainCommit,"--","clinical_control"], { encoding:"utf8" }).trim();
  assert.strictEqual(changed, "");
});
test("proof boundary forbids unsupported superiority and clinical claims", () => {
  assert.strictEqual(checkpoint.proofBoundary.externalComparativeSuperiorityEstablished, false);
  assert.strictEqual(checkpoint.proofBoundary.worldBestClaim, "NOT_ESTABLISHED");
  assert.strictEqual(checkpoint.proofBoundary.clinicalPerformanceClaimed, false);
  assert.strictEqual(checkpoint.diagnosticRuntime, "GOVERNED_INACTIVE");
  assert.strictEqual(checkpoint.metrics, "NOT_REPORTABLE");
  assert.strictEqual(checkpoint.clinicalValidity, "NOT_INFERRED");
});
test("implementation candidate evidence is exact and successful", () => {
  assert.strictEqual(checkpoint.verification.implementationCandidateCommit,"278a3f12e06ee51d9e38a5e164c5ea37304293db");
  assert.strictEqual(checkpoint.verification.implementationCandidateTree,"e42d6c8b3aaec0e4f894e8a2e4419d70d32142a1");
  assert.strictEqual(checkpoint.verification.candidateCiRunId,35281532869);
  assert.strictEqual(checkpoint.verification.candidateCiConclusion,"success");
  assert.strictEqual(checkpoint.verification.independentVerification,"PASS_FULL_CLONE");
  assert.strictEqual(checkpoint.verification.independentFocused,"87/87 PASS");
  assert.strictEqual(checkpoint.verification.independentFullTargetSuite,"PASS");
});
test("checkpoint status and verification remain stage safe", () => {
  assert.ok(["IMPLEMENTED_UNVERIFIED","VERIFIED_UNPROMOTED","ACCEPTED_ON_MAIN"].includes(checkpoint.status));
  if (checkpoint.status === "IMPLEMENTED_UNVERIFIED") {
    assert.strictEqual(checkpoint.verification.candidateCiConclusion, "PENDING");
    assert.strictEqual(checkpoint.verification.independentVerification, "PENDING");
  }
});
if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-capability-realization-checkpoint-tests-v1",pass:true,passed,total:passed,canonicalCapabilities:registry.capability_count,executableCapabilities:checkpoint.readinessAfter.EXECUTABLE_TARGET_OWNED,residualReferences:checkpoint.residualNonExecutable.length,diagnosticRuntime:checkpoint.diagnosticRuntime,clinicalAuthorityAdded:false}));
