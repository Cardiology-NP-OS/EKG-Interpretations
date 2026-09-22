"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { deriveCandidateRuntimeIdentity, verifyDevelopmentExecutionPackage } = require("./development_execution_identity");
const { readDevelopmentExecutionHandoff, validateCandidateProcessFailure, validateDevelopmentExecutionHandoff } = require("./development_execution_handoff");
const { publishEvaluationBundle, verifyEvaluationBundle } = require("./evaluation_artifact_store");
const { publishDevelopmentAttemptStart, publishDevelopmentAttemptTerminal, verifyDevelopmentAttempt } = require("./development_attempt_store");
const { createRunAccounting, normalizeFailureCode, recordDetectorOutcome, summarizeRunAccounting } = require("./development_run_accounting");
const { compareDevelopmentRuns, validatePolicy } = require("./development_run_comparison");
const { PAN_TOMPKINS_ALGORITHM, detectPanTompkinsRPeaks } = require("./pan_tompkins_detector");
const { createDevelopmentExecutionInput, readDevelopmentExecutionInput } = require("./development_execution_input");
const { CANDIDATE_INPUT_MODE, CANDIDATE_LAUNCH_POLICY_SHA256, deriveCandidateIsolationExpectation } = require("./development_candidate_isolation");
const { validateCandidateRuntimeAttestation } = require("./development_candidate_runtime_attestation");
const { evaluateRPeakRecords } = require("./rpeak_development_metrics");
const { payloadSha256 } = require("./evaluation_signatures");
const { deriveContractDigests, implementationDigest, loadDevelopmentGovernance, loadEvaluationRecord, readJson, readJsonWithSha256, requirePathWithin, runConfigurationIdentity, runDetector, transitionAttempt, utcNow, validateRunConfig } = require("./development_evaluation_runner");

const MANDATORY_INTEGRITY_CONTROLS = Object.freeze(["RIGHTS_FAILURE", "SPENT_STATE_FAILURE", "SIGNATURE_FAILURE", "HASH_FAILURE", "PATIENT_LEAKAGE", "WAVEFORM_DUPLICATE_LEAKAGE", "RECORD_OR_DENOMINATOR_DRIFT", "NONDETERMINISTIC_PREDICTIONS", "INVALID_OUTPUT", "UNDECLARED_CONTRACT_CHANGE"]);
const SIGNER_ROOT = path.resolve(__dirname, "..");
const SIGNER_CONTROL_FILES = Object.freeze({
  protocol: "evaluation/protocols/DEVELOPMENT_RPEAK_EVALUATION_V1.json",
  regressionPolicy: "evaluation/protocols/DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json",
});

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function loadSignerControls(repositoryRoot, execution) {
  const controls = {};
  for (const [name, file] of Object.entries(SIGNER_CONTROL_FILES)) {
    const candidateArtifact = execution.verifiedArtifacts.get(file);
    requireCondition(candidateArtifact, "DEVELOPMENT_SIGNER_CONTROL_ARTIFACT_MISMATCH");
    let bytes;
    try {
      bytes = fs.readFileSync(path.join(repositoryRoot, file));
    } catch (_) {
      throw new Error("DEVELOPMENT_SIGNER_CONTROL_ARTIFACT_MISMATCH");
    }
    requireCondition(bytes.length === candidateArtifact.identity.bytes && crypto.createHash("sha256").update(bytes).digest("hex") === candidateArtifact.identity.sha256, "DEVELOPMENT_SIGNER_CONTROL_ARTIFACT_MISMATCH");
    const source = bytes.toString("utf8");
    requireCondition(Buffer.from(source, "utf8").equals(bytes), "DEVELOPMENT_SIGNER_CONTROL_ARTIFACT_ENCODING");
    try {
      controls[name] = JSON.parse(source);
    } catch (_) {
      throw new Error("DEVELOPMENT_SIGNER_CONTROL_ARTIFACT_JSON");
    }
  }
  return Object.freeze(controls);
}

function deriveDevelopmentGateStatus(input) {
  if (!input.candidateExecutionHealthy || input.comparisonFailure) return "FAILED";
  if (!input.candidateReferenceIsolation || !input.policyReady || input.comparisonBlocked) return "QUARANTINED";
  return "PASSED";
}

function isDevelopmentPolicyReady(regressionPolicy, candidateSigner) {
  const gates = validatePolicy(regressionPolicy);
  return candidateSigner && candidateSigner.productionAuthority === true
    && Array.isArray(regressionPolicy.mandatoryIntegrityBlocks)
    && JSON.stringify(regressionPolicy.mandatoryIntegrityBlocks) === JSON.stringify(MANDATORY_INTEGRITY_CONTROLS)
    && regressionPolicy.approvalStatus === "APPROVED"
    && gates.length > 0
    && gates.every(gate => gate && gate.blocking === true && (Number.isFinite(gate.absoluteFloor) || Number.isFinite(gate.noninferiorityMargin)));
}

function stripDistributionValues(value) {
  if (Array.isArray(value)) return value.map(stripDistributionValues);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) if (key !== "values" && key !== "sampledPatientIndices") output[key] = stripDistributionValues(nested);
  return output;
}

function publicEvaluationResult(result) {
  return stripDistributionValues({
    schema: result.schema,
    metricVersion: result.metricVersion,
    matcherVersion: result.matcherVersion,
    benchmarkId: result.benchmarkId,
    benchmarkVersion: result.benchmarkVersion,
    candidateId: result.candidateId,
    manifestPayloadSha256: result.manifestPayloadSha256,
    contractDigests: result.contractDigests,
    primaryToleranceMs: result.primaryToleranceMs,
    toleranceMs: result.toleranceMs,
    denominators: result.denominators,
    summary: result.summary,
    confidenceIntervals: result.confidenceIntervals,
    subgroups: result.subgroups,
    worstRecordSensitivity: result.worstRecords[0] ? result.worstRecords[0].sensitivity : null,
    capabilityStatement: result.capabilityStatement,
    clinicalAccuracyClaimed: false,
    capabilityNotClaim: true,
  });
}

function publicComparison(comparison) {
  const copy = { ...comparison };
  delete copy.recordDiffs;
  delete copy.regressions;
  return stripDistributionValues(copy);
}

function governedArtifact(value) {
  return { ...value, clinicalAccuracyClaimed: false, capabilityNotClaim: true };
}

