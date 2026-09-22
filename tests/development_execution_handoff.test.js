"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { MAX_HANDOFF_BYTES, createDevelopmentExecutionHandoff, readDevelopmentExecutionHandoff, serializeDevelopmentExecutionHandoff, validateDevelopmentExecutionHandoff, writeDevelopmentExecutionHandoff } = require("../lib/development_execution_handoff");

const record = "a".repeat(64);
const excluded = "b".repeat(64);
const manifest = { records: [{ recordHmacSha256: record, taskEligibility: "ELIGIBLE" }, { recordHmacSha256: excluded, taskEligibility: "EXCLUDED" }] };
const config = { attemptId: "attempt-1", workflowRunId: "workflow-1", workflowRunAttempt: 1, workflowSha: "c".repeat(40), startedAtUtc: "2026-09-22T12:00:00Z" };
const result = (detector, pass) => ({ recordHmacSha256: record, detector, pass, status: "SUCCESS", failureCode: null, predictedSampleIndices: [10, 20], algorithm: detector === "CURRENT_ENGINE" ? "candidate-v1" : "baseline-v1", latencyMs: 1.5, peakMemoryBytes: 1024 });
const handoff = createDevelopmentExecutionHandoff({
  config,
  runConfigurationSha256: "f".repeat(64),
  handoffStatus: "EXECUTED",
  failureCode: null,
  lastPhase: "RUNNING",
  stateTransitions: [{ state: "VALIDATING", atUtc: config.startedAtUtc }, { state: "RUNNING", atUtc: config.startedAtUtc }, { state: "EXECUTED", atUtc: config.startedAtUtc }],
  candidateManifestPayloadSha256: "d".repeat(64),
  executionIdentitySha256: "e".repeat(64),
  manifestPayloadSha256: "9".repeat(64),
  outcomes: [result("CURRENT_ENGINE", "PRIMARY"), result("CURRENT_ENGINE", "REPLAY"), result("PAN_TOMPKINS", "PRIMARY"), result("PAN_TOMPKINS", "REPLAY")],
});
const expected = { ...config, runConfigurationSha256: "f".repeat(64), candidateManifestPayloadSha256: "d".repeat(64), executionIdentitySha256: "e".repeat(64), manifestPayloadSha256: "9".repeat(64), sampleCounts: new Map([[record, 30]]) };
assert.strictEqual(validateDevelopmentExecutionHandoff(handoff, manifest, expected), handoff);
assert.ok(serializeDevelopmentExecutionHandoff(handoff).length < MAX_HANDOFF_BYTES);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, extra: true }, manifest, expected), /DEVELOPMENT_HANDOFF_FIELDS/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: handoff.outcomes.slice(1) }, manifest, expected), /DEVELOPMENT_HANDOFF_OUTCOME_COUNT/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: [...handoff.outcomes, { ...handoff.outcomes[0] }] }, manifest, expected), /DEVELOPMENT_HANDOFF_DUPLICATE_OUTCOME/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: handoff.outcomes.map((row, index) => index ? row : { ...row, recordHmacSha256: excluded }) }, manifest, expected), /DEVELOPMENT_HANDOFF_RECORD/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: handoff.outcomes.map((row, index) => index ? row : { ...row, predictedSampleIndices: [20, 10] }) }, manifest, expected), /DEVELOPMENT_HANDOFF_PREDICTION_ORDER/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, outcomes: handoff.outcomes.map((row, index) => index ? row : { ...row, predictedSampleIndices: [30] }) }, manifest, expected), /DEVELOPMENT_HANDOFF_PREDICTION_RANGE/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, workflowSha: "f".repeat(40) }, manifest, expected), /DEVELOPMENT_HANDOFF_IDENTITY:workflowSha/);
assert.throws(() => validateDevelopmentExecutionHandoff({ ...handoff, manifestPayloadSha256: "8".repeat(64) }, manifest, expected), /DEVELOPMENT_HANDOFF_IDENTITY:manifestPayloadSha256/);
const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evaluation", "schemas", "DEVELOPMENT_EXECUTION_HANDOFF_SCHEMA.json"), "utf8"));
assert.equal(schema.properties.stateTransitions.maxItems, 3);
assert.equal(schema.properties.outcomes.uniqueItems, true);
assert.equal(schema.properties.outcomes.items.properties.predictedSampleIndices.uniqueItems, true);
assert.match(schema.$comment, /validateDevelopmentExecutionHandoff is mandatory/);
assert.equal(schema.allOf.length, 3);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-handoff-"));
try {
  const file = path.join(temporaryRoot, "execution.json");
  writeDevelopmentExecutionHandoff(file, handoff);
  assert.deepEqual(readDevelopmentExecutionHandoff(file), handoff);
  assert.throws(() => writeDevelopmentExecutionHandoff(file, handoff), /DEVELOPMENT_HANDOFF_COLLISION/);
  const target = path.join(temporaryRoot, "target.json");
  fs.writeFileSync(target, "{}\n");
  const link = path.join(temporaryRoot, "link.json");
  try {
    fs.symlinkSync(target, link);
    assert.throws(() => readDevelopmentExecutionHandoff(link), /DEVELOPMENT_HANDOFF_FILE/);
  } catch (error) {
    if (!error || !["EPERM", "EACCES"].includes(error.code)) throw error;
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("development execution handoff tests passed");
