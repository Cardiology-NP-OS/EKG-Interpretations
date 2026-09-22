"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { canonicalBytes, createDevelopmentExecutionInput, readDevelopmentExecutionInput } = require("../lib/development_execution_input");
const { deriveCandidateIsolationExpectation } = require("../lib/development_candidate_isolation");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-input-"));
const config = { attemptId: "synthetic-input-1", workflowRunId: "workflow-1", workflowRunAttempt: 1, workflowSha: "a".repeat(40), startedAtUtc: "2026-09-22T12:00:00Z", engineCommitDigest: "a".repeat(40), engineTreeDigest: "b".repeat(40) };
const isolation = deriveCandidateIsolationExpectation({ networkIsolation: "SYNTHETIC_TEST_PROCESS" });
const create = name => {
  const target = path.join(root, name);
  fs.mkdirSync(target);
  return createDevelopmentExecutionInput(target, {
    config,
    runConfigurationSha256: "1".repeat(64),
    candidateManifestPayloadSha256: "2".repeat(64),
    executionIdentitySha256: "3".repeat(64),
    candidateRuntimeIdentitySha256: "5".repeat(64),
    manifestPayloadSha256: "4".repeat(64),
    candidateIsolationExpectation: isolation.expectation,
    candidateIsolationExpectationSha256: isolation.candidateIsolationExpectationSha256,
    records: [{ sampleRateHz: 250, samples: [0, 0.25, -0.5, 1], lead: "II", referenceSampleIndices: [1], patientHmacSha256: "SENTINEL_PROTECTED_METADATA", rights: { source: "restricted" } }],
  });
};
try {
  const created = create("valid");
  assert.match(created.executionInputSha256, /^[0-9a-f]{64}$/);
  assert.equal(created.index.records[0].executionRecordId, "record-000001");
  assert.equal(created.index.candidateIsolationMode, "SYNTHETIC_IN_PROCESS");
  assert.equal(created.index.candidateIsolationState, "PENDING_EXTERNAL_CONTROL_PLANE_ATTESTATION");
  assert.equal(created.index.candidateIsolationExpectationSha256, isolation.candidateIsolationExpectationSha256);
  assert.deepEqual(created.records[0].samples, [0, 0.25, -0.5, 1]);
  const packageText = fs.readFileSync(path.join(root, "valid", "input.json"), "utf8") + fs.readFileSync(path.join(root, "valid", "signals", "record-000001.json"), "utf8");
  for (const forbidden of ["referenceSampleIndices", "referenceEventCount", "patientHmacSha256", "recordHmacSha256", "subgroups", "rights", "lead", "SENTINEL_PROTECTED_METADATA"]) assert.equal(packageText.includes(forbidden), false, forbidden);
  assert.equal(fs.readFileSync(path.join(root, "valid", "signals", "record-000001.json")).equals(canonicalBytes({ sampleRateHz: 250, samples: [0, 0.25, -0.5, 1] })), true);
  assert.throws(() => readDevelopmentExecutionInput(path.join(root, "valid"), { executionInputSha256: "0".repeat(64) }), /DEVELOPMENT_EXECUTION_INPUT_DIGEST_MISMATCH/);

  create("extra");
  fs.writeFileSync(path.join(root, "extra", "signals", "extra.json"), "{}\n");
  assert.throws(() => readDevelopmentExecutionInput(path.join(root, "extra")), /DEVELOPMENT_EXECUTION_INPUT_SIGNAL_INVENTORY/);

  create("hash");
  fs.appendFileSync(path.join(root, "hash", "signals", "record-000001.json"), " ");
  assert.throws(() => readDevelopmentExecutionInput(path.join(root, "hash")), /DEVELOPMENT_EXECUTION_INPUT_SIGNAL_LENGTH/);

  create("traversal");
  const traversalIndexPath = path.join(root, "traversal", "input.json");
  const traversalIndex = JSON.parse(fs.readFileSync(traversalIndexPath, "utf8"));
  traversalIndex.records[0].signalFile = "../reference.json";
  fs.writeFileSync(traversalIndexPath, canonicalBytes(traversalIndex));
  assert.throws(() => readDevelopmentExecutionInput(path.join(root, "traversal")), /DEVELOPMENT_EXECUTION_INPUT_SIGNAL_FILE/);

  create("canonical");
  const inputPath = path.join(root, "canonical", "input.json");
  const index = JSON.parse(fs.readFileSync(inputPath, "utf8"));
  fs.writeFileSync(inputPath, `${JSON.stringify(index, null, 2)}\n`);
  assert.throws(() => readDevelopmentExecutionInput(path.join(root, "canonical")), /DEVELOPMENT_EXECUTION_INPUT_INDEX_CANONICAL/);

  create("nonfinite");
  const signalPath = path.join(root, "nonfinite", "signals", "record-000001.json");
  const signalBytes = Buffer.from('{"sampleRateHz":250,"samples":[1e999]}\n');
  fs.writeFileSync(signalPath, signalBytes);
  const nonfiniteIndexPath = path.join(root, "nonfinite", "input.json");
  const nonfiniteIndex = JSON.parse(fs.readFileSync(nonfiniteIndexPath, "utf8"));
  nonfiniteIndex.records[0].signalBytes = signalBytes.length;
  nonfiniteIndex.records[0].signalSha256 = require("crypto").createHash("sha256").update(signalBytes).digest("hex");
  nonfiniteIndex.records[0].sampleCount = 1;
  fs.writeFileSync(nonfiniteIndexPath, canonicalBytes(nonfiniteIndex));
  assert.throws(() => readDevelopmentExecutionInput(path.join(root, "nonfinite")), /DEVELOPMENT_EXECUTION_INPUT_SIGNAL_FINITE/);

  create("signal-symlink");
  const linkedSignal = path.join(root, "signal-symlink", "signals", "record-000001.json");
  const linkedTarget = path.join(root, "linked-target.json");
  fs.copyFileSync(linkedSignal, linkedTarget);
  fs.rmSync(linkedSignal);
  try {
    fs.symlinkSync(linkedTarget, linkedSignal);
    assert.throws(() => readDevelopmentExecutionInput(path.join(root, "signal-symlink")), /DEVELOPMENT_EXECUTION_INPUT_SIGNAL_FILE_TYPE/);
  } catch (error) {
    if (!error || !["EPERM", "EACCES"].includes(error.code)) throw error;
  }

  const ancestorTarget = path.join(root, "ancestor-target");
  fs.mkdirSync(ancestorTarget);
  const ancestorPackage = path.join(ancestorTarget, "package");
  fs.mkdirSync(ancestorPackage);
  const ancestorLink = path.join(root, "ancestor-link");
  try {
    fs.symlinkSync(ancestorTarget, ancestorLink, "junction");
    assert.throws(() => createDevelopmentExecutionInput(path.join(ancestorLink, "package"), { config, runConfigurationSha256: "1".repeat(64), candidateManifestPayloadSha256: "2".repeat(64), executionIdentitySha256: "3".repeat(64), candidateRuntimeIdentitySha256: "5".repeat(64), manifestPayloadSha256: "4".repeat(64), candidateIsolationExpectation: isolation.expectation, candidateIsolationExpectationSha256: isolation.candidateIsolationExpectationSha256, records: [{ sampleRateHz: 250, samples: [0, 1] }] }), /DEVELOPMENT_EXECUTION_INPUT_ANCESTOR_SYMLINK/);
    createDevelopmentExecutionInput(ancestorPackage, { config, runConfigurationSha256: "1".repeat(64), candidateManifestPayloadSha256: "2".repeat(64), executionIdentitySha256: "3".repeat(64), candidateRuntimeIdentitySha256: "5".repeat(64), manifestPayloadSha256: "4".repeat(64), candidateIsolationExpectation: isolation.expectation, candidateIsolationExpectationSha256: isolation.candidateIsolationExpectationSha256, records: [{ sampleRateHz: 250, samples: [0, 1] }] });
    assert.throws(() => readDevelopmentExecutionInput(path.join(ancestorLink, "package")), /DEVELOPMENT_EXECUTION_INPUT_ANCESTOR_SYMLINK/);
  } catch (error) {
    if (!error || !["EPERM", "EACCES"].includes(error.code)) throw error;
  }

  const symlinkRoot = path.join(root, "symlink");
  const targetRoot = path.join(root, "symlink-target");
  fs.mkdirSync(targetRoot);
  try {
    fs.symlinkSync(targetRoot, symlinkRoot, "junction");
    assert.throws(() => readDevelopmentExecutionInput(symlinkRoot), /DEVELOPMENT_EXECUTION_INPUT_DIRECTORY/);
  } catch (error) {
    if (!error || !["EPERM", "EACCES"].includes(error.code)) throw error;
  }

  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evaluation", "schemas", "DEVELOPMENT_EXECUTION_INPUT_SCHEMA.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.records.maxItems, 4096);
  assert.equal(schema.properties.candidateInputMode.const, "SIGNAL_ONLY_READ_ONLY_V1");
  const candidateConfigSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evaluation", "schemas", "DEVELOPMENT_CANDIDATE_RUN_CONFIG_SCHEMA.json"), "utf8"));
  const signerConfigSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evaluation", "schemas", "DEVELOPMENT_RUN_CONFIG_SCHEMA.json"), "utf8"));
  assert.equal(candidateConfigSchema.additionalProperties, false);
  assert.deepEqual(candidateConfigSchema.required.slice().sort(), Object.keys(candidateConfigSchema.properties).sort());
  const isolationSchema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "evaluation", "schemas", "DEVELOPMENT_CANDIDATE_ISOLATION_EXPECTATION_SCHEMA.json"), "utf8"));
  assert.equal(isolationSchema.$id, isolation.expectation.schema);
  assert.equal(signerConfigSchema.$id, "ekg-development-run-config-v4");
  assert.ok(signerConfigSchema.required.includes("executionInputRoot"));
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("development execution input tests passed");
