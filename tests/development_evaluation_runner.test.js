"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { gitIdentity, implementationDigest, loadEvaluationRecord, runDevelopmentCandidateExecution, runDevelopmentEvaluation, validateRunConfig } = require("../lib/development_evaluation_runner");
const { finalizeDevelopmentEvaluationAttempt, startDevelopmentEvaluationAttempt } = require("../lib/development_evaluation_signer");
const { verifyEvaluationBundle } = require("../lib/evaluation_artifact_store");
const { verifyCompletedDevelopmentAttempt, verifyDevelopmentAttempt } = require("../lib/development_attempt_store");

function syntheticSignal(length, peaks) {
  const samples = Array.from({ length }, (_, index) => 0.015 * Math.sin(index * 0.03));
  for (const peak of peaks) [-0.2, -0.5, 0.2, 1.5, 0.2, -0.5, -0.2].forEach((value, offset) => { samples[peak + offset - 3] += value; });
  return samples;
}

const repositoryRoot = path.join(__dirname, "..");
const repositoryHead = childProcess.execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
const repositoryIdentity = gitIdentity(repositoryRoot);
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
  const privateKeyPem = bundleKeys.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = bundleKeys.publicKey.export({ type: "spki", format: "pem" });
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
    engineCommitDigest: repositoryIdentity.commit,
    engineTreeDigest: repositoryIdentity.tree,
    worktreeClean: repositoryIdentity.worktreeClean,
    worktreeStatusSha256: repositoryIdentity.worktreeStatusSha256,
    trigger: "synthetic-test",
    bootstrap: { replicates: 50, seed: 11 },
    signerKeyId: "synthetic-bundle-signer",
    allowDirtySyntheticTest: true,
  };
  const attempt = (attemptId, overrides = {}) => ({ ...config, ...overrides, attemptId });
  assert.throws(() => validateRunConfig({ ...config, signingPrivateKeyPem: privateKeyPem }), /DEVELOPMENT_RUN_CONFIG_UNKNOWN_FIELD/);
  assert.throws(() => validateRunConfig({ ...config, previousApprovedBundlePath: "prior" }), /DEVELOPMENT_PREVIOUS_BASELINE_CONFIG/);
  assert.throws(() => runDevelopmentEvaluation(config), /DEVELOPMENT_EVALUATION_SPLIT_REQUIRED/);
  assert.equal(runDevelopmentCandidateExecution(attempt("candidate-trust-block", { expectedCandidateTrustStoreSha256: "0".repeat(64) })).failureCode, "DEVELOPMENT_CANDIDATE_TRUST_JSON_HASH");
  assert.equal(runDevelopmentCandidateExecution(attempt("manifest-trust-block", { expectedManifestTrustStoreSha256: "0".repeat(64) })).failureCode, "DEVELOPMENT_MANIFEST_TRUST_JSON_HASH");
  const cleanPartition = JSON.parse(fs.readFileSync(config.partitionIndexPath, "utf8"));
  const invalidPartition = JSON.parse(JSON.stringify(cleanPartition));
  invalidPartition.rows[1].patientHmacSha256 = invalidPartition.rows[0].patientHmacSha256;
  const invalidPartitionPath = path.join(temporaryRoot, "invalid-partition.json");
  fs.writeFileSync(invalidPartitionPath, JSON.stringify(invalidPartition));
  assert.equal(runDevelopmentCandidateExecution(attempt("partition-block", { partitionIndexPath: invalidPartitionPath })).failureCode, "DEVELOPMENT_PARTITION_PATIENT_LEAKAGE");
  assert.equal(runDevelopmentCandidateExecution(attempt("sha-mismatch", { workflowSha: "0".repeat(40), engineCommitDigest: "0".repeat(40) })).failureCode, "DEVELOPMENT_WORKFLOW_SHA_MISMATCH");
  const wrongLeadBytes = Buffer.from(`${JSON.stringify({ sampleRateHz: 250, lead: "V1", samples: syntheticSignal(1250, peaks) })}\n`, "utf8");
  const fixtureManifest = JSON.parse(fs.readFileSync(config.manifestPath, "utf8"));
  const wrongLeadRecord = { ...fixtureManifest.records[0], signalBytes: wrongLeadBytes.length, sourceFileSha256: crypto.createHash("sha256").update(wrongLeadBytes).digest("hex") };
  fs.writeFileSync(path.join(corpusRoot, "signals", "record-1.json"), wrongLeadBytes);
  assert.throws(() => loadEvaluationRecord(corpusRoot, wrongLeadRecord, fixtureManifest.leadPolicy), /DEVELOPMENT_SIGNAL_LEAD_DRIFT/);
  fs.writeFileSync(path.join(corpusRoot, "signals", "record-1.json"), signalBytes);

  const failedConfig = attempt("signal-failure");
  startDevelopmentEvaluationAttempt(failedConfig, privateKeyPem);
  fs.appendFileSync(path.join(corpusRoot, "signals", "record-1.json"), " ");
  const failedHandoff = runDevelopmentCandidateExecution(failedConfig);
  assert.equal(failedHandoff.handoffStatus, "FAILED");
  assert.equal(failedHandoff.failureCode, "DEVELOPMENT_SIGNAL_BYTES");
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(failedConfig, failedHandoff, privateKeyPem), /DEVELOPMENT_SIGNAL_BYTES/);
  const failedAttempt = verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", failedConfig.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(failedAttempt.executionStatus, "FAILED");
  assert.equal(failedAttempt.terminal.failureCode, "DEVELOPMENT_SIGNAL_BYTES");
  assert.equal(failedAttempt.terminal.accounting.rows.every(row => row.status === "NOT_RUN" && row.failureCode === "NOT_ATTEMPTED"), true);
  fs.writeFileSync(path.join(corpusRoot, "signals", "record-1.json"), signalBytes);

  startDevelopmentEvaluationAttempt(config, privateKeyPem);
  const handoff = runDevelopmentCandidateExecution(config);
  assert.equal(handoff.handoffStatus, "EXECUTED");
  assert.equal(handoff.manifestPayloadSha256, "9c949d21557197d1cb8c9a2730308ce6b3d9e093cadbc86a9472ba51c48ac589");
  assert.equal(JSON.stringify(handoff).includes("PRIVATE KEY"), false);
  const receipt = finalizeDevelopmentEvaluationAttempt(config, handoff, privateKeyPem);
  assert.equal(receipt.writeOnce, false);
  assert.equal(receipt.applicationCollisionProtected, true);
  assert.equal(receipt.externalObjectLockAttested, false);
  const verified = verifyEvaluationBundle(receipt.path, publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(verified.pass, true);
  assert.equal(verified.artifactCount, 14);
  assert.equal(verified.runManifest.environment.signingBoundary, "SEPARATE_PINNED_SIGNER_IMAGE_BOUNDED_HANDOFF");
  assert.equal(verified.runManifest.gateStatus, "QUARANTINED");
  const completedAttempt = verifyCompletedDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", config.attemptId), artifactRoot, publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(completedAttempt.executionStatus, "COMPLETED");
  assert.equal(completedAttempt.start.runBinding.candidateReferenceIsolation, false);
  assert.deepEqual(completedAttempt.bundleVerification.runManifest.runBinding, completedAttempt.start.runBinding);
  assert.equal(completedAttempt.bundleVerification.pass, true);
  assert.equal(completedAttempt.bundleVerification.runManifest.candidateReferenceIsolation, false);
  assert.equal(completedAttempt.terminal.accounting.byDetectorAndPass.every(row => row.SUCCESS === 1 && row.NOT_RUN === 0), true);
  const report = JSON.parse(fs.readFileSync(path.join(receipt.path, "development-report.json"), "utf8"));
  assert.equal(report.clinicalAccuracyClaimed, false);
  assert.equal(report.currentEngine.denominators.nRecords, 1);
  assert.equal(report.currentEngine.records, undefined);
  const candidateDigests = JSON.parse(fs.readFileSync(path.join(receipt.path, "candidate-digests.json"), "utf8"));
  assert.equal(candidateDigests.candidateManifest.manifestPayloadSha256, "f7b2940b02d328739c4296384fb8be2851647837c601467dab820179ec7d6d24");
  assert.equal(candidateDigests.candidateSignature.keyId, "synthetic-development-candidate-2026-09-22");
  assert.equal(candidateDigests.metricCodeDigest, implementationDigest([path.join(repositoryRoot, "lib", "rpeak_development_metrics.js"), path.join(repositoryRoot, "lib", "event_matcher_v2.js")]));
  assert.match(candidateDigests.matcherDigest, /^[0-9a-f]{64}$/);
  assert.match(candidateDigests.candidateSignerPublicKeySha256, /^[0-9a-f]{64}$/);
  const publishedText = fs.readdirSync(receipt.path).filter(name => name.endsWith(".json")).map(name => fs.readFileSync(path.join(receipt.path, name), "utf8")).join("\n");
  for (const row of cleanPartition.rows.filter(row => row.splitRole !== "development")) for (const field of ["recordHmacSha256", "patientHmacSha256", "sourceFileSha256", "nearDuplicateGroupSha256"]) assert.equal(publishedText.includes(row[field]), false);
  fs.rmSync(path.join(artifactRoot, "attempts", "2026", "09", "22", config.attemptId, "terminal"), { recursive: true });
  const retriedReceipt = finalizeDevelopmentEvaluationAttempt(config, handoff, privateKeyPem);
  assert.equal(retriedReceipt.runId, receipt.runId);
  assert.equal(verifyCompletedDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", config.attemptId), artifactRoot, publicKeyPem, { expectedSignerKeyId: config.signerKeyId }).executionStatus, "COMPLETED");

  const tamperedConfig = attempt("tampered-handoff");
  startDevelopmentEvaluationAttempt(tamperedConfig, privateKeyPem);
  const tampered = runDevelopmentCandidateExecution(tamperedConfig);
  tampered.outcomes[0].predictedSampleIndices = [20, 10];
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(tamperedConfig, tampered, privateKeyPem), /DEVELOPMENT_HANDOFF_PREDICTION_ORDER/);
  const tamperedAttempt = verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", tamperedConfig.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(tamperedAttempt.executionStatus, "BLOCKED");
  assert.equal(tamperedAttempt.terminal.bundle, null);

  const manifestTamperConfig = attempt("manifest-handoff-tamper");
  startDevelopmentEvaluationAttempt(manifestTamperConfig, privateKeyPem);
  const manifestTamper = runDevelopmentCandidateExecution(manifestTamperConfig);
  manifestTamper.manifestPayloadSha256 = "0".repeat(64);
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(manifestTamperConfig, manifestTamper, privateKeyPem), /DEVELOPMENT_HANDOFF_IDENTITY/);
  assert.equal(verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", manifestTamperConfig.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId }).executionStatus, "BLOCKED");

  const missingConfig = attempt("missing-handoff");
  startDevelopmentEvaluationAttempt(missingConfig, privateKeyPem);
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(missingConfig, null, privateKeyPem), /DEVELOPMENT_EXECUTION_HANDOFF_MISSING/);
  const missingAttempt = verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", missingConfig.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(missingAttempt.executionStatus, "BLOCKED");
  assert.equal(missingAttempt.terminal.failureCode, "DEVELOPMENT_EXECUTION_HANDOFF_MISSING");

  const malformedConfig = attempt("malformed-handoff");
  startDevelopmentEvaluationAttempt(malformedConfig, privateKeyPem);
  const malformedPath = path.join(temporaryRoot, "malformed-handoff.json");
  fs.writeFileSync(malformedPath, "{not-json");
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(malformedConfig, malformedPath, privateKeyPem), /DEVELOPMENT_HANDOFF_JSON/);
  const malformedAttempt = verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", malformedConfig.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(malformedAttempt.executionStatus, "BLOCKED");
  assert.equal(malformedAttempt.terminal.failureCode, "DEVELOPMENT_HANDOFF_JSON");

  const gatesPath = path.join(receipt.path, "gates.json");
  const original = fs.readFileSync(gatesPath);
  fs.writeFileSync(gatesPath, Buffer.concat([original, Buffer.from(" ")]));
  assert.throws(() => verifyEvaluationBundle(receipt.path, publicKeyPem), /EVALUATION_BUNDLE_ARTIFACT_HASH/);
  if (previousNetwork === undefined) delete process.env.EKG_EVALUATION_NETWORK_DISABLED;
  else process.env.EKG_EVALUATION_NETWORK_DISABLED = previousNetwork;
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("development evaluation runner tests passed");
