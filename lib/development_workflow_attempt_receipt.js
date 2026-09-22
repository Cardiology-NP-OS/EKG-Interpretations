"use strict";

const crypto = require("crypto");
const { stableJson } = require("./evaluation_runtime");

const EXPECTED_JOBS = Object.freeze(["synthetic-boundary", "full-development"]);
const EXPECTED_STEPS = Object.freeze({
  preflight: "Require governed external resources",
  signingKey: "Prepare ephemeral signing key",
  runConfiguration: "Build ephemeral run configuration",
  attemptStart: "Sign immutable attempt start",
  evaluation: "Run isolated signal-only candidate evaluation",
  reconciliation: "Reconcile signed attempt terminal state",
  cleanup: "Remove ephemeral evaluation inputs",
});
const ALLOWED_EVENTS = Object.freeze(["push", "schedule", "workflow_dispatch"]);
const ALLOWED_CONCLUSIONS = Object.freeze(["success", "failure", "cancelled", "timed_out", "action_required", "neutral", "skipped", "stale", "startup_failure"]);
const PHASES = Object.freeze(["SYNTHETIC_BOUNDARY_NOT_PASSED", "FULL_DEVELOPMENT_NOT_STARTED", "GOVERNED_RESOURCE_PREFLIGHT_NOT_PASSED", "SIGNING_KEY_NOT_PREPARED", "RUN_CONFIGURATION_NOT_CREATED", "ATTEMPT_START_NOT_SIGNED", "ATTEMPT_START_SIGNED", "EVALUATION_STEP_REACHED", "SOURCE_WORKFLOW_COMPLETED", "OBSERVATION_INCOMPLETE"]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedString(value, pattern, maximum, code) {
  requireCondition(typeof value === "string" && value.length > 0 && value.length <= maximum && pattern.test(value), code);
  return value;
}

function validateUtc(value, code) {
  boundedString(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/, 32, code);
  requireCondition(Number.isFinite(Date.parse(value)), code);
  return value;
}

function validateConclusion(value, code) {
  requireCondition(ALLOWED_CONCLUSIONS.includes(value), code);
  return value;
}

function validateSourceUrl(value, repository, runId, runAttempt, code) {
  boundedString(value, /^https:\/\/github\.com\//, 512, code);
  const parsed = new URL(value);
  const basePath = `/${repository}/actions/runs/${runId}`;
  requireCondition(parsed.protocol === "https:" && parsed.hostname === "github.com" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash, code);
  requireCondition(parsed.pathname === basePath || parsed.pathname === `${basePath}/attempts/${runAttempt}`, code);
  return value;
}

function validateSourceRun(sourceRun, options) {
  requireCondition(plain(sourceRun) && plain(options), "DEVELOPMENT_WORKFLOW_RECEIPT_SOURCE");
  const expectedRepository = boundedString(options.expectedRepository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 200, "DEVELOPMENT_WORKFLOW_RECEIPT_EXPECTED_REPOSITORY");
  const expectedWorkflowPath = boundedString(options.expectedWorkflowPath, /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/, 200, "DEVELOPMENT_WORKFLOW_RECEIPT_EXPECTED_PATH");
  const expectedWorkflowName = boundedString(options.expectedWorkflowName, /^[A-Za-z0-9][A-Za-z0-9 ._-]+$/, 128, "DEVELOPMENT_WORKFLOW_RECEIPT_EXPECTED_NAME");
  requireCondition(plain(sourceRun.repository) && sourceRun.repository.full_name === expectedRepository, "DEVELOPMENT_WORKFLOW_RECEIPT_REPOSITORY");
  requireCondition(sourceRun.path === expectedWorkflowPath && sourceRun.name === expectedWorkflowName, "DEVELOPMENT_WORKFLOW_RECEIPT_WORKFLOW");
  requireCondition(Number.isSafeInteger(sourceRun.id) && sourceRun.id > 0, "DEVELOPMENT_WORKFLOW_RECEIPT_RUN_ID");
  requireCondition(Number.isSafeInteger(sourceRun.run_attempt) && sourceRun.run_attempt > 0, "DEVELOPMENT_WORKFLOW_RECEIPT_RUN_ATTEMPT");
  boundedString(sourceRun.head_sha, /^[0-9a-f]{40}$/, 40, "DEVELOPMENT_WORKFLOW_RECEIPT_HEAD_SHA");
  requireCondition(ALLOWED_EVENTS.includes(sourceRun.event), "DEVELOPMENT_WORKFLOW_RECEIPT_EVENT");
  requireCondition(sourceRun.status === "completed", "DEVELOPMENT_WORKFLOW_RECEIPT_SOURCE_INCOMPLETE");
  validateConclusion(sourceRun.conclusion, "DEVELOPMENT_WORKFLOW_RECEIPT_SOURCE_CONCLUSION");
  validateUtc(sourceRun.created_at, "DEVELOPMENT_WORKFLOW_RECEIPT_CREATED_AT");
  validateUtc(sourceRun.updated_at, "DEVELOPMENT_WORKFLOW_RECEIPT_UPDATED_AT");
  requireCondition(Date.parse(sourceRun.updated_at) >= Date.parse(sourceRun.created_at), "DEVELOPMENT_WORKFLOW_RECEIPT_TIME_ORDER");
  validateSourceUrl(sourceRun.html_url, expectedRepository, sourceRun.id, sourceRun.run_attempt, "DEVELOPMENT_WORKFLOW_RECEIPT_URL");
  const observerRunId = boundedString(options.observerRunId, /^[1-9][0-9]*$/, 32, "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_RUN_ID");
  requireCondition(Number.isSafeInteger(options.observerRunAttempt) && options.observerRunAttempt > 0, "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_RUN_ATTEMPT");
  const observerSha = boundedString(options.observerSha, /^[0-9a-f]{40}$/, 40, "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_SHA");
  const observerWorkflowPath = boundedString(options.observerWorkflowPath, /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/, 200, "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_PATH");
  requireCondition(observerWorkflowPath === ".github/workflows/development_evaluation_watchdog.yml", "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_PATH");
  return { expectedRepository, expectedWorkflowPath, expectedWorkflowName, observerRunId, observerRunAttempt: options.observerRunAttempt, observerSha, observerWorkflowPath };
}

function validateJobs(sourceRun, jobsPayload) {
  requireCondition(plain(jobsPayload) && Number.isInteger(jobsPayload.total_count) && Array.isArray(jobsPayload.jobs), "DEVELOPMENT_WORKFLOW_RECEIPT_JOBS");
  requireCondition(jobsPayload.total_count === jobsPayload.jobs.length && jobsPayload.jobs.length <= 20, "DEVELOPMENT_WORKFLOW_RECEIPT_JOB_COUNT");
  const jobs = new Map();
  for (const job of jobsPayload.jobs) {
    requireCondition(plain(job), "DEVELOPMENT_WORKFLOW_RECEIPT_JOB");
    requireCondition(EXPECTED_JOBS.includes(job.name), "DEVELOPMENT_WORKFLOW_RECEIPT_UNKNOWN_JOB");
    requireCondition(!jobs.has(job.name), "DEVELOPMENT_WORKFLOW_RECEIPT_DUPLICATE_JOB");
    requireCondition(Number.isSafeInteger(job.id) && job.id > 0 && job.run_id === sourceRun.id && job.run_attempt === sourceRun.run_attempt, "DEVELOPMENT_WORKFLOW_RECEIPT_JOB_IDENTITY");
    requireCondition(job.head_sha === sourceRun.head_sha && job.status === "completed", "DEVELOPMENT_WORKFLOW_RECEIPT_JOB_STATE");
    validateConclusion(job.conclusion, "DEVELOPMENT_WORKFLOW_RECEIPT_JOB_CONCLUSION");
    requireCondition(Array.isArray(job.steps) && job.steps.length <= 50, "DEVELOPMENT_WORKFLOW_RECEIPT_STEPS");
    const names = new Set();
    for (const step of job.steps) {
      requireCondition(plain(step), "DEVELOPMENT_WORKFLOW_RECEIPT_STEP");
      boundedString(step.name, /^[^\u0000-\u001f\u007f]+$/, 256, "DEVELOPMENT_WORKFLOW_RECEIPT_STEP_NAME");
      requireCondition(!names.has(step.name), "DEVELOPMENT_WORKFLOW_RECEIPT_DUPLICATE_STEP");
      names.add(step.name);
      requireCondition(step.status === "completed", "DEVELOPMENT_WORKFLOW_RECEIPT_STEP_INCOMPLETE");
      validateConclusion(step.conclusion, "DEVELOPMENT_WORKFLOW_RECEIPT_STEP_CONCLUSION");
      if (step.started_at !== null && step.started_at !== undefined) validateUtc(step.started_at, "DEVELOPMENT_WORKFLOW_RECEIPT_STEP_STARTED_AT");
    }
    jobs.set(job.name, job);
  }
  return jobs;
}

function knownStep(job, name) {
  if (!job) return null;
  const matches = job.steps.filter(step => step.name === name);
  requireCondition(matches.length <= 1, "DEVELOPMENT_WORKFLOW_RECEIPT_DUPLICATE_STEP");
  return matches[0] || null;
}

function stepState(step) {
  if (!step || step.conclusion === "skipped" || !step.started_at) return "NOT_OBSERVED";
  return step.conclusion === "success" ? "PASSED" : "NOT_PASSED";
}

function conclusionState(job) {
  return job ? job.conclusion.toUpperCase() : "NOT_OBSERVED";
}

function validateEvidenceLifecycle(sourceConclusion, evidence) {
  const executionSteps = ["governedResourcePreflight", "runConfigurationStep", "signingKeyPreparation", "attemptStartStep", "evaluationStep"];
  if (evidence.syntheticBoundaryConclusion === "NOT_OBSERVED") {
    requireCondition(evidence.fullDevelopmentConclusion === "NOT_OBSERVED" && executionSteps.every(field => evidence[field] === "NOT_OBSERVED"), "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_ORDER");
  } else if (evidence.syntheticBoundaryConclusion !== "SUCCESS") {
    requireCondition(["SKIPPED", "NOT_OBSERVED"].includes(evidence.fullDevelopmentConclusion) && executionSteps.every(field => evidence[field] === "NOT_OBSERVED"), "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_ORDER");
  } else if (["SKIPPED", "NOT_OBSERVED"].includes(evidence.fullDevelopmentConclusion)) {
    requireCondition(executionSteps.every(field => evidence[field] === "NOT_OBSERVED"), "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_ORDER");
  } else {
    if (evidence.governedResourcePreflight !== "PASSED") requireCondition(["runConfigurationStep", "signingKeyPreparation", "attemptStartStep", "evaluationStep"].every(field => evidence[field] === "NOT_OBSERVED"), "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_ORDER");
    if (evidence.runConfigurationStep !== "PASSED") requireCondition(["signingKeyPreparation", "attemptStartStep", "evaluationStep"].every(field => evidence[field] === "NOT_OBSERVED"), "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_ORDER");
    if (evidence.signingKeyPreparation !== "PASSED") requireCondition(["attemptStartStep", "evaluationStep"].every(field => evidence[field] === "NOT_OBSERVED"), "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_ORDER");
    if (evidence.attemptStartStep !== "PASSED") requireCondition(evidence.evaluationStep === "NOT_OBSERVED", "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_ORDER");
  }
  const allPassed = [...executionSteps, "reconciliationStep", "cleanupStep"].every(field => evidence[field] === "PASSED");
  if (evidence.syntheticBoundaryConclusion !== "NOT_OBSERVED" && (sourceConclusion === "success" || evidence.fullDevelopmentConclusion === "SUCCESS")) requireCondition(sourceConclusion === "success" && evidence.fullDevelopmentConclusion === "SUCCESS" && evidence.syntheticBoundaryConclusion === "SUCCESS" && allPassed, "DEVELOPMENT_WORKFLOW_RECEIPT_SUCCESS_EVIDENCE");
}

function derivePhase(sourceConclusion, evidence) {
  if (evidence.syntheticBoundaryConclusion === "NOT_OBSERVED") return "OBSERVATION_INCOMPLETE";
  if (evidence.syntheticBoundaryConclusion !== "SUCCESS") return "SYNTHETIC_BOUNDARY_NOT_PASSED";
  if (["NOT_OBSERVED", "SKIPPED"].includes(evidence.fullDevelopmentConclusion)) return "FULL_DEVELOPMENT_NOT_STARTED";
  if (evidence.governedResourcePreflight !== "PASSED") return "GOVERNED_RESOURCE_PREFLIGHT_NOT_PASSED";
  if (evidence.runConfigurationStep !== "PASSED") return "RUN_CONFIGURATION_NOT_CREATED";
  if (evidence.signingKeyPreparation !== "PASSED") return "SIGNING_KEY_NOT_PREPARED";
  if (evidence.attemptStartStep !== "PASSED") return "ATTEMPT_START_NOT_SIGNED";
  if (evidence.evaluationStep === "NOT_OBSERVED") return "ATTEMPT_START_SIGNED";
  const complete = sourceConclusion === "success" && evidence.fullDevelopmentConclusion === "SUCCESS" && evidence.evaluationStep === "PASSED" && evidence.reconciliationStep === "PASSED" && evidence.cleanupStep === "PASSED";
  return complete ? "SOURCE_WORKFLOW_COMPLETED" : "EVALUATION_STEP_REACHED";
}

function classify(sourceRun, jobs) {
  const synthetic = jobs.get("synthetic-boundary") || null;
  const full = jobs.get("full-development") || null;
  const evidence = {
    syntheticBoundaryConclusion: conclusionState(synthetic),
    fullDevelopmentConclusion: conclusionState(full),
    governedResourcePreflight: stepState(knownStep(full, EXPECTED_STEPS.preflight)),
    signingKeyPreparation: stepState(knownStep(full, EXPECTED_STEPS.signingKey)),
    runConfigurationStep: stepState(knownStep(full, EXPECTED_STEPS.runConfiguration)),
    attemptStartStep: stepState(knownStep(full, EXPECTED_STEPS.attemptStart)),
    evaluationStep: stepState(knownStep(full, EXPECTED_STEPS.evaluation)),
    reconciliationStep: stepState(knownStep(full, EXPECTED_STEPS.reconciliation)),
    cleanupStep: stepState(knownStep(full, EXPECTED_STEPS.cleanup)),
  };
  validateEvidenceLifecycle(sourceRun.conclusion, evidence);
  const phase = derivePhase(sourceRun.conclusion, evidence);
  requireCondition(PHASES.includes(phase), "DEVELOPMENT_WORKFLOW_RECEIPT_PHASE");
  const preLaunchFailure = phase === "OBSERVATION_INCOMPLETE" ? null : !["EVALUATION_STEP_REACHED", "SOURCE_WORKFLOW_COMPLETED"].includes(phase);
  return { phase, preLaunchFailure, evidence };
}

function createDevelopmentWorkflowAttemptReceipt(sourceRun, jobsPayload, options) {
  const expected = validateSourceRun(sourceRun, options);
  const jobs = validateJobs(sourceRun, jobsPayload);
  const classification = classify(sourceRun, jobs);
  return {
    schema: "ekg-development-workflow-attempt-receipt-v1",
    receiptId: `github-actions:${expected.expectedRepository}:${sourceRun.id}:${sourceRun.run_attempt}`,
    observationAuthority: "GITHUB_ACTIONS_CONTROL_PLANE_ONLY",
    observer: {
      repository: expected.expectedRepository,
      workflowName: "Development ECG evaluation watchdog",
      workflowPath: expected.observerWorkflowPath,
      runId: expected.observerRunId,
      runAttempt: expected.observerRunAttempt,
      headSha: expected.observerSha,
    },
    source: {
      repository: expected.expectedRepository,
      workflowName: expected.expectedWorkflowName,
      workflowPath: expected.expectedWorkflowPath,
      runId: String(sourceRun.id),
      runAttempt: sourceRun.run_attempt,
      event: sourceRun.event,
      headSha: sourceRun.head_sha,
      status: sourceRun.status,
      conclusion: sourceRun.conclusion,
      createdAtUtc: sourceRun.created_at,
      updatedAtUtc: sourceRun.updated_at,
      htmlUrl: sourceRun.html_url,
    },
    classification,
    evaluationAttemptSignaturePresent: "NOT_OBSERVED",
    candidateExecutionClaimed: false,
    bundleValidityClaimed: false,
    clinicalAccuracyClaimed: false,
    capabilityNotClaim: true,
    runtimeAuthority: false,
    containsProtectedDatasetMetadata: false,
    writeOnce: false,
    externalObjectLockAttested: false,
  };
}

function exactKeys(value, expected, code) {
  requireCondition(plain(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), code);
}

function validateDevelopmentWorkflowAttemptReceipt(receipt) {
  exactKeys(receipt, ["schema", "receiptId", "observationAuthority", "observer", "source", "classification", "evaluationAttemptSignaturePresent", "candidateExecutionClaimed", "bundleValidityClaimed", "clinicalAccuracyClaimed", "capabilityNotClaim", "runtimeAuthority", "containsProtectedDatasetMetadata", "writeOnce", "externalObjectLockAttested"], "DEVELOPMENT_WORKFLOW_RECEIPT_FIELDS");
  requireCondition(receipt.schema === "ekg-development-workflow-attempt-receipt-v1" && receipt.observationAuthority === "GITHUB_ACTIONS_CONTROL_PLANE_ONLY", "DEVELOPMENT_WORKFLOW_RECEIPT_AUTHORITY");
  exactKeys(receipt.observer, ["repository", "workflowName", "workflowPath", "runId", "runAttempt", "headSha"], "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_FIELDS");
  exactKeys(receipt.source, ["repository", "workflowName", "workflowPath", "runId", "runAttempt", "event", "headSha", "status", "conclusion", "createdAtUtc", "updatedAtUtc", "htmlUrl"], "DEVELOPMENT_WORKFLOW_RECEIPT_SOURCE_FIELDS");
  requireCondition(receipt.observer.repository === receipt.source.repository && receipt.observer.workflowName === "Development ECG evaluation watchdog" && receipt.observer.workflowPath === ".github/workflows/development_evaluation_watchdog.yml", "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_IDENTITY");
  boundedString(receipt.observer.runId, /^[1-9][0-9]*$/, 32, "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_RUN_ID");
  requireCondition(Number.isSafeInteger(receipt.observer.runAttempt) && receipt.observer.runAttempt > 0, "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_RUN_ATTEMPT");
  boundedString(receipt.observer.headSha, /^[0-9a-f]{40}$/, 40, "DEVELOPMENT_WORKFLOW_RECEIPT_OBSERVER_SHA");
  boundedString(receipt.source.repository, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, 200, "DEVELOPMENT_WORKFLOW_RECEIPT_REPOSITORY");
  requireCondition(receipt.source.workflowName === "Development ECG evaluation" && receipt.source.workflowPath === ".github/workflows/development_evaluation.yml", "DEVELOPMENT_WORKFLOW_RECEIPT_WORKFLOW");
  boundedString(receipt.source.runId, /^[1-9][0-9]*$/, 32, "DEVELOPMENT_WORKFLOW_RECEIPT_RUN_ID");
  requireCondition(Number.isSafeInteger(receipt.source.runAttempt) && receipt.source.runAttempt > 0, "DEVELOPMENT_WORKFLOW_RECEIPT_RUN_ATTEMPT");
  boundedString(receipt.source.headSha, /^[0-9a-f]{40}$/, 40, "DEVELOPMENT_WORKFLOW_RECEIPT_HEAD_SHA");
  requireCondition(ALLOWED_EVENTS.includes(receipt.source.event) && receipt.source.status === "completed", "DEVELOPMENT_WORKFLOW_RECEIPT_SOURCE_STATE");
  validateConclusion(receipt.source.conclusion, "DEVELOPMENT_WORKFLOW_RECEIPT_SOURCE_CONCLUSION");
  validateUtc(receipt.source.createdAtUtc, "DEVELOPMENT_WORKFLOW_RECEIPT_CREATED_AT");
  validateUtc(receipt.source.updatedAtUtc, "DEVELOPMENT_WORKFLOW_RECEIPT_UPDATED_AT");
  requireCondition(Date.parse(receipt.source.updatedAtUtc) >= Date.parse(receipt.source.createdAtUtc), "DEVELOPMENT_WORKFLOW_RECEIPT_TIME_ORDER");
  validateSourceUrl(receipt.source.htmlUrl, receipt.source.repository, receipt.source.runId, receipt.source.runAttempt, "DEVELOPMENT_WORKFLOW_RECEIPT_URL");
  requireCondition(receipt.receiptId === `github-actions:${receipt.source.repository}:${receipt.source.runId}:${receipt.source.runAttempt}`, "DEVELOPMENT_WORKFLOW_RECEIPT_IDENTITY");
  exactKeys(receipt.classification, ["phase", "preLaunchFailure", "evidence"], "DEVELOPMENT_WORKFLOW_RECEIPT_CLASSIFICATION_FIELDS");
  requireCondition(PHASES.includes(receipt.classification.phase), "DEVELOPMENT_WORKFLOW_RECEIPT_PHASE");
  const expectedPreLaunchFailure = receipt.classification.phase === "OBSERVATION_INCOMPLETE" ? null : !["EVALUATION_STEP_REACHED", "SOURCE_WORKFLOW_COMPLETED"].includes(receipt.classification.phase);
  requireCondition(receipt.classification.preLaunchFailure === expectedPreLaunchFailure, "DEVELOPMENT_WORKFLOW_RECEIPT_PRELAUNCH_CLASSIFICATION");
  const evidenceFields = ["syntheticBoundaryConclusion", "fullDevelopmentConclusion", "governedResourcePreflight", "signingKeyPreparation", "runConfigurationStep", "attemptStartStep", "evaluationStep", "reconciliationStep", "cleanupStep"];
  exactKeys(receipt.classification.evidence, evidenceFields, "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_FIELDS");
  const conclusionStates = [...ALLOWED_CONCLUSIONS.map(value => value.toUpperCase()), "NOT_OBSERVED"];
  requireCondition(conclusionStates.includes(receipt.classification.evidence.syntheticBoundaryConclusion) && conclusionStates.includes(receipt.classification.evidence.fullDevelopmentConclusion), "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_CONCLUSION");
  for (const field of evidenceFields.slice(2)) requireCondition(["PASSED", "NOT_PASSED", "NOT_OBSERVED"].includes(receipt.classification.evidence[field]), "DEVELOPMENT_WORKFLOW_RECEIPT_EVIDENCE_STATE");
  validateEvidenceLifecycle(receipt.source.conclusion, receipt.classification.evidence);
  requireCondition(receipt.classification.phase === derivePhase(receipt.source.conclusion, receipt.classification.evidence), "DEVELOPMENT_WORKFLOW_RECEIPT_PHASE_EVIDENCE");
  requireCondition(receipt.evaluationAttemptSignaturePresent === "NOT_OBSERVED", "DEVELOPMENT_WORKFLOW_RECEIPT_SIGNATURE_CLAIM");
  for (const field of ["candidateExecutionClaimed", "bundleValidityClaimed", "clinicalAccuracyClaimed", "runtimeAuthority", "containsProtectedDatasetMetadata", "writeOnce", "externalObjectLockAttested"]) requireCondition(receipt[field] === false, "DEVELOPMENT_WORKFLOW_RECEIPT_FALSE_CLAIM");
  requireCondition(receipt.capabilityNotClaim === true, "DEVELOPMENT_WORKFLOW_RECEIPT_CAPABILITY_BOUNDARY");
  return receipt;
}

function serializeDevelopmentWorkflowAttemptReceipt(receipt) {
  validateDevelopmentWorkflowAttemptReceipt(receipt);
  return Buffer.from(`${stableJson(receipt)}\n`, "utf8");
}

function developmentWorkflowAttemptReceiptSha256(receipt) {
  return crypto.createHash("sha256").update(serializeDevelopmentWorkflowAttemptReceipt(receipt)).digest("hex");
}

module.exports = { ALLOWED_CONCLUSIONS, EXPECTED_JOBS, EXPECTED_STEPS, PHASES, createDevelopmentWorkflowAttemptReceipt, developmentWorkflowAttemptReceiptSha256, serializeDevelopmentWorkflowAttemptReceipt, validateDevelopmentWorkflowAttemptReceipt };
