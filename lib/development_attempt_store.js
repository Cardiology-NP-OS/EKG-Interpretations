"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { CLAIM_BOUNDARY } = require("./development_evaluation_preflight");
const { summarizeRunAccounting } = require("./development_run_accounting");
const { verifyEvaluationBundle } = require("./evaluation_artifact_store");
const { payloadSha256 } = require("./evaluation_signatures");
const { CANDIDATE_LAUNCH_POLICY_SHA256, validateCandidateIsolationExpectation } = require("./development_candidate_isolation");
const { validateCandidateRuntimeAttestation } = require("./development_candidate_runtime_attestation");

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function fsyncFile(file) {
  const descriptor = fs.openSync(file, "r+");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function assertDirectoryChain(directory) {
  for (let current = path.resolve(directory); ; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "DEVELOPMENT_ATTEMPT_DIRECTORY");
    if (current === path.dirname(current)) break;
  }
}

const ATTEMPT_RESOURCE_LIMITS = Object.freeze({ maxStartPayloadBytes: 4 * 1024 * 1024, maxTerminalPayloadBytes: 16 * 1024 * 1024, maxSignatureBytes: 64 * 1024, maxAttemptBytes: 24 * 1024 * 1024 });

function statIdentity(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(":");
}

function readFileSnapshot(file, maxBytes, budget) {
  let descriptor = null;
  try {
    const before = fs.lstatSync(file, { bigint: true });
    requireCondition(before.isFile() && !before.isSymbolicLink() && before.size > 0n && before.size <= BigInt(maxBytes), "DEVELOPMENT_ATTEMPT_CONTROL_FILE");
    requireCondition(budget.totalBytes <= budget.maxBytes - Number(before.size), "DEVELOPMENT_ATTEMPT_TOTAL_SIZE");
    budget.totalBytes += Number(before.size);
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    requireCondition(opened.isFile() && statIdentity(before) === statIdentity(opened), "DEVELOPMENT_ATTEMPT_READ_RACE");
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(file, { bigint: true });
    requireCondition(statIdentity(opened) === statIdentity(after) && statIdentity(opened) === statIdentity(current) && offset === Number(opened.size), "DEVELOPMENT_ATTEMPT_READ_RACE");
    return { bytes: bytes.subarray(0, offset), identity: statIdentity(opened) };
  } catch (error) {
    if (error && /^DEVELOPMENT_ATTEMPT_/.test(error.message)) throw error;
    throw new Error("DEVELOPMENT_ATTEMPT_CONTROL_FILE");
  } finally {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch (_) {}
    }
  }
}

function readBoundedInventory(directory, expected, code = "DEVELOPMENT_ATTEMPT_UNDECLARED_FILE") {
  const names = [];
  const handle = fs.opendirSync(directory);
  try {
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) break;
      requireCondition(names.length < expected.length, code);
      names.push(entry.name);
    }
  } finally {
    handle.closeSync();
  }
  requireCondition(JSON.stringify(names.sort()) === JSON.stringify(expected.slice().sort()), code);
  return names;
}

function validateAttemptId(value) {
  requireCondition(typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value), "DEVELOPMENT_ATTEMPT_ID");
  return value;
}

function isolationExpectationFromRunBinding(value) {
  return { schema: "ekg-development-candidate-isolation-expectation-v1", attestationState: value.candidateIsolationState, isolationMode: value.candidateIsolationMode, candidateInputMode: value.candidateInputMode, candidateRuntimeImageDigest: value.candidateRuntimeImageDigest, candidateLaunchPolicySha256: value.candidateLaunchPolicySha256, expectedUid: value.candidateExpectedUid, expectedGid: value.candidateExpectedGid };
}

