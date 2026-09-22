"use strict";

const assert = require("assert");
const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createCandidateWorkerBudget, gitIdentity, implementationDigest, loadEvaluationRecord, runDevelopmentCandidateExecution, runDevelopmentEvaluation, validateCandidateRunConfig, validateRunConfig } = require("../lib/development_evaluation_runner");
const { MANDATORY_INTEGRITY_CONTROLS, deriveDevelopmentGateStatus, finalizeDevelopmentEvaluationAttempt, isDevelopmentPolicyReady, startDevelopmentEvaluationAttempt } = require("../lib/development_evaluation_signer");
const { verifyEvaluationBundle } = require("../lib/evaluation_artifact_store");
const { verifyCompletedDevelopmentAttempt, verifyDevelopmentAttempt } = require("../lib/development_attempt_store");
const { CANDIDATE_LAUNCH_POLICY_SHA256, CANDIDATE_TOTAL_WORKER_BUDGET_MS, CANDIDATE_WORKER_TIMEOUT_MS } = require("../lib/development_candidate_isolation");
const { readDevelopmentExecutionHandoff, writeDevelopmentExecutionHandoff } = require("../lib/development_execution_handoff");
const { CANDIDATE_RUNTIME_ARTIFACT_FILES, ENTRY_FILES, canonicalCandidatePayload } = require("../lib/development_execution_identity");

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
  const governanceRoot = path.join(temporaryRoot, "governance");
  const controlsRoot = path.join(temporaryRoot, "candidate-controls");
  fs.mkdirSync(path.join(corpusRoot, "signals"), { recursive: true });
  fs.mkdirSync(path.join(corpusRoot, "references"), { recursive: true });
  fs.mkdirSync(governanceRoot);
  fs.mkdirSync(controlsRoot);
  const governanceFiles = {
    "manifest.json": path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_MANIFEST_V2.json"),
    "manifest.sig.json": path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_MANIFEST_V2.sig"),
    "manifest-trust-store.json": path.join(repositoryRoot, "evaluation", "keys", "DEVELOPMENT_MANIFEST_SIGNERS.json"),
    "partition-index.json": path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_PARTITION_INDEX_V2.json"),
    "candidate-manifest.json": path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_CANDIDATE_V1.json"),
    "candidate-manifest.sig.json": path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_CANDIDATE_V1.sig"),
    "candidate-trust-store.json": path.join(repositoryRoot, "evaluation", "keys", "DEVELOPMENT_CANDIDATE_SIGNERS.json"),
  };
  for (const [name, source] of Object.entries(governanceFiles)) fs.copyFileSync(source, path.join(governanceRoot, name));
  const candidateManifestPath = path.join(governanceRoot, "candidate-manifest.json");
  const candidateSignaturePath = path.join(governanceRoot, "candidate-manifest.sig.json");
  const candidateTrustStorePath = path.join(governanceRoot, "candidate-trust-store.json");
  const candidateManifest = JSON.parse(fs.readFileSync(candidateManifestPath, "utf8"));
  candidateManifest.candidateId = "synthetic-development-rpeak-execution-current";
  candidateManifest.artifacts = candidateManifest.artifacts.map(artifact => {
    const bytes = fs.readFileSync(path.join(repositoryRoot, artifact.file));
    return { file: artifact.file, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  });
  candidateManifest.executionIdentitySha256 = require("../lib/evaluation_signatures").payloadSha256({ schema: "ekg-development-execution-identity-v1", task: candidateManifest.task, candidateId: candidateManifest.candidateId, loadingPolicy: "PRIVATE_COMMONJS_EXACT_UTF8_BYTES", entryFiles: ENTRY_FILES.slice(), artifacts: candidateManifest.artifacts });
  delete candidateManifest.manifestPayloadSha256;
  candidateManifest.manifestPayloadSha256 = require("../lib/evaluation_signatures").payloadSha256(candidateManifest);
  const candidateKeys = crypto.generateKeyPairSync("ed25519");
  const candidateTrustStore = JSON.parse(fs.readFileSync(candidateTrustStorePath, "utf8"));
  candidateTrustStore.keys[0].publicKeyPem = candidateKeys.publicKey.export({ type: "spki", format: "pem" });
  const candidateSignature = { schema: "ekg-detached-signature-v1", algorithm: "Ed25519", keyId: candidateTrustStore.keys[0].keyId, payloadSha256: candidateManifest.manifestPayloadSha256, signatureBase64: crypto.sign(null, Buffer.from(require("../lib/evaluation_runtime").stableJson(canonicalCandidatePayload(candidateManifest))), candidateKeys.privateKey).toString("base64") };
  fs.writeFileSync(candidateManifestPath, `${JSON.stringify(candidateManifest, null, 2)}\n`);
  fs.writeFileSync(candidateSignaturePath, `${JSON.stringify(candidateSignature, null, 2)}\n`);
  fs.writeFileSync(candidateTrustStorePath, `${JSON.stringify(candidateTrustStore, null, 2)}\n`);
  for (const name of ["candidate-manifest.json", "candidate-manifest.sig.json", "candidate-trust-store.json"]) fs.copyFileSync(path.join(governanceRoot, name), path.join(controlsRoot, name));
  const peaks = [250, 500, 750, 1000];
  const signalBytes = Buffer.from(`${JSON.stringify({ sampleRateHz: 250, lead: "II", samples: syntheticSignal(1250, peaks) })}\n`, "utf8");
  const referenceBytes = Buffer.from(`${JSON.stringify({ referenceSampleIndices: peaks, sentinelMetadata: "SENTINEL_PROTECTED_METADATA" })}\n`, "utf8");
  fs.writeFileSync(path.join(corpusRoot, "signals", "record-1.json"), signalBytes);
  fs.writeFileSync(path.join(corpusRoot, "references", "record-1.json"), referenceBytes);
  const manifest = JSON.parse(fs.readFileSync(path.join(governanceRoot, "manifest.json"), "utf8"));
  manifest.records[0].referenceBytes = referenceBytes.length;
  manifest.records[0].labelSnapshotSha256 = crypto.createHash("sha256").update(referenceBytes).digest("hex");
  const manifestPayload = { ...manifest };
  delete manifestPayload.manifestPayloadSha256;
  const manifestTrust = JSON.parse(fs.readFileSync(path.join(governanceRoot, "manifest-trust-store.json"), "utf8"));
  const manifestKeys = crypto.generateKeyPairSync("ed25519");
  manifestTrust.keys[0].publicKeyPem = manifestKeys.publicKey.export({ type: "spki", format: "pem" });
  manifest.manifestPayloadSha256 = require("../lib/evaluation_signatures").payloadSha256(manifestPayload);
  fs.writeFileSync(path.join(governanceRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestSignature = { schema: "ekg-detached-signature-v1", algorithm: "Ed25519", keyId: manifestTrust.keys[0].keyId, payloadSha256: manifest.manifestPayloadSha256, signatureBase64: crypto.sign(null, Buffer.from(require("../lib/evaluation_runtime").stableJson(manifestPayload)), manifestKeys.privateKey).toString("base64") };
  fs.writeFileSync(path.join(governanceRoot, "manifest.sig.json"), `${JSON.stringify(manifestSignature, null, 2)}\n`);
  fs.writeFileSync(path.join(governanceRoot, "manifest-trust-store.json"), `${JSON.stringify(manifestTrust, null, 2)}\n`);
  const bundleKeys = crypto.generateKeyPairSync("ed25519");
  const privateKeyPem = bundleKeys.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKeyPem = bundleKeys.publicKey.export({ type: "spki", format: "pem" });
  const previousNetwork = process.env.EKG_EVALUATION_NETWORK_DISABLED;
  process.env.EKG_EVALUATION_NETWORK_DISABLED = "1";
  const config = {
    repositoryRoot,
    manifestPath: path.join(governanceRoot, "manifest.json"),
    manifestSignaturePath: path.join(governanceRoot, "manifest.sig.json"),
    manifestTrustStorePath: path.join(governanceRoot, "manifest-trust-store.json"),
    expectedManifestTrustStoreSha256: crypto.createHash("sha256").update(fs.readFileSync(path.join(governanceRoot, "manifest-trust-store.json"))).digest("hex"),
    partitionIndexPath: path.join(governanceRoot, "partition-index.json"),
    candidateManifestPath: path.join(governanceRoot, "candidate-manifest.json"),
    candidateSignaturePath: path.join(governanceRoot, "candidate-manifest.sig.json"),
    candidateTrustStorePath: path.join(governanceRoot, "candidate-trust-store.json"),
    expectedCandidateTrustStoreSha256: crypto.createHash("sha256").update(fs.readFileSync(candidateTrustStorePath)).digest("hex"),
    corpusRoot,
    artifactRoot,
    executionInputRoot: path.join(temporaryRoot, "inputs", "synthetic-success"),
    candidateRoot: repositoryRoot,
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
  const attempt = (attemptId, overrides = {}) => ({ ...config, ...overrides, attemptId, executionInputRoot: path.join(temporaryRoot, "inputs", attemptId) });
  const candidateConfig = signerConfig => ({ executionInputRoot: signerConfig.executionInputRoot, candidateManifestPath: path.join(controlsRoot, "candidate-manifest.json"), candidateSignaturePath: path.join(controlsRoot, "candidate-manifest.sig.json"), candidateTrustStorePath: path.join(controlsRoot, "candidate-trust-store.json"), expectedCandidateTrustStoreSha256: signerConfig.expectedCandidateTrustStoreSha256, repositoryRoot, candidateRoot: repositoryRoot, inputMountMode: "READ_ONLY", networkIsolation: "SYNTHETIC_TEST_PROCESS", candidateRuntimeImageDigest: null, candidateLaunchPolicySha256: CANDIDATE_LAUNCH_POLICY_SHA256, candidateExpectedUid: null, candidateExpectedGid: null });
  const createDriftedCandidate = (name, mutate) => {
    const candidateRoot = path.join(temporaryRoot, `${name}-candidate`);
    const controlRoot = path.join(temporaryRoot, `${name}-controls`);
    for (const artifact of candidateManifest.artifacts) {
      const target = path.join(candidateRoot, artifact.file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(repositoryRoot, artifact.file), target);
    }
    mutate(candidateRoot);
    const manifest = JSON.parse(JSON.stringify(candidateManifest));
    manifest.candidateId = `${candidateManifest.candidateId}-${name}`;
    manifest.artifacts = manifest.artifacts.map(artifact => {
      const bytes = fs.readFileSync(path.join(candidateRoot, artifact.file));
      return { file: artifact.file, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
    });
    manifest.executionIdentitySha256 = require("../lib/evaluation_signatures").payloadSha256({ schema: "ekg-development-execution-identity-v1", task: manifest.task, candidateId: manifest.candidateId, loadingPolicy: "PRIVATE_COMMONJS_EXACT_UTF8_BYTES", entryFiles: ENTRY_FILES.slice(), artifacts: manifest.artifacts });
    delete manifest.manifestPayloadSha256;
    manifest.manifestPayloadSha256 = require("../lib/evaluation_signatures").payloadSha256(manifest);
    const signature = { schema: "ekg-detached-signature-v1", algorithm: "Ed25519", keyId: candidateTrustStore.keys[0].keyId, payloadSha256: manifest.manifestPayloadSha256, signatureBase64: crypto.sign(null, Buffer.from(require("../lib/evaluation_runtime").stableJson(canonicalCandidatePayload(manifest))), candidateKeys.privateKey).toString("base64") };
    fs.mkdirSync(controlRoot);
    const manifestPath = path.join(controlRoot, "candidate-manifest.json");
    const signaturePath = path.join(controlRoot, "candidate-manifest.sig.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(signaturePath, `${JSON.stringify(signature, null, 2)}\n`);
    return { candidateRoot, manifestPath, signaturePath };
  };
  const start = signerConfig => { fs.mkdirSync(signerConfig.executionInputRoot, { recursive: true }); return startDevelopmentEvaluationAttempt(signerConfig, privateKeyPem); };
  assert.throws(() => validateRunConfig({ ...config, signingPrivateKeyPem: privateKeyPem }), /DEVELOPMENT_RUN_CONFIG_UNKNOWN_FIELD/);
  assert.throws(() => validateRunConfig({ ...config, previousApprovedBundlePath: "prior" }), /DEVELOPMENT_PREVIOUS_BASELINE_CONFIG/);
  assert.throws(() => validateCandidateRunConfig({ ...candidateConfig(config), corpusRoot }), /DEVELOPMENT_CANDIDATE_RUN_CONFIG_FIELDS/);
  assert.throws(() => runDevelopmentEvaluation(config), /DEVELOPMENT_EVALUATION_SPLIT_REQUIRED/);
  for (const status of ["TECHNICAL_FAILURE", "ABSTAINED"]) assert.equal(deriveDevelopmentGateStatus({ candidateExecutionHealthy: status === "SUCCESS", candidateReferenceIsolation: true, policyReady: true, comparisonFailure: false, comparisonBlocked: false }), "FAILED");
  assert.equal(deriveDevelopmentGateStatus({ candidateExecutionHealthy: true, candidateReferenceIsolation: false, policyReady: true, comparisonFailure: false, comparisonBlocked: false }), "QUARANTINED");
  const effectiveGate = { id: "sensitivity-floor", metricPath: "summary.micro.sensitivity", direction: "higher", blocking: true, absoluteFloor: 0.9 };
  const approvedPolicy = { mandatoryIntegrityBlocks: [...MANDATORY_INTEGRITY_CONTROLS], approvalStatus: "APPROVED", gates: [effectiveGate] };
  assert.equal(isDevelopmentPolicyReady(approvedPolicy, { productionAuthority: true }), true);
  assert.equal(isDevelopmentPolicyReady(approvedPolicy, { productionAuthority: false }), false);
  assert.equal(isDevelopmentPolicyReady({ ...approvedPolicy, mandatoryIntegrityBlocks: ["REFERENCE_NON_DISCLOSURE"] }, { productionAuthority: true }), false);
  assert.equal(isDevelopmentPolicyReady({ ...approvedPolicy, gates: [{ ...effectiveGate, blocking: false }] }, { productionAuthority: true }), false);
  assert.equal(isDevelopmentPolicyReady({ ...approvedPolicy, gates: [{ id: "no-op", metricPath: "summary.micro.sensitivity", direction: "higher", blocking: true }] }, { productionAuthority: true }), false);
  assert.equal(isDevelopmentPolicyReady({ ...approvedPolicy, gates: [effectiveGate, { id: "no-op", metricPath: "summary.micro.ppv", direction: "higher", blocking: true }] }, { productionAuthority: true }), false);
  assert.throws(() => isDevelopmentPolicyReady({ ...approvedPolicy, gates: [{ ...effectiveGate, absoluteFloor: Number.NaN }] }, { productionAuthority: true }), /RUN_COMPARISON_GATE_ABSOLUTE_FLOOR/);
  assert.throws(() => isDevelopmentPolicyReady({ ...approvedPolicy, gates: [{ ...effectiveGate, absoluteFloor: Number.POSITIVE_INFINITY }] }, { productionAuthority: true }), /RUN_COMPARISON_GATE_ABSOLUTE_FLOOR/);
  assert.throws(() => isDevelopmentPolicyReady({ ...approvedPolicy, gates: [{ ...effectiveGate, absoluteFloor: 0.9, noninferiorityMargin: -0.1 }] }, { productionAuthority: true }), /RUN_COMPARISON_GATE_MARGIN/);
  assert.throws(() => isDevelopmentPolicyReady({ ...approvedPolicy, gates: [{ ...effectiveGate, direction: "lower" }] }, { productionAuthority: true }), /RUN_COMPARISON_GATE_DIRECTION/);
  assert.throws(() => isDevelopmentPolicyReady({ ...approvedPolicy, gates: [{ ...effectiveGate, absoluteFloor: 0 }] }, { productionAuthority: true }), /RUN_COMPARISON_GATE_ABSOLUTE_FLOOR_VACUOUS/);
  assert.throws(() => isDevelopmentPolicyReady({ ...approvedPolicy, gates: [{ ...effectiveGate, runtimeAuthority: true }] }, { productionAuthority: true }), /RUN_COMPARISON_GATE_FIELDS/);
  const budgetTimes = [1000, 1025, 1099, 1100];
  const workerBudget = createCandidateWorkerBudget({ budgetMs: 100, nowMs: () => budgetTimes.shift() });
  assert.equal(workerBudget.nextWorkerTimeoutMs(), 75);
  workerBudget.assertRemaining();
  assert.throws(() => workerBudget.nextWorkerTimeoutMs(), /DEVELOPMENT_CANDIDATE_TOTAL_TIMEOUT/);
  assert.throws(() => createCandidateWorkerBudget({ budgetMs: CANDIDATE_TOTAL_WORKER_BUDGET_MS + 1, nowMs: () => 0 }), /DEVELOPMENT_CANDIDATE_TOTAL_BUDGET_CONFIG/);
  assert.ok(CANDIDATE_TOTAL_WORKER_BUDGET_MS > CANDIDATE_WORKER_TIMEOUT_MS);
  const realClockBudget = createCandidateWorkerBudget({ budgetMs: 100 });
  const realClockStarted = process.hrtime.bigint();
  const timedOutWorker = childProcess.spawnSync(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { encoding: "utf8", timeout: realClockBudget.nextWorkerTimeoutMs(), windowsHide: true });
  const realClockElapsedMs = Number(process.hrtime.bigint() - realClockStarted) / 1e6;
  assert.equal(timedOutWorker.error && timedOutWorker.error.code, "ETIMEDOUT");
  assert.ok(realClockElapsedMs < 10000);
  assert.throws(() => realClockBudget.assertRemaining(), /DEVELOPMENT_CANDIDATE_TOTAL_TIMEOUT/);
  const missingInputConfigPath = path.join(temporaryRoot, "missing-input-candidate-config.json");
  const missingInputHandoffPath = path.join(temporaryRoot, "missing-input-handoff.json");
  fs.writeFileSync(missingInputConfigPath, JSON.stringify({ ...candidateConfig(config), executionInputRoot: path.join(temporaryRoot, "missing-input") }));
  const missingInputResult = childProcess.spawnSync(process.execPath, [path.join(repositoryRoot, "tools", "run_development_evaluation.js"), "--phase", "candidate", "--config", missingInputConfigPath, "--handoff", missingInputHandoffPath], { cwd: repositoryRoot, encoding: "utf8", env: process.env });
  assert.notEqual(missingInputResult.status, 0);
  assert.match(missingInputResult.stderr, /^DEVELOPMENT_EXECUTION_INPUT_MISSING\r?\n$/);
  assert.deepEqual(readDevelopmentExecutionHandoff(missingInputHandoffPath), { schema: "ekg-development-candidate-process-failure-v1", failureCode: "DEVELOPMENT_EXECUTION_INPUT_MISSING" });

  const trustBlock = attempt("manifest-trust-block", { expectedManifestTrustStoreSha256: "0".repeat(64) });
  fs.mkdirSync(trustBlock.executionInputRoot, { recursive: true });
  assert.throws(() => startDevelopmentEvaluationAttempt(trustBlock, privateKeyPem), /DEVELOPMENT_MANIFEST_TRUST_JSON_HASH/);
  assert.equal(fs.existsSync(path.join(artifactRoot, "attempts", "2026", "09", "22", trustBlock.attemptId)), false);
  assert.deepEqual(fs.readdirSync(trustBlock.executionInputRoot), []);
  const preparationBlock = attempt("input-preparation-block");
  fs.mkdirSync(preparationBlock.executionInputRoot, { recursive: true });
  fs.writeFileSync(path.join(preparationBlock.executionInputRoot, "undeclared.json"), "{}\n");
  assert.throws(() => startDevelopmentEvaluationAttempt(preparationBlock, privateKeyPem), /DEVELOPMENT_EXECUTION_INPUT_NOT_EMPTY/);
  assert.equal(fs.existsSync(path.join(artifactRoot, "attempts", "2026", "09", "22", preparationBlock.attemptId)), false);

  const protocolDrift = createDriftedCandidate("protocol-drift", candidateRoot => {
    const protocolPath = path.join(candidateRoot, "evaluation", "protocols", "DEVELOPMENT_RPEAK_EVALUATION_V1.json");
    const protocol = JSON.parse(fs.readFileSync(protocolPath, "utf8"));
    protocol.primaryToleranceMs += 1;
    protocol.sensitivityToleranceMs = [protocol.primaryToleranceMs];
    fs.writeFileSync(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);
  });
  const protocolDriftConfig = attempt("signer-protocol-drift", { repositoryRoot: protocolDrift.candidateRoot, candidateRoot: protocolDrift.candidateRoot, candidateManifestPath: protocolDrift.manifestPath, candidateSignaturePath: protocolDrift.signaturePath });
  assert.throws(() => start(protocolDriftConfig), /DEVELOPMENT_SIGNER_CONTROL_ARTIFACT_MISMATCH/);
  assert.equal(fs.existsSync(path.join(artifactRoot, "attempts", "2026", "09", "22", protocolDriftConfig.attemptId)), false);
  assert.deepEqual(fs.readdirSync(protocolDriftConfig.executionInputRoot), []);

  const policyDrift = createDriftedCandidate("policy-drift", candidateRoot => {
    const policyPath = path.join(candidateRoot, "evaluation", "protocols", "DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json");
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    policy.approvalStatus = "APPROVED";
    policy.gates = [{ id: "candidate-selected-floor", metricPath: "summary.micro.sensitivity", direction: "higher", blocking: true, absoluteFloor: 0.000001 }];
    policy.bootstrap = { replicates: Number.MAX_SAFE_INTEGER };
    fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
  });
  const policyDriftConfig = attempt("signer-policy-drift", { repositoryRoot: policyDrift.candidateRoot, candidateRoot: policyDrift.candidateRoot, candidateManifestPath: policyDrift.manifestPath, candidateSignaturePath: policyDrift.signaturePath });
  assert.throws(() => start(policyDriftConfig), /DEVELOPMENT_SIGNER_CONTROL_ARTIFACT_MISMATCH/);
  assert.equal(fs.existsSync(path.join(artifactRoot, "attempts", "2026", "09", "22", policyDriftConfig.attemptId)), false);
  assert.deepEqual(fs.readdirSync(policyDriftConfig.executionInputRoot), []);

  const cleanPartition = JSON.parse(fs.readFileSync(config.partitionIndexPath, "utf8"));
  const invalidPartition = JSON.parse(JSON.stringify(cleanPartition));
  invalidPartition.rows[1].patientHmacSha256 = invalidPartition.rows[0].patientHmacSha256;
  const invalidPartitionPath = path.join(temporaryRoot, "invalid-partition.json");
  fs.writeFileSync(invalidPartitionPath, JSON.stringify(invalidPartition));
  const partitionBlock = attempt("partition-block", { partitionIndexPath: invalidPartitionPath });
  fs.mkdirSync(partitionBlock.executionInputRoot, { recursive: true });
  assert.throws(() => startDevelopmentEvaluationAttempt(partitionBlock, privateKeyPem), /DEVELOPMENT_PARTITION_PATIENT_LEAKAGE/);
  const shaMismatch = attempt("sha-mismatch", { workflowSha: "0".repeat(40) });
  fs.mkdirSync(shaMismatch.executionInputRoot, { recursive: true });
  assert.throws(() => startDevelopmentEvaluationAttempt(shaMismatch, privateKeyPem), /DEVELOPMENT_ENGINE_WORKFLOW_COMMIT_MISMATCH/);
  const candidateTrustBlock = attempt("candidate-trust-block");
  start(candidateTrustBlock);
  const candidateTrustHandoff = runDevelopmentCandidateExecution({ ...candidateConfig(candidateTrustBlock), expectedCandidateTrustStoreSha256: "0".repeat(64) });
  assert.equal(candidateTrustHandoff.handoffStatus, "BLOCKED");
  assert.equal(candidateTrustHandoff.failureCode, "DEVELOPMENT_CANDIDATE_TRUST_JSON_HASH");
  for (const field of ["executionInputSha256", "candidateRuntimeIdentitySha256", "candidateIsolationExpectationSha256", "candidateRuntimeAttestationSha256", "candidateManifestPayloadSha256", "executionIdentitySha256", "manifestPayloadSha256"]) assert.match(candidateTrustHandoff[field], /^[0-9a-f]{64}$/);
  const candidateTrustHandoffPath = path.join(temporaryRoot, "candidate-trust-handoff.json");
  writeDevelopmentExecutionHandoff(candidateTrustHandoffPath, candidateTrustHandoff);
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(candidateTrustBlock, candidateTrustHandoffPath, privateKeyPem), /DEVELOPMENT_CANDIDATE_TRUST_JSON_HASH/);
  const candidateTrustTerminal = verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", candidateTrustBlock.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(candidateTrustTerminal.executionStatus, "BLOCKED");
  assert.equal(candidateTrustTerminal.terminal.failureCode, "DEVELOPMENT_CANDIDATE_TRUST_JSON_HASH");

  const runtimeLoadBlock = attempt("candidate-runtime-load-block");
  start(runtimeLoadBlock);
  const brokenCandidateRoot = path.join(temporaryRoot, "broken-candidate-runtime");
  for (const file of CANDIDATE_RUNTIME_ARTIFACT_FILES) {
    const target = path.join(brokenCandidateRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repositoryRoot, file), target);
  }
  fs.appendFileSync(path.join(brokenCandidateRoot, "lib", "signal_measurement_contract.js"), " ");
  const runtimeLoadHandoff = runDevelopmentCandidateExecution({ ...candidateConfig(runtimeLoadBlock), repositoryRoot: brokenCandidateRoot, candidateRoot: brokenCandidateRoot });
  assert.equal(runtimeLoadHandoff.handoffStatus, "BLOCKED");
  assert.equal(runtimeLoadHandoff.failureCode, "DEVELOPMENT_CANDIDATE_ARTIFACT_IDENTITY_MISMATCH");
  for (const field of ["executionInputSha256", "candidateRuntimeIdentitySha256", "candidateIsolationExpectationSha256", "candidateRuntimeAttestationSha256", "candidateManifestPayloadSha256", "executionIdentitySha256", "manifestPayloadSha256"]) assert.match(runtimeLoadHandoff[field], /^[0-9a-f]{64}$/);
  const runtimeLoadHandoffPath = path.join(temporaryRoot, "candidate-runtime-load-handoff.json");
  writeDevelopmentExecutionHandoff(runtimeLoadHandoffPath, runtimeLoadHandoff);
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(runtimeLoadBlock, runtimeLoadHandoffPath, privateKeyPem), /DEVELOPMENT_CANDIDATE_ARTIFACT_IDENTITY_MISMATCH/);
  const runtimeLoadTerminal = verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", runtimeLoadBlock.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(runtimeLoadTerminal.executionStatus, "BLOCKED");
  assert.equal(runtimeLoadTerminal.terminal.failureCode, "DEVELOPMENT_CANDIDATE_ARTIFACT_IDENTITY_MISMATCH");

  const hostileBaseline = createDriftedCandidate("hostile-baseline", candidateRoot => {
    const detectorPath = path.join(candidateRoot, "lib", "pan_tompkins_detector.js");
    const source = fs.readFileSync(detectorPath, "utf8");
    const changed = source.replace("function detectPanTompkinsRPeaks(samples, sampleRateHz, options = {}) {\n", "function detectPanTompkinsRPeaks(samples, sampleRateHz, options = {}) {\n  process.exit(17);\n");
    assert.notEqual(changed, source);
    fs.writeFileSync(detectorPath, changed);
  });
  const hostileBaselineConfig = attempt("hostile-baseline", { candidateRoot: hostileBaseline.candidateRoot, candidateManifestPath: hostileBaseline.manifestPath, candidateSignaturePath: hostileBaseline.signaturePath });
  start(hostileBaselineConfig);
  const hostileCandidateConfig = { ...candidateConfig(hostileBaselineConfig), repositoryRoot: hostileBaseline.candidateRoot, candidateRoot: hostileBaseline.candidateRoot, candidateManifestPath: hostileBaseline.manifestPath, candidateSignaturePath: hostileBaseline.signaturePath };
  const hostileCandidateConfigPath = path.join(temporaryRoot, "hostile-baseline-candidate-config.json");
  const hostileHandoffPath = path.join(temporaryRoot, "hostile-baseline-handoff.json");
  fs.writeFileSync(hostileCandidateConfigPath, JSON.stringify(hostileCandidateConfig));
  const hostileCandidateResult = childProcess.spawnSync(process.execPath, [path.join(repositoryRoot, "tools", "run_development_evaluation.js"), "--phase", "candidate", "--config", hostileCandidateConfigPath, "--handoff", hostileHandoffPath], { cwd: repositoryRoot, encoding: "utf8", env: process.env });
  assert.equal(hostileCandidateResult.status, 0);
  const hostileHandoff = readDevelopmentExecutionHandoff(hostileHandoffPath);
  assert.equal(hostileHandoff.handoffStatus, "EXECUTED");
  assert.equal(hostileHandoff.outcomes.filter(row => row.detector === "CURRENT_ENGINE").every(row => row.status === "SUCCESS"), true);
  assert.equal(hostileHandoff.outcomes.filter(row => row.detector === "PAN_TOMPKINS").every(row => row.status === "TECHNICAL_FAILURE" && row.failureCode === "DEVELOPMENT_CANDIDATE_DETECTOR_FAILURE"), true);
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(hostileBaselineConfig, hostileHandoffPath, privateKeyPem), /DEVELOPMENT_PAN_TOMPKINS_SUBMISSION_MISMATCH/);

  const wrongLeadBytes = Buffer.from(`${JSON.stringify({ sampleRateHz: 250, lead: "V1", samples: syntheticSignal(1250, peaks) })}\n`, "utf8");
  const wrongLeadRecord = { ...manifest.records[0], signalBytes: wrongLeadBytes.length, sourceFileSha256: crypto.createHash("sha256").update(wrongLeadBytes).digest("hex") };
  fs.writeFileSync(path.join(corpusRoot, "signals", "record-1.json"), wrongLeadBytes);
  assert.throws(() => loadEvaluationRecord(corpusRoot, wrongLeadRecord, manifest.leadPolicy), /DEVELOPMENT_SIGNAL_LEAD_DRIFT/);
  fs.writeFileSync(path.join(corpusRoot, "signals", "record-1.json"), signalBytes);

  const driftConfig = attempt("corpus-drift");
  start(driftConfig);
  fs.appendFileSync(path.join(corpusRoot, "signals", "record-1.json"), " ");
  const driftHandoff = runDevelopmentCandidateExecution(candidateConfig(driftConfig));
  assert.equal(driftHandoff.handoffStatus, "EXECUTED");
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(driftConfig, driftHandoff, privateKeyPem), /DEVELOPMENT_SIGNAL_BYTES/);
  fs.writeFileSync(path.join(corpusRoot, "signals", "record-1.json"), signalBytes);

  start(config);
  const unavailableGovernance = `${governanceRoot}-unavailable`;
  const unavailableCorpus = `${corpusRoot}-unavailable`;
  fs.renameSync(governanceRoot, unavailableGovernance);
  fs.renameSync(corpusRoot, unavailableCorpus);
  const handoff = runDevelopmentCandidateExecution(candidateConfig(config));
  fs.renameSync(unavailableGovernance, governanceRoot);
  fs.renameSync(unavailableCorpus, corpusRoot);
  assert.equal(handoff.handoffStatus, "EXECUTED");
  assert.equal(handoff.schema, "ekg-development-execution-handoff-v2");
  assert.match(handoff.executionInputSha256, /^[0-9a-f]{64}$/);
  assert.equal(handoff.outcomes.every(row => row.executionRecordId === "record-000001" && row.recordHmacSha256 === undefined), true);
  const candidateVisible = fs.readFileSync(path.join(config.executionInputRoot, "input.json"), "utf8") + JSON.stringify(handoff);
  for (const forbidden of [manifest.records[0].recordHmacSha256, manifest.records[0].patientHmacSha256, "SENTINEL_PROTECTED_METADATA", "referenceSampleIndices", "subgroups", "rights"]) assert.equal(candidateVisible.includes(forbidden), false, forbidden);
  const receipt = finalizeDevelopmentEvaluationAttempt(config, handoff, privateKeyPem);
  assert.equal(receipt.writeOnce, false);
  assert.equal(receipt.applicationCollisionProtected, true);
  assert.equal(receipt.externalObjectLockAttested, false);
  const verified = verifyEvaluationBundle(receipt.path, publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(verified.pass, true);
  assert.equal(verified.artifactCount, 14);
  assert.equal(verified.runManifest.environment.signingBoundary, "SEPARATE_PINNED_SIGNER_IMAGE_BOUNDED_HANDOFF");
  assert.equal(verified.runManifest.gateStatus, "QUARANTINED");
  assert.equal(verified.runManifest.candidateReferenceIsolation, false);
  assert.equal(verified.runManifest.executionInputSha256, handoff.executionInputSha256);
  assert.equal(verified.runManifest.candidateRuntimeIdentitySha256, handoff.candidateRuntimeIdentitySha256);
  assert.equal(verified.runManifest.candidateIsolationExpectationSha256, handoff.candidateIsolationExpectationSha256);
  assert.equal(verified.runManifest.candidateRuntimeAttestationSha256, handoff.candidateRuntimeAttestationSha256);
  assert.equal(verified.runManifest.candidateRuntimeAttestation.candidateReferenceIsolation, false);
  const completedAttempt = verifyCompletedDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", config.attemptId), artifactRoot, publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(completedAttempt.executionStatus, "COMPLETED");
  assert.equal(Object.hasOwn(completedAttempt.start.runBinding, "candidateReferenceIsolation"), false);
  assert.equal(completedAttempt.start.runBinding.candidateInputMode, "SIGNAL_ONLY_READ_ONLY_V1");
  assert.equal(completedAttempt.start.runBinding.candidateIsolationMode, "SYNTHETIC_IN_PROCESS");
  assert.equal(completedAttempt.start.runBinding.candidateIsolationState, "PENDING_EXTERNAL_CONTROL_PLANE_ATTESTATION");
  assert.equal(completedAttempt.start.runBinding.candidateRuntimeImageDigest, null);
  assert.match(completedAttempt.start.runBinding.candidateRuntimeIdentitySha256, /^[0-9a-f]{64}$/);
  assert.match(completedAttempt.start.runBinding.candidateIsolationExpectationSha256, /^[0-9a-f]{64}$/);
  assert.equal(completedAttempt.terminal.bundle.executionInputSha256, handoff.executionInputSha256);
  assert.equal(completedAttempt.terminal.bundle.candidateRuntimeAttestationSha256, handoff.candidateRuntimeAttestationSha256);
  assert.equal(completedAttempt.terminal.bundle.candidateReferenceIsolation, false);
  assert.deepEqual(completedAttempt.bundleVerification.runManifest.runBinding, completedAttempt.start.runBinding);
  assert.equal(completedAttempt.terminal.accounting.byDetectorAndPass.every(row => row.SUCCESS === 1 && row.NOT_RUN === 0), true);
  const report = JSON.parse(fs.readFileSync(path.join(receipt.path, "development-report.json"), "utf8"));
  assert.equal(report.clinicalAccuracyClaimed, false);
  assert.equal(report.currentEngine.denominators.nRecords, 1);
  assert.equal(report.currentEngine.records, undefined);
  const candidateDigests = JSON.parse(fs.readFileSync(path.join(receipt.path, "candidate-digests.json"), "utf8"));
  assert.equal(candidateDigests.candidateSignature.keyId, "synthetic-development-candidate-2026-09-22");
  assert.equal(candidateDigests.metricCodeDigest, implementationDigest([path.join(repositoryRoot, "lib", "rpeak_development_metrics.js"), path.join(repositoryRoot, "lib", "event_matcher_v2.js")]));
  assert.equal(candidateDigests.candidateRuntimeIdentitySha256, handoff.candidateRuntimeIdentitySha256);
  assert.equal(candidateDigests.candidateRuntimeIdentity.schema, "ekg-development-candidate-runtime-identity-v1");
  const publishedText = fs.readdirSync(receipt.path).filter(name => name.endsWith(".json")).map(name => fs.readFileSync(path.join(receipt.path, name), "utf8")).join("\n");
  for (const row of cleanPartition.rows.filter(row => row.splitRole !== "development")) for (const field of ["recordHmacSha256", "patientHmacSha256", "sourceFileSha256", "nearDuplicateGroupSha256"]) assert.equal(publishedText.includes(row[field]), false);
  fs.rmSync(path.join(artifactRoot, "attempts", "2026", "09", "22", config.attemptId, "terminal"), { recursive: true });
  assert.equal(finalizeDevelopmentEvaluationAttempt(config, handoff, privateKeyPem).runId, receipt.runId);

  const predictionOrderConfig = attempt("tampered-handoff");
  start(predictionOrderConfig);
  const predictionOrderTamper = runDevelopmentCandidateExecution(candidateConfig(predictionOrderConfig));
  predictionOrderTamper.outcomes[0].predictedSampleIndices = [20, 10];
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(predictionOrderConfig, predictionOrderTamper, privateKeyPem), /DEVELOPMENT_HANDOFF_PREDICTION_ORDER/);

  const manifestTamperConfig = attempt("manifest-handoff-tamper");
  start(manifestTamperConfig);
  const manifestTamper = runDevelopmentCandidateExecution(candidateConfig(manifestTamperConfig));
  manifestTamper.manifestPayloadSha256 = "0".repeat(64);
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(manifestTamperConfig, manifestTamper, privateKeyPem), /DEVELOPMENT_HANDOFF_IDENTITY/);

  const missingConfig = attempt("missing-handoff");
  start(missingConfig);
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(missingConfig, null, privateKeyPem), /DEVELOPMENT_EXECUTION_HANDOFF_MISSING/);
  assert.equal(verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", missingConfig.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId }).executionStatus, "BLOCKED");

  const candidateInputFailureConfig = attempt("candidate-input-failure");
  start(candidateInputFailureConfig);
  fs.rmSync(candidateInputFailureConfig.executionInputRoot, { recursive: true });
  const candidateInputFailureConfigPath = path.join(temporaryRoot, "candidate-input-failure-config.json");
  const candidateInputFailurePath = path.join(temporaryRoot, "candidate-input-failure.json");
  fs.writeFileSync(candidateInputFailureConfigPath, JSON.stringify(candidateConfig(candidateInputFailureConfig)));
  const candidateInputFailureResult = childProcess.spawnSync(process.execPath, [path.join(repositoryRoot, "tools", "run_development_evaluation.js"), "--phase", "candidate", "--config", candidateInputFailureConfigPath, "--handoff", candidateInputFailurePath], { cwd: repositoryRoot, encoding: "utf8", env: process.env });
  assert.notEqual(candidateInputFailureResult.status, 0);
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(candidateInputFailureConfig, candidateInputFailurePath, privateKeyPem), /DEVELOPMENT_EXECUTION_INPUT_MISSING/);
  const candidateInputFailureTerminal = verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", candidateInputFailureConfig.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  assert.equal(candidateInputFailureTerminal.executionStatus, "BLOCKED");
  assert.equal(candidateInputFailureTerminal.terminal.failureCode, "DEVELOPMENT_EXECUTION_INPUT_MISSING");
  assert.equal(candidateInputFailureTerminal.terminal.bundle, null);

  const digestConfig = attempt("handoff-digest-tamper");
  start(digestConfig);
  const digestTamper = runDevelopmentCandidateExecution(candidateConfig(digestConfig));
  digestTamper.executionInputSha256 = "0".repeat(64);
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(digestConfig, digestTamper, privateKeyPem), /DEVELOPMENT_HANDOFF_IDENTITY/);

  const baselineConfig = attempt("baseline-tamper");
  start(baselineConfig);
  const baselineTamper = runDevelopmentCandidateExecution(candidateConfig(baselineConfig));
  baselineTamper.outcomes.find(row => row.detector === "PAN_TOMPKINS" && row.pass === "PRIMARY").predictedSampleIndices = [];
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(baselineConfig, baselineTamper, privateKeyPem), /DEVELOPMENT_PAN_TOMPKINS_SUBMISSION_MISMATCH/);

  const extraConfig = attempt("input-extra");
  start(extraConfig);
  const extraHandoff = runDevelopmentCandidateExecution(candidateConfig(extraConfig));
  fs.writeFileSync(path.join(extraConfig.executionInputRoot, "signals", "extra.json"), "{}\n");
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(extraConfig, extraHandoff, privateKeyPem), /DEVELOPMENT_EXECUTION_INPUT_SIGNAL_INVENTORY/);

  const malformedConfig = attempt("malformed-handoff");
  start(malformedConfig);
  const malformedPath = path.join(temporaryRoot, "malformed-handoff.json");
  fs.writeFileSync(malformedPath, "{not-json");
  assert.throws(() => finalizeDevelopmentEvaluationAttempt(malformedConfig, malformedPath, privateKeyPem), /DEVELOPMENT_HANDOFF_JSON/);
  assert.equal(verifyDevelopmentAttempt(path.join(artifactRoot, "attempts", "2026", "09", "22", malformedConfig.attemptId), publicKeyPem, { expectedSignerKeyId: config.signerKeyId }).executionStatus, "BLOCKED");

  const gatesPath = path.join(receipt.path, "gates.json");
  const originalGates = fs.readFileSync(gatesPath);
  fs.writeFileSync(gatesPath, Buffer.concat([originalGates, Buffer.from(" ")]));
  assert.throws(() => verifyEvaluationBundle(receipt.path, publicKeyPem), /EVALUATION_BUNDLE_ARTIFACT_HASH/);

  if (previousNetwork === undefined) delete process.env.EKG_EVALUATION_NETWORK_DISABLED;
  else process.env.EKG_EVALUATION_NETWORK_DISABLED = previousNetwork;
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}

console.log("development evaluation runner tests passed");
