"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { stableJson } = require("./evaluation_runtime");
const { payloadSha256 } = require("./evaluation_signatures");
const { CANDIDATE_INPUT_MODE, validateCandidateIsolationExpectation } = require("./development_candidate_isolation");

const CLAIM_BOUNDARY = Object.freeze({ clinicalAccuracyClaimed: false, capabilityNotClaim: true, reportable: false, runtimeAuthority: false, projectGold: false, sourceLabelsAreProjectGold: false });
const MAX_INDEX_BYTES = 4 * 1024 * 1024;
const MAX_SIGNAL_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const MAX_RECORDS = 4096;
const MAX_SAMPLES_PER_RECORD = 10000000;

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function exactKeys(value, expected, code) {
  requireCondition(plain(value), code);
  requireCondition(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.slice().sort()), code);
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function canonicalBytes(value) {
  return Buffer.from(`${stableJson(value)}\n`, "utf8");
}

function assertDirectory(directory, code) {
  const stat = fs.lstatSync(directory);
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), code);
}

function assertNoSymlinkAncestors(directory) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    requireCondition(!stat.isSymbolicLink(), "DEVELOPMENT_EXECUTION_INPUT_ANCESTOR_SYMLINK");
    if (current === path.parse(current).root) break;
  }
}

function validateRecordIndex(record, index) {
  exactKeys(record, ["executionRecordId", "signalFile", "signalSha256", "signalBytes", "sampleCount", "sampleRateHz"], "DEVELOPMENT_EXECUTION_INPUT_RECORD_FIELDS");
  const expectedId = `record-${String(index + 1).padStart(6, "0")}`;
  requireCondition(record.executionRecordId === expectedId, "DEVELOPMENT_EXECUTION_INPUT_RECORD_ORDER");
  requireCondition(record.signalFile === `signals/${expectedId}.json`, "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_FILE");
  requireCondition(/^[0-9a-f]{64}$/.test(record.signalSha256), "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_DIGEST");
  requireCondition(Number.isSafeInteger(record.signalBytes) && record.signalBytes > 0 && record.signalBytes <= MAX_SIGNAL_BYTES, "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_BYTES");
  requireCondition(Number.isSafeInteger(record.sampleCount) && record.sampleCount > 0 && record.sampleCount <= MAX_SAMPLES_PER_RECORD, "DEVELOPMENT_EXECUTION_INPUT_SAMPLE_COUNT");
  requireCondition(Number.isInteger(record.sampleRateHz) && record.sampleRateHz > 0 && record.sampleRateHz <= 100000, "DEVELOPMENT_EXECUTION_INPUT_SAMPLE_RATE");
}

