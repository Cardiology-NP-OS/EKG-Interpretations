"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { publishDevelopmentAttemptStart, publishDevelopmentAttemptTerminal, verifyCompletedDevelopmentAttempt, verifyDevelopmentAttempt } = require("../lib/development_attempt_store");
const { publishEvaluationBundle, REQUIRED_ARTIFACTS } = require("../lib/evaluation_artifact_store");
const { payloadSha256 } = require("../lib/evaluation_signatures");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ekg-development-attempt-"));
try {
  const keys = crypto.generateKeyPairSync("ed25519");
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" });
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" });
  const input = {
    attemptId: "synthetic-77-1",
    startedAtUtc: "2026-09-22T12:00:00Z",
    trigger: "synthetic-test",
    workflowRunId: "synthetic-77",
    workflowRunAttempt: 1,
    workflowSha: "a".repeat(40),
    runBinding: {
      schema: "ekg-development-run-binding-v1",
      runConfigurationSha256: "1".repeat(64),
      candidateManifestPayloadSha256: "2".repeat(64),
      executionIdentitySha256: "3".repeat(64),
      manifestPayloadSha256: "4".repeat(64),
      candidateTrustStoreSha256: "5".repeat(64),
      manifestTrustStoreSha256: "6".repeat(64),
      environmentImageDigest: null,
      signerImageDigest: null,
      candidateReferenceIsolation: false,
    },
    signingPrivateKeyPem: privateKey,
    signerKeyId: "test-signer",
  };
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
    bundle: { runId: crossBundle.runId, runDigest: crossBundle.runDigest, merkleRootSha256: crossBundle.merkleRootSha256 },
    signingPrivateKeyPem: privateKey,
    signerKeyId: "test-signer",
  });
  assert.throws(() => verifyCompletedDevelopmentAttempt(crossHandle.path, root, publicKey, { expectedSignerKeyId: "test-signer" }), /DEVELOPMENT_ATTEMPT_BUNDLE_RUN_BINDING/);
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
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("development attempt store tests passed");
