"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { preflightDevelopmentRun } = require("./development_evaluation_preflight");
const { detectCandidateRPeaks } = require("./signal_measurement_contract");
const { detectPanTompkinsRPeaks, PAN_TOMPKINS_ALGORITHM } = require("./pan_tompkins_detector");
const { evaluateRPeakRecords } = require("./rpeak_development_metrics");
const { compareDevelopmentRuns } = require("./development_run_comparison");
const { publishEvaluationBundle, verifyEvaluationBundle } = require("./evaluation_artifact_store");
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
  const allowed = new Set(["manifestPath", "manifestSignaturePath", "manifestTrustStorePath", "corpusRoot", "artifactRoot", "inputMountMode", "networkIsolation", "storageMode", "startedAtUtc", "trigger", "bootstrap", "previousApprovedBundlePath", "previousBundlePublicKeyPem", "previousBundleSignerKeyId", "signerKeyId", "repositoryRoot", "signingPrivateKeyPem", "allowDirtySyntheticTest", "environmentImageDigest"]);
  requireCondition(Object.keys(config).every(key => allowed.has(key)), "DEVELOPMENT_RUN_CONFIG_UNKNOWN_FIELD");
  for (const field of ["manifestPath", "manifestSignaturePath", "corpusRoot", "artifactRoot", "trigger", "signerKeyId", "signingPrivateKeyPem"]) requireCondition(typeof config[field] === "string" && config[field].length > 0, `DEVELOPMENT_RUN_CONFIG_FIELD:${field}`);
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(config.startedAtUtc), "DEVELOPMENT_RUN_STARTED_AT");
  requireCondition(config.bootstrap === undefined || plain(config.bootstrap) && Object.keys(config.bootstrap).every(key => ["replicates", "seed"].includes(key)) && Number.isInteger(config.bootstrap.replicates) && config.bootstrap.replicates > 0 && Number.isInteger(config.bootstrap.seed), "DEVELOPMENT_RUN_BOOTSTRAP");
  requireCondition(config.manifestTrustStorePath === undefined || typeof config.manifestTrustStorePath === "string" && config.manifestTrustStorePath.length > 0, "DEVELOPMENT_MANIFEST_TRUST_PATH");
  const previousFields = [config.previousApprovedBundlePath, config.previousBundlePublicKeyPem, config.previousBundleSignerKeyId];
  requireCondition(previousFields.every(value => value === undefined || value === null) || previousFields.every(value => typeof value === "string" && value.length > 0), "DEVELOPMENT_PREVIOUS_BASELINE_CONFIG");
  requireCondition(config.environmentImageDigest === undefined || /^[0-9a-f]{64}$/.test(config.environmentImageDigest), "DEVELOPMENT_ENVIRONMENT_IMAGE_DIGEST");
}