function validateRunBinding(value) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), "DEVELOPMENT_ATTEMPT_RUN_BINDING");
  const common = ["schema", "runConfigurationSha256", "candidateManifestPayloadSha256", "executionIdentitySha256", "manifestPayloadSha256", "candidateTrustStoreSha256", "manifestTrustStoreSha256", "environmentImageDigest", "signerImageDigest"];
  const expected = value.schema === "ekg-development-run-binding-v2" ? [...common, "executionInputSha256", "candidateInputMode", "candidateRuntimeIdentitySha256", "candidateRuntimeImageDigest", "candidateLaunchPolicySha256", "candidateIsolationMode", "candidateIsolationState", "candidateExpectedUid", "candidateExpectedGid", "candidateIsolationExpectationSha256"] : [...common, "candidateReferenceIsolation"];
  requireCondition(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected.sort()), "DEVELOPMENT_ATTEMPT_RUN_BINDING_FIELDS");
  requireCondition(["ekg-development-run-binding-v1", "ekg-development-run-binding-v2"].includes(value.schema), "DEVELOPMENT_ATTEMPT_RUN_BINDING_SCHEMA");
  if (value.schema === "ekg-development-run-binding-v1") requireCondition(value.candidateReferenceIsolation === false, "DEVELOPMENT_ATTEMPT_REFERENCE_ISOLATION");
  for (const field of ["runConfigurationSha256", "candidateManifestPayloadSha256", "executionIdentitySha256", "manifestPayloadSha256", "candidateTrustStoreSha256", "manifestTrustStoreSha256"]) requireCondition(/^[0-9a-f]{64}$/.test(value[field]), `DEVELOPMENT_ATTEMPT_RUN_BINDING_DIGEST:${field}`);
  for (const field of ["environmentImageDigest", "signerImageDigest"]) requireCondition(value[field] === null || /^[0-9a-f]{64}$/.test(value[field]), `DEVELOPMENT_ATTEMPT_RUN_BINDING_DIGEST:${field}`);
  if (value.schema === "ekg-development-run-binding-v2") {
    for (const field of ["executionInputSha256", "candidateRuntimeIdentitySha256", "candidateLaunchPolicySha256", "candidateIsolationExpectationSha256"]) requireCondition(/^[0-9a-f]{64}$/.test(value[field]), `DEVELOPMENT_ATTEMPT_RUN_BINDING_DIGEST:${field}`);
    requireCondition(value.candidateInputMode === "SIGNAL_ONLY_READ_ONLY_V1", "DEVELOPMENT_ATTEMPT_INPUT_MODE");
    requireCondition(value.candidateLaunchPolicySha256 === CANDIDATE_LAUNCH_POLICY_SHA256, "DEVELOPMENT_ATTEMPT_LAUNCH_POLICY");
    validateCandidateIsolationExpectation(isolationExpectationFromRunBinding(value), value.candidateIsolationExpectationSha256);
    if (value.candidateIsolationMode === "SYNTHETIC_IN_PROCESS") requireCondition(value.environmentImageDigest === null, "DEVELOPMENT_ATTEMPT_SYNTHETIC_ISOLATION");
    else requireCondition(value.environmentImageDigest === value.candidateRuntimeImageDigest, "DEVELOPMENT_ATTEMPT_CONTAINER_ISOLATION");
  }
  return value;
}

function signedFiles(payload, signingPrivateKeyPem, signerKeyId, schema, maxPayloadBytes) {
  requireCondition(typeof signingPrivateKeyPem === "string" && signingPrivateKeyPem.includes("PRIVATE KEY"), "DEVELOPMENT_ATTEMPT_SIGNING_KEY");
  requireCondition(typeof signerKeyId === "string" && signerKeyId.length > 0, "DEVELOPMENT_ATTEMPT_SIGNER_KEY_ID");
  const body = Buffer.from(canonicalJson(payload), "utf8");
  requireCondition(body.length > 0 && body.length <= maxPayloadBytes, "DEVELOPMENT_ATTEMPT_PAYLOAD_SIZE");
  const payloadSha256 = sha256(body);
  const signatureBase64 = crypto.sign(null, body, signingPrivateKeyPem).toString("base64");
  const signature = Buffer.from(canonicalJson({ schema, algorithm: "Ed25519", signerKeyId, payloadSha256, signatureBase64 }), "utf8");
  requireCondition(signature.length > 0 && signature.length <= ATTEMPT_RESOURCE_LIMITS.maxSignatureBytes, "DEVELOPMENT_ATTEMPT_SIGNATURE_SIZE");
  return { body, signature, payloadSha256 };
}

function writeFileDurable(file, bytes) {
  fs.writeFileSync(file, bytes, { flag: "wx" });
  fsyncFile(file);
}

