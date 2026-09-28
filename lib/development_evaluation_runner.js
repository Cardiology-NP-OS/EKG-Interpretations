"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { preflightDevelopmentRun } = require("./development_evaluation_preflight");
const { loadDevelopmentExecution } = require("./development_execution_identity");
const { createRunAccounting, normalizeFailureCode, recordDetectorOutcome } = require("./development_run_accounting");
const { createDevelopmentExecutionHandoff } = require("./development_execution_handoff");
const { payloadSha256 } = require("./evaluation_signatures");
const { resolveWithin } = require("./local_dataset_loader");
const { MINIMUM_SPENT_REGISTRY_SEQUENCE, PINNED_SPENT_REGISTRY_SHA256 } = require("./spent_dataset_registry");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function validateRunConfig(config) {
  requireCondition(plain(config), "DEVELOPMENT_RUN_CONFIG");
  const allowed = new Set(["manifestPath", "manifestSignaturePath", "manifestTrustStorePath", "expectedManifestTrustStoreSha256", "partitionIndexPath", "candidateManifestPath", "candidateSignaturePath", "candidateTrustStorePath", "expectedCandidateTrustStoreSha256", "corpusRoot", "artifactRoot", "inputMountMode", "networkIsolation", "storageMode", "startedAtUtc", "trigger", "bootstrap", "previousApprovedBundlePath", "previousBundlePublicKeyPem", "previousBundleSignerKeyId", "signerKeyId", "repositoryRoot", "candidateRoot", "allowDirtySyntheticTest", "environmentImageDigest", "signerImageDigest", "attemptId", "workflowRunId", "workflowRunAttempt", "workflowSha", "engineCommitDigest", "engineTreeDigest", "worktreeClean", "worktreeStatusSha256"]);
  requireCondition(Object.keys(config).every(key => allowed.has(key)), "DEVELOPMENT_RUN_CONFIG_UNKNOWN_FIELD");
  for (const field of ["manifestPath", "manifestSignaturePath", "candidateManifestPath", "candidateSignaturePath", "candidateTrustStorePath", "expectedCandidateTrustStoreSha256", "corpusRoot", "artifactRoot", "trigger", "signerKeyId"]) requireCondition(typeof config[field] === "string" && config[field].length > 0, `DEVELOPMENT_RUN_CONFIG_FIELD:${field}`);
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

function readJson(file, code) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { throw new Error(code); }
  requireCondition(value && typeof value === "object" && !Array.isArray(value), code);
  return value;
}

function readJsonWithSha256(file, expectedSha256, code) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (_) { throw new Error(code); }
  requireCondition(crypto.createHash("sha256").update(bytes).digest("hex") === expectedSha256, `${code}_HASH`);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); } catch (_) { throw new Error(code); }
  requireCondition(value && typeof value === "object" && !Array.isArray(value), code);
  return value;
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
  const fields = ["manifestPath", "manifestSignaturePath", "manifestTrustStorePath", "expectedManifestTrustStoreSha256", "partitionIndexPath", "candidateManifestPath", "candidateSignaturePath", "candidateTrustStorePath", "expectedCandidateTrustStoreSha256", "corpusRoot", "artifactRoot", "inputMountMode", "networkIsolation", "storageMode", "startedAtUtc", "trigger", "bootstrap", "previousApprovedBundlePath", "previousBundlePublicKeyPem", "previousBundleSignerKeyId", "signerKeyId", "environmentImageDigest", "signerImageDigest", "attemptId", "workflowRunId", "workflowRunAttempt", "workflowSha", "engineCommitDigest", "engineTreeDigest", "worktreeClean", "worktreeStatusSha256"];
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

