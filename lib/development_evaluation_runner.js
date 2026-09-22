"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { deriveCandidateRuntimeIdentity, verifyDevelopmentCandidateRuntimePackage } = require("./development_execution_identity");
const { normalizeFailureCode } = require("./development_run_accounting");
const { createDevelopmentExecutionHandoff } = require("./development_execution_handoff");
const { readDevelopmentExecutionInput } = require("./development_execution_input");
const { CANDIDATE_INPUT_MODE, CANDIDATE_LAUNCH_POLICY_SHA256, CANDIDATE_TOTAL_WORKER_BUDGET_MS, CANDIDATE_WORKER_TIMEOUT_MS, validateCandidateIsolationExpectation } = require("./development_candidate_isolation");
const { collectCandidateRuntimeAttestation } = require("./development_candidate_runtime_attestation");
const { payloadSha256 } = require("./evaluation_signatures");
const { DEVELOPMENT_CONTROL_RESOURCE_LIMITS, createDevelopmentControlBudget, readDevelopmentControlJson } = require("./development_control_snapshot");
const { resolveWithin } = require("./local_dataset_loader");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateRunConfig(config) {
  requireCondition(plain(config), "DEVELOPMENT_RUN_CONFIG");
  const allowed = new Set(["manifestPath", "manifestSignaturePath", "manifestTrustStorePath", "expectedManifestTrustStoreSha256", "partitionIndexPath", "candidateManifestPath", "candidateSignaturePath", "candidateTrustStorePath", "expectedCandidateTrustStoreSha256", "corpusRoot", "artifactRoot", "executionInputRoot", "inputMountMode", "networkIsolation", "storageMode", "startedAtUtc", "trigger", "bootstrap", "previousApprovedBundlePath", "previousBundlePublicKeyPem", "previousBundleSignerKeyId", "signerKeyId", "repositoryRoot", "candidateRoot", "allowDirtySyntheticTest", "environmentImageDigest", "signerImageDigest", "candidateExpectedUid", "candidateExpectedGid", "attemptId", "workflowRunId", "workflowRunAttempt", "workflowSha", "engineCommitDigest", "engineTreeDigest", "worktreeClean", "worktreeStatusSha256"]);
  requireCondition(Object.keys(config).every(key => allowed.has(key)), "DEVELOPMENT_RUN_CONFIG_UNKNOWN_FIELD");
  for (const field of ["manifestPath", "manifestSignaturePath", "candidateManifestPath", "candidateSignaturePath", "candidateTrustStorePath", "expectedCandidateTrustStoreSha256", "corpusRoot", "artifactRoot", "executionInputRoot", "trigger", "signerKeyId"]) requireCondition(typeof config[field] === "string" && config[field].length > 0, `DEVELOPMENT_RUN_CONFIG_FIELD:${field}`);
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(config.startedAtUtc), "DEVELOPMENT_RUN_STARTED_AT");
  requireCondition(config.bootstrap === undefined || plain(config.bootstrap) && Object.keys(config.bootstrap).every(key => ["replicates", "seed"].includes(key)) && Number.isInteger(config.bootstrap.replicates) && config.bootstrap.replicates > 0 && Number.isInteger(config.bootstrap.seed), "DEVELOPMENT_RUN_BOOTSTRAP");
  requireCondition(config.manifestTrustStorePath === undefined || typeof config.manifestTrustStorePath === "string" && config.manifestTrustStorePath.length > 0, "DEVELOPMENT_MANIFEST_TRUST_PATH");
  requireCondition(config.expectedManifestTrustStoreSha256 === undefined || /^[0-9a-f]{64}$/.test(config.expectedManifestTrustStoreSha256), "DEVELOPMENT_MANIFEST_TRUST_DIGEST");
  requireCondition(/^[0-9a-f]{64}$/.test(config.expectedCandidateTrustStoreSha256), "DEVELOPMENT_CANDIDATE_TRUST_DIGEST");
  requireCondition(config.partitionIndexPath === undefined || typeof config.partitionIndexPath === "string" && config.partitionIndexPath.length > 0, "DEVELOPMENT_PARTITION_INDEX_PATH");
  const previousFields = [config.previousApprovedBundlePath, config.previousBundlePublicKeyPem, config.previousBundleSignerKeyId];
  requireCondition(previousFields.every(value => value === undefined || value === null) || previousFields.every(value => typeof value === "string" && value.length > 0), "DEVELOPMENT_PREVIOUS_BASELINE_CONFIG");
  requireCondition(config.environmentImageDigest === undefined || /^[0-9a-f]{64}$/.test(config.environmentImageDigest), "DEVELOPMENT_ENVIRONMENT_IMAGE_DIGEST");
  requireCondition(config.signerImageDigest === undefined || /^[0-9a-f]{64}$/.test(config.signerImageDigest), "DEVELOPMENT_SIGNER_IMAGE_DIGEST");
  requireCondition(config.candidateExpectedUid === undefined || Number.isSafeInteger(config.candidateExpectedUid) && config.candidateExpectedUid >= 0, "DEVELOPMENT_CANDIDATE_EXPECTED_UID");
  requireCondition(config.candidateExpectedGid === undefined || Number.isSafeInteger(config.candidateExpectedGid) && config.candidateExpectedGid >= 0, "DEVELOPMENT_CANDIDATE_EXPECTED_GID");
  if (config.networkIsolation === "CONTAINER_NETWORK_NONE") requireCondition(Number.isSafeInteger(config.candidateExpectedUid) && Number.isSafeInteger(config.candidateExpectedGid), "DEVELOPMENT_CANDIDATE_EXPECTED_IDS_REQUIRED");
  requireCondition(config.candidateRoot === undefined || typeof config.candidateRoot === "string" && config.candidateRoot.length > 0, "DEVELOPMENT_CANDIDATE_ROOT");
  requireCondition(typeof config.attemptId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.attemptId), "DEVELOPMENT_ATTEMPT_ID");
  requireCondition(typeof config.workflowRunId === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(config.workflowRunId), "DEVELOPMENT_WORKFLOW_RUN_ID");
  requireCondition(Number.isInteger(config.workflowRunAttempt) && config.workflowRunAttempt > 0, "DEVELOPMENT_WORKFLOW_RUN_ATTEMPT");
  requireCondition(/^[0-9a-f]{40}$/.test(config.workflowSha), "DEVELOPMENT_WORKFLOW_SHA");
  requireCondition(/^[0-9a-f]{40}$/.test(config.engineCommitDigest), "DEVELOPMENT_ENGINE_COMMIT_DIGEST");
  requireCondition(config.engineCommitDigest === config.workflowSha, "DEVELOPMENT_ENGINE_WORKFLOW_COMMIT_MISMATCH");
  requireCondition(/^[0-9a-f]{40}$/.test(config.engineTreeDigest), "DEVELOPMENT_ENGINE_TREE_DIGEST");
  requireCondition(typeof config.worktreeClean === "boolean", "DEVELOPMENT_WORKTREE_CLEAN");
  requireCondition(/^[0-9a-f]{64}$/.test(config.worktreeStatusSha256), "DEVELOPMENT_WORKTREE_STATUS_DIGEST");
}

