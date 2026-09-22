"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MAX_HANDOFF_BYTES, createDevelopmentExecutionHandoff, readDevelopmentExecutionHandoff, serializeDevelopmentExecutionHandoff, validateDevelopmentExecutionHandoff, writeDevelopmentExecutionHandoff } = require("../lib/development_execution_handoff");
const { deriveCandidateIsolationExpectation } = require("../lib/development_candidate_isolation");
const { collectCandidateRuntimeAttestation } = require("../lib/development_candidate_runtime_attestation");

const record = "record-000001";
const excluded = "record-000002";
const executionInput = { records: [{ executionRecordId: record, sampleCount: 30 }] };
const config = { attemptId: "attempt-1", workflowRunId: "workflow-1", workflowRunAttempt: 1, workflowSha: "c".repeat(40), startedAtUtc: "2026-09-22T12:00:00Z" };
const isolation = deriveCandidateIsolationExpectation({ networkIsolation: "SYNTHETIC_TEST_PROCESS" });
const runtimeAttestation = collectCandidateRuntimeAttestation(isolation.expectation);
const result = (detector, pass) => ({ executionRecordId: record, detector, pass, status: "SUCCESS", failureCode: null, predictedSampleIndices: [10, 20], algorithm: detector === "CURRENT_ENGINE" ? "candidate-v1" : "baseline-v1", latencyMs: 1.5, peakMemoryBytes: 1024 });
const handoff = createDevelopmentExecutionHandoff({
  config,
  runConfigurationSha256: "f".repeat(64),
  executionInputSha256: "1".repeat(64),
  candidateRuntimeIdentitySha256: "2".repeat(64),
  candidateIsolationExpectationSha256: isolation.candidateIsolationExpectationSha256,
  candidateRuntimeAttestation: runtimeAttestation.attestation,
  candidateRuntimeAttestationSha256: runtimeAttestation.candidateRuntimeAttestationSha256,
  handoffStatus: "EXECUTED",
  failureCode: null,
  lastPhase: "RUNNING",
  stateTransitions: [{ state: "VALIDATING", atUtc: config.startedAtUtc }, { state: "RUNNING", atUtc: config.startedAtUtc }, { state: "EXECUTED", atUtc: config.startedAtUtc }],
  candidateManifestPayloadSha256: "d".repeat(64),
  executionIdentitySha256: "e".repeat(64),
  manifestPayloadSha256: "9".repeat(64),
  outcomes: [result("CURRENT_ENGINE", "PRIMARY"), result("CURRENT_ENGINE", "REPLAY"), result("PAN_TOMPKINS", "PRIMARY"), result("PAN_TOMPKINS", "REPLAY")],
});
const expected = { ...config, runConfigurationSha256: "f".repeat(64), executionInputSha256: "1".repeat(64), candidateRuntimeIdentitySha256: "2".repeat(64), candidateIsolationExpectationSha256: isolation.candidateIsolationExpectationSha256, candidateIsolationExpectation: isolation.expectation, candidateManifestPayloadSha256: "d".repeat(64), executionIdentitySha256: "e".repeat(64), manifestPayloadSha256: "9".repeat(64) };
assert.strictEqual(validateDevelopmentExecutionHandoff(handoff, executionInput, expected), handoff);
assert.ok(serializeDevelopmentExecutionHandoff(handoff).length < MAX_HANDOFF_BYTES);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, extra: true }, executionInput, expected), /DEVELOPMENT_HANDOFF_FIELDS/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: handoff.outcomes.slice(1) }, executionInput, expected), /DEVELOPMENT_HANDOFF_OUTCOME_COUNT/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: [...handoff.outcomes, { ...handoff.outcomes[0] }] }, executionInput, expected), /DEVELOPMENT_HANDOFF_DUPLICATE_OUTCOME/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: handoff.outcomes.map((row, index) => index ? row : { ...row, executionRecordId: excluded }) }, executionInput, expected), /DEVELOPMENT_HANDOFF_RECORD/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: handoff.outcomes.map((row, index) => index ? row : { ...row, predictedSampleIndices: [20, 10] }) }, executionInput, expected), /DEVELOPMENT_HANDOFF_PREDICTION_ORDER/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: handoff.outcomes.map((row, index) => index ? row : { ...row, predictedSampleIndices: [30] }) }, executionInput, expected), /DEVELOPMENT_HANDOFF_PREDICTION_RANGE/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, workflowSha: "f".repeat(40) }, executionInput, expected), /DEVELOPMENT_HANDOFF_IDENTITY:workflowSha/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, executionInputSha256: "8".repeat(64) }, executionInput, expected), /DEVELOPMENT_HANDOFF_IDENTITY:executionInputSha256/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, candidateRuntimeIdentitySha256: "8".repeat(64) }, executionInput, expected), /DEVELOPMENT_HANDOFF_IDENTITY:candidateRuntimeIdentitySha256/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, candidateRuntimeAttestation: { ...handoff.candidateRuntimeAttestation, candidateReferenceIsolation: true } }, executionInput, expected), /DEVELOPMENT_CANDIDATE_REFERENCE_ISOLATION_MUST_REMAIN_FALSE/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, candidateRuntimeAttestationSha256: "8".repeat(64) }, executionInput, expected), /DEVELOPMENT_CANDIDATE_RUNTIME_ATTESTATION_DIGEST/);
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evaluation", "schemas", "DEVELOPMENT_EXECUTION_HANDOFF_SCHEMA.json"), "utf8"));
assert.equal(schema.$id, "ekg-development-execution-handoff-v2");
assert.equal(schema.properties.stateTransitions.maxItems, 3);
assert.equal(schema.properties.outcomes.uniqueItems, true);
assert.equal(schema.properties.outcomes.items.properties.predictedSampleIndices.uniqueItems, true);
assert.match(schema.$comment, /validateDevelopmentExecutionHandoff is mandatory/);
assert.equal(schema.allOf.length, 3);
assert.equal(schema.allOf.find(rule => rule.if.properties.handoffStatus.const === "BLOCKED").then.properties.outcomes.maxItems, 0);
assert.equal(schema.properties.outcomes.items.allOf[0].else.properties.predictedSampleIndices.maxItems, 0);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-handoff-"));
try {
  const file = path.join(temporaryRoot, "execution.json");
  writeDevelopmentExecutionHandoff(file, handoff);
  assert.deepEqual(readDevelopmentExecutionHandoff(file), handoff);
  assert.equal(fs.readFileSync(file, "utf8").includes("Hmac"), false);
  assert.throws(() => writeDevelopmentExecutionHandoff(file, handoff), /DEVELOPMENT_HANDOFF_COLLISION/);
  const target = path.join(temporaryRoot, "target.json");
  fs.writeFileSync(target, "{}\n");
  const link = path.join(temporaryRoot, "link.json");
  try {
    fs.symlinkSync(target, link);
    assert.throws(() => readDevelopmentExecutionHandoff(link), /DEVELOPMENT_HANDOFF_FILE/);
    assert.throws(() => writeDevelopmentExecutionHandoff(link, handoff), /DEVELOPMENT_HANDOFF_COLLISION/);
  } catch (error) {
    if (!error || !["EPERM", "EACCES"].includes(error.code)) throw error;
  }
  const originalFstatSync = fs.fstatSync;
  let fstatCount = 0;
  fs.fstatSync = (...args) => {
    const value = originalFstatSync(...args);
    fstatCount += 1;
    if (fstatCount !== 2) return value;
    return { ...value, isFile: value.isFile.bind(value), mtimeNs: value.mtimeNs + 1n };
  };
  try {
    assert.throws(() => readDevelopmentExecutionHandoff(file), /DEVELOPMENT_HANDOFF_READ_RACE/);
  } finally {
    fs.fstatSync = originalFstatSync;
  }
  const linkedParent = path.join(temporaryRoot, "linked-parent");
  try {
    fs.symlinkSync(temporaryRoot, linkedParent, "junction");
    assert.throws(() => writeDevelopmentExecutionHandoff(path.join(linkedParent, "nested.json"), handoff), /DEVELOPMENT_HANDOFF_DIRECTORY/);
  } catch (error) {
    if (!error || !["EPERM", "EACCES"].includes(error.code)) throw error;
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("development execution handoff tests passed");
