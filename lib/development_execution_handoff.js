"use strict";

const fs = require("fs");
const path = require("path");
const { CLAIM_BOUNDARY } = require("./development_evaluation_preflight");

const MAX_HANDOFF_BYTES = 64 * 1024 * 1024;
const DETECTORS = Object.freeze(["CURRENT_ENGINE", "PAN_TOMPKINS"]);
const PASSES = Object.freeze(["PRIMARY", "REPLAY"]);
const OUTCOME_STATUSES = Object.freeze(["SUCCESS", "TECHNICAL_FAILURE", "ABSTAINED"]);

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected, code) {
  const keys = Object.keys(value).sort();
  requireCondition(JSON.stringify(keys) === JSON.stringify(expected.slice().sort()), code);
}

function validateTransition(row) {
  requireCondition(plain(row), "DEVELOPMENT_HANDOFF_TRANSITION");
  exactKeys(row, ["state", "atUtc"], "DEVELOPMENT_HANDOFF_TRANSITION_FIELDS");
  requireCondition(/^[A-Z][A-Z0-9_]{2,63}$/.test(row.state), "DEVELOPMENT_HANDOFF_TRANSITION_STATE");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(row.atUtc) && Number.isFinite(Date.parse(row.atUtc)), "DEVELOPMENT_HANDOFF_TRANSITION_TIME");
}

function validateOutcome(row, eligibleRecords, sampleCounts) {
  requireCondition(plain(row), "DEVELOPMENT_HANDOFF_OUTCOME");
  exactKeys(row, ["recordHmacSha256", "detector", "pass", "status", "failureCode", "predictedSampleIndices", "algorithm", "latencyMs", "peakMemoryBytes"], "DEVELOPMENT_HANDOFF_OUTCOME_FIELDS");
  requireCondition(eligibleRecords.has(row.recordHmacSha256), "DEVELOPMENT_HANDOFF_RECORD");
  requireCondition(DETECTORS.includes(row.detector), "DEVELOPMENT_HANDOFF_DETECTOR");
  requireCondition(PASSES.includes(row.pass), "DEVELOPMENT_HANDOFF_PASS");
  requireCondition(OUTCOME_STATUSES.includes(row.status), "DEVELOPMENT_HANDOFF_OUTCOME_STATUS");
  requireCondition(Array.isArray(row.predictedSampleIndices), "DEVELOPMENT_HANDOFF_PREDICTIONS");
  const maximum = sampleCounts && sampleCounts.get(row.recordHmacSha256);
  for (let index = 0; index < row.predictedSampleIndices.length; index += 1) {
    const value = row.predictedSampleIndices[index];
    requireCondition(Number.isInteger(value) && value >= 0, "DEVELOPMENT_HANDOFF_PREDICTION_INDEX");
    requireCondition(index === 0 || value > row.predictedSampleIndices[index - 1], "DEVELOPMENT_HANDOFF_PREDICTION_ORDER");
    requireCondition(maximum === undefined || value < maximum, "DEVELOPMENT_HANDOFF_PREDICTION_RANGE");
  }
  requireCondition(Number.isFinite(row.latencyMs) && row.latencyMs >= 0 && row.latencyMs <= 86400000, "DEVELOPMENT_HANDOFF_LATENCY");
  requireCondition(Number.isSafeInteger(row.peakMemoryBytes) && row.peakMemoryBytes >= 0, "DEVELOPMENT_HANDOFF_MEMORY");
  if (row.status === "SUCCESS") {
    requireCondition(row.failureCode === null, "DEVELOPMENT_HANDOFF_SUCCESS_FAILURE_CODE");
    requireCondition(typeof row.algorithm === "string" && row.algorithm.length > 0 && row.algorithm.length <= 256, "DEVELOPMENT_HANDOFF_ALGORITHM");
  } else {
    requireCondition(typeof row.failureCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(row.failureCode), "DEVELOPMENT_HANDOFF_FAILURE_CODE");
    requireCondition(row.predictedSampleIndices.length === 0 && row.algorithm === null, "DEVELOPMENT_HANDOFF_FAILED_OUTPUT");
  }
}