function validateIndex(index) {
  exactKeys(index, ["schema", "attemptId", "workflowRunId", "workflowRunAttempt", "workflowSha", "startedAtUtc", "runConfigurationSha256", "candidateManifestPayloadSha256", "executionIdentitySha256", "candidateRuntimeIdentitySha256", "manifestPayloadSha256", "engineCommitDigest", "engineTreeDigest", "candidateInputMode", "candidateIsolationMode", "candidateIsolationState", "candidateRuntimeImageDigest", "candidateLaunchPolicySha256", "candidateExpectedUid", "candidateExpectedGid", "candidateIsolationExpectationSha256", "records", "clinicalAccuracyClaimed", "capabilityNotClaim", "reportable", "runtimeAuthority", "projectGold", "sourceLabelsAreProjectGold"], "DEVELOPMENT_EXECUTION_INPUT_FIELDS");
  requireCondition(index.schema === "ekg-development-execution-input-v1", "DEVELOPMENT_EXECUTION_INPUT_SCHEMA");
  requireCondition(typeof index.attemptId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(index.attemptId), "DEVELOPMENT_EXECUTION_INPUT_ATTEMPT_ID");
  requireCondition(typeof index.workflowRunId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(index.workflowRunId), "DEVELOPMENT_EXECUTION_INPUT_WORKFLOW_RUN_ID");
  requireCondition(Number.isInteger(index.workflowRunAttempt) && index.workflowRunAttempt > 0, "DEVELOPMENT_EXECUTION_INPUT_WORKFLOW_RUN_ATTEMPT");
  for (const field of ["workflowSha", "engineCommitDigest", "engineTreeDigest"]) requireCondition(/^[0-9a-f]{40}$/.test(index[field]), `DEVELOPMENT_EXECUTION_INPUT_DIGEST:${field}`);
  requireCondition(index.workflowSha === index.engineCommitDigest, "DEVELOPMENT_EXECUTION_INPUT_WORKFLOW_COMMIT");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(index.startedAtUtc), "DEVELOPMENT_EXECUTION_INPUT_STARTED_AT");
  for (const field of ["runConfigurationSha256", "candidateManifestPayloadSha256", "executionIdentitySha256", "candidateRuntimeIdentitySha256", "manifestPayloadSha256", "candidateLaunchPolicySha256", "candidateIsolationExpectationSha256"]) requireCondition(/^[0-9a-f]{64}$/.test(index[field]), `DEVELOPMENT_EXECUTION_INPUT_DIGEST:${field}`);
  requireCondition(index.candidateInputMode === CANDIDATE_INPUT_MODE, "DEVELOPMENT_EXECUTION_INPUT_MODE");
  requireCondition(["SYNTHETIC_IN_PROCESS", "PINNED_SIGNAL_ONLY_CONTAINER"].includes(index.candidateIsolationMode), "DEVELOPMENT_EXECUTION_INPUT_ISOLATION_MODE");
  requireCondition(index.candidateIsolationState === "PENDING_EXTERNAL_CONTROL_PLANE_ATTESTATION", "DEVELOPMENT_EXECUTION_INPUT_ISOLATION_STATE");
  if (index.candidateIsolationMode === "SYNTHETIC_IN_PROCESS") requireCondition(index.candidateRuntimeImageDigest === null && index.candidateExpectedUid === null && index.candidateExpectedGid === null, "DEVELOPMENT_EXECUTION_INPUT_SYNTHETIC_ISOLATION");
  else requireCondition(/^[0-9a-f]{64}$/.test(index.candidateRuntimeImageDigest) && Number.isSafeInteger(index.candidateExpectedUid) && index.candidateExpectedUid >= 0 && Number.isSafeInteger(index.candidateExpectedGid) && index.candidateExpectedGid >= 0, "DEVELOPMENT_EXECUTION_INPUT_CONTAINER_ISOLATION");
  validateCandidateIsolationExpectation({ schema: "ekg-development-candidate-isolation-expectation-v1", attestationState: index.candidateIsolationState, isolationMode: index.candidateIsolationMode, candidateInputMode: index.candidateInputMode, candidateRuntimeImageDigest: index.candidateRuntimeImageDigest, candidateLaunchPolicySha256: index.candidateLaunchPolicySha256, expectedUid: index.candidateExpectedUid, expectedGid: index.candidateExpectedGid }, index.candidateIsolationExpectationSha256);
  requireCondition(Array.isArray(index.records) && index.records.length > 0 && index.records.length <= MAX_RECORDS, "DEVELOPMENT_EXECUTION_INPUT_RECORDS");
  index.records.forEach(validateRecordIndex);
  requireCondition(index.clinicalAccuracyClaimed === false && index.capabilityNotClaim === true && index.reportable === false && index.runtimeAuthority === false && index.projectGold === false && index.sourceLabelsAreProjectGold === false, "DEVELOPMENT_EXECUTION_INPUT_CLAIM_BOUNDARY");
  return index;
}