function validateCandidateRunConfig(config) {
  requireCondition(plain(config), "DEVELOPMENT_CANDIDATE_RUN_CONFIG");
  const expected = ["executionInputRoot", "candidateManifestPath", "candidateSignaturePath", "candidateTrustStorePath", "expectedCandidateTrustStoreSha256", "repositoryRoot", "candidateRoot", "inputMountMode", "networkIsolation", "candidateRuntimeImageDigest", "candidateLaunchPolicySha256", "candidateExpectedUid", "candidateExpectedGid"];
  requireCondition(JSON.stringify(Object.keys(config).sort()) === JSON.stringify(expected.sort()), "DEVELOPMENT_CANDIDATE_RUN_CONFIG_FIELDS");
  for (const field of ["executionInputRoot", "candidateManifestPath", "candidateSignaturePath", "candidateTrustStorePath", "repositoryRoot", "candidateRoot"]) requireCondition(typeof config[field] === "string" && config[field].length > 0, `DEVELOPMENT_CANDIDATE_RUN_CONFIG_FIELD:${field}`);
  requireCondition(/^[0-9a-f]{64}$/.test(config.expectedCandidateTrustStoreSha256), "DEVELOPMENT_CANDIDATE_TRUST_DIGEST");
  requireCondition(config.inputMountMode === "READ_ONLY", "DEVELOPMENT_INPUT_READ_ONLY_REQUIRED");
  requireCondition(["CONTAINER_NETWORK_NONE", "SYNTHETIC_TEST_PROCESS"].includes(config.networkIsolation), "DEVELOPMENT_NETWORK_ISOLATION_REQUIRED");
  if (config.networkIsolation === "SYNTHETIC_TEST_PROCESS") requireCondition(config.candidateRuntimeImageDigest === null && config.candidateExpectedUid === null && config.candidateExpectedGid === null, "DEVELOPMENT_CANDIDATE_SYNTHETIC_CONFIG");
  else requireCondition(/^[0-9a-f]{64}$/.test(config.candidateRuntimeImageDigest) && Number.isSafeInteger(config.candidateExpectedUid) && config.candidateExpectedUid >= 0 && Number.isSafeInteger(config.candidateExpectedGid) && config.candidateExpectedGid >= 0, "DEVELOPMENT_CANDIDATE_CONTAINER_CONFIG");
  requireCondition(config.candidateLaunchPolicySha256 === CANDIDATE_LAUNCH_POLICY_SHA256, "DEVELOPMENT_CANDIDATE_LAUNCH_POLICY_DIGEST");
  return config;
}