function validateDevelopmentExecutionHandoff(handoff, manifest, expected = {}) {
  requireCondition(plain(handoff), "DEVELOPMENT_HANDOFF");
  exactKeys(handoff, ["schema", "attemptId", "workflowRunId", "workflowRunAttempt", "workflowSha", "startedAtUtc", "runConfigurationSha256", "handoffStatus", "failureCode", "lastPhase", "stateTransitions", "candidateManifestPayloadSha256", "executionIdentitySha256", "manifestPayloadSha256", "outcomes", "clinicalAccuracyClaimed", "capabilityNotClaim", "reportable", "runtimeAuthority", "projectGold", "sourceLabelsAreProjectGold"], "DEVELOPMENT_HANDOFF_FIELDS");
  requireCondition(handoff.schema === "ekg-development-execution-handoff-v1", "DEVELOPMENT_HANDOFF_SCHEMA");
  requireCondition(typeof handoff.attemptId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(handoff.attemptId), "DEVELOPMENT_HANDOFF_ATTEMPT_ID");
  requireCondition(typeof handoff.workflowRunId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(handoff.workflowRunId), "DEVELOPMENT_HANDOFF_WORKFLOW_RUN_ID");
  requireCondition(Number.isInteger(handoff.workflowRunAttempt) && handoff.workflowRunAttempt > 0, "DEVELOPMENT_HANDOFF_WORKFLOW_RUN_ATTEMPT");
  requireCondition(/^[0-9a-f]{40}$/.test(handoff.workflowSha), "DEVELOPMENT_HANDOFF_WORKFLOW_SHA");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(handoff.startedAtUtc), "DEVELOPMENT_HANDOFF_STARTED_AT");
  requireCondition(/^[0-9a-f]{64}$/.test(handoff.runConfigurationSha256), "DEVELOPMENT_HANDOFF_RUN_CONFIGURATION_DIGEST");
  requireCondition(["EXECUTED", "FAILED", "BLOCKED"].includes(handoff.handoffStatus), "DEVELOPMENT_HANDOFF_STATUS");
  requireCondition(typeof handoff.lastPhase === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(handoff.lastPhase), "DEVELOPMENT_HANDOFF_LAST_PHASE");
  requireCondition(Array.isArray(handoff.stateTransitions) && handoff.stateTransitions.length >= 2 && handoff.stateTransitions.length <= 3, "DEVELOPMENT_HANDOFF_TRANSITIONS");
  handoff.stateTransitions.forEach(validateTransition);
  requireCondition(handoff.stateTransitions[0].state === "VALIDATING" && handoff.stateTransitions[0].atUtc === handoff.startedAtUtc, "DEVELOPMENT_HANDOFF_INITIAL_STATE");
  requireCondition(handoff.stateTransitions.every((row, index) => index === 0 || row.atUtc >= handoff.stateTransitions[index - 1].atUtc), "DEVELOPMENT_HANDOFF_TRANSITION_ORDER");
  if (expected.maximumTransitionUtc !== undefined) requireCondition(handoff.stateTransitions.every(row => Date.parse(row.atUtc) <= Date.parse(expected.maximumTransitionUtc)), "DEVELOPMENT_HANDOFF_FUTURE_TRANSITION");
  const stateSequence = handoff.stateTransitions.map(row => row.state);
  const expectedSequence = handoff.handoffStatus === "EXECUTED" ? ["VALIDATING", "RUNNING", "EXECUTED"] : handoff.handoffStatus === "FAILED" ? ["VALIDATING", "RUNNING", "FAILED"] : ["VALIDATING", "BLOCKED"];
  requireCondition(JSON.stringify(stateSequence) === JSON.stringify(expectedSequence), "DEVELOPMENT_HANDOFF_STATE_MACHINE");
  requireCondition(handoff.lastPhase === handoff.stateTransitions[handoff.stateTransitions.length - 2].state, "DEVELOPMENT_HANDOFF_LAST_PHASE_MISMATCH");
  requireCondition(handoff.candidateManifestPayloadSha256 === null || /^[0-9a-f]{64}$/.test(handoff.candidateManifestPayloadSha256), "DEVELOPMENT_HANDOFF_CANDIDATE_DIGEST");
  requireCondition(handoff.executionIdentitySha256 === null || /^[0-9a-f]{64}$/.test(handoff.executionIdentitySha256), "DEVELOPMENT_HANDOFF_EXECUTION_DIGEST");
  requireCondition(handoff.manifestPayloadSha256 === null || /^[0-9a-f]{64}$/.test(handoff.manifestPayloadSha256), "DEVELOPMENT_HANDOFF_MANIFEST_DIGEST");
  requireCondition(Array.isArray(handoff.outcomes), "DEVELOPMENT_HANDOFF_OUTCOMES");
  requireCondition(handoff.clinicalAccuracyClaimed === false && handoff.capabilityNotClaim === true && handoff.reportable === false && handoff.runtimeAuthority === false && handoff.projectGold === false && handoff.sourceLabelsAreProjectGold === false, "DEVELOPMENT_HANDOFF_CLAIM_BOUNDARY");
  for (const [field, value] of Object.entries({ attemptId: expected.attemptId, workflowRunId: expected.workflowRunId, workflowRunAttempt: expected.workflowRunAttempt, workflowSha: expected.workflowSha, startedAtUtc: expected.startedAtUtc, runConfigurationSha256: expected.runConfigurationSha256, candidateManifestPayloadSha256: expected.candidateManifestPayloadSha256, executionIdentitySha256: expected.executionIdentitySha256, manifestPayloadSha256: expected.manifestPayloadSha256 })) {
    if (value !== undefined) requireCondition(handoff[field] === value, `DEVELOPMENT_HANDOFF_IDENTITY:${field}`);
  }
  requireCondition(manifest && Array.isArray(manifest.records), "DEVELOPMENT_HANDOFF_MANIFEST");
  const eligibleRecords = new Set(manifest.records.filter(row => row.taskEligibility === "ELIGIBLE").map(row => row.recordHmacSha256));
  const identities = new Set();
  for (const row of handoff.outcomes) {
    validateOutcome(row, eligibleRecords, expected.sampleCounts);
    const identity = `${row.recordHmacSha256}:${row.detector}:${row.pass}`;
    requireCondition(!identities.has(identity), "DEVELOPMENT_HANDOFF_DUPLICATE_OUTCOME");
    identities.add(identity);
  }
  if (handoff.handoffStatus === "EXECUTED") {
    requireCondition(handoff.failureCode === null, "DEVELOPMENT_HANDOFF_EXECUTED_FAILURE_CODE");
    requireCondition(typeof handoff.candidateManifestPayloadSha256 === "string" && typeof handoff.executionIdentitySha256 === "string" && typeof handoff.manifestPayloadSha256 === "string", "DEVELOPMENT_HANDOFF_EXECUTION_IDENTITY");
    requireCondition(identities.size === eligibleRecords.size * DETECTORS.length * PASSES.length, "DEVELOPMENT_HANDOFF_OUTCOME_COUNT");
    for (const record of eligibleRecords) for (const detector of DETECTORS) for (const pass of PASSES) requireCondition(identities.has(`${record}:${detector}:${pass}`), "DEVELOPMENT_HANDOFF_OUTCOME_MISSING");
  } else {
    requireCondition(typeof handoff.failureCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(handoff.failureCode), "DEVELOPMENT_HANDOFF_TERMINAL_FAILURE_CODE");
    if (handoff.handoffStatus === "FAILED") requireCondition(typeof handoff.candidateManifestPayloadSha256 === "string" && typeof handoff.executionIdentitySha256 === "string" && typeof handoff.manifestPayloadSha256 === "string", "DEVELOPMENT_HANDOFF_EXECUTION_IDENTITY");
  }
  return handoff;
}

