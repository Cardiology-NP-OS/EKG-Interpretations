"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { publishDevelopmentAttemptStart, publishDevelopmentAttemptTerminal, validateRunBinding, verifyCompletedDevelopmentAttempt, verifyDevelopmentAttempt } = require("../lib/development_attempt_store");
const { publishEvaluationBundle, REQUIRED_ARTIFACTS } = require("../lib/evaluation_artifact_store");
const { payloadSha256 } = require("../lib/evaluation_signatures");
const { CANDIDATE_LAUNCH_POLICY_SHA256, deriveCandidateIsolationExpectation } = require("../lib/development_candidate_isolation");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-attempt-"));
try {
  const keys = crypto.generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  const syntheticIsolation = deriveCandidateIsolationExpectation({ networkIsolation: "SYNTHETIC_TEST_PROCESS" });
  const input = {
    attemptId: "synthetic-77-1",
    startedAtUtc: "2026-09-22T12:00:00Z",
    trigger: "synthetic-test",
    workflowRunId: "synthetic-77",
    workflowRunAttempt: 1,
    workflowSha: "a".repeat(40),
    runBinding: {
      schema: "ekg-development-run-binding-v2",
      runConfigurationSha256: "1".repeat(64),
      candidateManifestPayloadSha256: "2".repeat(64),
      executionIdentitySha256: "3".repeat(64),
      candidateRuntimeIdentitySha256: "9".repeat(64),
      manifestPayloadSha256: "4".repeat(64),
      candidateTrustStoreSha256: "5".repeat(64),
      manifestTrustStoreSha256: "6".repeat(64),
      environmentImageDigest: null,
      signerImageDigest: null,
      executionInputSha256: "7".repeat(64),
      candidateInputMode: "SIGNAL_ONLY_READ_ONLY_V1",
      candidateRuntimeImageDigest: null,
      candidateLaunchPolicySha256: CANDIDATE_LAUNCH_POLICY_SHA256,
      candidateIsolationMode: syntheticIsolation.expectation.isolationMode,
      candidateIsolationState: syntheticIsolation.expectation.attestationState,
      candidateExpectedUid: null,
      candidateExpectedGid: null,
      candidateIsolationExpectationSha256: syntheticIsolation.candidateIsolationExpectationSha256,
    },
    signingPrivateKeyPem: privateKey,
    signerKeyId: "test-signer",
  };
  const historicalV1 = { ...input.runBinding, schema: "ekg-development-run-binding-v1", candidateReferenceIsolation: false };
  for (const field of ["executionInputSha256", "candidateInputMode", "candidateRuntimeIdentitySha256", "candidateRuntimeImageDigest", "candidateLaunchPolicySha256", "candidateIsolationMode", "candidateIsolationState", "candidateExpectedUid", "candidateExpectedGid", "candidateIsolationExpectationSha256"]) delete historicalV1[field];
  assert.equal(validateRunBinding(historicalV1).candidateReferenceIsolation, false);
  assert.equal(validateRunBinding(input.runBinding).candidateIsolationState, "PENDING_EXTERNAL_CONTROL_PLANE_ATTESTATION");
  assert.equal(Object.hasOwn(input.runBinding, "candidateReferenceIsolation"), false);
  const productionIsolation = deriveCandidateIsolationExpectation({ networkIsolation: "CONTAINER_NETWORK_NONE", environmentImageDigest: "8".repeat(64), candidateExpectedUid: 1000, candidateExpectedGid: 1000 });
  const productionBinding = { ...input.runBinding, environmentImageDigest: "8".repeat(64), candidateRuntimeImageDigest: "8".repeat(64), candidateIsolationMode: productionIsolation.expectation.isolationMode, candidateExpectedUid: 1000, candidateExpectedGid: 1000, candidateIsolationExpectationSha256: productionIsolation.candidateIsolationExpectationSha256 };
  assert.equal(validateRunBinding(productionBinding).candidateIsolationState, "PENDING_EXTERNAL_CONTROL_PLANE_ATTESTATION");
  assert.throws(() => validateRunBinding({ ...productionBinding, candidateReferenceIsolation: true }), /DEVELOPMENT_ATTEMPT_RUN_BINDING_FIELDS/);
  assert.throws(() => validateRunBinding({ ...input.runBinding, candidateInputMode: "FULL_REFERENCE" }), /DEVELOPMENT_ATTEMPT_INPUT_MODE/);
  assert.throws(() => validateRunBinding({ ...input.runBinding, executionInputSha256: undefined }), /DEVELOPMENT_ATTEMPT_RUN_BINDING_DIGEST/);
  const missingImageExpectation = { ...productionIsolation.expectation, candidateRuntimeImageDigest: null };
  assert.throws(() => validateRunBinding({ ...productionBinding, candidateRuntimeImageDigest: null, candidateIsolationExpectationSha256: payloadSha256(missingImageExpectation) }), /DEVELOPMENT_CANDIDATE_IMAGE_DIGEST_REQUIRED/);
  assert.throws(() => validateRunBinding({ ...productionBinding, candidateLaunchPolicySha256: "0".repeat(64) }), /DEVELOPMENT_ATTEMPT_LAUNCH_POLICY/);
  const handle = publishDevelopmentAttemptStart(root, input);
  const incomplete = verifyDevelopmentAttempt(handle.path, publicKey, { expectedSignerKeyId: "test-signer" });
  assert.equal(incomplete.executionStatus, "INCOMPLETE");
  assert.throws(() => publishDevelopmentAttemptStart(root, input), /DEVELOPMENT_ATTEMPT_IMMUTABLE_COLLISION/);
  publishDevelopmentAttemptTerminal(handle, {
    endedAtUtc: "2026-09-22T12:01:00Z",
    executionStatus: "FAILED",
    gateStatus: "NOT_RUN",
    failureCode: "DEVELOPMENT_SIGNAL_HASH",
    lastPhase: "RUNNING",
    stateTransitions: [{ state: "VALIDATING", atUtc: input.startedAtUtc }, { state: "RUNNING", atUtc: input.startedAtUtc }, { state: "FAILED", atUtc: "2026-09-22T12:01:00Z" }],
    accounting: null,
    bundle: null,
    signingPrivateKeyPem: privateKey,
    signerKeyId: "test-signer",
  });
  const verified = verifyDevelopmentAttempt(handle.path, publicKey, { expectedSignerKeyId: "test-signer" });
  assert.equal(verified.executionStatus, "FAILED");
  assert.equal(verified.terminal.failureCode, "DEVELOPMENT_SIGNAL_HASH");
  assert.equal(JSON.stringify(verified).includes("secret"), false);
  assert.throws(() => publishDevelopmentAttemptTerminal(handle, {
    endedAtUtc: "2026-09-22T12:02:00Z",
    executionStatus: "FAILED",
    gateStatus: "NOT_RUN",
    failureCode: "OTHER_FAILURE",
    lastPhase: "RUNNING",
    stateTransitions: [],
    signingPrivateKeyPem: privateKey,
    signerKeyId: "test-signer",
  }), /DEVELOPMENT_ATTEMPT_TERMINAL_COLLISION/);
  const undeclared = path.join(handle.path, "undeclared.json");
  fs.writeFileSync(undeclared, "{}\n");
  assert.throws(() => verifyDevelopmentAttempt(handle.path, publicKey, { expectedSignerKeyId: "test-signer" }), /DEVELOPMENT_ATTEMPT_UNDECLARED_FILE/);
  fs.rmSync(undeclared);
  fs.appendFileSync(path.join(handle.path, "terminal", "terminal.json"), " ");
  assert.throws(() => verifyDevelopmentAttempt(handle.path, publicKey, { expectedSignerKeyId: "test-signer" }), /DEVELOPMENT_ATTEMPT_PAYLOAD_HASH/);
  const crossInput = { ...input, attemptId: "synthetic-cross-binding", startedAtUtc: "2026-09-23T12:00:00Z" };
  const crossHandle = publishDevelopmentAttemptStart(root, crossInput);
  const mismatchedRunBinding = { ...crossInput.runBinding, manifestPayloadSha256: "7".repeat(64) };
  const crossBundle = publishEvaluationBundle(root, {
    storageMode: "APPLICATION_WRITE_ONCE_SIGNED",
    startedAtUtc: crossInput.startedAtUtc,
    runManifest: { schema: "ekg-development-run-manifest-v1", runId: null, runIdentityDigest: "8".repeat(64), attemptId: crossInput.attemptId, startedAtUtc: crossInput.startedAtUtc, workflowRunId: crossInput.workflowRunId, workflowRunAttempt: crossInput.workflowRunAttempt, workflowSha: crossInput.workflowSha, gateStatus: "QUARANTINED", runBinding: mismatchedRunBinding, runBindingSha256: payloadSha256(mismatchedRunBinding), clinicalAccuracyClaimed: false },
    artifacts: Object.fromEntries(REQUIRED_ARTIFACTS.map(name => [name, { clinicalAccuracyClaimed: false, capabilityNotClaim: true }])),
    signingPrivateKeyPem: privateKey,
    signerKeyId: "test-signer",
  });
  publishDevelopmentAttemptTerminal(crossHandle, {
    endedAtUtc: "2026-09-23T12:01:00Z",
    executionStatus: "COMPLETED",
    gateStatus: "QUARANTINED",
    failureCode: null,
    lastPhase: "VALIDATING",
    stateTransitions: [{ state: "VALIDATING", atUtc: crossInput.startedAtUtc }, { state: "COMPLETED", atUtc: "2026-09-23T12:01:00Z" }],
    accounting: null,
    bundle: { runId: crossBundle.runId, runDigest: crossBundle.runDigest, merkleRootSha256: crossBundle.merkleRootSha256, executionInputSha256: crossInput.runBinding.executionInputSha256, executionHandoffSha256: "a".repeat(64), candidateRuntimeAttestationSha256: "b".repeat(64), candidateReferenceIsolation: false },
    signingPrivateKeyPem: privateKey,
    signerKeyId: "test-signer",
  });
  assert.throws(() => verifyCompletedDevelopmentAttempt(crossHandle.path, root, publicKey, { expectedSignerKeyId: "test-signer" }), /DEVELOPMENT_ATTEMPT_BUNDLE_RUN_BINDING/);
  const missingDigestInput = { ...input, attemptId: "synthetic-missing-digests", startedAtUtc: "2026-09-24T12:00:00Z" };
  const missingDigestHandle = publishDevelopmentAttemptStart(root, missingDigestInput);
  const missingDigestBundle = publishEvaluationBundle(root, {
    storageMode: "APPLICATION_WRITE_ONCE_SIGNED",
    startedAtUtc: missingDigestInput.startedAtUtc,
    runManifest: { schema: "ekg-development-run-manifest-v1", runId: null, runIdentityDigest: "b".repeat(64), attemptId: missingDigestInput.attemptId, startedAtUtc: missingDigestInput.startedAtUtc, workflowRunId: missingDigestInput.workflowRunId, workflowRunAttempt: missingDigestInput.workflowRunAttempt, workflowSha: missingDigestInput.workflowSha, gateStatus: "QUARANTINED", runBinding: missingDigestInput.runBinding, runBindingSha256: payloadSha256(missingDigestInput.runBinding), clinicalAccuracyClaimed: false },
    artifacts: Object.fromEntries(REQUIRED_ARTIFACTS.map(name => [name, { clinicalAccuracyClaimed: false, capabilityNotClaim: true }])),
    signingPrivateKeyPem: privateKey,
    signerKeyId: "test-signer",
  });
  publishDevelopmentAttemptTerminal(missingDigestHandle, { endedAtUtc: "2026-09-24T12:01:00Z", executionStatus: "COMPLETED", gateStatus: "QUARANTINED", failureCode: null, lastPhase: "VALIDATING", stateTransitions: [{ state: "VALIDATING", atUtc: missingDigestInput.startedAtUtc }, { state: "COMPLETED", atUtc: "2026-09-24T12:01:00Z" }], accounting: null, bundle: { runId: missingDigestBundle.runId, runDigest: missingDigestBundle.runDigest, merkleRootSha256: missingDigestBundle.merkleRootSha256 }, signingPrivateKeyPem: privateKey, signerKeyId: "test-signer" });
  assert.throws(() => verifyCompletedDevelopmentAttempt(missingDigestHandle.path, root, publicKey, { expectedSignerKeyId: "test-signer" }), /DEVELOPMENT_ATTEMPT_V2_DIGESTS_REQUIRED/);
  const terminalMismatchInput = { ...input, attemptId: "synthetic-terminal-mismatch", startedAtUtc: "2026-09-25T12:00:00Z" };
  const terminalMismatchHandle = publishDevelopmentAttemptStart(root, terminalMismatchInput);
  const terminalMismatchBundle = publishEvaluationBundle(root, { storageMode: "APPLICATION_WRITE_ONCE_SIGNED", startedAtUtc: terminalMismatchInput.startedAtUtc, runManifest: { schema: "ekg-development-run-manifest-v1", runId: null, runIdentityDigest: "d".repeat(64), attemptId: terminalMismatchInput.attemptId, startedAtUtc: terminalMismatchInput.startedAtUtc, workflowRunId: terminalMismatchInput.workflowRunId, workflowRunAttempt: terminalMismatchInput.workflowRunAttempt, workflowSha: terminalMismatchInput.workflowSha, gateStatus: "QUARANTINED", runBinding: terminalMismatchInput.runBinding, runBindingSha256: payloadSha256(terminalMismatchInput.runBinding), executionInputSha256: terminalMismatchInput.runBinding.executionInputSha256, executionHandoffSha256: "a".repeat(64), candidateRuntimeAttestationSha256: "b".repeat(64), candidateReferenceIsolation: false, clinicalAccuracyClaimed: false }, artifacts: Object.fromEntries(REQUIRED_ARTIFACTS.map(name => [name, { clinicalAccuracyClaimed: false, capabilityNotClaim: true }])), signingPrivateKeyPem: privateKey, signerKeyId: "test-signer" });
  publishDevelopmentAttemptTerminal(terminalMismatchHandle, { endedAtUtc: "2026-09-25T12:01:00Z", executionStatus: "COMPLETED", gateStatus: "QUARANTINED", failureCode: null, lastPhase: "VALIDATING", stateTransitions: [{ state: "VALIDATING", atUtc: terminalMismatchInput.startedAtUtc }, { state: "COMPLETED", atUtc: "2026-09-25T12:01:00Z" }], accounting: null, bundle: { runId: terminalMismatchBundle.runId, runDigest: terminalMismatchBundle.runDigest, merkleRootSha256: terminalMismatchBundle.merkleRootSha256, executionInputSha256: "0".repeat(64), executionHandoffSha256: "a".repeat(64), candidateRuntimeAttestationSha256: "b".repeat(64), candidateReferenceIsolation: false }, signingPrivateKeyPem: privateKey, signerKeyId: "test-signer" });
  assert.throws(() => verifyCompletedDevelopmentAttempt(terminalMismatchHandle.path, root, publicKey, { expectedSignerKeyId: "test-signer" }), /DEVELOPMENT_ATTEMPT_INPUT_BINDING/);
  const contradictoryHandle = publishDevelopmentAttemptStart(root, { ...input, attemptId: "synthetic-77-2" });
  assert.throws(() => publishDevelopmentAttemptTerminal(contradictoryHandle, {
    endedAtUtc: "2026-09-22T12:01:00Z",
    executionStatus: "FAILED",
    gateStatus: "NOT_RUN",
    failureCode: "DEVELOPMENT_SIGNAL_HASH",
    lastPhase: "RUNNING",
    stateTransitions: [{ state: "VALIDATING", atUtc: input.startedAtUtc }, { state: "RUNNING", atUtc: input.startedAtUtc }, { state: "COMPLETED", atUtc: "2026-09-22T12:01:00Z" }],
    accounting: null,
    bundle: null,
    signingPrivateKeyPem: privateKey,
    signerKeyId: "test-signer",
  }), /DEVELOPMENT_ATTEMPT_TERMINAL_STATE/);
  const legacyDir = path.join(root, "attempts", "2026", "09", "21", "legacy-1");
  fs.mkdirSync(legacyDir, { recursive: true });
  const legacyPayload = { schema: "ekg-development-attempt-start-v1", attemptId: "legacy-1", startedAtUtc: "2026-09-21T12:00:00Z", trigger: "merge-or-nightly", workflowRunId: "legacy-workflow", workflowRunAttempt: 1, workflowSha: "b".repeat(40), clinicalAccuracyClaimed: false, capabilityNotClaim: true, reportable: false, runtimeAuthority: false, projectGold: false, sourceLabelsAreProjectGold: false };
  const legacyBody = Buffer.from(`${JSON.stringify(legacyPayload, null, 2)}\n`, "utf8");
  const legacyPayloadSha256 = crypto.createHash("sha256").update(legacyBody).digest("hex");
  const legacySignature = { schema: "ekg-development-attempt-start-signature-v1", algorithm: "Ed25519", signerKeyId: "test-signer", payloadSha256: legacyPayloadSha256, signatureBase64: crypto.sign(null, legacyBody, privateKey).toString("base64") };
  fs.writeFileSync(path.join(legacyDir, "start.json"), legacyBody);
  fs.writeFileSync(path.join(legacyDir, "start.signature.json"), `${JSON.stringify(legacySignature, null, 2)}\n`);
  const legacyVerified = verifyDevelopmentAttempt(legacyDir, publicKey, { expectedSignerKeyId: "test-signer" });
  assert.equal(legacyVerified.executionStatus, "INCOMPLETE");
  assert.equal(legacyVerified.start.schema, "ekg-development-attempt-start-v1");
  const legacyBundle = publishEvaluationBundle(root, { storageMode: "APPLICATION_WRITE_ONCE_SIGNED", startedAtUtc: legacyPayload.startedAtUtc, runManifest: { schema: "ekg-development-run-manifest-v1", runId: null, runIdentityDigest: "c".repeat(64), attemptId: legacyPayload.attemptId, startedAtUtc: legacyPayload.startedAtUtc, workflowRunId: legacyPayload.workflowRunId, workflowRunAttempt: legacyPayload.workflowRunAttempt, workflowSha: legacyPayload.workflowSha, gateStatus: "QUARANTINED", clinicalAccuracyClaimed: false }, artifacts: Object.fromEntries(REQUIRED_ARTIFACTS.map(name => [name, { clinicalAccuracyClaimed: false, capabilityNotClaim: true }])), signingPrivateKeyPem: privateKey, signerKeyId: "test-signer" });
  publishDevelopmentAttemptTerminal({ attemptId: legacyPayload.attemptId, path: legacyDir, startPayloadSha256: legacyPayloadSha256 }, { endedAtUtc: "2026-09-21T12:01:00Z", executionStatus: "COMPLETED", gateStatus: "QUARANTINED", failureCode: null, lastPhase: "VALIDATING", stateTransitions: [{ state: "VALIDATING", atUtc: legacyPayload.startedAtUtc }, { state: "COMPLETED", atUtc: "2026-09-21T12:01:00Z" }], accounting: null, bundle: { runId: legacyBundle.runId, runDigest: legacyBundle.runDigest, merkleRootSha256: legacyBundle.merkleRootSha256 }, signingPrivateKeyPem: privateKey, signerKeyId: "test-signer" });
  assert.equal(verifyCompletedDevelopmentAttempt(legacyDir, root, publicKey, { expectedSignerKeyId: "test-signer" }).executionStatus, "COMPLETED");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("development attempt store tests passed");