function validateSignal(signal, record) {
  exactKeys(signal, ["sampleRateHz", "samples"], "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_FIELDS");
  requireCondition(signal.sampleRateHz === record.sampleRateHz, "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_RATE");
  requireCondition(Array.isArray(signal.samples) && signal.samples.length === record.sampleCount && signal.samples.length <= MAX_SAMPLES_PER_RECORD, "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_COUNT");
  requireCondition(signal.samples.every(value => typeof value === "number" && Number.isFinite(value)), "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_FINITE");
  return signal;
}

function readDevelopmentExecutionInput(root, expected = {}) {
  const directory = path.resolve(root);
  let rootStat;
  try { rootStat = fs.lstatSync(directory); } catch (_) { throw new Error("DEVELOPMENT_EXECUTION_INPUT_MISSING"); }
  requireCondition(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "DEVELOPMENT_EXECUTION_INPUT_DIRECTORY");
  assertNoSymlinkAncestors(directory);
  const rootEntries = fs.readdirSync(directory).sort();
  requireCondition(JSON.stringify(rootEntries) === JSON.stringify(["input.json", "signals"]), "DEVELOPMENT_EXECUTION_INPUT_INVENTORY");
  const signalsRoot = path.join(directory, "signals");
  assertDirectory(signalsRoot, "DEVELOPMENT_EXECUTION_INPUT_SIGNALS_DIRECTORY");
  const inputFile = path.join(directory, "input.json");
  const inputStat = fs.lstatSync(inputFile);
  requireCondition(inputStat.isFile() && !inputStat.isSymbolicLink() && inputStat.size > 0 && inputStat.size <= MAX_INDEX_BYTES, "DEVELOPMENT_EXECUTION_INPUT_INDEX_FILE");
  const inputBytes = fs.readFileSync(inputFile);
  requireCondition(inputBytes.length === inputStat.size, "DEVELOPMENT_EXECUTION_INPUT_INDEX_RACE");
  let index;
  try { index = JSON.parse(inputBytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_EXECUTION_INPUT_INDEX_JSON"); }
  validateIndex(index);
  requireCondition(inputBytes.equals(canonicalBytes(index)), "DEVELOPMENT_EXECUTION_INPUT_INDEX_CANONICAL");
  const executionInputSha256 = payloadSha256(index);
  for (const [field, value] of Object.entries(expected)) {
    if (field === "executionInputSha256") requireCondition(executionInputSha256 === value, "DEVELOPMENT_EXECUTION_INPUT_DIGEST_MISMATCH");
    else if (value !== undefined) requireCondition(index[field] === value, `DEVELOPMENT_EXECUTION_INPUT_IDENTITY:${field}`);
  }
  const expectedFiles = index.records.map(record => path.basename(record.signalFile)).sort();
  requireCondition(JSON.stringify(fs.readdirSync(signalsRoot).sort()) === JSON.stringify(expectedFiles), "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_INVENTORY");
  let totalBytes = inputBytes.length;
  const records = [];
  for (const record of index.records) {
    const file = path.join(signalsRoot, path.basename(record.signalFile));
    const stat = fs.lstatSync(file);
    requireCondition(stat.isFile() && !stat.isSymbolicLink(), "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_FILE_TYPE");
    requireCondition(stat.size === record.signalBytes, "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_LENGTH");
    totalBytes += stat.size;
    requireCondition(totalBytes <= MAX_TOTAL_BYTES, "DEVELOPMENT_EXECUTION_INPUT_TOTAL_BYTES");
    const bytes = fs.readFileSync(file);
    requireCondition(bytes.length === stat.size, "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_RACE");
    requireCondition(sha256(bytes) === record.signalSha256, "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_HASH");
    let signal;
    try { signal = JSON.parse(bytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_EXECUTION_INPUT_SIGNAL_JSON"); }
    validateSignal(signal, record);
    requireCondition(bytes.equals(canonicalBytes(signal)), "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_CANONICAL");
    records.push({ ...record, samples: signal.samples });
  }
  return { index, executionInputSha256, records };
}

function createDevelopmentExecutionInput(root, input) {
  const directory = path.resolve(root);
  assertDirectory(directory, "DEVELOPMENT_EXECUTION_INPUT_DIRECTORY");
  assertNoSymlinkAncestors(directory);
  requireCondition(fs.readdirSync(directory).length === 0, "DEVELOPMENT_EXECUTION_INPUT_NOT_EMPTY");
  requireCondition(Array.isArray(input.records) && input.records.length > 0 && input.records.length <= MAX_RECORDS, "DEVELOPMENT_EXECUTION_INPUT_RECORDS");
  const signalsRoot = path.join(directory, "signals");
  fs.mkdirSync(signalsRoot, { mode: 0o700 });
  try {
    const records = input.records.map((loaded, index) => {
      requireCondition(loaded && Array.isArray(loaded.samples), "DEVELOPMENT_EXECUTION_INPUT_SOURCE_RECORD");
      const executionRecordId = `record-${String(index + 1).padStart(6, "0")}`;
      const signal = { sampleRateHz: loaded.sampleRateHz, samples: loaded.samples };
      const bytes = canonicalBytes(signal);
      requireCondition(bytes.length <= MAX_SIGNAL_BYTES, "DEVELOPMENT_EXECUTION_INPUT_SIGNAL_BYTES");
      const signalFile = `signals/${executionRecordId}.json`;
      fs.writeFileSync(path.join(directory, signalFile), bytes, { flag: "wx", mode: 0o600 });
      return { executionRecordId, signalFile, signalSha256: sha256(bytes), signalBytes: bytes.length, sampleCount: loaded.samples.length, sampleRateHz: loaded.sampleRateHz };
    });
    const index = {
      schema: "ekg-development-execution-input-v1",
      attemptId: input.config.attemptId,
      workflowRunId: input.config.workflowRunId,
      workflowRunAttempt: input.config.workflowRunAttempt,
      workflowSha: input.config.workflowSha,
      startedAtUtc: input.config.startedAtUtc,
      runConfigurationSha256: input.runConfigurationSha256,
      candidateManifestPayloadSha256: input.candidateManifestPayloadSha256,
      executionIdentitySha256: input.executionIdentitySha256,
      candidateRuntimeIdentitySha256: input.candidateRuntimeIdentitySha256,
      manifestPayloadSha256: input.manifestPayloadSha256,
      engineCommitDigest: input.config.engineCommitDigest,
      engineTreeDigest: input.config.engineTreeDigest,
      candidateInputMode: CANDIDATE_INPUT_MODE,
      candidateIsolationMode: input.candidateIsolationExpectation.isolationMode,
      candidateIsolationState: input.candidateIsolationExpectation.attestationState,
      candidateRuntimeImageDigest: input.candidateIsolationExpectation.candidateRuntimeImageDigest,
      candidateLaunchPolicySha256: input.candidateIsolationExpectation.candidateLaunchPolicySha256,
      candidateExpectedUid: input.candidateIsolationExpectation.expectedUid,
      candidateExpectedGid: input.candidateIsolationExpectation.expectedGid,
      candidateIsolationExpectationSha256: input.candidateIsolationExpectationSha256,
      records,
      ...CLAIM_BOUNDARY,
    };
    validateIndex(index);
    const bytes = canonicalBytes(index);
    requireCondition(bytes.length <= MAX_INDEX_BYTES, "DEVELOPMENT_EXECUTION_INPUT_INDEX_BYTES");
    fs.writeFileSync(path.join(directory, "input.json"), bytes, { flag: "wx", mode: 0o600 });
    return readDevelopmentExecutionInput(directory);
  } catch (error) {
    for (const entry of fs.readdirSync(directory)) fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
    throw error;
  }
}

module.exports = { CANDIDATE_INPUT_MODE, MAX_INDEX_BYTES, MAX_RECORDS, MAX_SAMPLES_PER_RECORD, MAX_SIGNAL_BYTES, MAX_TOTAL_BYTES, canonicalBytes, createDevelopmentExecutionInput, readDevelopmentExecutionInput, validateIndex };