function readJsonSnapshot(file, code, options = {}) {
  const maxBytes = options.maxBytes === undefined ? DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxManifestBytes : options.maxBytes;
  const budget = options.budget || createDevelopmentControlBudget();
  return readDevelopmentControlJson(file, maxBytes, budget, code, options.expectedSha256);
}

function readJson(file, code, options = {}) {
  return readJsonSnapshot(file, code, options).value;
}

function readJsonWithSha256(file, expectedSha256, code, options = {}) {
  return readJsonSnapshot(file, code, { ...options, expectedSha256 }).value;
}

function assertNoSymlinkPath(root, file, code) {
  const base = path.resolve(root);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    requireCondition(current === base || current.startsWith(prefix), `${code}_ESCAPE`);
    requireCondition(!fs.lstatSync(current).isSymbolicLink(), `${code}_SYMLINK`);
    if (current === base) break;
  }
}

function requirePathWithin(root, candidate, code) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  const prefix = base.endsWith(path.sep) ? base : `${base}${path.sep}`;
  requireCondition(resolved.startsWith(prefix), code);
  return resolved;
}

function readExact(root, relative, expectedBytes, expectedHash, code) {
  const file = resolveWithin(root, relative);
  assertNoSymlinkPath(root, file, code);
  const stat = fs.lstatSync(file);
  requireCondition(stat.isFile(), `${code}_FILE`);
  requireCondition(stat.size === expectedBytes, `${code}_BYTES`);
  const bytes = fs.readFileSync(file);
  requireCondition(crypto.createHash("sha256").update(bytes).digest("hex") === expectedHash, `${code}_HASH`);
  return bytes;
}

