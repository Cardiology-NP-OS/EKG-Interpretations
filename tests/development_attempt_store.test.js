"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { publishDevelopmentAttemptStart, publishDevelopmentAttemptTerminal, verifyDevelopmentAttempt } = require("../lib/development_attempt_store");

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
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("development attempt store tests passed");
