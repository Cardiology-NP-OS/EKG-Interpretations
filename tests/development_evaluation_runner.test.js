"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadEvaluationRecord, readExact, runDevelopmentEvaluation, validateRunConfig } = require("../lib/development_evaluation_runner");
const { verifyEvaluationBundle } = require("../lib/evaluation_artifact_store");
const { verifyCompletedDevelopmentAttempt, verifyDevelopmentAttempt } = require("../lib/development_attempt_store");

function syntheticSignal(length, peaks) {
  const samples = Array.from({ length }, (_, index) => 0.015 * Math.sin(index * 0.03));
  for (const peak of peaks) {
    [-0.2, -0.5, 0.2, 1.5, 0.2, -0.5, -0.2].forEach((value, offset) => { samples[peak + offset - 3] += value; });
  }
  return samples;
}

const repositoryRoot = path.join(__dirname, "..");
const repositoryHead = childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-runner-"));
try {
  const corpusRoot = path.join(temporaryRoot, "corpus");
  const artifactRoot = path.join(temporaryRoot, "artifacts");
  fs.mkdirSync(path.join(corpusRoot, "signals"), { recursive: true });
  fs.mkdirSync(path.join(corpusRoot, "references"), { recursive: true });
  const peaks = [250, 500, 750, 1000];
  const signalBytes = Buffer.from(`${JSON.stringify({ sampleRateHz: 250, lead: "II", samples: syntheticSignal(1250, peaks) })}\n`, "utf8");
  const referenceBytes = Buffer.from(`${JSON.stringify({ referenceSampleIndices: peaks })}\n`, "utf8");
  fs.writeFileSync(path.join(corpusRoot, "signals", "record-1.json"), signalBytes);
  fs.writeFileSync(path.join(corpusRoot, "references", "record-1.json"), referenceBytes);
  const bundleKeys = crypto.generateKeyPairSync("ed25519");
  const previousNetwork = process.env.EKG_EVALUATION_NETWORK_DISABLED;
  process.env.EKG_EVALUATION_NETWORK_DISABLED = "1";
  const config = {
    repositoryRoot,
    manifestPath: path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_MANIFEST_V2.json"),
    manifestSignaturePath: path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_MANIFEST_V2.sig"),
    partitionIndexPath: path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_PARTITION_INDEX_V2.json"),
    candidateManifestPath: path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_CANDIDATE_V1.json"),
    candidateSignaturePath: path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_CANDIDATE_V1.sig"),
    candidateTrustStorePath: path.join(repositoryRoot, "evaluation", "keys", "DEVELOPMENT_CANDIDATE_SIGNERS.json"),
    expectedCandidateTrustStoreSha256: "2df8894d1ffa708307f47d0d58ee0be1f640edef6e786698704395bc8843969d",
    corpusRoot,
    artifactRoot,
    inputMountMode: "READ_ONLY",
    networkIsolation: "SYNTHETIC_TEST_PROCESS",
    storageMode: "APPLICATION_WRITE_ONCE_SIGNED",
    startedAtUtc: "2026-09-22T12:00:00Z",
    attemptId: "synthetic-success",
    workflowRunId: "synthetic-workflow",
    workflowRunAttempt: 1,
    workflowSha: repositoryHead,
    trigger: "synthetic-test",
    bootstrap: { replicates: 50, seed: 11 },
    signingPrivateKeyPem: bundleKeys.privateKey.export({ type: "pkcs8", format: "pem" }),
    signerKeyId: "synthetic-bundle-signer",
    allowDirtySyntheticTest: true,
  };
  const attempt = (attemptId, overrides = {}) => ({ ...config, ...overrides, attemptId });
  const publicKeyPem = bundleKeys.publicKey.export({ type: "spki", format: "pem" });
  assert.throws(() => validateRunConfig({ ...config, previousApprovedBundlePath: "prior" }), /DEVELOPMENT_PREVIOUS_BASELINE_CONFIG/);
  assert.throws(() => runDevelopmentEvaluation(attempt("network-block", { networkIsolation: "CONTAINER_NETWORK_NONE", trigger: "merge-or-nightly", bootstrap: { replicates: 2000, seed: 11 }, environmentImageDigest: "a".repeat(64) })), /DEVELOPMENT_EXTERNAL_MANIFEST_TRUST_REQUIRED/);
  assert.throws(() => runDevelopmentEvaluation(attempt("candidate-trust-block", { expectedCandidateTrustStoreSha256: "0".repeat(64) })), /DEVELOPMENT_CANDIDATE_TRUST_JSON_HASH/);
  assert.throws(() => runDevelopmentEvaluation(attempt("manifest-trust-block", { expectedManifestTrustStoreSha256: "0".repeat(64) })), /DEVELOPMENT_MANIFEST_TRUST_JSON_HASH/);
  const signalPath = path.join(corpusRoot, "signals", "record-1.json");
  const originalSignalBytes = fs.readFileSync(signalPath);
  const cleanPartition = JSON.parse(fs.readFileSync(config.partitionIndexPath, "utf8"));
  const invalidPartition = JSON.parse(JSON.stringify(cleanPartition));
  invalidPartition.rows[1].patientHmacSha256 = invalidPartition.rows[0].patientHmacSha256;
  const invalidPartitionPath = path.join(temporaryRoot, "invalid-partition.json");
  fs.writeFileSync(invalidPartitionPath, JSON.stringify(invalidPartition));
  fs.writeFileSync(signalPath, Buffer.concat([originalSignalBytes, Buffer.from(" ")]));
  assert.throws(() => runDevelopmentEvaluation(attempt("partition-block", { partitionIndexPath: invalidPartitionPath })), /DEVELOPMENT_PARTITION_PATIENT_LEAKAGE/);
  assert.throws(() => runDevelopmentEvaluation(attempt("sha-mismatch", { workflowSha: "0".repeat(40), allowDirtySyntheticTest: false })), /DEVELOPMENT_WORKFLOW_SHA_MISMATCH/);
  const shaMismatchAttempt = verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", "sha-mismatch"), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(shaMismatchAttempt.terminal.lastPhase, "VALIDATING");
  assert.equal(shaMismatchAttempt.terminal.accounting, null);
  assert.throws(() => runDevelopmentEvaluation(attempt("signal-failure")), /DEVELOPMENT_SIGNAL_BYTES/);
  const failedAttemptPath = path.join(artifactRoot, "attempts", "2026", "09", "22", "signal-failure");
  const failedAttempt = verifyDevelopmentAttempt(failedAttemptPath, publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(failedAttempt.executionStatus, "FAILED");
  assert.equal(failedAttempt.terminal.lastPhase, "RUNNING");
  assert.equal(failedAttempt.terminal.failureCode, "DEVELOPMENT_SIGNAL_BYTES");
  assert.equal(failedAttempt.terminal.accounting.rows.length, 4);
  assert.equal(failedAttempt.terminal.accounting.rows.every(row => row.status === "NOT_RUN" && row.failureCode === "NOT_ATTEMPTED"), true);
  fs.writeFileSync(signalPath, originalSignalBytes);
  const fixtureManifest = JSON.parse(fs.readFileSync(config.manifestPath, "utf8"));
  const wrongLeadBytes = Buffer.from(`${JSON.stringify({ sampleRateHz: 250, lead: "V1", samples: syntheticSignal(1250, peaks) })}\n`, "utf8");
  fs.writeFileSync(signalPath, wrongLeadBytes);
  const wrongLeadRecord = { ...fixtureManifest.records[0], signalBytes: wrongLeadBytes.length, sourceFileSha256: crypto.createHash("sha256").update(wrongLeadBytes).digest("hex") };
  assert.throws(() => loadEvaluationRecord(corpusRoot, wrongLeadRecord, fixtureManifest.leadPolicy), /DEVELOPMENT_SIGNAL_LEAD_DRIFT/);
  fs.writeFileSync(signalPath, originalSignalBytes);
  const receipt = runDevelopmentEvaluation(config);
  assert.equal(receipt.writeOnce, false);
  assert.equal(receipt.applicationCollisionProtected, true);
  assert.equal(receipt.externalObjectLockAttested, false);
  const verified = verifyEvaluationBundle(receipt.path, publicKeyPem);
  assert.equal(verified.pass, true);
  assert.equal(verified.artifactCount, 14);
  assert.equal(verified.runManifest.executionStatus, "PUBLISHING");
  assert.equal(verified.runManifest.gateStatus, "QUARANTINED");
  assert.equal(verified.runManifest.attemptId, config.attemptId);
  const completedAttempt = verifyCompletedDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", config.attemptId), artifactRoot, publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(completedAttempt.executionStatus, "COMPLETED");
  assert.equal(completedAttempt.bundleVerification.pass, true);
  assert.equal(completedAttempt.terminal.gateStatus, "QUARANTINED");
  assert.equal(completedAttempt.terminal.accounting.byDetectorAndPass.every(row => row.SUCCESS === 1 && row.NOT_RUN === 0), true);
  const report = JSON.parse(fs.readFileSync(path.join(receipt.path, "development-report.json"), "utf8"));
  assert.equal(report.clinicalAccuracyClaimed, false);
  assert.equal(report.currentEngine.denominators.nRecords, 1);
  assert.equal(report.panTompkins.denominators.nRecords, 1);
  assert.equal(report.currentEngine.records, undefined);
  const candidateDigests = JSON.parse(fs.readFileSync(path.join(receipt.path, "candidate-digests.json"), "utf8"));
  assert.equal(candidateDigests.candidateManifest.manifestPayloadSha256, "f7b2940b02d328739c4296384fb8be2851647837c601467dab820179ec7d6d24");
  assert.equal(candidateDigests.candidateSignature.keyId, "synthetic-development-candidate-2026-09-22");
  assert.equal(candidateDigests.candidateTrustStoreSha256, config.expectedCandidateTrustStoreSha256);
  assert.match(candidateDigests.candidateSignerPublicKeySha256, /^[0-9a-f]{64}$/);
  const publishedText = fs.readdirSync(receipt.path).filter(name => name.endsWith(".json")).map(name => fs.readFileSync(path.join(receipt.path, name), "utf8")).join("\n");
  const protectedRows = cleanPartition.rows.filter(row => row.splitRole !== "development");
  for (const row of protectedRows) {
    for (const field of ["recordHmacSha256", "patientHmacSha256", "sourceFileSha256", "nearDuplicateGroupSha256"]) assert.equal(publishedText.includes(row[field]), false);
  }
  assert.throws(() => runDevelopmentEvaluation(attempt("bundle-collision")), /EVALUATION_BUNDLE_IMMUTABLE_COLLISION/);
  const collisionAttempt = verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", "bundle-collision"), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(collisionAttempt.executionStatus, "FAILED");
  assert.equal(collisionAttempt.terminal.failureCode, "EVALUATION_BUNDLE_IMMUTABLE_COLLISION");
  const gatesPath = path.join(receipt.path, "gates.json");
  const original = fs.readFileSync(gatesPath);
  fs.writeFileSync(gatesPath, Buffer.concat([original, Buffer.from(" ")]));
  assert.throws(() => verifyEvaluationBundle(receipt.path, publicKeyPem), /EVALUATION_BUNDLE_ARTIFACT_HASH/);
  assert.throws(() => verifyCompletedDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", config.attemptId), artifactRoot, publicKeyPem, { expectedSignerKeyId: config.signerKeyId }), /EVALUATION_BUNDLE_ARTIFACT_HASH/);
  if (previousNetwork === undefined) delete process.env.EKG_EVALUATION_NETWORK_DISABLED;
  else process.env.EKG_EVALUATION_NETWORK_DISABLED = previousNetwork;
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("development evaluation runner tests passed");
