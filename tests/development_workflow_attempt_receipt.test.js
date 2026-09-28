"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createDevelopmentWorkflowAttemptReceipt, developmentWorkflowAttemptReceiptSha256, serializeDevelopmentWorkflowAttemptReceipt, validateDevelopmentWorkflowAttemptReceipt } = require("../lib/development_workflow_attempt_receipt");

const options = {
  expectedRepository: "Cardiology-NP-OS/EKG-Interpretations",
  expectedWorkflowPath: ".github/workflows/development_evaluation.yml",
  expectedWorkflowName: "Development ECG evaluation",
  observerRunId: "35704941100",
  observerRunAttempt: 1,
  observerSha: "b".repeat(40),
  observerWorkflowPath: ".github/workflows/development_evaluation_watchdog.yml",
};

function source(overrides = {}) {
  return {
    id: 35704941042,
    run_attempt: 1,
    head_sha: "a".repeat(40),
    event: "push",
    status: "completed",
    conclusion: "failure",
    created_at: "2026-09-22T12:00:00Z",
    updated_at: "2026-09-22T12:05:00Z",
    html_url: "https://github.com/Cardiology-NP-OS/EKG-Interpretations/actions/runs/35704941042",
    name: "Development ECG evaluation",
    path: ".github/workflows/development_evaluation.yml",
    repository: { full_name: "Cardiology-NP-OS/EKG-Interpretations" },
    ...overrides,
  };
}

function step(name, conclusion = "success", started = true) {
  return { name, status: "completed", conclusion, started_at: started ? "2026-09-22T12:01:00Z" : null };
}

function job(sourceRun, name, conclusion, steps = []) {
  return { id: name === "synthetic-boundary" ? 11 : 12, run_id: sourceRun.id, run_attempt: sourceRun.run_attempt, head_sha: sourceRun.head_sha, name, status: "completed", conclusion, steps };
}

function jobs(rows) {
  return { total_count: rows.length, jobs: rows };
}

const names = {
  preflight: "Require governed external resources",
  signingKey: "Prepare ephemeral signing key",
  runConfiguration: "Build ephemeral run configuration",
  attemptStart: "Sign immutable attempt start",
  evaluation: "Run isolated current-engine and Pan-Tompkins evaluation",
  reconciliation: "Reconcile signed attempt terminal state",
  cleanup: "Remove ephemeral signing key",
};

function classify(sourceRun, rows) {
  return createDevelopmentWorkflowAttemptReceipt(sourceRun, jobs(rows), options);
}

const failedSyntheticSource = source();
let receipt = classify(failedSyntheticSource, [job(failedSyntheticSource, "synthetic-boundary", "failure"), job(failedSyntheticSource, "full-development", "skipped")]);
assert.equal(receipt.classification.phase, "SYNTHETIC_BOUNDARY_NOT_PASSED");
assert.equal(receipt.classification.preLaunchFailure, true);

const successfulSyntheticSource = source({ conclusion: "cancelled" });
receipt = classify(successfulSyntheticSource, [job(successfulSyntheticSource, "synthetic-boundary", "success")]);
assert.equal(receipt.classification.phase, "FULL_DEVELOPMENT_NOT_STARTED");

const preflightSource = source();
receipt = classify(preflightSource, [job(preflightSource, "synthetic-boundary", "success"), job(preflightSource, "full-development", "failure", [step(names.preflight, "failure")])]);
assert.equal(receipt.classification.phase, "GOVERNED_RESOURCE_PREFLIGHT_NOT_PASSED");

const signingSource = source();
receipt = classify(signingSource, [job(signingSource, "synthetic-boundary", "success"), job(signingSource, "full-development", "failure", [step(names.preflight), step(names.runConfiguration), step(names.signingKey, "failure")])]);
assert.equal(receipt.classification.phase, "SIGNING_KEY_NOT_PREPARED");

const configSource = source();
receipt = classify(configSource, [job(configSource, "synthetic-boundary", "success"), job(configSource, "full-development", "failure", [step(names.preflight), step(names.runConfiguration, "failure")])]);
assert.equal(receipt.classification.phase, "RUN_CONFIGURATION_NOT_CREATED");

const beforeStartSource = source({ conclusion: "failure" });
receipt = classify(beforeStartSource, [job(beforeStartSource, "synthetic-boundary", "success"), job(beforeStartSource, "full-development", "failure", [step(names.preflight), step(names.runConfiguration), step(names.signingKey), step(names.attemptStart, "failure")])]);
assert.equal(receipt.classification.phase, "ATTEMPT_START_NOT_SIGNED");