function implementationDigest(files) {
  const hashes = files.map(file => {
    const bytes = fs.readFileSync(file);
    return { file: path.basename(file), sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  });
  return payloadSha256(hashes);
}

function runDetector(detector, samples, sampleRateHz, provenance) {
  const started = process.hrtime.bigint();
  const memoryBefore = process.memoryUsage().rss;
  try {
    const output = detector(samples, sampleRateHz, provenance);
    return {
      status: "SUCCESS",
      failureCode: null,
      predictedSampleIndices: output.events.map(row => row.sampleIndex),
      latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
      peakMemoryBytes: Math.max(memoryBefore, process.memoryUsage().rss),
      algorithm: output.algorithm,
    };
  } catch (error) {
    return {
      status: "TECHNICAL_FAILURE",
      failureCode: normalizeFailureCode(error, "DETECTOR_FAILURE"),
      predictedSampleIndices: [],
      latencyMs: Number(process.hrtime.bigint() - started) / 1e6,
      peakMemoryBytes: Math.max(memoryBefore, process.memoryUsage().rss),
      algorithm: null,
    };
  }
}

function validateCandidateWorkerResponse(response, requestId, sampleCount) {
  requireCondition(plain(response), "DEVELOPMENT_CANDIDATE_WORKER_RESPONSE");
  const expected = ["schema", "requestId", "status", "failureCode", "predictedSampleIndices", "algorithm", "latencyMs", "peakMemoryBytes"];
  requireCondition(JSON.stringify(Object.keys(response).sort()) === JSON.stringify(expected.sort()), "DEVELOPMENT_CANDIDATE_WORKER_RESPONSE_FIELDS");
  requireCondition(response.schema === "ekg-development-candidate-prediction-response-v1" && response.requestId === requestId, "DEVELOPMENT_CANDIDATE_WORKER_RESPONSE_IDENTITY");
  requireCondition(["SUCCESS", "TECHNICAL_FAILURE", "ABSTAINED"].includes(response.status), "DEVELOPMENT_CANDIDATE_WORKER_RESPONSE_STATUS");
  requireCondition(Array.isArray(response.predictedSampleIndices) && response.predictedSampleIndices.every((value, index) => Number.isInteger(value) && value >= 0 && value < sampleCount && (index === 0 || value > response.predictedSampleIndices[index - 1])), "DEVELOPMENT_CANDIDATE_WORKER_RESPONSE_PREDICTIONS");
  requireCondition(Number.isFinite(response.latencyMs) && response.latencyMs >= 0 && response.latencyMs <= 86400000, "DEVELOPMENT_CANDIDATE_WORKER_RESPONSE_LATENCY");
  requireCondition(Number.isSafeInteger(response.peakMemoryBytes) && response.peakMemoryBytes >= 0, "DEVELOPMENT_CANDIDATE_WORKER_RESPONSE_MEMORY");
  if (response.status === "SUCCESS") requireCondition(response.failureCode === null && typeof response.algorithm === "string" && response.algorithm.length > 0 && response.algorithm.length <= 256, "DEVELOPMENT_CANDIDATE_WORKER_RESPONSE_SUCCESS");
  else requireCondition(typeof response.failureCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(response.failureCode) && response.predictedSampleIndices.length === 0 && response.algorithm === null, "DEVELOPMENT_CANDIDATE_WORKER_RESPONSE_FAILURE");
  return response;
}

function createCandidateWorkerBudget(options = {}) {
  const nowMs = options.nowMs || (() => Number(process.hrtime.bigint() / 1000000n));
  const budgetMs = options.budgetMs === undefined ? CANDIDATE_TOTAL_WORKER_BUDGET_MS : options.budgetMs;
  requireCondition(Number.isSafeInteger(budgetMs) && budgetMs > 0 && budgetMs <= CANDIDATE_TOTAL_WORKER_BUDGET_MS, "DEVELOPMENT_CANDIDATE_TOTAL_BUDGET_CONFIG");
  const startedAtMs = nowMs();
  requireCondition(Number.isSafeInteger(startedAtMs), "DEVELOPMENT_CANDIDATE_MONOTONIC_CLOCK");
  const remainingMs = () => {
    const currentMs = nowMs();
    requireCondition(Number.isSafeInteger(currentMs) && currentMs >= startedAtMs, "DEVELOPMENT_CANDIDATE_MONOTONIC_CLOCK");
    const remaining = budgetMs - (currentMs - startedAtMs);
    requireCondition(remaining > 0, "DEVELOPMENT_CANDIDATE_TOTAL_TIMEOUT");
    return remaining;
  };
  return Object.freeze({
    nextWorkerTimeoutMs: () => Math.min(CANDIDATE_WORKER_TIMEOUT_MS, remainingMs()),
    assertRemaining: () => { remainingMs(); },
  });
}

function runCandidateWorker(config, runtimeIdentitySha256, controlSha256, request, timeoutMs = CANDIDATE_WORKER_TIMEOUT_MS) {
  requireCondition(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= CANDIDATE_WORKER_TIMEOUT_MS, "DEVELOPMENT_CANDIDATE_WORKER_TIMEOUT_CONFIG");
  const worker = path.join(__dirname, "development_candidate_worker.js");
  const result = childProcess.spawnSync(process.execPath, [worker, config.candidateRoot, config.candidateManifestPath, config.candidateSignaturePath, config.candidateTrustStorePath, controlSha256.trustStore, controlSha256.manifest, controlSha256.signature, runtimeIdentitySha256, String(config.networkIsolation === "CONTAINER_NETWORK_NONE")], { input: JSON.stringify(request), encoding: "utf8", timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (result.error && result.error.code === "ETIMEDOUT") return { status: "TECHNICAL_FAILURE", failureCode: "DEVELOPMENT_CANDIDATE_WORKER_TIMEOUT", predictedSampleIndices: [], algorithm: null, latencyMs: timeoutMs, peakMemoryBytes: 0 };
  if (result.status !== 0 && typeof result.stderr === "string") {
    const match = /^DEVELOPMENT_CANDIDATE_WORKER_CONTROL_FAILURE:(DEVELOPMENT_[A-Z0-9_:.-]+)$/m.exec(result.stderr);
    if (match) throw new Error(match[1]);
  }
  if (result.error || result.status !== 0 || result.signal) return { status: "TECHNICAL_FAILURE", failureCode: "DEVELOPMENT_CANDIDATE_WORKER_TERMINATED", predictedSampleIndices: [], algorithm: null, latencyMs: 0, peakMemoryBytes: 0 };
  let response;
  try { response = JSON.parse(result.stdout); } catch (_) { throw new Error("DEVELOPMENT_CANDIDATE_WORKER_RESPONSE_JSON"); }
  const validated = validateCandidateWorkerResponse(response, request.requestId, request.samples.length);
  return { status: validated.status, failureCode: validated.failureCode, predictedSampleIndices: validated.predictedSampleIndices, algorithm: validated.algorithm, latencyMs: validated.latencyMs, peakMemoryBytes: validated.peakMemoryBytes };
}

function loadEvaluationRecord(corpusRoot, manifestRecord, leadPolicy) {
  const signalBytes = readExact(corpusRoot, manifestRecord.signalPath, manifestRecord.signalBytes, manifestRecord.sourceFileSha256, "DEVELOPMENT_SIGNAL");
  const referenceBytes = readExact(corpusRoot, manifestRecord.referencePath, manifestRecord.referenceBytes, manifestRecord.labelSnapshotSha256, "DEVELOPMENT_REFERENCE");
  let signal;
  let reference;
  try { signal = JSON.parse(signalBytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_SIGNAL_JSON"); }
  try { reference = JSON.parse(referenceBytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_REFERENCE_JSON"); }
  requireCondition(signal && Array.isArray(signal.samples) && signal.samples.length > 0 && signal.samples.every(Number.isFinite), "DEVELOPMENT_SIGNAL_SAMPLES");
  requireCondition(signal.sampleRateHz === manifestRecord.sampleRateHz, "DEVELOPMENT_SIGNAL_SAMPLE_RATE_DRIFT");
  requireCondition(reference && Array.isArray(reference.referenceSampleIndices), "DEVELOPMENT_REFERENCE_EVENTS");
  requireCondition(reference.referenceSampleIndices.every(index => Number.isInteger(index) && index >= 0 && index < signal.samples.length), "DEVELOPMENT_REFERENCE_EVENT_RANGE");
  requireCondition(new Set(reference.referenceSampleIndices).size === reference.referenceSampleIndices.length, "DEVELOPMENT_REFERENCE_EVENT_DUPLICATE");
  if (leadPolicy === "fixed-manifest-lead") {
    requireCondition(typeof manifestRecord.subgroups.lead === "string" && manifestRecord.subgroups.lead.length > 0, "DEVELOPMENT_MANIFEST_LEAD");
    requireCondition(signal.lead === manifestRecord.subgroups.lead, "DEVELOPMENT_SIGNAL_LEAD_DRIFT");
  }
  return { samples: signal.samples, referenceSampleIndices: reference.referenceSampleIndices, lead: signal.lead || null };
}

function gitIdentity(repositoryRoot) {
  const run = args => childProcess.execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
  const status = run(["status", "--porcelain=v1", "--untracked-files=all"]);
  return { commit: run(["rev-parse", "HEAD"]), tree: run(["rev-parse", "HEAD^{tree}"]), worktreeClean: status.length === 0, worktreeStatusSha256: payloadSha256(status) };
}

function deriveContractDigests(manifest, protocol, executionIdentity) {
  const protocolArtifact = executionIdentity.artifacts.find(row => row.file === "evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json");
  requireCondition(protocolArtifact, "DEVELOPMENT_PROTOCOL_IDENTITY_REQUIRED");
  return {
    protocolSha256: protocolArtifact.sha256,
    preprocessingSha256: payloadSha256(protocol.identicalPipelineRequirements),
    leadPolicySha256: payloadSha256(manifest.leadPolicy),
    labelSnapshotSha256: payloadSha256(manifest.records.filter(record => record.taskEligibility === "ELIGIBLE").map(record => ({ recordHmacSha256: record.recordHmacSha256, labelSnapshotSha256: record.labelSnapshotSha256 })).sort((left, right) => left.recordHmacSha256.localeCompare(right.recordHmacSha256))),
    thresholdCalibrationSha256: payloadSha256({ currentEngine: protocol.currentEngine.configuration, panTompkins: "DEFAULT_PAN_TOMPKINS_CONFIG_V1" }),
  };
}

function runConfigurationIdentity(config) {
  const fields = ["manifestPath", "manifestSignaturePath", "manifestTrustStorePath", "expectedManifestTrustStoreSha256", "partitionIndexPath", "candidateManifestPath", "candidateSignaturePath", "candidateTrustStorePath", "expectedCandidateTrustStoreSha256", "corpusRoot", "artifactRoot", "executionInputRoot", "inputMountMode", "networkIsolation", "storageMode", "startedAtUtc", "trigger", "bootstrap", "previousApprovedBundlePath", "previousBundlePublicKeyPem", "previousBundleSignerKeyId", "signerKeyId", "environmentImageDigest", "signerImageDigest", "candidateExpectedUid", "candidateExpectedGid", "attemptId", "workflowRunId", "workflowRunAttempt", "workflowSha", "engineCommitDigest", "engineTreeDigest", "worktreeClean", "worktreeStatusSha256"];
  return payloadSha256(Object.fromEntries(fields.map(field => [field, config[field] === undefined ? null : config[field]])));
}

function utcNow() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function transitionAttempt(attempt, state, atUtc = utcNow()) {
  const previousAtUtc = attempt.stateTransitions.length === 0 ? atUtc : attempt.stateTransitions[attempt.stateTransitions.length - 1].atUtc;
  const transitionAtUtc = atUtc < previousAtUtc ? previousAtUtc : atUtc;
  attempt.lastPhase = state;
  attempt.stateTransitions.push({ state, atUtc: transitionAtUtc });
  return transitionAtUtc;
}

function loadDevelopmentGovernance(config, repositoryRoot, syntheticTest, options = {}) {
  const { preflightDevelopmentRun } = require("./development_evaluation_preflight");
  const { MINIMUM_SPENT_REGISTRY_SEQUENCE, PINNED_SPENT_REGISTRY_SHA256 } = require("./spent_dataset_registry");
  const budget = options.controlBudget || createDevelopmentControlBudget();
  const manifest = readJson(config.manifestPath, "DEVELOPMENT_MANIFEST_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxManifestBytes, budget });
  const manifestSignature = readJson(config.manifestSignaturePath, "DEVELOPMENT_MANIFEST_SIGNATURE_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxSignatureBytes, budget });
  requireCondition(syntheticTest || typeof config.manifestTrustStorePath === "string", "DEVELOPMENT_EXTERNAL_MANIFEST_TRUST_REQUIRED");
  requireCondition(syntheticTest || typeof config.expectedManifestTrustStoreSha256 === "string", "DEVELOPMENT_EXTERNAL_MANIFEST_TRUST_DIGEST_REQUIRED");
  requireCondition(syntheticTest || typeof config.partitionIndexPath === "string", "DEVELOPMENT_EXTERNAL_PARTITION_INDEX_REQUIRED");
  const manifestTrustStorePath = config.manifestTrustStorePath || path.join(repositoryRoot, "evaluation", "keys", "DEVELOPMENT_MANIFEST_SIGNERS.json");
  const partitionIndexPath = config.partitionIndexPath || path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_PARTITION_INDEX_V2.json");
  const manifestTrustSnapshot = readJsonSnapshot(manifestTrustStorePath, "DEVELOPMENT_MANIFEST_TRUST_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxTrustStoreBytes, budget, expectedSha256: config.expectedManifestTrustStoreSha256 });
  const manifestTrustStore = manifestTrustSnapshot.value;
  const manifestTrustStoreSha256 = manifestTrustSnapshot.sha256;
  const partitionIndex = readJson(partitionIndexPath, "DEVELOPMENT_PARTITION_INDEX_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxPartitionIndexBytes, budget });
  const spentRegistry = readJson(path.join(repositoryRoot, "evaluation", "registries", "SPENT_DATASET_REGISTRY.json"), "SPENT_REGISTRY_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxRegistryBytes, budget });
  const spentRegistrySignature = readJson(path.join(repositoryRoot, "evaluation", "registries", "SPENT_DATASET_REGISTRY.sig"), "SPENT_REGISTRY_SIGNATURE_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxSignatureBytes, budget });
  const spentTrustStore = readJson(path.join(repositoryRoot, "evaluation", "keys", "SPENT_REGISTRY_SIGNERS.json"), "SPENT_REGISTRY_TRUST_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxTrustStoreBytes, budget });
  const preflight = preflightDevelopmentRun({ spentRegistry, spentRegistrySignature, spentTrustStore, minimumSpentRegistrySequence: MINIMUM_SPENT_REGISTRY_SEQUENCE, expectedSpentRegistrySha256: PINNED_SPENT_REGISTRY_SHA256, manifest, manifestSignature, manifestTrustStore, partitionIndex });
  return { manifest, manifestSignature, manifestTrustStore, manifestTrustStoreSha256, partitionIndex, spentRegistry, spentRegistrySignature, spentTrustStore, preflight, verifiedControlBytes: budget.totalBytes, controlResourceLimits: DEVELOPMENT_CONTROL_RESOURCE_LIMITS };
}

function executeDevelopmentCandidate(config, executionInput, attempt, options = {}) {
  requireCondition(process.env.EKG_EVALUATION_NETWORK_DISABLED === "1", "DEVELOPMENT_NETWORK_ISOLATION_ENV_REQUIRED");
  const repositoryRoot = path.resolve(config.repositoryRoot);
  const candidateRoot = path.resolve(config.candidateRoot);
  const budget = options.controlBudget || createDevelopmentControlBudget();
  requireCondition(repositoryRoot === candidateRoot, "DEVELOPMENT_CANDIDATE_ROOT_MISMATCH");
  const candidateManifestSnapshot = readJsonSnapshot(config.candidateManifestPath, "DEVELOPMENT_CANDIDATE_MANIFEST_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxManifestBytes, budget });
  const candidateSignatureSnapshot = readJsonSnapshot(config.candidateSignaturePath, "DEVELOPMENT_CANDIDATE_SIGNATURE_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxSignatureBytes, budget });
  const candidateTrustSnapshot = readJsonSnapshot(config.candidateTrustStorePath, "DEVELOPMENT_CANDIDATE_TRUST_JSON", { maxBytes: DEVELOPMENT_CONTROL_RESOURCE_LIMITS.maxTrustStoreBytes, budget, expectedSha256: config.expectedCandidateTrustStoreSha256 });
  const candidateManifest = candidateManifestSnapshot.value;
  const candidateSignature = candidateSignatureSnapshot.value;
  const candidateTrustStore = candidateTrustSnapshot.value;
  const controlSha256 = { manifest: candidateManifestSnapshot.sha256, signature: candidateSignatureSnapshot.sha256, trustStore: candidateTrustSnapshot.sha256 };
  const verified = verifyDevelopmentCandidateRuntimePackage(candidateManifest, candidateSignature, candidateTrustStore, { repositoryRoot: candidateRoot, requireProductionAuthority: config.networkIsolation === "CONTAINER_NETWORK_NONE" });
  const runtime = deriveCandidateRuntimeIdentity(verified);
  requireCondition(runtime.candidateRuntimeIdentitySha256 === executionInput.index.candidateRuntimeIdentitySha256, "DEVELOPMENT_CANDIDATE_RUNTIME_IDENTITY_MISMATCH");
  requireCondition(verified.manifestPayloadSha256 === executionInput.index.candidateManifestPayloadSha256, "DEVELOPMENT_EXECUTION_INPUT_CANDIDATE_MISMATCH");
  requireCondition(verified.executionIdentitySha256 === executionInput.index.executionIdentitySha256, "DEVELOPMENT_EXECUTION_INPUT_IDENTITY_MISMATCH");
  let protocol;
  try { protocol = JSON.parse(verified.verifiedArtifacts.get("evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json").source); } catch (_) { throw new Error("DEVELOPMENT_EXECUTION_PROTOCOL_JSON"); }
  attempt.candidateManifestPayloadSha256 = verified.manifestPayloadSha256;
  attempt.executionIdentitySha256 = verified.executionIdentitySha256;
  attempt.candidateRuntimeIdentitySha256 = runtime.candidateRuntimeIdentitySha256;
  attempt.manifestPayloadSha256 = executionInput.index.manifestPayloadSha256;
  transitionAttempt(attempt, "RUNNING");
  const panTompkinsAlgorithm = protocol.requiredDetectors.find(detector => detector !== protocol.currentEngine.algorithm);
  requireCondition(typeof panTompkinsAlgorithm === "string" && panTompkinsAlgorithm.length > 0, "DEVELOPMENT_PAN_TOMPKINS_ALGORITHM_REQUIRED");
  const workerBudget = createCandidateWorkerBudget();
  const executeWorker = request => {
    const result = runCandidateWorker(config, runtime.candidateRuntimeIdentitySha256, controlSha256, request, workerBudget.nextWorkerTimeoutMs());
    workerBudget.assertRemaining();
    return result;
  };
  for (const record of executionInput.records) {
    const provenance = { sourceKind: "signer_prepared_signal_only", locator: record.executionRecordId };
    const request = (detector, pass) => ({ schema: "ekg-development-candidate-prediction-request-v2", requestId: `${record.executionRecordId}:${detector}:${pass}`, detector, samples: record.samples, sampleRateHz: record.sampleRateHz, configuration: protocol.currentEngine.configuration, provenance });
    const runs = [
      ["CURRENT_ENGINE", "PRIMARY", executeWorker(request("CURRENT_ENGINE", "PRIMARY"))],
      ["CURRENT_ENGINE", "REPLAY", executeWorker(request("CURRENT_ENGINE", "REPLAY"))],
      ["PAN_TOMPKINS", "PRIMARY", executeWorker(request("PAN_TOMPKINS", "PRIMARY"))],
      ["PAN_TOMPKINS", "REPLAY", executeWorker(request("PAN_TOMPKINS", "REPLAY"))],
    ];
    for (const [detector, pass, result] of runs) attempt.outcomes.push({ executionRecordId: record.executionRecordId, detector, pass, ...result });
    const candidate = runs[0][2];
    const candidateReplay = runs[1][2];
    const panTompkins = runs[2][2];
    const panTompkinsReplay = runs[3][2];
    const deterministicOutput = value => ({ status: value.status, failureCode: value.failureCode, predictedSampleIndices: value.predictedSampleIndices, algorithm: value.algorithm });
    requireCondition(JSON.stringify(deterministicOutput(candidate)) === JSON.stringify(deterministicOutput(candidateReplay)), "DEVELOPMENT_CURRENT_ENGINE_NONDETERMINISTIC");
    requireCondition(JSON.stringify(deterministicOutput(panTompkins)) === JSON.stringify(deterministicOutput(panTompkinsReplay)), "DEVELOPMENT_PAN_TOMPKINS_NONDETERMINISTIC");
    if (candidate.status === "SUCCESS") requireCondition(candidate.algorithm === protocol.currentEngine.algorithm, "DEVELOPMENT_CURRENT_ENGINE_ALGORITHM_DRIFT");
    if (panTompkins.status === "SUCCESS") requireCondition(panTompkins.algorithm === panTompkinsAlgorithm, "DEVELOPMENT_PAN_TOMPKINS_ALGORITHM_DRIFT");
  }
}

function runDevelopmentCandidateExecution(config, options = {}) {
  validateCandidateRunConfig(config);
  const executionInput = readDevelopmentExecutionInput(config.executionInputRoot);
  requireCondition(executionInput.index.candidateInputMode === CANDIDATE_INPUT_MODE, "DEVELOPMENT_EXECUTION_INPUT_MODE");
  const expectedIsolationMode = config.networkIsolation === "SYNTHETIC_TEST_PROCESS" ? "SYNTHETIC_IN_PROCESS" : "PINNED_SIGNAL_ONLY_CONTAINER";
  requireCondition(executionInput.index.candidateIsolationMode === expectedIsolationMode, "DEVELOPMENT_EXECUTION_INPUT_ISOLATION_MODE");
  const identity = executionInput.index;
  const candidateIsolationExpectation = {
    schema: "ekg-development-candidate-isolation-expectation-v1",
    attestationState: identity.candidateIsolationState,
    isolationMode: identity.candidateIsolationMode,
    candidateInputMode: identity.candidateInputMode,
    candidateRuntimeImageDigest: identity.candidateRuntimeImageDigest,
    candidateLaunchPolicySha256: identity.candidateLaunchPolicySha256,
    expectedUid: identity.candidateExpectedUid,
    expectedGid: identity.candidateExpectedGid,
  };
  validateCandidateIsolationExpectation(candidateIsolationExpectation, identity.candidateIsolationExpectationSha256);
  const attempt = { stateTransitions: [{ state: "VALIDATING", atUtc: identity.startedAtUtc }], lastPhase: "VALIDATING", outcomes: [], candidateManifestPayloadSha256: identity.candidateManifestPayloadSha256, executionIdentitySha256: identity.executionIdentitySha256, candidateRuntimeIdentitySha256: identity.candidateRuntimeIdentitySha256, manifestPayloadSha256: identity.manifestPayloadSha256, candidateRuntimeAttestation: null, candidateRuntimeAttestationSha256: null };
  const handoffInput = (handoffStatus, failureCode, lastPhase) => ({ config: identity, runConfigurationSha256: identity.runConfigurationSha256, executionInputSha256: executionInput.executionInputSha256, candidateRuntimeIdentitySha256: attempt.candidateRuntimeIdentitySha256, candidateIsolationExpectationSha256: identity.candidateIsolationExpectationSha256, candidateRuntimeAttestation: attempt.candidateRuntimeAttestation, candidateRuntimeAttestationSha256: attempt.candidateRuntimeAttestationSha256, handoffStatus, failureCode, lastPhase, stateTransitions: attempt.stateTransitions, candidateManifestPayloadSha256: attempt.candidateManifestPayloadSha256, executionIdentitySha256: attempt.executionIdentitySha256, manifestPayloadSha256: attempt.manifestPayloadSha256, outcomes: attempt.outcomes });
  try {
    const runtimeAttestation = collectCandidateRuntimeAttestation(candidateIsolationExpectation);
    attempt.candidateRuntimeAttestation = runtimeAttestation.attestation;
    attempt.candidateRuntimeAttestationSha256 = runtimeAttestation.candidateRuntimeAttestationSha256;
    requireCondition(config.candidateRuntimeImageDigest === identity.candidateRuntimeImageDigest, "DEVELOPMENT_CANDIDATE_CONFIG_IMAGE_DIGEST");
    requireCondition(config.candidateLaunchPolicySha256 === identity.candidateLaunchPolicySha256, "DEVELOPMENT_CANDIDATE_CONFIG_POLICY_DIGEST");
    requireCondition(config.candidateExpectedUid === identity.candidateExpectedUid && config.candidateExpectedGid === identity.candidateExpectedGid, "DEVELOPMENT_CANDIDATE_CONFIG_USER");
    requireCondition(runtimeAttestation.candidateReferenceIsolation === false, "DEVELOPMENT_CANDIDATE_REFERENCE_ISOLATION_MUST_REMAIN_FALSE");
    executeDevelopmentCandidate(config, executionInput, attempt, options);
    const lastPhase = attempt.lastPhase;
    transitionAttempt(attempt, "EXECUTED");
    return createDevelopmentExecutionHandoff(handoffInput("EXECUTED", null, lastPhase));
  } catch (error) {
    const failureCode = normalizeFailureCode(error, "DEVELOPMENT_EVALUATION_FAILURE");
    const lastPhase = attempt.lastPhase;
    const handoffStatus = lastPhase === "VALIDATING" ? "BLOCKED" : "FAILED";
    transitionAttempt(attempt, handoffStatus);
    return createDevelopmentExecutionHandoff(handoffInput(handoffStatus, failureCode, lastPhase));
  }
}

function runDevelopmentEvaluation() {
  throw new Error("DEVELOPMENT_EVALUATION_SPLIT_REQUIRED");
}

module.exports = { assertNoSymlinkPath, createCandidateWorkerBudget, deriveContractDigests, gitIdentity, implementationDigest, loadDevelopmentGovernance, loadEvaluationRecord, normalizeFailureCode, readExact, readJson, readJsonSnapshot, readJsonWithSha256, requirePathWithin, runConfigurationIdentity, runDevelopmentCandidateExecution, runDevelopmentEvaluation, runDetector, transitionAttempt, utcNow, validateCandidateRunConfig, validateRunConfig };
