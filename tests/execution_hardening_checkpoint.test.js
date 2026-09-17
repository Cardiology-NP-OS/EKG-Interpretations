"use strict";
const assert = require("assert");
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const checkpoint = require("../ECG_EXECUTION_HARDENING_CHECKPOINT.json");
const donors = require("../ECG_DONOR_REGISTRY.json");
const pkg = require("../package.json");
const renderingProtocol = require("../evaluation/protocols/WAVEFORM_RENDERING_CONTRACT.json");
const renderer = require("../lib/waveform_rendering");
const root = path.resolve(__dirname,"..");
let passed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}: ${error.stack || error}`); process.exitCode = 1; }
}
function ensureCommit(commit) {
  const probe = cp.spawnSync("git",["-C",root,"cat-file","-e",`${commit}^{commit}`],{encoding:"utf8"});
  if (probe.status === 0) return;
  cp.execFileSync("git",["-C",root,"fetch","--no-tags","--depth=1","origin",commit],{stdio:"ignore"});
}

test("checkpoint is pinned to accepted execution realization main", () => {
  assert.strictEqual(checkpoint.parentMainCommit,"6a0bad3319266590293c54cabb7cf0f3b5a2b679");
  assert.strictEqual(checkpoint.parentMainTree,"60d371901c6650b556195b8f72ebb08449b842eb");
});
test("declared hardening implementation files exist", () => {
  for (const relative of checkpoint.implementation)
    assert.ok(fs.existsSync(path.join(root,relative)), relative);
});
test("hardening tests and operator remain CI wired", () => {
  assert.ok(pkg.scripts["test:ci"].includes("tests/ecg_execution_hardening.test.js"));
  assert.ok(pkg.scripts["test:ci"].includes("tests/waveform_rendering.test.js"));
  assert.strictEqual(pkg.scripts["execute:wfdb"],"node tools/run_ecg_pipeline.js");
});
test("renderer resource bounds are executable contract values", () => {
  assert.strictEqual(renderer.MAX_LEADS,renderingProtocol.resourceBounds.maxLeads);
  assert.strictEqual(renderer.MAX_SAMPLES_PER_LEAD,renderingProtocol.resourceBounds.maxSamplesPerLead);
  assert.strictEqual(renderer.MAX_TOTAL_SAMPLES,renderingProtocol.resourceBounds.maxTotalSamples);
});
test("blind renderer delegates to the canonical renderer", () => {
  const text=fs.readFileSync(path.join(root,"tools/render_blind.js"),"utf8");
  assert.ok(text.includes('require("../lib/waveform_rendering")'));
  assert.ok(!text.includes('function waveformPath('));
});
test("engineering proof records all-lead and invariance hardening", () => {
  assert.strictEqual(checkpoint.engineeringProof.preprocessingOnceBeforeLeadAnalysis,true);
  assert.strictEqual(checkpoint.engineeringProof.allUsableCanonicalLeadsAnalyzed,true);
  assert.strictEqual(checkpoint.engineeringProof.sourceLeadOrderInvarianceTested,true);
  assert.strictEqual(checkpoint.engineeringProof.samplingRateResamplingInvarianceTested,true);
  assert.strictEqual(checkpoint.engineeringProof.silentLeadDropPermitted,false);
});
test("proof boundary forbids unsupported superiority and clinical claims", () => {
  assert.strictEqual(checkpoint.proofBoundary.externalComparativeSuperiorityEstablished,false);
  assert.strictEqual(checkpoint.proofBoundary.worldBestClaim,"NOT_ESTABLISHED");
  assert.strictEqual(checkpoint.proofBoundary.clinicalPerformanceClaimed,false);
  assert.strictEqual(checkpoint.metrics,"NOT_REPORTABLE");
  assert.strictEqual(checkpoint.clinicalValidity,"NOT_INFERRED");
});
test("donor frontier remains paused until hardening acceptance", () => {
  assert.strictEqual(donors.completed_donors,9);
  assert.strictEqual(donors.next_donor_id,"DONOR-010");
  assert.strictEqual(checkpoint.donorProgram.pausedFrontier,"DONOR-010");
  assert.strictEqual(checkpoint.donorProgram.resumeEligibleAfterAcceptance,true);
});
test("clinical control is unchanged from the hardening parent", () => {
  ensureCommit(checkpoint.parentMainCommit);
  const changed=cp.execFileSync("git",["-C",root,"diff","--name-only",checkpoint.parentMainCommit,"--","clinical_control"],{encoding:"utf8"}).trim();
  assert.strictEqual(changed,"");
});
test("implementation candidate verification is exact and successful", () => {
  assert.strictEqual(checkpoint.verification.implementationCandidateCommit,"4ccd37a401b960d0e2ba280457cca8488a616fe0");
  assert.strictEqual(checkpoint.verification.implementationCandidateTree,"89041fe5612a32ae61484cf808d982c317b3e0f9");
  assert.strictEqual(checkpoint.verification.candidateCiRunId,35276933722);
  assert.strictEqual(checkpoint.verification.candidateCiConclusion,"success");
  assert.strictEqual(checkpoint.verification.independentVerification,"PASS_FULL_CLONE");
  assert.strictEqual(checkpoint.verification.independentFullTargetSuite,"PASS");
});
test("checkpoint status and verification are stage safe", () => {
  assert.ok(["IMPLEMENTED_UNVERIFIED","VERIFIED_UNPROMOTED","ACCEPTED_ON_MAIN"].includes(checkpoint.status));
  if (checkpoint.status === "IMPLEMENTED_UNVERIFIED") {
    assert.strictEqual(checkpoint.verification.candidateCiConclusion,"PENDING");
    assert.strictEqual(checkpoint.verification.independentVerification,"PENDING");
  }
});
if (process.exitCode) process.exit(process.exitCode);
console.log(JSON.stringify({schema:"ekg-execution-hardening-checkpoint-tests-v1",pass:true,passed,total:passed,completedDonors:donors.completed_donors,nextDonor:donors.next_donor_id,diagnosticRuntime:checkpoint.diagnosticRuntime,metrics:checkpoint.metrics,clinicalAuthorityAdded:false}));