function resultInput(config, manifest, candidateId, records, contractDigests, protocol) {
  return {
    benchmarkId: manifest.benchmarkId,
    benchmarkVersion: manifest.benchmarkVersion,
    candidateId,
    manifestPayloadSha256: manifest.manifestPayloadSha256,
    contractDigests,
    primaryToleranceMs: protocol.primaryToleranceMs,
    toleranceMs: protocol.sensitivityToleranceMs,
    bootstrap: config.bootstrap || { replicates: protocol.routineBootstrapReplicates, seed: protocol.bootstrapSeed },
    records,
  };
}

function signerPublicKey(signingPrivateKeyPem) {
  requireCondition(typeof signingPrivateKeyPem === "string" && signingPrivateKeyPem.includes("PRIVATE KEY"), "DEVELOPMENT_SIGNER_PRIVATE_KEY");
  return crypto.createPublicKey(crypto.createPrivateKey(signingPrivateKeyPem)).export({ type: "spki", format: "pem" });
}

function attemptPath(config) {
  return path.join(path.resolve(config.artifactRoot), "attempts", ...config.startedAtUtc.slice(0, 10).split("-"), config.attemptId);
}

function validateStart(config, signingPrivateKeyPem) {
  const publicKeyPem = signerPublicKey(signingPrivateKeyPem);
  const verification = verifyDevelopmentAttempt(attemptPath(config), publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
  requireCondition(verification.executionStatus === "INCOMPLETE", "DEVELOPMENT_ATTEMPT_ALREADY_TERMINAL");
  for (const field of ["attemptId", "startedAtUtc", "trigger", "workflowRunId", "workflowRunAttempt", "workflowSha"]) requireCondition(verification.start[field] === config[field], `DEVELOPMENT_ATTEMPT_START_MISMATCH:${field}`);
  requireCondition(verification.start.runBinding.runConfigurationSha256 === runConfigurationIdentity(config), "DEVELOPMENT_ATTEMPT_START_MISMATCH:runConfigurationSha256");
  return { publicKeyPem, handle: { attemptId: config.attemptId, path: attemptPath(config), startPayloadSha256: verification.startPayloadSha256 }, runBinding: verification.start.runBinding };
}

function prepareSignerInputs(config, options = {}) {
  requireCondition(process.env.EKG_EVALUATION_NETWORK_DISABLED === "1", "DEVELOPMENT_NETWORK_ISOLATION_ENV_REQUIRED");
  requireCondition(["CONTAINER_NETWORK_NONE", "SYNTHETIC_TEST_PROCESS"].includes(config.networkIsolation), "DEVELOPMENT_NETWORK_ISOLATION_REQUIRED");
  requireCondition(config.inputMountMode === "READ_ONLY", "DEVELOPMENT_INPUT_READ_ONLY_REQUIRED");
  requireCondition(config.storageMode === "APPLICATION_WRITE_ONCE_SIGNED", "DEVELOPMENT_STORAGE_MODE");
  const repositoryRoot = path.resolve(config.repositoryRoot || SIGNER_ROOT);
  const candidateRoot = path.resolve(config.candidateRoot || repositoryRoot);
  const syntheticTest = config.networkIsolation === "SYNTHETIC_TEST_PROCESS" && config.trigger === "synthetic-test";
  if (!syntheticTest) {
    requireCondition(typeof config.signerImageDigest === "string", "DEVELOPMENT_SIGNER_IMAGE_DIGEST_REQUIRED");
    requireCondition(typeof config.candidateRoot === "string", "DEVELOPMENT_SIGNER_CANDIDATE_ROOT_REQUIRED");
  }
  const candidateManifest = readJson(config.candidateManifestPath, "DEVELOPMENT_CANDIDATE_MANIFEST_JSON");
  const candidateSignature = readJson(config.candidateSignaturePath, "DEVELOPMENT_CANDIDATE_SIGNATURE_JSON");
  const candidateTrustStore = readJsonWithSha256(config.candidateTrustStorePath, config.expectedCandidateTrustStoreSha256, "DEVELOPMENT_CANDIDATE_TRUST_JSON");
  const execution = verifyDevelopmentExecutionPackage(candidateManifest, candidateSignature, candidateTrustStore, { repositoryRoot: candidateRoot, requireProductionAuthority: !syntheticTest });
  const signerControls = loadSignerControls(SIGNER_ROOT, execution);
  const candidateRuntime = deriveCandidateRuntimeIdentity(execution);
  const candidateIsolation = deriveCandidateIsolationExpectation(config);
  const governance = loadDevelopmentGovernance(config, repositoryRoot, syntheticTest);
  const manifest = governance.manifest;
  const dirtySyntheticAllowed = config.allowDirtySyntheticTest === true && syntheticTest && manifest.datasetIdentity.datasetId === "ECG-DATASET-SYNTHETIC-DEVELOPMENT";
  const identity = { commit: config.engineCommitDigest, tree: config.engineTreeDigest, worktreeClean: config.worktreeClean, worktreeStatusSha256: config.worktreeStatusSha256 };
  requireCondition(identity.commit === config.workflowSha, "DEVELOPMENT_WORKFLOW_SHA_MISMATCH");
  requireCondition(identity.worktreeClean || dirtySyntheticAllowed, "DEVELOPMENT_WORKTREE_NOT_CLEAN");
  const eligibleManifestRecords = manifest.records.filter(record => record.taskEligibility === "ELIGIBLE");
  const loadedRecords = new Map();
  for (const manifestRecord of eligibleManifestRecords) {
    const loaded = loadEvaluationRecord(config.corpusRoot, manifestRecord, manifest.leadPolicy);
    requireCondition(loaded.referenceSampleIndices.length === manifestRecord.referenceEventCount, "DEVELOPMENT_REFERENCE_COUNT_DRIFT");
    requireCondition(Math.abs(loaded.samples.length / manifestRecord.sampleRateHz - manifestRecord.durationSeconds) <= 1 / manifestRecord.sampleRateHz, "DEVELOPMENT_DURATION_DRIFT");
    loadedRecords.set(manifestRecord.recordHmacSha256, loaded);
  }
  const runConfigurationSha256 = runConfigurationIdentity(config);
  const sourceRecords = eligibleManifestRecords.map(record => ({ sampleRateHz: record.sampleRateHz, samples: loadedRecords.get(record.recordHmacSha256).samples }));
  const executionInput = options.createExecutionInput === true
    ? createDevelopmentExecutionInput(config.executionInputRoot, { config, runConfigurationSha256, candidateManifestPayloadSha256: execution.manifestPayloadSha256, executionIdentitySha256: execution.executionIdentitySha256, candidateRuntimeIdentitySha256: candidateRuntime.candidateRuntimeIdentitySha256, manifestPayloadSha256: manifest.manifestPayloadSha256, candidateIsolationExpectation: candidateIsolation.expectation, candidateIsolationExpectationSha256: candidateIsolation.candidateIsolationExpectationSha256, records: sourceRecords })
    : readDevelopmentExecutionInput(config.executionInputRoot);
  const expectedInput = { attemptId: config.attemptId, workflowRunId: config.workflowRunId, workflowRunAttempt: config.workflowRunAttempt, workflowSha: config.workflowSha, startedAtUtc: config.startedAtUtc, runConfigurationSha256, candidateManifestPayloadSha256: execution.manifestPayloadSha256, executionIdentitySha256: execution.executionIdentitySha256, candidateRuntimeIdentitySha256: candidateRuntime.candidateRuntimeIdentitySha256, manifestPayloadSha256: manifest.manifestPayloadSha256, engineCommitDigest: config.engineCommitDigest, engineTreeDigest: config.engineTreeDigest, candidateInputMode: CANDIDATE_INPUT_MODE, candidateIsolationMode: candidateIsolation.expectation.isolationMode, candidateIsolationState: candidateIsolation.expectation.attestationState, candidateRuntimeImageDigest: candidateIsolation.expectation.candidateRuntimeImageDigest, candidateLaunchPolicySha256: candidateIsolation.expectation.candidateLaunchPolicySha256, candidateExpectedUid: candidateIsolation.expectation.expectedUid, candidateExpectedGid: candidateIsolation.expectation.expectedGid, candidateIsolationExpectationSha256: candidateIsolation.candidateIsolationExpectationSha256 };
  for (const [field, value] of Object.entries(expectedInput)) requireCondition(executionInput.index[field] === value, `DEVELOPMENT_EXECUTION_INPUT_IDENTITY:${field}`);
  requireCondition(executionInput.records.length === sourceRecords.length, "DEVELOPMENT_EXECUTION_INPUT_RECORD_COUNT");
  for (let index = 0; index < sourceRecords.length; index += 1) {
    requireCondition(executionInput.records[index].sampleRateHz === sourceRecords[index].sampleRateHz, "DEVELOPMENT_EXECUTION_INPUT_GOVERNED_RATE_DRIFT");
    requireCondition(JSON.stringify(executionInput.records[index].samples) === JSON.stringify(sourceRecords[index].samples), "DEVELOPMENT_EXECUTION_INPUT_GOVERNED_SIGNAL_DRIFT");
  }
  const runBinding = {
    schema: "ekg-development-run-binding-v2",
    runConfigurationSha256,
    candidateManifestPayloadSha256: execution.manifestPayloadSha256,
    executionIdentitySha256: execution.executionIdentitySha256,
    candidateRuntimeIdentitySha256: candidateRuntime.candidateRuntimeIdentitySha256,
    manifestPayloadSha256: manifest.manifestPayloadSha256,
    candidateTrustStoreSha256: config.expectedCandidateTrustStoreSha256,
    manifestTrustStoreSha256: governance.manifestTrustStoreSha256,
    environmentImageDigest: config.environmentImageDigest || null,
    signerImageDigest: config.signerImageDigest || null,
    executionInputSha256: executionInput.executionInputSha256,
    candidateInputMode: CANDIDATE_INPUT_MODE,
    candidateRuntimeImageDigest: candidateIsolation.expectation.candidateRuntimeImageDigest,
    candidateLaunchPolicySha256: CANDIDATE_LAUNCH_POLICY_SHA256,
    candidateIsolationMode: candidateIsolation.expectation.isolationMode,
    candidateIsolationState: candidateIsolation.expectation.attestationState,
    candidateExpectedUid: candidateIsolation.expectation.expectedUid,
    candidateExpectedGid: candidateIsolation.expectation.expectedGid,
    candidateIsolationExpectationSha256: candidateIsolation.candidateIsolationExpectationSha256,
  };
  return { repositoryRoot, candidateRoot, syntheticTest, candidateManifest, candidateSignature, candidateTrustStore, execution, signerControls, candidateRuntime, candidateIsolation, governance, identity, loadedRecords, executionInput, runBinding };
}

function startDevelopmentEvaluationAttempt(config, signingPrivateKeyPem) {
  validateRunConfig(config);
  signerPublicKey(signingPrivateKeyPem);
  const prepared = prepareSignerInputs(config, { createExecutionInput: true });
  return publishDevelopmentAttemptStart(config.artifactRoot, {
    attemptId: config.attemptId,
    startedAtUtc: config.startedAtUtc,
    trigger: config.trigger,
    workflowRunId: config.workflowRunId,
    workflowRunAttempt: config.workflowRunAttempt,
    workflowSha: config.workflowSha,
    runBinding: prepared.runBinding,
    signingPrivateKeyPem,
    signerKeyId: config.signerKeyId,
  });
}

function loadSignerContext(config, handoff) {
  requireCondition(process.env.EKG_EVALUATION_NETWORK_DISABLED === "1", "DEVELOPMENT_NETWORK_ISOLATION_ENV_REQUIRED");
  requireCondition(["CONTAINER_NETWORK_NONE", "SYNTHETIC_TEST_PROCESS"].includes(config.networkIsolation), "DEVELOPMENT_NETWORK_ISOLATION_REQUIRED");
  requireCondition(config.inputMountMode === "READ_ONLY", "DEVELOPMENT_INPUT_READ_ONLY_REQUIRED");
  requireCondition(config.storageMode === "APPLICATION_WRITE_ONCE_SIGNED", "DEVELOPMENT_STORAGE_MODE");
  if (config.networkIsolation === "CONTAINER_NETWORK_NONE") {
    requireCondition(typeof config.environmentImageDigest === "string", "DEVELOPMENT_ENVIRONMENT_IMAGE_DIGEST_REQUIRED");
    requireCondition(typeof config.signerImageDigest === "string", "DEVELOPMENT_SIGNER_IMAGE_DIGEST_REQUIRED");
    requireCondition(typeof config.candidateRoot === "string", "DEVELOPMENT_SIGNER_CANDIDATE_ROOT_REQUIRED");
  }
  const prepared = prepareSignerInputs(config);
  const { repositoryRoot, syntheticTest, candidateManifest, candidateSignature, candidateTrustStore, execution, signerControls, candidateRuntime, governance, identity, loadedRecords, executionInput } = prepared;
  const protocol = signerControls.protocol;
  const regressionPolicy = signerControls.regressionPolicy;
  const minimumBootstrapReplicates = config.trigger === "weekly" ? protocol.finalBootstrapReplicates : protocol.routineBootstrapReplicates;
  if (!syntheticTest && config.bootstrap !== undefined) requireCondition(config.bootstrap.replicates >= minimumBootstrapReplicates, "DEVELOPMENT_BOOTSTRAP_REPLICATES_TOO_LOW");
  const manifest = governance.manifest;
  if (config.networkIsolation === "SYNTHETIC_TEST_PROCESS") requireCondition(config.trigger === "synthetic-test" && manifest.datasetIdentity.datasetId === "ECG-DATASET-SYNTHETIC-DEVELOPMENT", "DEVELOPMENT_TEST_NETWORK_SCOPE");
  const expectedHandoff = {
    attemptId: config.attemptId,
    workflowRunId: config.workflowRunId,
    workflowRunAttempt: config.workflowRunAttempt,
    workflowSha: config.workflowSha,
    startedAtUtc: config.startedAtUtc,
    runConfigurationSha256: prepared.runBinding.runConfigurationSha256,
    executionInputSha256: prepared.runBinding.executionInputSha256,
    candidateRuntimeIdentitySha256: prepared.runBinding.candidateRuntimeIdentitySha256,
    candidateIsolationExpectationSha256: prepared.runBinding.candidateIsolationExpectationSha256,
    candidateIsolationExpectation: prepared.candidateIsolation.expectation,
    maximumTransitionUtc: syntheticTest ? undefined : utcNow(),
    candidateManifestPayloadSha256: execution.manifestPayloadSha256,
    executionIdentitySha256: execution.executionIdentitySha256,
    manifestPayloadSha256: prepared.runBinding.manifestPayloadSha256,
  };
  validateDevelopmentExecutionHandoff(handoff, executionInput.index, expectedHandoff);
  const runtimeAttestation = validateCandidateRuntimeAttestation(handoff.candidateRuntimeAttestation, prepared.candidateIsolation.expectation, handoff.candidateRuntimeAttestationSha256);
  return { repositoryRoot, candidateManifest, candidateSignature, candidateTrustStore, execution, candidateRuntime, protocol, regressionPolicy, governance, manifest, identity, loadedRecords, executionInput, runtimeAttestation, runBinding: prepared.runBinding };
}

function reconstructExecution(manifest, loadedRecords, executionInput, handoff, protocol, panTompkinsAlgorithm) {
  const accounting = createRunAccounting(manifest);
  const eligibleManifestRecords = manifest.records.filter(record => record.taskEligibility === "ELIGIBLE");
  const manifestByExecutionId = new Map(executionInput.index.records.map((record, index) => [record.executionRecordId, eligibleManifestRecords[index]]));
  for (const row of handoff.outcomes) recordDetectorOutcome(accounting, manifestByExecutionId.get(row.executionRecordId).recordHmacSha256, row.detector, row.pass, row);
  if (handoff.handoffStatus !== "EXECUTED") return { accounting, candidateRows: [], panTompkinsRows: [], engineeringRows: [] };
  const byIdentity = new Map(handoff.outcomes.map(row => [`${row.executionRecordId}:${row.detector}:${row.pass}`, row]));
  const candidateRows = [];
  const panTompkinsRows = [];
  const engineeringRows = [];
  const deterministicOutput = value => ({ status: value.status, failureCode: value.failureCode, predictedSampleIndices: value.predictedSampleIndices, algorithm: value.algorithm });
  for (let index = 0; index < eligibleManifestRecords.length; index += 1) {
    const manifestRecord = eligibleManifestRecords[index];
    const executionRecord = executionInput.index.records[index];
    const key = (detector, pass) => byIdentity.get(`${executionRecord.executionRecordId}:${detector}:${pass}`);
    const candidate = key("CURRENT_ENGINE", "PRIMARY");
    const candidateReplay = key("CURRENT_ENGINE", "REPLAY");
    const submittedPanTompkins = key("PAN_TOMPKINS", "PRIMARY");
    const submittedPanTompkinsReplay = key("PAN_TOMPKINS", "REPLAY");
    requireCondition(JSON.stringify(deterministicOutput(candidate)) === JSON.stringify(deterministicOutput(candidateReplay)), "DEVELOPMENT_CURRENT_ENGINE_NONDETERMINISTIC");
    if (candidate.status === "SUCCESS") requireCondition(candidate.algorithm === protocol.currentEngine.algorithm, "DEVELOPMENT_CURRENT_ENGINE_ALGORITHM_DRIFT");
    const loaded = loadedRecords.get(manifestRecord.recordHmacSha256);
    const provenance = { sourceKind: "signer_governed_signal", locator: manifestRecord.recordHmacSha256 };
    const baselineDetector = (samples, sampleRateHz, source) => detectPanTompkinsRPeaks(samples, sampleRateHz, { provenance: source });
    const panTompkins = runDetector(baselineDetector, loaded.samples, manifestRecord.sampleRateHz, provenance);
    const panTompkinsReplay = runDetector(baselineDetector, loaded.samples, manifestRecord.sampleRateHz, provenance);
    requireCondition(JSON.stringify(deterministicOutput(panTompkins)) === JSON.stringify(deterministicOutput(panTompkinsReplay)), "DEVELOPMENT_SIGNER_PAN_TOMPKINS_NONDETERMINISTIC");
    requireCondition(JSON.stringify(deterministicOutput(submittedPanTompkins)) === JSON.stringify(deterministicOutput(panTompkins)), "DEVELOPMENT_PAN_TOMPKINS_SUBMISSION_MISMATCH");
    requireCondition(JSON.stringify(deterministicOutput(submittedPanTompkinsReplay)) === JSON.stringify(deterministicOutput(panTompkinsReplay)), "DEVELOPMENT_PAN_TOMPKINS_SUBMISSION_MISMATCH");
    if (panTompkins.status === "SUCCESS") requireCondition(panTompkins.algorithm === panTompkinsAlgorithm, "DEVELOPMENT_PAN_TOMPKINS_ALGORITHM_DRIFT");
    const shared = { recordHmacSha256: manifestRecord.recordHmacSha256, patientHmacSha256: manifestRecord.patientHmacSha256, referenceSampleIndices: loaded.referenceSampleIndices, sampleRateHz: manifestRecord.sampleRateHz, durationSeconds: manifestRecord.durationSeconds, lead: loaded.lead, subgroups: manifestRecord.subgroups };
    candidateRows.push({ ...shared, predictedSampleIndices: candidate.predictedSampleIndices, status: candidate.status, failureCode: candidate.failureCode });
    panTompkinsRows.push({ ...shared, predictedSampleIndices: panTompkins.predictedSampleIndices, status: panTompkins.status, failureCode: panTompkins.failureCode });
    engineeringRows.push({ recordHmacSha256: manifestRecord.recordHmacSha256, candidate: { status: candidate.status, failureCode: candidate.failureCode, latencyMs: candidate.latencyMs, peakMemoryBytes: candidate.peakMemoryBytes }, candidateReplay: { status: candidateReplay.status, failureCode: candidateReplay.failureCode, latencyMs: candidateReplay.latencyMs, peakMemoryBytes: candidateReplay.peakMemoryBytes }, panTompkins: { status: panTompkins.status, failureCode: panTompkins.failureCode, latencyMs: panTompkins.latencyMs, peakMemoryBytes: panTompkins.peakMemoryBytes }, panTompkinsReplay: { status: panTompkinsReplay.status, failureCode: panTompkinsReplay.failureCode, latencyMs: panTompkinsReplay.latencyMs, peakMemoryBytes: panTompkinsReplay.peakMemoryBytes } });
  }
  return { accounting, candidateRows, panTompkinsRows, engineeringRows };
}

function buildEvaluationBundle(config, handoff, context, attempt, signingPrivateKeyPem) {
  const executionHandoffSha256 = payloadSha256(handoff);
  const { repositoryRoot, candidateManifest, candidateSignature, candidateTrustStore, execution, candidateRuntime, protocol, regressionPolicy, governance, manifest, identity, loadedRecords } = context;
  const reconstructed = reconstructExecution(manifest, loadedRecords, context.executionInput, handoff, protocol, PAN_TOMPKINS_ALGORITHM);
  attempt.accounting = reconstructed.accounting;
  requireCondition(handoff.handoffStatus === "EXECUTED", handoff.failureCode || "DEVELOPMENT_EXECUTION_NOT_COMPLETED");
  transitionAttempt(attempt, "SCORING");
  const contractDigests = deriveContractDigests(manifest, protocol, execution.executionIdentity);
  const current = evaluateRPeakRecords(resultInput(config, manifest, protocol.currentEngine.algorithm, reconstructed.candidateRows, contractDigests, protocol));
  const panTompkins = evaluateRPeakRecords(resultInput(config, manifest, PAN_TOMPKINS_ALGORITHM, reconstructed.panTompkinsRows, contractDigests, protocol));
  transitionAttempt(attempt, "COMPARING");
  const panTompkinsComparison = compareDevelopmentRuns(current, panTompkins, regressionPolicy);
  let previousComparison = { schema: "ekg-development-run-comparison-v1", status: "NOT_AVAILABLE", reason: "NO_EXPLICIT_APPROVED_BASELINE" };
  let previousBaselineIdentity = null;
  if (config.previousApprovedBundlePath) {
    const previousApprovedBundlePath = requirePathWithin(config.artifactRoot, config.previousApprovedBundlePath, "DEVELOPMENT_PREVIOUS_BASELINE_OUTSIDE_ARTIFACT_ROOT");
    const priorVerification = verifyEvaluationBundle(previousApprovedBundlePath, config.previousBundlePublicKeyPem, { expectedSignerKeyId: config.previousBundleSignerKeyId });
    requireCondition(priorVerification.runManifest.baselineApproval === "APPROVED", "DEVELOPMENT_PREVIOUS_BASELINE_NOT_APPROVED");
    previousBaselineIdentity = { runId: priorVerification.runManifest.runId, merkleRootSha256: priorVerification.merkleRootSha256, signerKeyId: priorVerification.signerKeyId };
    const previous = readJson(path.join(previousApprovedBundlePath, "internal-result.restricted.json"), "DEVELOPMENT_PREVIOUS_RESULT_JSON");
    previousComparison = compareDevelopmentRuns(current, previous.currentEngine, regressionPolicy);
  }
  const executionArtifacts = execution.executionIdentity.artifacts;
  const candidateSigner = candidateTrustStore.keys.find(row => row.keyId === execution.signatureVerification.keyId);
  const candidateSignerPublicKeySha256 = crypto.createHash("sha256").update(Buffer.from(candidateSigner.publicKeyPem, "utf8")).digest("hex");
  const artifactIdentity = files => payloadSha256(executionArtifacts.filter(row => files.includes(row.file)));
  const artifactSha256 = file => executionArtifacts.find(row => row.file === file).sha256;
  const trustedMetricFiles = [path.join(repositoryRoot, "lib", "rpeak_development_metrics.js"), path.join(repositoryRoot, "lib", "event_matcher_v2.js")];
  const candidateDigest = artifactIdentity(["lib/signal_measurement_contract.js", "lib/wfdb_signal.js"]);
  const panTompkinsDigest = artifactIdentity(["lib/pan_tompkins_detector.js", "lib/signal_dsp_filtering.js", "lib/signal_measurement_contract.js", "lib/wfdb_signal.js"]);
  const metricCodeDigest = implementationDigest(trustedMetricFiles);
  const matcherDigest = crypto.createHash("sha256").update(fs.readFileSync(trustedMetricFiles[1])).digest("hex");
  const harnessCodeDigest = implementationDigest([
    path.join(repositoryRoot, "lib", "development_evaluation_runner.js"),
    path.join(repositoryRoot, "lib", "development_evaluation_signer.js"),
    path.join(repositoryRoot, "lib", "development_execution_handoff.js"),
    path.join(repositoryRoot, "lib", "development_execution_input.js"),
    path.join(repositoryRoot, "lib", "development_candidate_isolation.js"),
    path.join(repositoryRoot, "lib", "development_candidate_runtime_attestation.js"),
    path.join(repositoryRoot, "lib", "development_attempt_store.js"),
    path.join(repositoryRoot, "lib", "development_run_accounting.js"),
    path.join(repositoryRoot, "lib", "development_execution_identity.js"),
    path.join(repositoryRoot, "lib", "development_evaluation_preflight.js"),
    path.join(repositoryRoot, "lib", "development_partition_verifier.js"),
    path.join(repositoryRoot, "lib", "development_run_comparison.js"),
    path.join(repositoryRoot, "lib", "rpeak_development_metrics.js"),
    path.join(repositoryRoot, "lib", "event_matcher_v2.js"),
    path.join(repositoryRoot, "lib", "evaluation_artifact_store.js"),
    path.join(repositoryRoot, "lib", "evaluation_signatures.js"),
    path.join(repositoryRoot, "lib", "local_dataset_loader.js"),
    path.join(repositoryRoot, "lib", "spent_dataset_registry.js"),
  ]);
  const regressionPolicyDigest = artifactSha256("evaluation/protocols/DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json");
  const candidateReferenceIsolation = context.runtimeAttestation.candidateReferenceIsolation;
  const candidateRuntimeAttestationSha256 = context.runtimeAttestation.candidateRuntimeAttestationSha256;
  const environment = { node: process.version, platform: process.platform, architecture: process.arch, imageDigest: config.environmentImageDigest || null, signerImageDigest: config.signerImageDigest || null, networkIsolation: config.networkIsolation, inputMount: config.inputMountMode, artifactStorage: config.storageMode, signingBoundary: "SEPARATE_PINNED_SIGNER_IMAGE_BOUNDED_HANDOFF", candidateReferenceIsolation };
  const environmentDigest = payloadSha256(environment);
  const bootstrap = config.bootstrap || { replicates: protocol.routineBootstrapReplicates, seed: protocol.bootstrapSeed };
  const runConfigurationDigest = payloadSha256({ trigger: config.trigger, bootstrap, networkIsolation: config.networkIsolation, inputMountMode: config.inputMountMode, storageMode: config.storageMode, manifestTrustStoreSha256: governance.manifestTrustStoreSha256, candidateTrustStoreSha256: config.expectedCandidateTrustStoreSha256, candidateManifestPayloadSha256: execution.manifestPayloadSha256, previousBaselineIdentity, workflowRunId: config.workflowRunId, workflowRunAttempt: config.workflowRunAttempt, workflowSha: config.workflowSha });
  const runBindingSha256 = payloadSha256(context.runBinding);
  const sbomDigest = implementationDigest([path.join(repositoryRoot, "package.json")]);
  const runIdentityDigest = payloadSha256({ candidateDigest, panTompkinsDigest, engineCommitDigest: identity.commit, engineTreeDigest: identity.tree, environmentDigest, sbomDigest, configurationDigest: runConfigurationDigest, runBindingSha256, executionHandoffSha256, executionInputSha256: context.runBinding.executionInputSha256, candidateRuntimeIdentitySha256: context.runBinding.candidateRuntimeIdentitySha256, candidateIsolationExpectationSha256: context.runBinding.candidateIsolationExpectationSha256, candidateRuntimeAttestationSha256, candidateReferenceIsolation, preprocessingDigest: contractDigests.preprocessingSha256, manifestDigest: manifest.manifestPayloadSha256, sourceInventoryDigest: manifest.datasetIdentity.sourceManifestSha256, labelSnapshotDigest: contractDigests.labelSnapshotSha256, ontologyMappingDigest: payloadSha256("NOT_APPLICABLE_RPEAK"), metricCodeDigest, harnessCodeDigest, regressionPolicyDigest, bootstrap, matcherDigest, executionIdentitySha256: execution.executionIdentitySha256, candidateManifestPayloadSha256: execution.manifestPayloadSha256, thresholdCalibrationDigest: contractDigests.thresholdCalibrationSha256 });
  const candidateSignerProductionAuthority = candidateSigner.productionAuthority === true;
  const exactMandatoryIntegrityControls = JSON.stringify(regressionPolicy.mandatoryIntegrityBlocks) === JSON.stringify(MANDATORY_INTEGRITY_CONTROLS);
  const policyReady = isDevelopmentPolicyReady(regressionPolicy, candidateSigner);
  const candidateExecutionHealthy = reconstructed.candidateRows.length > 0 && reconstructed.candidateRows.every(row => row.status === "SUCCESS") && handoff.outcomes.filter(row => row.detector === "CURRENT_ENGINE").every(row => row.status === "SUCCESS");
  const comparisonFailure = [panTompkinsComparison, previousComparison].some(comparison => comparison.status === "FAILED");
  const comparisonBlocked = [panTompkinsComparison, previousComparison].some(comparison => ["NOT_AVAILABLE", "NOT_COMPARABLE"].includes(comparison.status));
  const gateStatus = deriveDevelopmentGateStatus({ candidateExecutionHealthy, candidateReferenceIsolation, policyReady, comparisonFailure, comparisonBlocked });
  const accounting = summarizeRunAccounting(reconstructed.accounting);
  const endedAtUtc = transitionAttempt(attempt, "PUBLISHING");
  const runManifest = { schema: "ekg-development-run-manifest-v1", runId: null, trigger: config.trigger, startedAtUtc: config.startedAtUtc, endedAtUtc, state: gateStatus, executionStatus: "PUBLISHING", gateStatus, attemptId: config.attemptId, workflowRunId: config.workflowRunId, workflowRunAttempt: config.workflowRunAttempt, workflowSha: config.workflowSha, stateTransitions: attempt.stateTransitions, runIdentityDigest, engineCommitDigest: identity.commit, engineTreeDigest: identity.tree, environment, environmentDigest, runConfigurationDigest, runBinding: context.runBinding, runBindingSha256, executionInputSha256: context.runBinding.executionInputSha256, candidateRuntimeIdentitySha256: context.runBinding.candidateRuntimeIdentitySha256, candidateIsolationExpectationSha256: context.runBinding.candidateIsolationExpectationSha256, candidateRuntimeAttestation: handoff.candidateRuntimeAttestation, candidateRuntimeAttestationSha256, executionHandoffSha256, sbomDigest, manifestPayloadSha256: manifest.manifestPayloadSha256, manifestTrustStoreSha256: governance.manifestTrustStoreSha256, spentRegistrySha256: governance.spentRegistrySignature.payloadSha256, candidateDigest, panTompkinsDigest, metricCodeDigest, matcherDigest, harnessCodeDigest, regressionPolicyDigest, executionIdentitySha256: execution.executionIdentitySha256, candidateManifestPayloadSha256: execution.manifestPayloadSha256, candidateSignerKeyId: execution.signatureVerification.keyId, candidateTrustStoreSha256: config.expectedCandidateTrustStoreSha256, candidateSignerPublicKeySha256, candidateReferenceIsolation, worktreeClean: identity.worktreeClean, worktreeStatusSha256: identity.worktreeStatusSha256, contractDigests, baselineApproval: "NOT_APPROVED_AUTOMATICALLY", clinicalAccuracyClaimed: false };
  const artifacts = {
    "input-and-rights-digests.json": governedArtifact({ datasetIdentity: manifest.datasetIdentity, rights: manifest.rights, partitionAttestation: manifest.partitionAttestation, manifestPayloadSha256: manifest.manifestPayloadSha256, spentRegistrySha256: governance.spentRegistrySignature.payloadSha256 }),
    "candidate-digests.json": governedArtifact({ currentEngine: current.candidateId, panTompkins: panTompkins.candidateId, candidateDigest, panTompkinsDigest, metricCodeDigest, matcherDigest, regressionPolicyDigest, executionIdentity: execution.executionIdentity, executionIdentitySha256: execution.executionIdentitySha256, candidateRuntimeIdentity: candidateRuntime.candidateRuntimeIdentity, candidateRuntimeIdentitySha256: candidateRuntime.candidateRuntimeIdentitySha256, candidateManifest, candidateSignature, candidateTrustStoreSha256: config.expectedCandidateTrustStoreSha256, candidateSignerKeyId: execution.signatureVerification.keyId, candidateSignerPublicKeySha256, contractDigests }),
    "predictions.restricted.json": governedArtifact({ currentEngine: reconstructed.candidateRows.map(row => ({ recordHmacSha256: row.recordHmacSha256, predictedSampleIndices: row.predictedSampleIndices, status: row.status, failureCode: row.failureCode })), panTompkins: reconstructed.panTompkinsRows.map(row => ({ recordHmacSha256: row.recordHmacSha256, predictedSampleIndices: row.predictedSampleIndices, status: row.status, failureCode: row.failureCode })) }),
    "per-record.restricted.json": governedArtifact({ currentEngine: current.records, panTompkins: panTompkins.records }),
    "per-patient.restricted.json": governedArtifact({ currentEngine: current.patients, panTompkins: panTompkins.patients }),
    "internal-result.restricted.json": governedArtifact({ currentEngine: current, panTompkins, engineeringRows: reconstructed.engineeringRows, accounting, versusPanTompkins: panTompkinsComparison, versusPreviousApprovedRun: previousComparison }),
    "subgroup-metrics.json": governedArtifact({ currentEngine: stripDistributionValues(current.subgroups), panTompkins: stripDistributionValues(panTompkins.subgroups) }),
    "metric-distributions.json": governedArtifact({ currentEngine: stripDistributionValues(current.summary), panTompkins: stripDistributionValues(panTompkins.summary), currentWorstRecordSensitivity: current.worstRecords[0] ? current.worstRecords[0].sensitivity : null, panTompkinsWorstRecordSensitivity: panTompkins.worstRecords[0] ? panTompkins.worstRecords[0].sensitivity : null }),
    "bootstrap-and-paired-deltas.json": governedArtifact({ currentEngine: stripDistributionValues(current.confidenceIntervals), panTompkins: stripDistributionValues(panTompkins.confidenceIntervals), versusPanTompkins: publicComparison(panTompkinsComparison), versusPreviousApprovedRun: publicComparison(previousComparison) }),
    "engineering-report.json": governedArtifact({ schema: "ekg-development-engineering-report-v1", nRecords: reconstructed.engineeringRows.length, currentEngineTechnicalFailureCount: reconstructed.engineeringRows.filter(row => row.candidate.status !== "SUCCESS").length, panTompkinsTechnicalFailureCount: reconstructed.engineeringRows.filter(row => row.panTompkins.status !== "SUCCESS").length, accounting, preflight: governance.preflight }),
    "development-report.json": governedArtifact({ schema: "ekg-development-evaluation-report-v1", currentEngine: publicEvaluationResult(current), panTompkins: publicEvaluationResult(panTompkins), repeatedDevelopmentUse: true, untouchedValidation: false, capabilityStatement: current.capabilityStatement }),
    "gates.json": governedArtifact({ schema: "ekg-development-gates-v1", status: gateStatus, versusPanTompkins: panTompkinsComparison.status, versusPreviousApprovedRun: previousComparison.status, regressionPolicyApproval: regressionPolicy.approvalStatus, candidateSignerProductionAuthority, exactMandatoryIntegrityControls, policyReady, candidateExecutionHealthy, candidateRuntimeAttestationSha256, candidateReferenceIsolation, referenceIsolationRequiredForPass: true, externalControlPlaneAttestationRequiredForPass: true }),
    "logs.json": governedArtifact({ schema: "ekg-development-run-log-v1", attemptId: config.attemptId, executionStatus: "PUBLISHING", gateStatus, stateTransitions: attempt.stateTransitions, accounting }),
  };
  try {
    return publishEvaluationBundle(config.artifactRoot, { storageMode: config.storageMode, startedAtUtc: config.startedAtUtc, runManifest, artifacts, signingPrivateKeyPem, signerKeyId: config.signerKeyId });
  } catch (error) {
    if (!error || error.message !== "EVALUATION_BUNDLE_IMMUTABLE_COLLISION") throw error;
    const runId = `${config.startedAtUtc.replace(/[-:]/g, "")}_${runIdentityDigest.slice(0, 16)}`;
    const existingPath = path.join(path.resolve(config.artifactRoot), ...config.startedAtUtc.slice(0, 10).split("-"), runId);
    const publicKeyPem = signerPublicKey(signingPrivateKeyPem);
    const existing = verifyEvaluationBundle(existingPath, publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
    requireCondition(existing.runManifest.runIdentityDigest === runIdentityDigest && existing.runManifest.executionHandoffSha256 === executionHandoffSha256, "DEVELOPMENT_SIGNER_EXISTING_BUNDLE_IDENTITY");
    requireCondition(existing.runManifest.attemptId === config.attemptId && existing.runManifest.workflowRunId === config.workflowRunId && existing.runManifest.workflowRunAttempt === config.workflowRunAttempt && existing.runManifest.workflowSha === config.workflowSha, "DEVELOPMENT_SIGNER_EXISTING_BUNDLE_ATTEMPT");
    requireCondition(existing.runManifest.gateStatus === gateStatus, "DEVELOPMENT_SIGNER_EXISTING_BUNDLE_GATE");
    return { schema: "ekg-evaluation-bundle-receipt-v1", runId, path: existingPath, runDigest: existing.runDigest, merkleRootSha256: existing.merkleRootSha256, gateStatus, recoveredExistingBundle: true, runManifest: existing.runManifest, writeOnce: false, applicationCollisionProtected: true, externalObjectLockAttested: false, storageMode: config.storageMode, clinicalAccuracyClaimed: false, capabilityNotClaim: true, reportable: false, runtimeAuthority: false, projectGold: false, sourceLabelsAreProjectGold: false };
  }
}

function failureAttempt(config, handle, signingPrivateKeyPem, error, handoff, accounting) {
  const failureCode = normalizeFailureCode(error, "DEVELOPMENT_EXECUTION_HANDOFF_INVALID");
  let stateTransitions = [{ state: "VALIDATING", atUtc: config.startedAtUtc }];
  let lastPhase = "VALIDATING";
  let executionStatus = "BLOCKED";
  if (handoff && Array.isArray(handoff.stateTransitions) && ["EXECUTED", "FAILED", "BLOCKED"].includes(handoff.handoffStatus)) {
    stateTransitions = handoff.stateTransitions.map(row => ({ ...row }));
    if (["FAILED", "BLOCKED"].includes(handoff.handoffStatus)) stateTransitions.pop();
    lastPhase = stateTransitions[stateTransitions.length - 1].state;
    executionStatus = handoff.handoffStatus === "BLOCKED" ? "BLOCKED" : "FAILED";
  }
  const attempt = { stateTransitions, lastPhase };
  const endedAtUtc = transitionAttempt(attempt, executionStatus, utcNow());
  publishDevelopmentAttemptTerminal(handle, { endedAtUtc, executionStatus, gateStatus: "NOT_RUN", failureCode, lastPhase, stateTransitions: attempt.stateTransitions, accounting: accounting ? summarizeRunAccounting(accounting) : null, bundle: null, signingPrivateKeyPem, signerKeyId: config.signerKeyId });
  throw new Error(failureCode);
}

function finalizeDevelopmentEvaluationAttempt(config, handoffSource, signingPrivateKeyPem) {
  validateRunConfig(config);
  const { publicKeyPem, handle, runBinding } = validateStart(config, signingPrivateKeyPem);
  let validatedHandoff = null;
  let accounting = null;
  try {
    const handoff = typeof handoffSource === "string" ? readDevelopmentExecutionHandoff(handoffSource) : handoffSource;
    requireCondition(handoff && typeof handoff === "object", "DEVELOPMENT_EXECUTION_HANDOFF_MISSING");
    if (handoff.schema === "ekg-development-candidate-process-failure-v1") throw new Error(validateCandidateProcessFailure(handoff).failureCode);
    const context = loadSignerContext(config, handoff);
    requireCondition(JSON.stringify(context.runBinding) === JSON.stringify(runBinding), "DEVELOPMENT_ATTEMPT_RUN_BINDING_MISMATCH");
    validatedHandoff = handoff;
    const attempt = { stateTransitions: handoff.stateTransitions.map(row => ({ ...row })), lastPhase: handoff.handoffStatus, accounting: null };
    const reconstructed = reconstructExecution(context.manifest, context.loadedRecords, context.executionInput, handoff, context.protocol, PAN_TOMPKINS_ALGORITHM);
    accounting = reconstructed.accounting;
    requireCondition(handoff.handoffStatus === "EXECUTED", handoff.failureCode || "DEVELOPMENT_EXECUTION_NOT_COMPLETED");
    const bundle = buildEvaluationBundle(config, handoff, context, attempt, signingPrivateKeyPem);
    const verification = verifyEvaluationBundle(bundle.path, publicKeyPem, { expectedSignerKeyId: config.signerKeyId });
    requireCondition(verification.runDigest === bundle.runDigest && verification.merkleRootSha256 === bundle.merkleRootSha256, "DEVELOPMENT_SIGNER_BUNDLE_VERIFICATION");
    requireCondition(verification.runManifest.executionHandoffSha256 === payloadSha256(handoff), "DEVELOPMENT_SIGNER_BUNDLE_HANDOFF");
    if (bundle.recoveredExistingBundle) {
      attempt.stateTransitions = verification.runManifest.stateTransitions.map(row => ({ ...row }));
      attempt.lastPhase = attempt.stateTransitions[attempt.stateTransitions.length - 1].state;
    }
    const lastPhase = attempt.lastPhase;
    const completedAtUtc = transitionAttempt(attempt, "COMPLETED");
    publishDevelopmentAttemptTerminal(handle, { endedAtUtc: completedAtUtc, executionStatus: "COMPLETED", gateStatus: bundle.gateStatus, failureCode: null, lastPhase, stateTransitions: attempt.stateTransitions, accounting: summarizeRunAccounting(attempt.accounting), bundle: { runId: bundle.runId, runDigest: bundle.runDigest, merkleRootSha256: bundle.merkleRootSha256, executionInputSha256: runBinding.executionInputSha256, executionHandoffSha256: payloadSha256(handoff), candidateRuntimeAttestationSha256: handoff.candidateRuntimeAttestationSha256, candidateReferenceIsolation: context.runtimeAttestation.candidateReferenceIsolation }, signingPrivateKeyPem, signerKeyId: config.signerKeyId });
    return { ...bundle, attemptId: config.attemptId, executionStatus: "COMPLETED" };
  } catch (error) {
    return failureAttempt(config, handle, signingPrivateKeyPem, error, validatedHandoff, accounting);
  }
}

module.exports = { MANDATORY_INTEGRITY_CONTROLS, deriveDevelopmentGateStatus, finalizeDevelopmentEvaluationAttempt, isDevelopmentPolicyReady, prepareSignerInputs, reconstructExecution, startDevelopmentEvaluationAttempt };