function publishDevelopmentAttemptStart(root, input) {
  requireCondition(typeof root === "string" && root.length > 0, "DEVELOPMENT_ATTEMPT_ROOT");
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "DEVELOPMENT_ATTEMPT_START_INPUT");
  const attemptId = validateAttemptId(input.attemptId);
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(input.startedAtUtc), "DEVELOPMENT_ATTEMPT_STARTED_AT");
  const rootDir = path.resolve(root);
  fs.mkdirSync(rootDir, { recursive: true });
  assertDirectoryChain(rootDir);
  const parent = path.join(rootDir, "attempts", ...input.startedAtUtc.slice(0, 10).split("-"));
  fs.mkdirSync(parent, { recursive: true });
  assertDirectoryChain(parent);
  const finalDir = path.join(parent, attemptId);
  requireCondition(!fs.existsSync(finalDir), "DEVELOPMENT_ATTEMPT_IMMUTABLE_COLLISION");
  const payload = {
    schema: "ekg-development-attempt-start-v2",
    attemptId,
    startedAtUtc: input.startedAtUtc,
    trigger: input.trigger,
    workflowRunId: input.workflowRunId,
    workflowRunAttempt: input.workflowRunAttempt,
    workflowSha: input.workflowSha,
    runBinding: validateRunBinding(input.runBinding),
    ...CLAIM_BOUNDARY,
  };
  const signed = signedFiles(payload, input.signingPrivateKeyPem, input.signerKeyId, "ekg-development-attempt-start-signature-v2", ATTEMPT_RESOURCE_LIMITS.maxStartPayloadBytes);
  const stage = fs.mkdtempSync(path.join(parent, ".attempt-staging-"));
  try {
    writeFileDurable(path.join(stage, "start.json"), signed.body);
    writeFileDurable(path.join(stage, "start.signature.json"), signed.signature);
    fsyncDirectory(stage);
    fs.renameSync(stage, finalDir);
    fsyncDirectory(parent);
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return { attemptId, path: finalDir, startPayloadSha256: signed.payloadSha256 };
}

function validateTerminalPayload(payload) {
  requireCondition(payload && ["COMPLETED", "FAILED", "BLOCKED", "NOT_RUN"].includes(payload.executionStatus), "DEVELOPMENT_ATTEMPT_EXECUTION_STATUS");
  requireCondition(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(payload.endedAtUtc), "DEVELOPMENT_ATTEMPT_ENDED_AT");
  requireCondition(typeof payload.lastPhase === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(payload.lastPhase), "DEVELOPMENT_ATTEMPT_LAST_PHASE");
  requireCondition(Array.isArray(payload.stateTransitions) && payload.stateTransitions.length >= 2 && payload.stateTransitions.every(row => row && /^[A-Z][A-Z0-9_]{2,63}$/.test(row.state) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(row.atUtc)), "DEVELOPMENT_ATTEMPT_TRANSITIONS");
  requireCondition(payload.stateTransitions.every((row, index) => index === 0 || row.atUtc >= payload.stateTransitions[index - 1].atUtc), "DEVELOPMENT_ATTEMPT_TRANSITION_ORDER");
  requireCondition(payload.stateTransitions[0].state === "VALIDATING", "DEVELOPMENT_ATTEMPT_INITIAL_STATE");
  requireCondition(payload.stateTransitions[payload.stateTransitions.length - 1].state === payload.executionStatus, "DEVELOPMENT_ATTEMPT_TERMINAL_STATE");
  requireCondition(payload.stateTransitions[payload.stateTransitions.length - 2].state === payload.lastPhase, "DEVELOPMENT_ATTEMPT_LAST_PHASE_MISMATCH");
  requireCondition(payload.failureCode === null || payload.failureCode === undefined || /^[A-Z][A-Z0-9_]{2,63}$/.test(payload.failureCode), "DEVELOPMENT_ATTEMPT_FAILURE_CODE");
  if (payload.accounting !== null && payload.accounting !== undefined) summarizeRunAccounting(payload.accounting);
  if (payload.executionStatus === "COMPLETED") {
    requireCondition(payload.failureCode === null && payload.bundle !== null && payload.gateStatus !== "NOT_RUN", "DEVELOPMENT_ATTEMPT_TERMINAL_CONTENT");
    requireCondition(typeof payload.bundle.runId === "string" && /^\d{8}T\d{6}Z_[0-9a-f]{16}$/.test(payload.bundle.runId), "DEVELOPMENT_ATTEMPT_BUNDLE_ID");
    requireCondition(/^[0-9a-f]{64}$/.test(payload.bundle.runDigest) && /^[0-9a-f]{64}$/.test(payload.bundle.merkleRootSha256), "DEVELOPMENT_ATTEMPT_BUNDLE_DIGEST");
    requireCondition(payload.bundle.executionHandoffSha256 === undefined || /^[0-9a-f]{64}$/.test(payload.bundle.executionHandoffSha256), "DEVELOPMENT_ATTEMPT_HANDOFF_DIGEST");
    requireCondition(payload.bundle.executionInputSha256 === undefined || /^[0-9a-f]{64}$/.test(payload.bundle.executionInputSha256), "DEVELOPMENT_ATTEMPT_INPUT_DIGEST");
    requireCondition(payload.bundle.candidateRuntimeAttestationSha256 === undefined || /^[0-9a-f]{64}$/.test(payload.bundle.candidateRuntimeAttestationSha256), "DEVELOPMENT_ATTEMPT_RUNTIME_ATTESTATION_DIGEST");
    requireCondition(payload.bundle.candidateReferenceIsolation === undefined || typeof payload.bundle.candidateReferenceIsolation === "boolean", "DEVELOPMENT_ATTEMPT_REFERENCE_ISOLATION");
  } else {
    requireCondition(typeof payload.failureCode === "string" && payload.bundle === null && payload.gateStatus === "NOT_RUN", "DEVELOPMENT_ATTEMPT_TERMINAL_CONTENT");
  }
}