function loadDevelopmentGovernance(config, repositoryRoot, syntheticTest) {
  const manifest = readJson(config.manifestPath, "DEVELOPMENT_MANIFEST_JSON");
  const manifestSignature = readJson(config.manifestSignaturePath, "DEVELOPMENT_MANIFEST_SIGNATURE_JSON");
  requireCondition(syntheticTest || typeof config.manifestTrustStorePath === "string", "DEVELOPMENT_EXTERNAL_MANIFEST_TRUST_REQUIRED");
  requireCondition(syntheticTest || typeof config.expectedManifestTrustStoreSha256 === "string", "DEVELOPMENT_EXTERNAL_MANIFEST_TRUST_DIGEST_REQUIRED");
  requireCondition(syntheticTest || typeof config.partitionIndexPath === "string", "DEVELOPMENT_EXTERNAL_PARTITION_INDEX_REQUIRED");
  const manifestTrustStorePath = config.manifestTrustStorePath || path.join(repositoryRoot, "evaluation", "keys", "DEVELOPMENT_MANIFEST_SIGNERS.json");
  const partitionIndexPath = config.partitionIndexPath || path.join(repositoryRoot, "evaluation", "manifests", "SYNTHETIC_DEVELOPMENT_PARTITION_INDEX_V2.json");
  const manifestTrustStore = config.expectedManifestTrustStoreSha256 ? readJsonWithSha256(manifestTrustStorePath, config.expectedManifestTrustStoreSha256, "DEVELOPMENT_MANIFEST_TRUST_JSON") : readJson(manifestTrustStorePath, "DEVELOPMENT_MANIFEST_TRUST_JSON");
  const manifestTrustStoreSha256 = config.expectedManifestTrustStoreSha256 || crypto.createHash("sha256").update(fs.readFileSync(manifestTrustStorePath)).digest("hex");
  const partitionIndex = readJson(partitionIndexPath, "DEVELOPMENT_PARTITION_INDEX_JSON");
  const spentRegistry = readJson(path.join(repositoryRoot, "evaluation", "registries", "SPENT_DATASET_REGISTRY.json"), "SPENT_REGISTRY_JSON");
  const spentRegistrySignature = readJson(path.join(repositoryRoot, "evaluation", "registries", "SPENT_DATASET_REGISTRY.sig"), "SPENT_REGISTRY_SIGNATURE_JSON");
  const spentTrustStore = readJson(path.join(repositoryRoot, "evaluation", "keys", "SPENT_REGISTRY_SIGNERS.json"), "SPENT_REGISTRY_TRUST_JSON");
  const preflight = preflightDevelopmentRun({ spentRegistry, spentRegistrySignature, spentTrustStore, minimumSpentRegistrySequence: MINIMUM_SPENT_REGISTRY_SEQUENCE, expectedSpentRegistrySha256: PINNED_SPENT_REGISTRY_SHA256, manifest, manifestSignature, manifestTrustStore, partitionIndex });
  return { manifest, manifestSignature, manifestTrustStore, manifestTrustStoreSha256, partitionIndex, spentRegistry, spentRegistrySignature, spentTrustStore, preflight };
}