const beforeEvaluationSource = source({ conclusion: "cancelled" });
receipt = classify(beforeEvaluationSource, [job(beforeEvaluationSource, "synthetic-boundary", "success"), job(beforeEvaluationSource, "full-development", "cancelled", [step(names.preflight), step(names.runConfiguration), step(names.signingKey), step(names.attemptStart), step(names.evaluation, "skipped", false)])]);
assert.equal(receipt.classification.phase, "ATTEMPT_START_SIGNED");

const evaluationSource = source();
receipt = classify(evaluationSource, [job(evaluationSource, "synthetic-boundary", "success"), job(evaluationSource, "full-development", "failure", [step(names.preflight), step(names.runConfiguration), step(names.signingKey), step(names.attemptStart), step(names.evaluation, "failure"), step(names.reconciliation, "failure")])]);
assert.equal(receipt.classification.phase, "EVALUATION_STEP_REACHED");
assert.equal(receipt.classification.preLaunchFailure, false);

const successSource = source({ conclusion: "success", run_attempt: 2, updated_at: "2026-09-22T12:06:00Z", html_url: "https://github.com/Cardiology-NP-OS/EKG-Interpretations/actions/runs/35704941042/attempts/2" });
const successSteps = [step(names.preflight), step(names.runConfiguration), step(names.signingKey), step(names.attemptStart), step(names.evaluation), step(names.reconciliation), step(names.cleanup)];
receipt = classify(successSource, [job(successSource, "synthetic-boundary", "success"), job(successSource, "full-development", "success", successSteps)]);
assert.equal(receipt.classification.phase, "SOURCE_WORKFLOW_COMPLETED");
assert.equal(receipt.receiptId.endsWith(":35704941042:2"), true);
assert.equal(receipt.evaluationAttemptSignaturePresent, "NOT_OBSERVED");
for (const field of ["candidateExecutionClaimed", "bundleValidityClaimed", "clinicalAccuracyClaimed", "runtimeAuthority", "containsProtectedDatasetMetadata", "writeOnce", "externalObjectLockAttested"]) assert.equal(receipt[field], false, field);
assert.equal(receipt.capabilityNotClaim, true);
assert.equal(JSON.stringify(receipt).includes("runner_name"), false);
assert.equal(JSON.stringify(receipt).includes("secret"), false);
const firstBytes = serializeDevelopmentWorkflowAttemptReceipt(receipt);
const secondBytes = serializeDevelopmentWorkflowAttemptReceipt(classify(successSource, [job(successSource, "synthetic-boundary", "success"), job(successSource, "full-development", "success", successSteps)]));
assert.equal(firstBytes.equals(secondBytes), true);
assert.equal(developmentWorkflowAttemptReceiptSha256(receipt), "3644ba6d3a700823f2cee80962ae8d3ab89a5284920253d8dcb65da90d0b8aac");

const rerun = classify(source({ run_attempt: 3, html_url: "https://github.com/Cardiology-NP-OS/EKG-Interpretations/actions/runs/35704941042/attempts/3" }), []);
assert.equal(rerun.classification.phase, "OBSERVATION_INCOMPLETE");
assert.equal(rerun.classification.preLaunchFailure, null);
assert.notEqual(rerun.receiptId, receipt.receiptId);
const successfulObservationGap = classify(source({ conclusion: "success" }), []);
assert.equal(successfulObservationGap.classification.phase, "OBSERVATION_INCOMPLETE");
assert.equal(successfulObservationGap.classification.preLaunchFailure, null);