function publishDevelopmentAttemptTerminal(attempt, input) {
  requireCondition(attempt && typeof attempt.path === "string" && /^[0-9a-f]{64}$/.test(attempt.startPayloadSha256), "DEVELOPMENT_ATTEMPT_HANDLE");
  requireCondition(input && typeof input === "object" && !Array.isArray(input), "DEVELOPMENT_ATTEMPT_TERMINAL_INPUT");
  const terminalDir = path.join(attempt.path, "terminal");
  requireCondition(!fs.existsSync(terminalDir), "DEVELOPMENT_ATTEMPT_TERMINAL_COLLISION");
  const payload = {
    schema: "ekg-development-attempt-terminal-v1",
    attemptId: attempt.attemptId,
    startPayloadSha256: attempt.startPayloadSha256,
    endedAtUtc: input.endedAtUtc,
    executionStatus: input.executionStatus,
    gateStatus: input.gateStatus || "NOT_RUN",
    failureCode: input.failureCode || null,
    lastPhase: input.lastPhase,
    stateTransitions: input.stateTransitions,
    accounting: input.accounting || null,
    bundle: input.bundle || null,
    ...CLAIM_BOUNDARY,
  };
  validateTerminalPayload(payload);
  const signed = signedFiles(payload, input.signingPrivateKeyPem, input.signerKeyId, "ekg-development-attempt-terminal-signature-v1", ATTEMPT_RESOURCE_LIMITS.maxTerminalPayloadBytes);
  const stage = fs.mkdtempSync(path.join(attempt.path, ".terminal-staging-"));
  try {
    writeFileDurable(path.join(stage, "terminal.json"), signed.body);
    writeFileDurable(path.join(stage, "terminal.signature.json"), signed.signature);
    fsyncDirectory(stage);
    fs.renameSync(stage, terminalDir);
    fsyncDirectory(attempt.path);
  } catch (error) {
    if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
  return { attemptId: attempt.attemptId, path: attempt.path, terminalPayloadSha256: signed.payloadSha256, executionStatus: input.executionStatus };
}

function verifySignedFile(payloadFile, signatureFile, publicKeyPem, expectedSignerKeyId, expectedSchema, maxPayloadBytes, budget) {
  const signatureSnapshot = readFileSnapshot(signatureFile, ATTEMPT_RESOURCE_LIMITS.maxSignatureBytes, budget);
  let signature;
  try { signature = JSON.parse(signatureSnapshot.bytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_ATTEMPT_SIGNATURE_JSON"); }
  const expectedSchemas = Array.isArray(expectedSchema) ? expectedSchema : [expectedSchema];
  requireCondition(expectedSchemas.includes(signature.schema) && signature.algorithm === "Ed25519", "DEVELOPMENT_ATTEMPT_SIGNATURE_METADATA");
  requireCondition(signature.signerKeyId === expectedSignerKeyId, "DEVELOPMENT_ATTEMPT_UNTRUSTED_SIGNER");
  const payloadSnapshot = readFileSnapshot(payloadFile, maxPayloadBytes, budget);
  requireCondition(signature.payloadSha256 === sha256(payloadSnapshot.bytes), "DEVELOPMENT_ATTEMPT_PAYLOAD_HASH");
  requireCondition(crypto.verify(null, payloadSnapshot.bytes, publicKeyPem, Buffer.from(signature.signatureBase64, "base64")), "DEVELOPMENT_ATTEMPT_SIGNATURE");
  let payload;
  try { payload = JSON.parse(payloadSnapshot.bytes.toString("utf8")); } catch (_) { throw new Error("DEVELOPMENT_ATTEMPT_PAYLOAD_JSON"); }
  return { payload, payloadSha256: signature.payloadSha256, signatureSchema: signature.schema, identities: { [payloadFile]: payloadSnapshot.identity, [signatureFile]: signatureSnapshot.identity } };
}

function verifyDevelopmentAttempt(attemptPath, publicKeyPem, options = {}) {
  const directory = path.resolve(attemptPath);
  assertDirectoryChain(directory);
  requireCondition(typeof options.expectedSignerKeyId === "string" && options.expectedSignerKeyId.length > 0, "DEVELOPMENT_ATTEMPT_EXPECTED_SIGNER");
  const directoryBefore = fs.lstatSync(directory, { bigint: true });
  requireCondition(directoryBefore.isDirectory() && !directoryBefore.isSymbolicLink(), "DEVELOPMENT_ATTEMPT_DIRECTORY");
  const initialNames = [];
  const initialHandle = fs.opendirSync(directory);
  try {
    for (;;) {
      const entry = initialHandle.readSync();
      if (entry === null) break;
      requireCondition(initialNames.length < 3, "DEVELOPMENT_ATTEMPT_UNDECLARED_FILE");
      initialNames.push(entry.name);
    }
  } finally {
    initialHandle.closeSync();
  }
  const hasTerminal = initialNames.includes("terminal");
  const expectedAttemptFiles = hasTerminal ? ["start.json", "start.signature.json", "terminal"] : ["start.json", "start.signature.json"];
  requireCondition(JSON.stringify(initialNames.sort()) === JSON.stringify(expectedAttemptFiles.slice().sort()), "DEVELOPMENT_ATTEMPT_UNDECLARED_FILE");
  const budget = { maxBytes: ATTEMPT_RESOURCE_LIMITS.maxAttemptBytes, totalBytes: 0 };
  const identities = {};
  const start = verifySignedFile(path.join(directory, "start.json"), path.join(directory, "start.signature.json"), publicKeyPem, options.expectedSignerKeyId, ["ekg-development-attempt-start-signature-v1", "ekg-development-attempt-start-signature-v2"], ATTEMPT_RESOURCE_LIMITS.maxStartPayloadBytes, budget);
  Object.assign(identities, start.identities);
  requireCondition(["ekg-development-attempt-start-v1", "ekg-development-attempt-start-v2"].includes(start.payload.schema), "DEVELOPMENT_ATTEMPT_START_SCHEMA");
  requireCondition(start.signatureSchema === start.payload.schema.replace("-v", "-signature-v"), "DEVELOPMENT_ATTEMPT_START_SIGNATURE_SCHEMA");
  requireCondition(start.payload.attemptId === path.basename(directory) && start.payload.clinicalAccuracyClaimed === false && start.payload.capabilityNotClaim === true, "DEVELOPMENT_ATTEMPT_START_IDENTITY");
  if (start.payload.schema === "ekg-development-attempt-start-v2") validateRunBinding(start.payload.runBinding);
  else requireCondition(start.payload.runBinding === undefined, "DEVELOPMENT_ATTEMPT_LEGACY_RUN_BINDING");
  let terminal = null;
  const terminalDir = path.join(directory, "terminal");
  if (hasTerminal) {
    assertDirectoryChain(terminalDir);
    const terminalDirectoryBefore = fs.lstatSync(terminalDir, { bigint: true });
    requireCondition(terminalDirectoryBefore.isDirectory() && !terminalDirectoryBefore.isSymbolicLink(), "DEVELOPMENT_ATTEMPT_DIRECTORY");
    readBoundedInventory(terminalDir, ["terminal.json", "terminal.signature.json"], "DEVELOPMENT_ATTEMPT_UNDECLARED_TERMINAL_FILE");
    terminal = verifySignedFile(path.join(terminalDir, "terminal.json"), path.join(terminalDir, "terminal.signature.json"), publicKeyPem, options.expectedSignerKeyId, "ekg-development-attempt-terminal-signature-v1", ATTEMPT_RESOURCE_LIMITS.maxTerminalPayloadBytes, budget);
    Object.assign(identities, terminal.identities);
    requireCondition(terminal.payload.attemptId === start.payload.attemptId && terminal.payload.startPayloadSha256 === start.payloadSha256, "DEVELOPMENT_ATTEMPT_TERMINAL_IDENTITY");
    requireCondition(terminal.payload.clinicalAccuracyClaimed === false && terminal.payload.capabilityNotClaim === true, "DEVELOPMENT_ATTEMPT_CLAIM_BOUNDARY");
    validateTerminalPayload(terminal.payload);
    readBoundedInventory(terminalDir, ["terminal.json", "terminal.signature.json"], "DEVELOPMENT_ATTEMPT_UNDECLARED_TERMINAL_FILE");
    const terminalDirectoryAfter = fs.lstatSync(terminalDir, { bigint: true });
    requireCondition(statIdentity(terminalDirectoryBefore) === statIdentity(terminalDirectoryAfter), "DEVELOPMENT_ATTEMPT_READ_RACE");
  }
  readBoundedInventory(directory, expectedAttemptFiles);
  const directoryAfter = fs.lstatSync(directory, { bigint: true });
  requireCondition(statIdentity(directoryBefore) === statIdentity(directoryAfter), "DEVELOPMENT_ATTEMPT_READ_RACE");
  for (const [file, identity] of Object.entries(identities)) {
    const current = fs.lstatSync(file, { bigint: true });
    requireCondition(current.isFile() && !current.isSymbolicLink() && statIdentity(current) === identity, "DEVELOPMENT_ATTEMPT_READ_RACE");
  }
  return { schema: "ekg-development-attempt-verification-v1", pass: true, attemptId: start.payload.attemptId, executionStatus: terminal ? terminal.payload.executionStatus : "INCOMPLETE", startPayloadSha256: start.payloadSha256, start: start.payload, terminal: terminal ? terminal.payload : null, verifiedBytes: budget.totalBytes, attemptResourceLimits: ATTEMPT_RESOURCE_LIMITS };
}

function verifyCompletedDevelopmentAttempt(attemptPath, artifactRoot, publicKeyPem, options = {}) {
  const attempt = verifyDevelopmentAttempt(attemptPath, publicKeyPem, options);
  if (attempt.executionStatus !== "COMPLETED") return { ...attempt, bundleVerification: null };
  const runId = attempt.terminal.bundle.runId;
  requireCondition(/^\d{8}T\d{6}Z_[0-9a-f]{16}$/.test(runId), "DEVELOPMENT_ATTEMPT_BUNDLE_ID");
  if (attempt.start.schema === "ekg-development-attempt-start-v2" && attempt.start.runBinding.schema === "ekg-development-run-binding-v2") {
    requireCondition(/^[0-9a-f]{64}$/.test(attempt.terminal.bundle.executionInputSha256) && /^[0-9a-f]{64}$/.test(attempt.terminal.bundle.executionHandoffSha256) && /^[0-9a-f]{64}$/.test(attempt.terminal.bundle.candidateRuntimeAttestationSha256) && typeof attempt.terminal.bundle.candidateReferenceIsolation === "boolean", "DEVELOPMENT_ATTEMPT_V2_DIGESTS_REQUIRED");
    requireCondition(attempt.terminal.bundle.executionInputSha256 === attempt.start.runBinding.executionInputSha256, "DEVELOPMENT_ATTEMPT_INPUT_BINDING");
  }
  const bundlePath = path.join(path.resolve(artifactRoot), ...attempt.start.startedAtUtc.slice(0, 10).split("-"), runId);
  const bundleVerification = verifyEvaluationBundle(bundlePath, publicKeyPem, options);
  requireCondition(bundleVerification.runManifest.attemptId === attempt.attemptId, "DEVELOPMENT_ATTEMPT_BUNDLE_ATTEMPT_ID");
  requireCondition(bundleVerification.runManifest.startedAtUtc === attempt.start.startedAtUtc, "DEVELOPMENT_ATTEMPT_BUNDLE_STARTED_AT");
  requireCondition(bundleVerification.runManifest.workflowRunId === attempt.start.workflowRunId, "DEVELOPMENT_ATTEMPT_BUNDLE_WORKFLOW_RUN_ID");
  requireCondition(bundleVerification.runManifest.workflowRunAttempt === attempt.start.workflowRunAttempt, "DEVELOPMENT_ATTEMPT_BUNDLE_WORKFLOW_RUN_ATTEMPT");
  requireCondition(bundleVerification.runManifest.workflowSha === attempt.start.workflowSha, "DEVELOPMENT_ATTEMPT_BUNDLE_WORKFLOW_SHA");
  if (attempt.start.schema === "ekg-development-attempt-start-v2") {
    validateRunBinding(bundleVerification.runManifest.runBinding);
    requireCondition(JSON.stringify(bundleVerification.runManifest.runBinding) === JSON.stringify(attempt.start.runBinding), "DEVELOPMENT_ATTEMPT_BUNDLE_RUN_BINDING");
    requireCondition(bundleVerification.runManifest.runBindingSha256 === payloadSha256(attempt.start.runBinding), "DEVELOPMENT_ATTEMPT_BUNDLE_RUN_BINDING_DIGEST");
    if (attempt.start.runBinding.schema === "ekg-development-run-binding-v2") {
      const runtimeAttestation = validateCandidateRuntimeAttestation(bundleVerification.runManifest.candidateRuntimeAttestation, isolationExpectationFromRunBinding(attempt.start.runBinding), bundleVerification.runManifest.candidateRuntimeAttestationSha256);
      requireCondition(bundleVerification.runManifest.candidateIsolationExpectationSha256 === attempt.start.runBinding.candidateIsolationExpectationSha256, "DEVELOPMENT_ATTEMPT_ISOLATION_EXPECTATION_BINDING");
      requireCondition(runtimeAttestation.candidateReferenceIsolation === bundleVerification.runManifest.candidateReferenceIsolation, "DEVELOPMENT_ATTEMPT_REFERENCE_ISOLATION");
    }
  }
  requireCondition(bundleVerification.runManifest.gateStatus === attempt.terminal.gateStatus, "DEVELOPMENT_ATTEMPT_BUNDLE_GATE_STATUS");
  requireCondition(bundleVerification.runDigest === attempt.terminal.bundle.runDigest, "DEVELOPMENT_ATTEMPT_BUNDLE_RUN_DIGEST");
  requireCondition(bundleVerification.merkleRootSha256 === attempt.terminal.bundle.merkleRootSha256, "DEVELOPMENT_ATTEMPT_BUNDLE_MERKLE_ROOT");
  if (attempt.terminal.bundle.executionHandoffSha256 !== undefined) requireCondition(bundleVerification.runManifest.executionHandoffSha256 === attempt.terminal.bundle.executionHandoffSha256, "DEVELOPMENT_ATTEMPT_HANDOFF_DIGEST");
  if (attempt.terminal.bundle.executionInputSha256 !== undefined) {
    requireCondition(bundleVerification.runManifest.executionInputSha256 === attempt.terminal.bundle.executionInputSha256, "DEVELOPMENT_ATTEMPT_INPUT_DIGEST");
    requireCondition(attempt.start.runBinding.executionInputSha256 === attempt.terminal.bundle.executionInputSha256, "DEVELOPMENT_ATTEMPT_INPUT_BINDING");
  }
  if (attempt.terminal.bundle.candidateRuntimeAttestationSha256 !== undefined) {
    requireCondition(bundleVerification.runManifest.candidateRuntimeAttestationSha256 === attempt.terminal.bundle.candidateRuntimeAttestationSha256, "DEVELOPMENT_ATTEMPT_RUNTIME_ATTESTATION_DIGEST");
    requireCondition(bundleVerification.runManifest.candidateReferenceIsolation === attempt.terminal.bundle.candidateReferenceIsolation, "DEVELOPMENT_ATTEMPT_REFERENCE_ISOLATION");
  }
  return { ...attempt, bundleVerification };
}

module.exports = { ATTEMPT_RESOURCE_LIMITS, publishDevelopmentAttemptStart, publishDevelopmentAttemptTerminal, validateAttemptId, validateRunBinding, verifyCompletedDevelopmentAttempt, verifyDevelopmentAttempt };