function executeDevelopmentCandidate(config, attempt) {
  requireCondition(process.env.EKG_EVALUATION_NETWORK_DISABLED === "1", "DEVELOPMENT_NETWORK_ISOLATION_ENV_REQUIRED");
  requireCondition(["CONTAINER_NETWORK_NONE", "SYNTHETIC_TEST_PROCESS"].includes(config.networkIsolation), "DEVELOPMENT_NETWORK_ISOLATION_REQUIRED");
  requireCondition(config.inputMountMode === "READ_ONLY", "DEVELOPMENT_INPUT_READ_ONLY_REQUIRED");
  requireCondition(config.storageMode === "APPLICATION_WRITE_ONCE_SIGNED", "DEVELOPMENT_STORAGE_MODE");
  if (config.networkIsolation === "CONTAINER_NETWORK_NONE") requireCondition(typeof config.environmentImageDigest === "string", "DEVELOPMENT_ENVIRONMENT_IMAGE_DIGEST_REQUIRED");
  const repositoryRoot = path.resolve(config.repositoryRoot || path.join(__dirname, ".."));
  const syntheticTest = config.networkIsolation === "SYNTHETIC_TEST_PROCESS" && config.trigger === "synthetic-test";
  const candidateManifest = readJson(config.candidateManifestPath, "DEVELOPMENT_CANDIDATE_MANIFEST_JSON");
  const candidateSignature = readJson(config.candidateSignaturePath, "DEVELOPMENT_CANDIDATE_SIGNATURE_JSON");
  const candidateTrustStore = readJsonWithSha256(config.candidateTrustStorePath, config.expectedCandidateTrustStoreSha256, "DEVELOPMENT_CANDIDATE_TRUST_JSON");
  const execution = loadDevelopmentExecution(candidateManifest, candidateSignature, candidateTrustStore, { repositoryRoot });
  attempt.candidateManifestPayloadSha256 = execution.manifestPayloadSha256;
  attempt.executionIdentitySha256 = execution.executionIdentitySha256;
  const protocol = execution.protocol;
  const minimumBootstrapReplicates = config.trigger === "weekly" ? protocol.finalBootstrapReplicates : protocol.routineBootstrapReplicates;
  if (!syntheticTest && config.bootstrap !== undefined) requireCondition(config.bootstrap.replicates >= minimumBootstrapReplicates, "DEVELOPMENT_BOOTSTRAP_REPLICATES_TOO_LOW");
  const governance = loadDevelopmentGovernance(config, repositoryRoot, syntheticTest);
  const manifest = governance.manifest;
  attempt.manifestPayloadSha256 = manifest.manifestPayloadSha256;
  if (config.networkIsolation === "SYNTHETIC_TEST_PROCESS") requireCondition(config.trigger === "synthetic-test" && manifest.datasetIdentity.datasetId === "ECG-DATASET-SYNTHETIC-DEVELOPMENT", "DEVELOPMENT_TEST_NETWORK_SCOPE");
  const identity = gitIdentity(repositoryRoot);
  const dirtySyntheticAllowed = config.allowDirtySyntheticTest === true && syntheticTest && manifest.datasetIdentity.datasetId === "ECG-DATASET-SYNTHETIC-DEVELOPMENT";
  requireCondition(identity.commit === config.engineCommitDigest && identity.commit === config.workflowSha, "DEVELOPMENT_WORKFLOW_SHA_MISMATCH");
  requireCondition(identity.tree === config.engineTreeDigest, "DEVELOPMENT_ENGINE_TREE_MISMATCH");
  requireCondition(identity.worktreeClean === config.worktreeClean && identity.worktreeStatusSha256 === config.worktreeStatusSha256, "DEVELOPMENT_WORKTREE_IDENTITY_MISMATCH");
  requireCondition(identity.worktreeClean || dirtySyntheticAllowed, "DEVELOPMENT_WORKTREE_NOT_CLEAN");
  attempt.accounting = createRunAccounting(manifest);
  transitionAttempt(attempt, "RUNNING");
  for (const manifestRecord of manifest.records.filter(record => record.taskEligibility === "ELIGIBLE")) {
    const loaded = loadEvaluationRecord(config.corpusRoot, manifestRecord, manifest.leadPolicy);
    requireCondition(loaded.referenceSampleIndices.length === manifestRecord.referenceEventCount, "DEVELOPMENT_REFERENCE_COUNT_DRIFT");
    requireCondition(Math.abs(loaded.samples.length / manifestRecord.sampleRateHz - manifestRecord.durationSeconds) <= 1 / manifestRecord.sampleRateHz, "DEVELOPMENT_DURATION_DRIFT");
    const provenance = { sourceKind: "authorized_development_manifest", locator: `${manifest.benchmarkId}:${manifestRecord.recordHmacSha256}` };
    const candidateDetector = (samples, sampleRateHz, source) => execution.detectCandidateRPeaks(samples, sampleRateHz, { ...protocol.currentEngine.configuration, provenance: source });
    const panTompkinsDetector = (samples, sampleRateHz, source) => execution.detectPanTompkinsRPeaks(samples, sampleRateHz, { provenance: source });
    const runs = [
      ["CURRENT_ENGINE", "PRIMARY", runDetector(candidateDetector, loaded.samples, manifestRecord.sampleRateHz, provenance)],
      ["CURRENT_ENGINE", "REPLAY", runDetector(candidateDetector, loaded.samples, manifestRecord.sampleRateHz, provenance)],
      ["PAN_TOMPKINS", "PRIMARY", runDetector(panTompkinsDetector, loaded.samples, manifestRecord.sampleRateHz, provenance)],
      ["PAN_TOMPKINS", "REPLAY", runDetector(panTompkinsDetector, loaded.samples, manifestRecord.sampleRateHz, provenance)],
    ];
    for (const [detector, pass, result] of runs) {
      recordDetectorOutcome(attempt.accounting, manifestRecord.recordHmacSha256, detector, pass, result);
      attempt.outcomes.push({ recordHmacSha256: manifestRecord.recordHmacSha256, detector, pass, ...result });
    }
  }
  const outcome = (record, detector, pass) => attempt.outcomes.find(row => row.recordHmacSha256 === record && row.detector === detector && row.pass === pass);
  const deterministicOutput = value => ({ status: value.status, failureCode: value.failureCode, predictedSampleIndices: value.predictedSampleIndices, algorithm: value.algorithm });
  for (const manifestRecord of manifest.records.filter(record => record.taskEligibility === "ELIGIBLE")) {
    const candidate = outcome(manifestRecord.recordHmacSha256, "CURRENT_ENGINE", "PRIMARY");
    const candidateReplay = outcome(manifestRecord.recordHmacSha256, "CURRENT_ENGINE", "REPLAY");
    const panTompkins = outcome(manifestRecord.recordHmacSha256, "PAN_TOMPKINS", "PRIMARY");
    const panTompkinsReplay = outcome(manifestRecord.recordHmacSha256, "PAN_TOMPKINS", "REPLAY");
    requireCondition(JSON.stringify(deterministicOutput(candidate)) === JSON.stringify(deterministicOutput(candidateReplay)), "DEVELOPMENT_CURRENT_ENGINE_NONDETERMINISTIC");
    requireCondition(JSON.stringify(deterministicOutput(panTompkins)) === JSON.stringify(deterministicOutput(panTompkinsReplay)), "DEVELOPMENT_PAN_TOMPKINS_NONDETERMINISTIC");
    if (candidate.status === "SUCCESS") requireCondition(candidate.algorithm === protocol.currentEngine.algorithm, "DEVELOPMENT_CURRENT_ENGINE_ALGORITHM_DRIFT");
    if (panTompkins.status === "SUCCESS") requireCondition(panTompkins.algorithm === execution.panTompkinsAlgorithm, "DEVELOPMENT_PAN_TOMPKINS_ALGORITHM_DRIFT");
  }
}