function createDevelopmentExecutionHandoff(input) {
  return {
    schema: "ekg-development-execution-handoff-v1",
    attemptId: input.config.attemptId,
    workflowRunId: input.config.workflowRunId,
    workflowRunAttempt: input.config.workflowRunAttempt,
    workflowSha: input.config.workflowSha,
    startedAtUtc: input.config.startedAtUtc,
    runConfigurationSha256: input.runConfigurationSha256,
    handoffStatus: input.handoffStatus,
    failureCode: input.failureCode || null,
    lastPhase: input.lastPhase,
    stateTransitions: input.stateTransitions,
    candidateManifestPayloadSha256: input.candidateManifestPayloadSha256 || null,
    executionIdentitySha256: input.executionIdentitySha256 || null,
    manifestPayloadSha256: input.manifestPayloadSha256 || null,
    outcomes: input.outcomes || [],
    ...CLAIM_BOUNDARY,
  };
}

function serializeDevelopmentExecutionHandoff(handoff) {
  const bytes = Buffer.from(`${JSON.stringify(handoff, null, 2)}\n`, "utf8");
  requireCondition(bytes.length <= MAX_HANDOFF_BYTES, "DEVELOPMENT_HANDOFF_TOO_LARGE");
  return bytes;
}

function writeDevelopmentExecutionHandoff(file, handoff) {
  const target = path.resolve(file);
  const parent = path.dirname(target);
  const parentStat = fs.lstatSync(parent);
  requireCondition(parentStat.isDirectory() && !parentStat.isSymbolicLink(), "DEVELOPMENT_HANDOFF_DIRECTORY");
  requireCondition(!fs.existsSync(target), "DEVELOPMENT_HANDOFF_COLLISION");
  const bytes = serializeDevelopmentExecutionHandoff(handoff);
  const stage = path.join(parent, `.${path.basename(target)}.${process.pid}.${Date.now()}`);
  try {
    fs.writeFileSync(stage, bytes, { flag: "wx", mode: 0o600 });
    const descriptor = fs.openSync(stage, "r+");
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.renameSync(stage, target);
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { force: true });
    throw error;
  }
  return { path: target, bytes: bytes.length };
}

function readDevelopmentExecutionHandoff(file) {
  const target = path.resolve(file);
  let stat;
  try { stat = fs.lstatSync(target); } catch (_) { throw new Error("DEVELOPMENT_EXECUTION_HANDOFF_MISSING"); }
  requireCondition(stat.isFile() && !stat.isSymbolicLink(), "DEVELOPMENT_HANDOFF_FILE");
  requireCondition(stat.size > 0 && stat.size <= MAX_HANDOFF_BYTES, "DEVELOPMENT_HANDOFF_SIZE");
  const bytes = fs.readFileSync(target);
  requireCondition(bytes.length === stat.size, "DEVELOPMENT_HANDOFF_READ_RACE");
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_HANDOFF_JSON"); }
  return value;
}

module.exports = { MAX_HANDOFF_BYTES, createDevelopmentExecutionHandoff, readDevelopmentExecutionHandoff, serializeDevelopmentExecutionHandoff, validateDevelopmentExecutionHandoff, writeDevelopmentExecutionHandoff };