assert.throws(() => classify(source(), [job(source(), "synthetic-boundary", "success"), job(source(), "synthetic-boundary", "success")]), /DEVELOPMENT_WORKFLOW_RECEIPT_DUPLICATE_JOB/);
assert.throws(() => classify(source(), Array.from({ length: 21 }, (_, index) => ({ ...job(source(), "synthetic-boundary", "success"), id: index + 1 }))), /DEVELOPMENT_WORKFLOW_RECEIPT_JOB_COUNT/);
assert.throws(() => createDevelopmentWorkflowAttemptReceipt(source({ repository: { full_name: "attacker/fork" } }), jobs([]), options), /DEVELOPMENT_WORKFLOW_RECEIPT_REPOSITORY/);
assert.throws(() => createDevelopmentWorkflowAttemptReceipt(source({ path: ".github/workflows/other.yml" }), jobs([]), options), /DEVELOPMENT_WORKFLOW_RECEIPT_WORKFLOW/);
assert.throws(() => createDevelopmentWorkflowAttemptReceipt(source({ event: "pull_request" }), jobs([]), options), /DEVELOPMENT_WORKFLOW_RECEIPT_EVENT/);
assert.throws(() => createDevelopmentWorkflowAttemptReceipt(source({ head_sha: "0".repeat(64) }), jobs([]), options), /DEVELOPMENT_WORKFLOW_RECEIPT_HEAD_SHA/);
assert.throws(() => createDevelopmentWorkflowAttemptReceipt(source({ html_url: "https://example.com/attempts/1" }), jobs([]), options), /DEVELOPMENT_WORKFLOW_RECEIPT_URL/);
assert.throws(() => createDevelopmentWorkflowAttemptReceipt(source({ run_attempt: 2, html_url: "https://github.com/Cardiology-NP-OS/EKG-Interpretations/actions/runs/35704941042/attempts/9" }), jobs([]), options), /DEVELOPMENT_WORKFLOW_RECEIPT_URL/);
assert.throws(() => classify(source(), [job(source(), "synthetic-boundary", "success", [step("duplicate"), step("duplicate")])]), /DEVELOPMENT_WORKFLOW_RECEIPT_DUPLICATE_STEP/);
assert.throws(() => validateDevelopmentWorkflowAttemptReceipt({ ...receipt, extra: true }), /DEVELOPMENT_WORKFLOW_RECEIPT_FIELDS/);
assert.throws(() => validateDevelopmentWorkflowAttemptReceipt({ ...receipt, classification: { ...receipt.classification, phase: "SOURCE_WORKFLOW_COMPLETED", preLaunchFailure: true } }), /DEVELOPMENT_WORKFLOW_RECEIPT_PRELAUNCH_CLASSIFICATION/);
assert.throws(() => validateDevelopmentWorkflowAttemptReceipt({ ...receipt, classification: { ...receipt.classification, evidence: { ...receipt.classification.evidence, evaluationStep: "NOT_OBSERVED" } } }), /DEVELOPMENT_WORKFLOW_RECEIPT_SUCCESS_EVIDENCE/);
assert.throws(() => validateDevelopmentWorkflowAttemptReceipt({ ...receipt, source: { ...receipt.source, conclusion: "failure" }, classification: { phase: "GOVERNED_RESOURCE_PREFLIGHT_NOT_PASSED", preLaunchFailure: true, evidence: { ...receipt.classification.evidence, governedResourcePreflight: "NOT_PASSED" } } }), /DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_ORDER/);
assert.throws(() => validateDevelopmentWorkflowAttemptReceipt({ ...receipt, source: { ...receipt.source, updatedAtUtc: "not-a-time" } }), /DEVELOPMENT_WORKFLOW_RECEIPT_UPDATED_AT/);

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-workflow-receipt-"));
try {
  const eventPath = path.join(root, "event.json");
  const jobsPath = path.join(root, "jobs.json");
  const outputPath = path.join(root, "receipt.json");
  fs.writeFileSync(eventPath, JSON.stringify({ workflow_run: successSource }));
  fs.writeFileSync(jobsPath, JSON.stringify(jobs([job(successSource, "synthetic-boundary", "success"), job(successSource, "full-development", "success", successSteps)])));
  const cliArgs = [path.join(__dirname, "..", "tools", "record_development_workflow_attempt.js"), "--event", eventPath, "--jobs", jobsPath, "--repository", options.expectedRepository, "--workflow-path", options.expectedWorkflowPath, "--observer-run-id", options.observerRunId, "--observer-run-attempt", String(options.observerRunAttempt), "--observer-sha", options.observerSha, "--observer-workflow-path", options.observerWorkflowPath, "--output", outputPath];
  const cli = childProcess.spawnSync(process.execPath, cliArgs, { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  const summary = JSON.parse(cli.stdout);
  assert.equal(summary.phase, "SOURCE_WORKFLOW_COMPLETED");
  assert.equal(summary.receiptSha256, developmentWorkflowAttemptReceiptSha256(JSON.parse(fs.readFileSync(outputPath, "utf8"))));
  const collision = childProcess.spawnSync(process.execPath, cliArgs, { encoding: "utf8" });
  assert.equal(collision.status, 1);
  assert.match(collision.stderr, /EEXIST/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

const usage = childProcess.spawnSync(process.execPath, [path.join(__dirname, "..", "tools", "record_development_workflow_attempt.js")], { encoding: "utf8" });
assert.equal(usage.status, 1);
assert.equal(usage.stderr, "DEVELOPMENT_WORKFLOW_RECEIPT_USAGE\n");

const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evaluation", "schemas", "DEVELOPMENT_WORKFLOW_ATTEMPT_RECEIPT_SCHEMA.json"), "utf8"));
assert.equal(schema.properties.observationAuthority.const, "GITHUB_ACTIONS_CONTROL_PLANE_ONLY");
assert.equal(schema.properties.observer.properties.workflowPath.const, ".github/workflows/development_evaluation_watchdog.yml");
assert.equal(schema.properties.clinicalAccuracyClaimed.const, false);
assert.equal(schema.properties.writeOnce.const, false);

console.log("development workflow attempt receipt tests passed");