function runDevelopmentCandidateExecution(config) {
  validateRunConfig(config);
  const runConfigurationSha256 = runConfigurationIdentity(config);
  const attempt = { stateTransitions: [{ state: "VALIDATING", atUtc: config.startedAtUtc }], lastPhase: "VALIDATING", accounting: null, outcomes: [], candidateManifestPayloadSha256: null, executionIdentitySha256: null, manifestPayloadSha256: null };
  try {
    executeDevelopmentCandidate(config, attempt);
    const lastPhase = attempt.lastPhase;
    transitionAttempt(attempt, "EXECUTED");
    return createDevelopmentExecutionHandoff({ config, runConfigurationSha256, handoffStatus: "EXECUTED", failureCode: null, lastPhase, stateTransitions: attempt.stateTransitions, candidateManifestPayloadSha256: attempt.candidateManifestPayloadSha256, executionIdentitySha256: attempt.executionIdentitySha256, manifestPayloadSha256: attempt.manifestPayloadSha256, outcomes: attempt.outcomes });
  } catch (error) {
    const failureCode = normalizeFailureCode(error, "DEVELOPMENT_EVALUATION_FAILURE");
    const lastPhase = attempt.lastPhase;
    const handoffStatus = lastPhase === "VALIDATING" ? "BLOCKED" : "FAILED";
    transitionAttempt(attempt, handoffStatus);
    return createDevelopmentExecutionHandoff({ config, runConfigurationSha256, handoffStatus, failureCode, lastPhase, stateTransitions: attempt.stateTransitions, candidateManifestPayloadSha256: attempt.candidateManifestPayloadSha256, executionIdentitySha256: attempt.executionIdentitySha256, manifestPayloadSha256: attempt.manifestPayloadSha256, outcomes: attempt.outcomes });
  }
}

function runDevelopmentEvaluation() {
  throw new Error("DEVELOPMENT_EVALUATION_SPLIT_REQUIRED");
}

module.exports = { assertNoSymlinkPath, deriveContractDigests, gitIdentity, implementationDigest, loadDevelopmentGovernance, loadEvaluationRecord, normalizeFailureCode, readExact, readJson, readJsonWithSha256, requirePathWithin, runConfigurationIdentity, runDevelopmentCandidateExecution, runDevelopmentEvaluation, runDetector, transitionAttempt, utcNow, validateRunConfig };