function readJson(file, code) {
  let value;
  try { value = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { throw new Error(code); }
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
      failureCode: String(error && error.message || "DETECTOR_FAILURE"),
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

function deriveContractDigests(repositoryRoot, manifest) {
  const protocolPath = path.join(repositoryRoot, "evaluation", "protocols", "DEVELOPMENT_RPEAK_EVALUATION_V1.json");
  const protocol = readJson(protocolPath, "DEVELOPMENT_PROTOCOL_JSON");
  return {
    protocolSha256: implementationDigest([protocolPath]),
    preprocessingSha256: payloadSha256(protocol.identicalPipelineRequirements),
    leadPolicySha256: payloadSha256(manifest.leadPolicy),
    labelSnapshotSha256: payloadSha256(manifest.records.filter(record => record.taskEligibility === "ELIGIBLE").map(record => ({ recordHmacSha256: record.recordHmacSha256, labelSnapshotSha256: record.labelSnapshotSha256 })).sort((left, right) => left.recordHmacSha256.localeCompare(right.recordHmacSha256))),
    thresholdCalibrationSha256: payloadSha256({ currentEngine: protocol.currentEngine.configuration, panTompkins: "DEFAULT_PAN_TOMPKINS_CONFIG_V1" }),
  };
}

function resultInput(config, manifest, candidateId, records, contractDigests) {
  return {
    benchmarkId: manifest.benchmarkId,
    benchmarkVersion: manifest.benchmarkVersion,
    candidateId,
    manifestPayloadSha256: manifest.manifestPayloadSha256,
    contractDigests,
    primaryToleranceMs: config.protocol.primaryToleranceMs,
    toleranceMs: config.protocol.sensitivityToleranceMs,
    bootstrap: config.bootstrap || { replicates: config.protocol.routineBootstrapReplicates, seed: config.protocol.bootstrapSeed },
    records,
  };
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

function runDevelopmentEvaluation(config) {
  validateRunConfig(config);
  requireCondition(process.env.EKG_EVALUATION_NETWORK_DISABLED === "1", "DEVELOPMENT_NETWORK_ISOLATION_ENV_REQUIRED");
  requireCondition(["CONTAINER_NETWORK_NONE", "SYNTHETIC_TEST_PROCESS"].includes(config.networkIsolation), "DEVELOPMENT_NETWORK_ISOLATION_REQUIRED");
  requireCondition(config.inputMountMode === "READ_ONLY", "DEVELOPMENT_INPUT_READ_ONLY_REQUIRED");
  requireCondition(config.storageMode === "APPLICATION_WRITE_ONCE_SIGNED", "DEVELOPMENT_STORAGE_MODE");
  if (config.networkIsolation === "CONTAINER_NETWORK_NONE") requireCondition(typeof config.environmentImageDigest === "string", "DEVELOPMENT_ENVIRONMENT_IMAGE_DIGEST_REQUIRED");
  const repositoryRoot = path.resolve(config.repositoryRoot || path.join(__dirname, ".."));
  const protocol = readJson(path.join(repositoryRoot, "evaluation", "protocols", "DEVELOPMENT_RPEAK_EVALUATION_V1.json"), "DEVELOPMENT_PROTOCOL_JSON");
  const regressionPolicy = readJson(path.join(repositoryRoot, "evaluation", "protocols", "DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json"), "DEVELOPMENT_REGRESSION_POLICY_JSON");
  const runtimeConfig = { ...config, protocol };
  const syntheticTest = config.networkIsolation === "SYNTHETIC_TEST_PROCESS" && config.trigger === "synthetic-test";
  const minimumBootstrapReplicates = config.trigger === "weekly" ? protocol.finalBootstrapReplicates : protocol.routineBootstrapReplicates;
  if (!syntheticTest && config.bootstrap !== undefined) requireCondition(config.bootstrap.replicates >= minimumBootstrapReplicates, "DEVELOPMENT_BOOTSTRAP_REPLICATES_TOO_LOW");
  const manifest = readJson(config.manifestPath, "DEVELOPMENT_MANIFEST_JSON");
  const manifestSignature = readJson(config.manifestSignaturePath, "DEVELOPMENT_MANIFEST_SIGNATURE_JSON");
  const syntheticManifest = manifest.datasetIdentity && manifest.datasetIdentity.datasetId === "ECG-DATASET-SYNTHETIC-DEVELOPMENT";
  requireCondition(syntheticManifest || typeof config.manifestTrustStorePath === "string", "DEVELOPMENT_EXTERNAL_MANIFEST_TRUST_REQUIRED");
  const manifestTrustStorePath = config.manifestTrustStorePath || path.join(repositoryRoot, "evaluation", "keys", "DEVELOPMENT_MANIFEST_SIGNERS.json");
  const manifestTrustStore = readJson(manifestTrustStorePath, "DEVELOPMENT_MANIFEST_TRUST_JSON");
  const spentRegistry = readJson(path.join(repositoryRoot, "evaluation", "registries", "SPENT_DATASET_REGISTRY.json"), "SPENT_REGISTRY_JSON");
  const spentRegistrySignature = readJson(path.join(repositoryRoot, "evaluation", "registries", "SPENT_DATASET_REGISTRY.sig"), "SPENT_REGISTRY_SIGNATURE_JSON");
  const spentTrustStore = readJson(path.join(repositoryRoot, "evaluation", "keys", "SPENT_REGISTRY_SIGNERS.json"), "SPENT_REGISTRY_TRUST_JSON");
  const preflight = preflightDevelopmentRun({
    spentRegistry,
    spentRegistrySignature,
    spentTrustStore,
    minimumSpentRegistrySequence: MINIMUM_SPENT_REGISTRY_SEQUENCE,
    expectedSpentRegistrySha256: PINNED_SPENT_REGISTRY_SHA256,
    manifest,
    manifestSignature,
    manifestTrustStore,
  });
  if (config.networkIsolation === "SYNTHETIC_TEST_PROCESS") requireCondition(config.trigger === "synthetic-test" && manifest.datasetIdentity.datasetId === "ECG-DATASET-SYNTHETIC-DEVELOPMENT", "DEVELOPMENT_TEST_NETWORK_SCOPE");
  const contractDigests = deriveContractDigests(repositoryRoot, manifest);
  const states = [{ state: "VALIDATING", atUtc: config.startedAtUtc }];
  const candidateRows = [];
  const panTompkinsRows = [];
  const engineeringRows = [];
  states.push({ state: "RUNNING", atUtc: config.startedAtUtc });
  for (const manifestRecord of manifest.records.filter(record => record.taskEligibility === "ELIGIBLE")) {
    const loaded = loadEvaluationRecord(config.corpusRoot, manifestRecord, manifest.leadPolicy);
    requireCondition(loaded.referenceSampleIndices.length === manifestRecord.referenceEventCount, "DEVELOPMENT_REFERENCE_COUNT_DRIFT");
    requireCondition(Math.abs(loaded.samples.length / manifestRecord.sampleRateHz - manifestRecord.durationSeconds) <= 1 / manifestRecord.sampleRateHz, "DEVELOPMENT_DURATION_DRIFT");
    const provenance = { sourceKind: "authorized_development_manifest", locator: `${manifest.benchmarkId}:${manifestRecord.recordHmacSha256}` };
    const candidateDetector = (samples, sampleRateHz, source) => detectCandidateRPeaks(samples, sampleRateHz, { ...protocol.currentEngine.configuration, provenance: source });
    const panTompkinsDetector = (samples, sampleRateHz, source) => detectPanTompkinsRPeaks(samples, sampleRateHz, { provenance: source });
    const candidate = runDetector(candidateDetector, loaded.samples, manifestRecord.sampleRateHz, provenance);
    const candidateReplay = runDetector(candidateDetector, loaded.samples, manifestRecord.sampleRateHz, provenance);
    const panTompkins = runDetector(panTompkinsDetector, loaded.samples, manifestRecord.sampleRateHz, provenance);
    const panTompkinsReplay = runDetector(panTompkinsDetector, loaded.samples, manifestRecord.sampleRateHz, provenance);
    const deterministicOutput = value => ({ status: value.status, failureCode: value.failureCode, predictedSampleIndices: value.predictedSampleIndices, algorithm: value.algorithm });
    requireCondition(JSON.stringify(deterministicOutput(candidate)) === JSON.stringify(deterministicOutput(candidateReplay)), "DEVELOPMENT_CURRENT_ENGINE_NONDETERMINISTIC");
    requireCondition(JSON.stringify(deterministicOutput(panTompkins)) === JSON.stringify(deterministicOutput(panTompkinsReplay)), "DEVELOPMENT_PAN_TOMPKINS_NONDETERMINISTIC");
    if (candidate.status === "SUCCESS") requireCondition(candidate.algorithm === protocol.currentEngine.algorithm, "DEVELOPMENT_CURRENT_ENGINE_ALGORITHM_DRIFT");
    if (panTompkins.status === "SUCCESS") requireCondition(panTompkins.algorithm === PAN_TOMPKINS_ALGORITHM, "DEVELOPMENT_PAN_TOMPKINS_ALGORITHM_DRIFT");
    const shared = {
      recordHmacSha256: manifestRecord.recordHmacSha256,
      patientHmacSha256: manifestRecord.patientHmacSha256,
      referenceSampleIndices: loaded.referenceSampleIndices,
      sampleRateHz: manifestRecord.sampleRateHz,
      durationSeconds: manifestRecord.durationSeconds,
      lead: loaded.lead,
      subgroups: manifestRecord.subgroups,
    };
    candidateRows.push({ ...shared, predictedSampleIndices: candidate.predictedSampleIndices, status: candidate.status, failureCode: candidate.failureCode });
    panTompkinsRows.push({ ...shared, predictedSampleIndices: panTompkins.predictedSampleIndices, status: panTompkins.status, failureCode: panTompkins.failureCode });
    engineeringRows.push({ recordHmacSha256: manifestRecord.recordHmacSha256, candidate: { status: candidate.status, failureCode: candidate.failureCode, latencyMs: candidate.latencyMs, peakMemoryBytes: candidate.peakMemoryBytes }, panTompkins: { status: panTompkins.status, failureCode: panTompkins.failureCode, latencyMs: panTompkins.latencyMs, peakMemoryBytes: panTompkins.peakMemoryBytes } });
  }
  states.push({ state: "SCORING", atUtc: config.startedAtUtc });
  const current = evaluateRPeakRecords(resultInput(runtimeConfig, manifest, protocol.currentEngine.algorithm, candidateRows, contractDigests));
  const panTompkins = evaluateRPeakRecords(resultInput(runtimeConfig, manifest, PAN_TOMPKINS_ALGORITHM, panTompkinsRows, contractDigests));
  states.push({ state: "COMPARING", atUtc: config.startedAtUtc });
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
  const identity = gitIdentity(repositoryRoot);
  const dirtySyntheticAllowed = config.allowDirtySyntheticTest === true && config.trigger === "synthetic-test" && manifest.datasetIdentity.datasetId === "ECG-DATASET-SYNTHETIC-DEVELOPMENT";
  requireCondition(identity.worktreeClean || dirtySyntheticAllowed, "DEVELOPMENT_WORKTREE_NOT_CLEAN");
  const candidateDigest = implementationDigest([path.join(repositoryRoot, "lib", "signal_measurement_contract.js")]);
  const panTompkinsDigest = implementationDigest([path.join(repositoryRoot, "lib", "pan_tompkins_detector.js"), path.join(repositoryRoot, "lib", "signal_dsp_filtering.js"), path.join(repositoryRoot, "lib", "signal_measurement_contract.js")]);
  const metricCodeDigest = implementationDigest([path.join(repositoryRoot, "lib", "rpeak_development_metrics.js"), path.join(repositoryRoot, "lib", "event_matcher_v2.js")]);
  const harnessCodeDigest = implementationDigest([
    path.join(repositoryRoot, "lib", "development_evaluation_runner.js"),
    path.join(repositoryRoot, "lib", "development_evaluation_preflight.js"),
    path.join(repositoryRoot, "lib", "development_run_comparison.js"),
    path.join(repositoryRoot, "lib", "evaluation_artifact_store.js"),
    path.join(repositoryRoot, "lib", "evaluation_signatures.js"),
    path.join(repositoryRoot, "lib", "local_dataset_loader.js"),
    path.join(repositoryRoot, "lib", "spent_dataset_registry.js"),
  ]);
  const regressionPolicyDigest = implementationDigest([path.join(repositoryRoot, "evaluation", "protocols", "DEVELOPMENT_RPEAK_REGRESSION_POLICY_V1.json")]);
  const environment = { node: process.version, platform: process.platform, architecture: process.arch, imageDigest: config.environmentImageDigest || null, networkIsolation: config.networkIsolation, inputMount: config.inputMountMode, artifactStorage: config.storageMode };
  const environmentDigest = payloadSha256(environment);
  const runConfigurationDigest = payloadSha256({ trigger: config.trigger, bootstrap: runtimeConfig.bootstrap || { replicates: protocol.routineBootstrapReplicates, seed: protocol.bootstrapSeed }, networkIsolation: config.networkIsolation, inputMountMode: config.inputMountMode, storageMode: config.storageMode, manifestTrustStoreConfigured: Boolean(config.manifestTrustStorePath), previousBaselineIdentity });
  const sbomDigest = implementationDigest([path.join(repositoryRoot, "package.json")]);
  const runIdentityDigest = payloadSha256({
    candidateDigest,
    panTompkinsDigest,
    engineCommitDigest: identity.commit,
    engineTreeDigest: identity.tree,
    environmentDigest,
    sbomDigest,
    configurationDigest: runConfigurationDigest,
    preprocessingDigest: contractDigests.preprocessingSha256,
    manifestDigest: manifest.manifestPayloadSha256,
    sourceInventoryDigest: manifest.datasetIdentity.sourceManifestSha256,
    labelSnapshotDigest: contractDigests.labelSnapshotSha256,
    ontologyMappingDigest: payloadSha256("NOT_APPLICABLE_RPEAK"),
    metricCodeDigest,
    harnessCodeDigest,
    regressionPolicyDigest,
    bootstrap: runtimeConfig.bootstrap || { replicates: protocol.routineBootstrapReplicates, seed: protocol.bootstrapSeed },
    matcherDigest: payloadSha256(current.matcherVersion),
    thresholdCalibrationDigest: contractDigests.thresholdCalibrationSha256,
  });
  const endedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const policyReady = regressionPolicy.approvalStatus === "APPROVED" && Array.isArray(regressionPolicy.gates) && regressionPolicy.gates.some(gate => gate.blocking === true);
  const comparisonFailure = [panTompkinsComparison, previousComparison].some(comparison => comparison.status === "FAILED");
  const comparisonBlocked = [panTompkinsComparison, previousComparison].some(comparison => ["NOT_AVAILABLE", "NOT_COMPARABLE"].includes(comparison.status));
  const gateStatus = comparisonFailure ? "FAILED" : !policyReady || comparisonBlocked ? "QUARANTINED" : "PASSED";
  states.push({ state: "PUBLISHING", atUtc: endedAtUtc });
  states.push({ state: gateStatus, atUtc: endedAtUtc });
  const runManifest = {
    schema: "ekg-development-run-manifest-v1",
    runId: null,
    trigger: config.trigger,
    startedAtUtc: config.startedAtUtc,
    endedAtUtc,
    state: gateStatus,
    stateTransitions: states,
    runIdentityDigest,
    engineCommitDigest: identity.commit,
    engineTreeDigest: identity.tree,
    environment,
    environmentDigest,
    runConfigurationDigest,
    sbomDigest,
    manifestPayloadSha256: manifest.manifestPayloadSha256,
    spentRegistrySha256: spentRegistrySignature.payloadSha256,
    candidateDigest,
    panTompkinsDigest,
    metricCodeDigest,
    harnessCodeDigest,
    regressionPolicyDigest,
    worktreeClean: identity.worktreeClean,
    worktreeStatusSha256: identity.worktreeStatusSha256,
    contractDigests,
    baselineApproval: "NOT_APPROVED_AUTOMATICALLY",
    clinicalAccuracyClaimed: false,
  };
  const artifacts = {
    "input-and-rights-digests.json": governedArtifact({ datasetIdentity: manifest.datasetIdentity, rights: manifest.rights, partitionAttestation: manifest.partitionAttestation, manifestPayloadSha256: manifest.manifestPayloadSha256, spentRegistrySha256: spentRegistrySignature.payloadSha256 }),
    "candidate-digests.json": governedArtifact({ currentEngine: current.candidateId, panTompkins: panTompkins.candidateId, candidateDigest, panTompkinsDigest, contractDigests }),
    "predictions.restricted.json": governedArtifact({ currentEngine: candidateRows.map(row => ({ recordHmacSha256: row.recordHmacSha256, predictedSampleIndices: row.predictedSampleIndices })), panTompkins: panTompkinsRows.map(row => ({ recordHmacSha256: row.recordHmacSha256, predictedSampleIndices: row.predictedSampleIndices })) }),
    "per-record.restricted.json": governedArtifact({ currentEngine: current.records, panTompkins: panTompkins.records }),
    "per-patient.restricted.json": governedArtifact({ currentEngine: current.patients, panTompkins: panTompkins.patients }),
    "internal-result.restricted.json": governedArtifact({ currentEngine: current, panTompkins, engineeringRows, versusPanTompkins: panTompkinsComparison, versusPreviousApprovedRun: previousComparison }),
    "subgroup-metrics.json": governedArtifact({ currentEngine: stripDistributionValues(current.subgroups), panTompkins: stripDistributionValues(panTompkins.subgroups) }),
    "metric-distributions.json": governedArtifact({ currentEngine: stripDistributionValues(current.summary), panTompkins: stripDistributionValues(panTompkins.summary), currentWorstRecordSensitivity: current.worstRecords[0] ? current.worstRecords[0].sensitivity : null, panTompkinsWorstRecordSensitivity: panTompkins.worstRecords[0] ? panTompkins.worstRecords[0].sensitivity : null }),
    "bootstrap-and-paired-deltas.json": governedArtifact({ currentEngine: stripDistributionValues(current.confidenceIntervals), panTompkins: stripDistributionValues(panTompkins.confidenceIntervals), versusPanTompkins: publicComparison(panTompkinsComparison), versusPreviousApprovedRun: publicComparison(previousComparison) }),
    "engineering-report.json": governedArtifact({ schema: "ekg-development-engineering-report-v1", nRecords: engineeringRows.length, currentEngineTechnicalFailureCount: engineeringRows.filter(row => row.candidate.status !== "SUCCESS").length, panTompkinsTechnicalFailureCount: engineeringRows.filter(row => row.panTompkins.status !== "SUCCESS").length, preflight }),
    "development-report.json": governedArtifact({ schema: "ekg-development-evaluation-report-v1", currentEngine: publicEvaluationResult(current), panTompkins: publicEvaluationResult(panTompkins), repeatedDevelopmentUse: true, untouchedValidation: false, capabilityStatement: current.capabilityStatement }),
    "gates.json": governedArtifact({ schema: "ekg-development-gates-v1", status: gateStatus, versusPanTompkins: panTompkinsComparison.status, versusPreviousApprovedRun: previousComparison.status, regressionPolicyApproval: regressionPolicy.approvalStatus, policyReady }),
    "logs.json": governedArtifact({ schema: "ekg-development-run-log-v1", stateTransitions: states }),
  };
  return publishEvaluationBundle(config.artifactRoot, {
    storageMode: config.storageMode,
    startedAtUtc: config.startedAtUtc,
    runManifest,
    artifacts,
    signingPrivateKeyPem: config.signingPrivateKeyPem,
    signerKeyId: config.signerKeyId,
  });
}

module.exports = { assertNoSymlinkPath, deriveContractDigests, implementationDigest, loadEvaluationRecord, readExact, runDevelopmentEvaluation, runDetector, validateRunConfig };
