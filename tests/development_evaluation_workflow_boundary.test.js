"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "development_evaluation.yml"), "utf8");
const watchdog = fs.readFileSync(path.join(root, ".github", "workflows", "development_evaluation_watchdog.yml"), "utf8");
const runner = fs.readFileSync(path.join(root, "lib", "development_evaluation_runner.js"), "utf8");
const combinedExecutableSurface = `${workflow}\n${runner}`;
const prohibited = [
  "run_mitbih_rpeak_pilot.py",
  "run_mitbih_rpeak_full.py",
  "run_ludb_qrs_v2_dev.py",
  "run_ludb_qrs_v2_coverage_v2_dev.py",
  "run_ludb_qrs_v2_coverage_v2_holdout.py",
  "clinical_accuracy_pilot.yml",
  "validate:qrs-v2-ludb-train",
  "validate:qrs-v2-ludb-coverage-v2-train",
  "validate:qrs-v2-ludb-coverage-v2-holdout",
];
for (const value of prohibited) assert.equal(combinedExecutableSurface.includes(value), false, `prohibited executable reference: ${value}`);
assert.match(workflow, /schedule:/);
assert.match(workflow, /push:/);
assert.match(workflow, /runs-on: \[self-hosted, linux, x64, ecg-development\]/);
assert.match(workflow, /EKG_EVALUATION_NETWORK_DISABLED/);
assert.match(workflow, /APPLICATION_WRITE_ONCE_SIGNED/);
assert.match(workflow, /manifest-trust-store\.json/);
assert.match(workflow, /EKG_DEVELOPMENT_MANIFEST_TRUST_STORE_SHA256/);
assert.match(workflow, /expectedManifestTrustStoreSha256/);
assert.match(workflow, /partition-index\.json/);
assert.match(workflow, /partitionIndexPath/);
assert.match(workflow, /candidate-manifest\.json/);
assert.match(workflow, /candidate-manifest\.sig\.json/);
assert.match(workflow, /candidate-trust-store\.json/);
assert.match(workflow, /EKG_DEVELOPMENT_CANDIDATE_TRUST_STORE_SHA256/);
assert.match(workflow, /expectedCandidateTrustStoreSha256/);
assert.match(workflow, /previousBundleSignerKeyId/);
assert.match(workflow, /environmentImageDigest/);
assert.match(workflow, /attemptId:'github-'/);
assert.match(workflow, /workflowRunId:process\.env\.GITHUB_RUN_ID/);
assert.match(workflow, /workflowRunAttempt:Number\(process\.env\.GITHUB_RUN_ATTEMPT\)/);
assert.match(workflow, /workflowSha:process\.env\.GITHUB_SHA/);
assert.match(workflow, /Reconcile signed attempt terminal state\n        if: always\(\)/);
assert.match(workflow, /verify_development_attempt\.js/);
assert.match(workflow, /--network none/);
assert.match(workflow, /node:22@sha256:/);
assert.match(workflow, /weekly\?10000:2000/);
assert.match(workflow, /EKG_EVALUATION_SIGNING_KEY_FILE/);
assert.equal(workflow.includes("--env EKG_EVALUATION_SIGNING_KEY_PEM_BASE64"), false);
assert.match(watchdog, /workflow_run:/);
assert.match(watchdog, /workflows: \["Development ECG evaluation"\]/);
assert.match(watchdog, /types: \[completed\]/);
assert.match(watchdog, /record-source-attempt:[\s\S]*runs-on: ubuntu-latest/);
assert.match(watchdog, /actions\/checkout@[0-9a-f]{40}/);
assert.match(watchdog, /ref: \$\{\{ github\.sha \}\}/);
assert.match(watchdog, /persist-credentials: false/);
assert.match(watchdog, /actions\/runs\/\$SOURCE_RUN_ID\/attempts\/\$SOURCE_RUN_ATTEMPT\/jobs\?per_page=100/);
assert.match(watchdog, /record_development_workflow_attempt\.js/);
assert.match(watchdog, /--observer-run-id "\$OBSERVER_RUN_ID"/);
assert.match(watchdog, /--observer-sha "\$OBSERVER_SHA"/);
assert.match(watchdog, /actions\/upload-artifact@[0-9a-f]{40}/);
assert.match(watchdog, /development-workflow-attempt-\$\{\{ github\.event\.workflow_run\.id \}\}-\$\{\{ github\.event\.workflow_run\.run_attempt \}\}-observer-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
assert.match(watchdog, /printf '\{\"total_count\":0,\"jobs\":\[\]\}\\n'/);
assert.match(watchdog, /observationIncomplete/);
assert.match(watchdog, /Upload control-plane attempt receipt[\s\S]*alert-source-attempt/);
assert.match(watchdog, /Development ECG observation incomplete run/);
assert.match(watchdog, /record-source-attempt:[\s\S]*permissions:[\s\S]*actions: read[\s\S]*contents: read/);
assert.match(watchdog, /alert-source-attempt:[\s\S]*permissions:[\s\S]*issues: write/);
assert.equal(watchdog.includes("github.event.workflow_run.head_sha"), false);
for (const secret of ["EKG_EVALUATION_SIGNING_KEY", "EKG_DEVELOPMENT_CORPUS_ROOT", "EKG_DEVELOPMENT_GOVERNANCE_ROOT", "EKG_EVALUATION_ARTIFACT_ROOT"]) assert.equal(watchdog.includes(secret), false, secret);
assert.match(watchdog, /--event schedule/);
assert.match(watchdog, /--limit 20/);
assert.match(watchdog, /rows\.some/);
assert.match(watchdog, /30\*60\*60\*1000/);
assert.match(watchdog, /issue create/);
const observerUsage = childProcess.spawnSync(process.execPath, [path.join(root, "tools", "record_development_workflow_attempt.js")], { encoding: "utf8" });
assert.equal(observerUsage.status, 1);
assert.equal(observerUsage.stderr, "DEVELOPMENT_WORKFLOW_RECEIPT_USAGE\n");
const runnerUsage = childProcess.spawnSync(process.execPath, [path.join(root, "tools", "run_development_evaluation.js")], { encoding: "utf8" });
assert.equal(runnerUsage.status, 1);
assert.equal(runnerUsage.stderr, "USAGE\n");
const verifierUsage = childProcess.spawnSync(process.execPath, [path.join(root, "tools", "verify_development_attempt.js")], { encoding: "utf8" });
assert.equal(verifierUsage.status, 1);
assert.equal(verifierUsage.stderr, "DEVELOPMENT_ATTEMPT_VERIFY_USAGE\n");
console.log("development evaluation workflow boundary tests passed");
